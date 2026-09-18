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

export const CONCENTRATION_DETECTOR_ID = 'customer.concentration';
export const CONCENTRATION_DETECTOR_VERSION = 'v1';

export function detectCustomerConcentration(
  context: DetectorContext,
  version: DatasetVersion
): Insight[] {
  const insights: Insight[] = [];

  for (const table of version.tables) {
    const customer = bestColumn(
      table,
      ['customer name', 'customer', 'client name', 'client', 'buyer'],
      (column) => !isNumeric(column) && !isDate(column)
    );
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
    if (!customer || !measure) continue;

    const customerIndex = columnIndex(table, customer);
    const measureIndex = columnIndex(table, measure);
    const totals = new Map<string, number>();
    let grandTotal = 0;

    for (const row of table.rows) {
      const name =
        row[customerIndex] === null ? '' : String(row[customerIndex]).trim();
      const value = numberValue(row[measureIndex] ?? null);
      if (!name || value === null || value < 0) continue;
      totals.set(name, (totals.get(name) || 0) + value);
      grandTotal += value;
    }

    if (totals.size < 3 || grandTotal <= 0) continue;

    const ranked = Array.from(totals.entries()).sort(
      (left, right) => right[1] - left[1]
    );
    const top = ranked[0];
    const share = top[1] / grandTotal;
    if (share < 0.4) continue;

    const severity: InsightSeverity =
      share >= 0.6 ? 'HIGH' : share >= 0.45 ? 'MEDIUM' : 'LOW';

    insights.push(
      insightFor({
        context,
        version,
        table,
        detectorId: CONCENTRATION_DETECTOR_ID,
        detectorVersion: CONCENTRATION_DETECTOR_VERSION,
        type: 'RISK',
        severity,
        title:
          top[0] +
          ' represents ' +
          (share * 100).toFixed(1) +
          '% of ' +
          measure.name,
        summary:
          'The largest customer contributes ' +
          top[1].toLocaleString('en-US', { maximumFractionDigits: 2 }) +
          ' of ' +
          grandTotal.toLocaleString('en-US', { maximumFractionDigits: 2 }) +
          ' across ' +
          String(totals.size) +
          ' customers. This is a concentration signal, not a prediction of customer loss.',
        confidence: 0.96,
        calculation:
          'Group valid non-negative business-measure rows by explicit customer/client column, SUM the measure, divide the largest customer total by the grand total, and emit when the largest share is at least 40%.',
        values: {
          customerColumn: customer.name,
          measure: measure.name,
          topCustomer: top[0],
          topCustomerValue: top[1],
          grandTotal,
          distinctCustomers: totals.size,
          topCustomerShare: share,
        },
        fingerprintParts: [
          customer.name,
          measure.name,
          top[0],
          top[1],
          grandTotal,
        ],
      })
    );
  }

  return insights;
}
