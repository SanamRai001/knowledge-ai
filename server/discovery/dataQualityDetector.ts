import { DatasetVersion } from '../datasets/types.js';
import { DetectorContext, Insight } from './types.js';
import { insightFor } from './detectorUtils.js';

export const DATA_QUALITY_DETECTOR_ID = 'data-quality';
export const DATA_QUALITY_DETECTOR_VERSION = 'v1';

export function detectDataQuality(
  context: DetectorContext,
  version: DatasetVersion
): Insight[] {
  const insights: Insight[] = [];

  for (const table of version.tables) {
    if (table.rowCount <= 0) continue;

    const duplicateRatio = table.duplicateRowCount / table.rowCount;

    if (table.duplicateRowCount >= 2 && duplicateRatio >= 0.02) {
      insights.push(
        insightFor({
          context,
          version,
          table,
          detectorId: DATA_QUALITY_DETECTOR_ID,
          detectorVersion: DATA_QUALITY_DETECTOR_VERSION,
          type: 'DATA_QUALITY',
          severity: duplicateRatio >= 0.1 ? 'MEDIUM' : 'LOW',
          title:
            String(table.duplicateRowCount) +
            ' duplicate rows may affect analysis',
          summary:
            (duplicateRatio * 100).toFixed(1) +
            '% of ' +
            table.name +
            ' rows are duplicates. They remain preserved in the source data.',
          confidence: 1,
          calculation:
            'Use the duplicate-row count recorded during deterministic ingestion and divide it by total row count.',
          values: {
            duplicateRows: table.duplicateRowCount,
            totalRows: table.rowCount,
            duplicateRatio,
          },
          fingerprintParts: [
            'duplicates',
            table.duplicateRowCount,
            table.rowCount,
          ],
        })
      );
    }

    const missing = table.columns
      .map((column) => ({
        column,
        ratio:
          table.rowCount === 0
            ? 0
            : column.missingCount / table.rowCount,
      }))
      .filter(
        (item) =>
          item.column.missingCount >= 3 &&
          item.ratio >= 0.1
      )
      .sort((a, b) => b.ratio - a.ratio)[0];

    if (!missing) continue;

    insights.push(
      insightFor({
        context,
        version,
        table,
        detectorId: DATA_QUALITY_DETECTOR_ID,
        detectorVersion: DATA_QUALITY_DETECTOR_VERSION,
        type: 'DATA_QUALITY',
        severity: missing.ratio >= 0.3 ? 'MEDIUM' : 'LOW',
        title:
          missing.column.name +
          ' is missing in ' +
          (missing.ratio * 100).toFixed(1) +
          '% of rows',
        summary:
          String(missing.column.missingCount) +
          ' of ' +
          String(table.rowCount) +
          ' rows have no value for ' +
          missing.column.name +
          ', which may reduce the reliability of analyses that depend on it.',
        confidence: 1,
        calculation:
          'Use ingestion-time missing-value counts and divide the highest materially incomplete column by total row count.',
        values: {
          column: missing.column.name,
          missingValues: missing.column.missingCount,
          totalRows: table.rowCount,
          missingRatio: missing.ratio,
        },
        fingerprintParts: [
          'missing',
          missing.column.name,
          missing.column.missingCount,
          table.rowCount,
        ],
      })
    );
  }

  return insights;
}
