import { DatasetVersion } from '../datasets/types.js';
import { DetectorContext, Insight } from './types.js';
import {
  insightFor,
  normalizeName,
  severityForPercent,
} from './detectorUtils.js';

export const VERSION_CHANGE_DETECTOR_ID = 'version.change';
export const VERSION_CHANGE_DETECTOR_VERSION = 'v1';

export function detectVersionChanges(
  context: DetectorContext,
  previous: DatasetVersion,
  current: DatasetVersion
): Insight[] {
  const insights: Insight[] = [];

  for (const currentTable of current.tables) {
    const previousTable = previous.tables.find(
      (table) => normalizeName(table.name) === normalizeName(currentTable.name)
    );
    if (!previousTable) continue;

    if (previousTable.rowCount > 0) {
      const absoluteChange = currentTable.rowCount - previousTable.rowCount;
      const percentChange =
        (absoluteChange / previousTable.rowCount) * 100;

      if (
        Math.abs(absoluteChange) >= 2 &&
        Math.abs(percentChange) >= 20
      ) {
        const direction = percentChange > 0 ? 'increased' : 'decreased';

        insights.push(
          insightFor({
            context,
            version: current,
            table: currentTable,
            detectorId: VERSION_CHANGE_DETECTOR_ID,
            detectorVersion: VERSION_CHANGE_DETECTOR_VERSION,
            type: 'CHANGE',
            severity: severityForPercent(percentChange),
            title:
              currentTable.name +
              ' row count ' +
              direction +
              ' ' +
              Math.abs(percentChange).toFixed(1) +
              '%',
            summary:
              'Dataset version ' +
              String(previous.versionNumber) +
              ' had ' +
              String(previousTable.rowCount) +
              ' rows; version ' +
              String(current.versionNumber) +
              ' has ' +
              String(currentTable.rowCount) +
              ' rows.',
            confidence: 1,
            calculation:
              'Compare rowCount for the same normalized table name across two consecutive immutable dataset versions. Emit when absolute row change is at least 2 and absolute percentage change is at least 20%.',
            values: {
              previousVersionId: previous.id,
              previousVersionNumber: previous.versionNumber,
              previousSourceSha256: previous.source.sha256,
              currentVersionId: current.id,
              currentVersionNumber: current.versionNumber,
              previousRowCount: previousTable.rowCount,
              currentRowCount: currentTable.rowCount,
              absoluteChange,
              percentChange,
            },
            fingerprintParts: [
              'row-count',
              previous.id,
              current.id,
              previousTable.rowCount,
              currentTable.rowCount,
            ],
          })
        );
      }
    }

    const previousColumns = new Set(
      previousTable.columns.map((column) =>
        normalizeName(column.normalizedName || column.name)
      )
    );
    const currentColumns = new Set(
      currentTable.columns.map((column) =>
        normalizeName(column.normalizedName || column.name)
      )
    );

    const added = Array.from(currentColumns).filter(
      (column) => !previousColumns.has(column)
    );
    const removed = Array.from(previousColumns).filter(
      (column) => !currentColumns.has(column)
    );

    if (added.length > 0 || removed.length > 0) {
      const parts: string[] = [];
      if (added.length > 0) parts.push('added: ' + added.join(', '));
      if (removed.length > 0) parts.push('removed: ' + removed.join(', '));

      insights.push(
        insightFor({
          context,
          version: current,
          table: currentTable,
          detectorId: VERSION_CHANGE_DETECTOR_ID,
          detectorVersion: VERSION_CHANGE_DETECTOR_VERSION,
          type: 'CHANGE',
          severity: removed.length > 0 ? 'MEDIUM' : 'LOW',
          title: currentTable.name + ' schema changed',
          summary:
            'Between dataset versions ' +
            String(previous.versionNumber) +
            ' and ' +
            String(current.versionNumber) +
            ', columns changed (' +
            parts.join('; ') +
            ').',
          confidence: 1,
          calculation:
            'Normalize column names and compare the exact schema sets of consecutive immutable dataset versions.',
          values: {
            previousVersionId: previous.id,
            previousVersionNumber: previous.versionNumber,
            previousSourceSha256: previous.source.sha256,
            currentVersionId: current.id,
            currentVersionNumber: current.versionNumber,
            addedColumns: added.join(', ') || null,
            removedColumns: removed.join(', ') || null,
          },
          fingerprintParts: [
            'schema',
            previous.id,
            current.id,
            added.join('|'),
            removed.join('|'),
          ],
        })
      );
    }
  }

  return insights;
}
