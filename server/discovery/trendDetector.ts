import { DatasetVersion } from '../datasets/types.js';
import { DetectorContext, Insight } from './types.js';
import {
  bestColumn,
  columnIndex,
  formatNumber,
  isDate,
  isNumeric,
  insightFor,
  monthKey,
  numberValue,
  parseDate,
  severityForPercent,
} from './detectorUtils.js';

export const TREND_DETECTOR_ID = 'trend.change';
export const TREND_DETECTOR_VERSION = 'v1';

export function detectTrendChanges(
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
    const buckets = new Map<string, { total: number; rows: number }>();

    for (const row of table.rows) {
      const timestamp = parseDate(row[dateIndex] ?? null);
      const value = numberValue(row[measureIndex] ?? null);
      if (timestamp === null || value === null) continue;

      const key = monthKey(timestamp);
      const bucket = buckets.get(key) || { total: 0, rows: 0 };
      bucket.total += value;
      bucket.rows += 1;
      buckets.set(key, bucket);
    }

    const reference = new Date(context.referenceTime);
    const currentMonth =
      String(reference.getUTCFullYear()) +
      '-' +
      String(reference.getUTCMonth() + 1).padStart(2, '0');

    const completeMonths = Array.from(buckets.entries())
      .filter(([key, bucket]) => key < currentMonth && bucket.rows >= 2)
      .sort(([left], [right]) => left.localeCompare(right));

    if (completeMonths.length < 2) continue;

    const previousEntry = completeMonths[completeMonths.length - 2];
    const currentEntry = completeMonths[completeMonths.length - 1];
    const previousKey = previousEntry[0];
    const previous = previousEntry[1];
    const currentKey = currentEntry[0];
    const current = currentEntry[1];

    if (previous.total === 0) continue;

    const absoluteChange = current.total - previous.total;
    const percentChange = (absoluteChange / previous.total) * 100;
    if (Math.abs(percentChange) < 15) continue;

    const direction = percentChange > 0 ? 'increased' : 'decreased';
    const confidence = Math.min(
      0.96,
      0.76 + Math.min(previous.rows + current.rows, 20) * 0.01
    );

    insights.push(
      insightFor({
        context,
        version,
        table,
        detectorId: TREND_DETECTOR_ID,
        detectorVersion: TREND_DETECTOR_VERSION,
        type: 'CHANGE',
        severity: severityForPercent(percentChange),
        title:
          measure.name +
          ' ' +
          direction +
          ' ' +
          Math.abs(percentChange).toFixed(1) +
          '%',
        summary:
          measure.name +
          ' changed from ' +
          formatNumber(previous.total) +
          ' in ' +
          previousKey +
          ' to ' +
          formatNumber(current.total) +
          ' in ' +
          currentKey +
          '.',
        confidence,
        calculation:
          'Group valid rows by complete calendar month, SUM the selected business measure, then compare the latest two complete months. Emit only when absolute percentage change is at least 15%.',
        values: {
          measure: measure.name,
          previousPeriod: previousKey,
          currentPeriod: currentKey,
          previousValue: previous.total,
          currentValue: current.total,
          absoluteChange,
          percentChange,
          previousRowCount: previous.rows,
          currentRowCount: current.rows,
        },
        fingerprintParts: [
          measure.name,
          previousKey,
          currentKey,
          previous.total,
          current.total,
        ],
      })
    );
  }

  return insights;
}
