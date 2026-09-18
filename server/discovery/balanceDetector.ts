import { DatasetVersion } from '../datasets/types.js';
import { DetectorContext, Insight, InsightSeverity } from './types.js';
import {
  bestColumn,
  columnIndex,
  entityColumn,
  formatNumber,
  isDate,
  isNumeric,
  insightFor,
  numberValue,
  parseDate,
} from './detectorUtils.js';

export const BALANCE_DETECTOR_ID = 'balance.outstanding';
export const BALANCE_DETECTOR_VERSION = 'v1';

export function detectOutstandingBalances(
  context: DetectorContext,
  version: DatasetVersion
): Insight[] {
  const insights: Insight[] = [];

  for (const table of version.tables) {
    const balance = bestColumn(
      table,
      [
        'outstanding balance',
        'balance due',
        'amount due',
        'remaining balance',
        'remaining amount',
        'outstanding',
        'balance',
      ],
      isNumeric
    );
    if (!balance) continue;

    const dueDate = bestColumn(
      table,
      ['due date', 'payment due', 'payment deadline', 'deadline'],
      isDate
    );
    const entity = entityColumn(table);

    const balanceIndex = columnIndex(table, balance);
    const dueIndex = dueDate ? columnIndex(table, dueDate) : -1;
    const entityIndex = entity ? columnIndex(table, entity) : -1;

    const positive: Array<{
      rowIndex: number;
      balance: number;
      due?: number;
      entity?: string;
    }> = [];

    table.rows.forEach((row, rowIndex) => {
      const value = numberValue(row[balanceIndex] ?? null);
      if (value === null || value <= 0) return;

      const due = dueDate ? parseDate(row[dueIndex] ?? null) : null;
      positive.push({
        rowIndex,
        balance: value,
        due: due === null ? undefined : due,
        entity:
          entityIndex >= 0 && row[entityIndex] !== null
            ? String(row[entityIndex])
            : undefined,
      });
    });

    if (positive.length === 0) continue;

    const overdue = dueDate
      ? positive.filter(
          (item) =>
            item.due !== undefined && item.due < context.referenceTime
        )
      : [];
    const relevant = dueDate ? overdue : positive;
    if (relevant.length === 0) continue;

    const total = relevant.reduce((sum, item) => sum + item.balance, 0);
    const sorted = [...relevant].sort((a, b) => b.balance - a.balance);
    const top = sorted[0];
    const overdueMode = Boolean(dueDate);

    const severity: InsightSeverity = overdueMode
      ? relevant.length >= 3
        ? 'HIGH'
        : 'MEDIUM'
      : relevant.length >= 5
        ? 'MEDIUM'
        : 'LOW';

    insights.push(
      insightFor({
        context,
        version,
        table,
        detectorId: BALANCE_DETECTOR_ID,
        detectorVersion: BALANCE_DETECTOR_VERSION,
        type: 'RISK',
        severity,
        title: overdueMode
          ? String(relevant.length) +
            ' overdue balance' +
            (relevant.length === 1 ? '' : 's') +
            ' total ' +
            formatNumber(total)
          : formatNumber(total) + ' remains outstanding',
        summary: top.entity
          ? String(relevant.length) +
            ' record' +
            (relevant.length === 1 ? '' : 's') +
            ' have positive ' +
            balance.name +
            '. The largest is ' +
            top.entity +
            ' at ' +
            formatNumber(top.balance) +
            '.'
          : String(relevant.length) +
            ' record' +
            (relevant.length === 1 ? '' : 's') +
            ' have positive ' +
            balance.name +
            ', totaling ' +
            formatNumber(total) +
            '.',
        confidence: overdueMode ? 0.96 : 0.9,
        calculation: overdueMode
          ? 'Select rows where ' +
            balance.name +
            ' > 0 and ' +
            dueDate!.name +
            ' is before the analysis reference time, then SUM ' +
            balance.name +
            '.'
          : 'Select rows where ' +
            balance.name +
            ' > 0, then SUM ' +
            balance.name +
            '.',
        values: {
          balanceColumn: balance.name,
          dueDateColumn: dueDate?.name || null,
          affectedRecords: relevant.length,
          totalOutstanding: total,
          largestOutstanding: top.balance,
          largestEntity: top.entity || null,
        },
        rowReferences: sorted.slice(0, 10).map((item) => ({
          rowIndex: item.rowIndex,
          values: {
            ...(entity ? { [entity.name]: item.entity || null } : {}),
            [balance.name]: item.balance,
            ...(dueDate
              ? {
                  [dueDate.name]:
                    item.due !== undefined
                      ? new Date(item.due).toISOString().slice(0, 10)
                      : null,
                }
              : {}),
          },
        })),
        fingerprintParts: [
          balance.name,
          dueDate?.name || null,
          relevant.length,
          total,
          top.balance,
        ],
      })
    );
  }

  return insights;
}
