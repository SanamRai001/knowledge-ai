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

export const MARGIN_DETECTOR_ID = 'margin.opportunity';
export const MARGIN_DETECTOR_VERSION = 'v1';

export function detectMarginOpportunities(
  context: DetectorContext,
  version: DatasetVersion
): Insight[] {
  const insights: Insight[] = [];

  for (const table of version.tables) {
    const product = bestColumn(
      table,
      ['product name', 'product', 'item name', 'item', 'sku'],
      (column) => !isNumeric(column) && !isDate(column)
    );
    const revenue = bestColumn(
      table,
      [
        'revenue',
        'net sales',
        'gross sales',
        'sales amount',
        'grand total',
        'order total',
        'total amount',
      ],
      isNumeric
    );
    const cost = bestColumn(
      table,
      [
        'total cost',
        'cost amount',
        'cost of goods',
        'cogs',
        'cost',
      ],
      isNumeric
    );
    if (!product || !revenue || !cost || revenue.name === cost.name) continue;

    const productIndex = columnIndex(table, product);
    const revenueIndex = columnIndex(table, revenue);
    const costIndex = columnIndex(table, cost);

    const groups = new Map<
      string,
      { revenue: number; cost: number; rows: number }
    >();
    let totalRevenue = 0;
    let totalCost = 0;

    for (const row of table.rows) {
      const name =
        row[productIndex] === null ? '' : String(row[productIndex]).trim();
      const revenueValue = numberValue(row[revenueIndex] ?? null);
      const costValue = numberValue(row[costIndex] ?? null);

      if (
        !name ||
        revenueValue === null ||
        costValue === null ||
        revenueValue <= 0 ||
        costValue < 0
      ) {
        continue;
      }

      const current = groups.get(name) || {
        revenue: 0,
        cost: 0,
        rows: 0,
      };
      current.revenue += revenueValue;
      current.cost += costValue;
      current.rows += 1;
      groups.set(name, current);
      totalRevenue += revenueValue;
      totalCost += costValue;
    }

    if (groups.size < 2 || totalRevenue <= 0) continue;

    const overallMargin = (totalRevenue - totalCost) / totalRevenue;
    const candidates = Array.from(groups.entries())
      .map(([name, values]) => {
        const margin = (values.revenue - values.cost) / values.revenue;
        const revenueShare = values.revenue / totalRevenue;
        const marginLift = margin - overallMargin;
        return {
          name,
          ...values,
          margin,
          revenueShare,
          marginLift,
          opportunityScore: marginLift * values.revenue,
        };
      })
      .filter(
        (item) =>
          item.marginLift >= 0.1 &&
          item.revenueShare >= 0.05
      )
      .sort((a, b) => b.opportunityScore - a.opportunityScore);

    const top = candidates[0];
    if (!top) continue;

    const severity: InsightSeverity =
      top.revenueShare >= 0.2 && top.marginLift >= 0.15
        ? 'MEDIUM'
        : 'LOW';

    insights.push(
      insightFor({
        context,
        version,
        table,
        detectorId: MARGIN_DETECTOR_ID,
        detectorVersion: MARGIN_DETECTOR_VERSION,
        type: 'OPPORTUNITY',
        severity,
        title:
          top.name +
          ' margin is ' +
          (top.marginLift * 100).toFixed(1) +
          ' points above portfolio average',
        summary:
          top.name +
          ' has a ' +
          (top.margin * 100).toFixed(1) +
          '% observed margin versus ' +
          (overallMargin * 100).toFixed(1) +
          '% overall, while contributing ' +
          (top.revenueShare * 100).toFixed(1) +
          '% of observed revenue. This is a measured opportunity signal, not a recommendation.',
        confidence: 0.94,
        calculation:
          'Group rows by explicit product/item column. SUM revenue and cost, compute margin=(revenue-cost)/revenue, compare each product margin with overall weighted margin, and emit when margin lift is at least 10 percentage points and revenue share is at least 5%.',
        values: {
          productColumn: product.name,
          revenueColumn: revenue.name,
          costColumn: cost.name,
          product: top.name,
          productRevenue: top.revenue,
          productCost: top.cost,
          productMargin: top.margin,
          overallMargin,
          marginLift: top.marginLift,
          revenueShare: top.revenueShare,
        },
        fingerprintParts: [
          product.name,
          revenue.name,
          cost.name,
          top.name,
          top.revenue,
          top.cost,
          totalRevenue,
          totalCost,
        ],
      })
    );
  }

  return insights;
}
