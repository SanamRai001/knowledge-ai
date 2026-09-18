import { DatasetVersion } from '../datasets/types.js';
import { DetectorContext, Insight, InsightSeverity } from './types.js';
import {
  bestColumn,
  columnIndex,
  isDate,
  isNumeric,
  insightFor,
  monthKey,
  numberValue,
  parseDate,
} from './detectorUtils.js';

export const ANOMALY_DETECTOR_ID = 'trend.anomaly';
export const ANOMALY_DETECTOR_VERSION = 'v1';

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], mean: number): number {
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    values.length;
  return Math.sqrt(variance);
}

export function detectTrendAnomalies(
  context: DetectorContext,
  version: DatasetVersion
): Insight[] {
  const insights: Insight[] = [];

  for (const table of version.tables) {
    const dateColumn = table.columns.find(isDate) || null;
    const measure = bestColumn(
      table,
      [
        'revenue',
        'net sales',
        'gross sales',
        'sales amount',
        'grand total',
        'order total',
        'total amount',
        'amount',
        'total',
      ],
      isNumeric
    );
    if (!dateColumn || !measure) continue;

    const dateIndex = columnIndex(table, dateColumn);
    const measureIndex = columnIndex(table, measure);
    const monthly = new Map<string, { total: number; rows: number }>();

    for (const row of table.rows) {
      const timestamp = parseDate(row[dateIndex] ?? null);
      const value = numberValue(row[measureIndex] ?? null);
      if (timestamp === null || value === null) continue;

      const key = monthKey(timestamp);
      const bucket = monthly.get(key) || { total: 0, rows: 0 };
      bucket.total += value;
      bucket.rows += 1;
      monthly.set(key, bucket);
    }

    const reference = new Date(context.referenceTime);
    const currentMonth =
      String(reference.getUTCFullYear()) +
      '-' +
      String(reference.getUTCMonth() + 1).padStart(2, '0');

    const complete = Array.from(monthly.entries())
      .filter(([key, bucket]) => key < currentMonth && bucket.rows >= 2)
      .sort(([left], [right]) => left.localeCompare(right));

    if (complete.length < 4) continue;

    const latest = complete[complete.length - 1];
    const baselineEntries = complete.slice(
      Math.max(0, complete.length - 7),
      complete.length - 1
    );
    if (baselineEntries.length < 3) continue;

    const baselineValues = baselineEntries.map((entry) => entry[1].total);
    const mean = average(baselineValues);
    if (mean === 0) continue;

    const deviationPercent = ((latest[1].total - mean) / mean) * 100;
    const sd = standardDeviation(baselineValues, mean);
    const zScore = sd === 0 ? null : (latest[1].total - mean) / sd;

    const anomalous =
      (zScore !== null && Math.abs(zScore) >= 2) ||
      (sd === 0 && Math.abs(deviationPercent) >= 30);
    if (!anomalous) continue;

    const severity: InsightSeverity =
      (zScore !== null && Math.abs(zScore) >= 3) ||
      Math.abs(deviationPercent) >= 50
        ? 'HIGH'
        : 'MEDIUM';

    const direction = deviationPercent > 0 ? 'above' : 'below';

    insights.push(
      insightFor({
        context,
        version,
        table,
        detectorId: ANOMALY_DETECTOR_ID,
        detectorVersion: ANOMALY_DETECTOR_VERSION,
        type: 'ANOMALY',
        severity,
        title:
          measure.name +
          ' is unusually ' +
          (deviationPercent > 0 ? 'high' : 'low') +
          ' in ' +
          latest[0],
        summary:
          measure.name +
          ' is ' +
          Math.abs(deviationPercent).toFixed(1) +
          '% ' +
          direction +
          ' the prior ' +
          String(baselineEntries.length) +
          '-month baseline average.',
        confidence: baselineEntries.length >= 6 ? 0.94 : 0.88,
        calculation:
          'SUM the selected measure by complete calendar month. Compare the latest complete month against the mean and population standard deviation of the previous 3 to 6 complete months. Emit when |z-score| >= 2, or when the baseline standard deviation is zero and deviation is at least 30%.',
        values: {
          measure: measure.name,
          latestPeriod: latest[0],
          latestValue: latest[1].total,
          baselineMonths: baselineEntries.length,
          baselineMean: mean,
          baselineStdDev: sd,
          deviationPercent,
          zScore,
        },
        fingerprintParts: [
          measure.name,
          latest[0],
          latest[1].total,
          mean,
          sd,
        ],
      })
    );
  }

  return insights;
}
