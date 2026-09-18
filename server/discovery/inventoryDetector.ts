import { DatasetVersion } from '../datasets/types.js';
import { DetectorContext, Insight, InsightSeverity } from './types.js';
import {
  bestColumn,
  columnIndex,
  isDate,
  isNumeric,
  insightFor,
  numberValue,
} from './detectorUtils.js';

export const INVENTORY_DETECTOR_ID = 'inventory.threshold';
export const INVENTORY_DETECTOR_VERSION = 'v1';

export function detectInventoryThresholds(
  context: DetectorContext,
  version: DatasetVersion
): Insight[] {
  const insights: Insight[] = [];

  for (const table of version.tables) {
    const stock = bestColumn(
      table,
      [
        'current stock',
        'stock on hand',
        'quantity on hand',
        'on hand',
        'stock',
        'inventory',
      ],
      isNumeric
    );
    const threshold = bestColumn(
      table,
      [
        'reorder level',
        'reorder point',
        'minimum stock',
        'min stock',
        'safety stock',
      ],
      isNumeric
    );

    if (!stock || !threshold || stock.name === threshold.name) continue;

    const entity = bestColumn(
      table,
      ['product name', 'product', 'item name', 'item', 'sku', 'name'],
      (column) => !isNumeric(column) && !isDate(column)
    );

    const stockIndex = columnIndex(table, stock);
    const thresholdIndex = columnIndex(table, threshold);
    const entityIndex = entity ? columnIndex(table, entity) : -1;

    const risky: Array<{
      rowIndex: number;
      stock: number;
      threshold: number;
      entity?: string;
    }> = [];

    table.rows.forEach((row, rowIndex) => {
      const stockValue = numberValue(row[stockIndex] ?? null);
      const thresholdValue = numberValue(row[thresholdIndex] ?? null);

      if (
        stockValue === null ||
        thresholdValue === null ||
        stockValue > thresholdValue
      ) {
        return;
      }

      risky.push({
        rowIndex,
        stock: stockValue,
        threshold: thresholdValue,
        entity:
          entityIndex >= 0 && row[entityIndex] !== null
            ? String(row[entityIndex])
            : undefined,
      });
    });

    if (risky.length === 0) continue;

    const stockouts = risky.filter((item) => item.stock <= 0).length;
    const ratio = table.rowCount === 0 ? 0 : risky.length / table.rowCount;

    const severity: InsightSeverity =
      stockouts > 0 ? 'HIGH' : ratio >= 0.2 ? 'MEDIUM' : 'LOW';

    insights.push(
      insightFor({
        context,
        version,
        table,
        detectorId: INVENTORY_DETECTOR_ID,
        detectorVersion: INVENTORY_DETECTOR_VERSION,
        type: 'RISK',
        severity,
        title:
          stockouts > 0
            ? String(stockouts) +
              ' item' +
              (stockouts === 1 ? '' : 's') +
              ' are out of stock'
            : String(risky.length) +
              ' item' +
              (risky.length === 1 ? '' : 's') +
              ' reached reorder level',
        summary:
          String(risky.length) +
          ' of ' +
          String(table.rowCount) +
          ' records have ' +
          stock.name +
          ' at or below ' +
          threshold.name +
          '.',
        confidence: 0.97,
        calculation:
          'Select rows where ' +
          stock.name +
          ' <= ' +
          threshold.name +
          '. No risk is inferred unless both stock and explicit reorder/minimum columns exist.',
        values: {
          stockColumn: stock.name,
          thresholdColumn: threshold.name,
          affectedRecords: risky.length,
          totalRecords: table.rowCount,
          affectedRatio: ratio,
          stockoutRecords: stockouts,
        },
        rowReferences: risky.slice(0, 10).map((item) => ({
          rowIndex: item.rowIndex,
          values: {
            ...(entity ? { [entity.name]: item.entity || null } : {}),
            [stock.name]: item.stock,
            [threshold.name]: item.threshold,
          },
        })),
        fingerprintParts: [
          stock.name,
          threshold.name,
          risky.length,
          stockouts,
          table.rowCount,
        ],
      })
    );
  }

  return insights;
}
