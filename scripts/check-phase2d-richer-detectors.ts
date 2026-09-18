import { datasetService } from '../server/datasets/datasetService.js';
import { discoveryService } from '../server/discovery/discoveryService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountId = 'acc_discovery_2d';
  const referenceTime = Date.parse('2026-09-18T12:00:00Z');

  const csv = [
    'order_date,customer,product,revenue,total_cost',
    '2026-04-05,Acme,Chair,600,200',
    '2026-04-18,Beta,Table,400,350',
    '2026-05-05,Acme,Chair,600,200',
    '2026-05-18,Beta,Table,400,350',
    '2026-06-05,Acme,Chair,600,200',
    '2026-06-18,Beta,Table,400,350',
    '2026-07-05,Acme,Chair,600,200',
    '2026-07-18,Beta,Table,400,350',
    '2026-08-05,Acme,Chair,1600,400',
    '2026-08-18,Gamma,Table,400,350',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'richer-discovery.csv',
    datasetName: 'Richer Discovery Proof',
  });

  const result = discoveryService.analyzeDataset({
    accountId,
    datasetId: imported.dataset.id,
    referenceTime,
  });

  const anomaly = result.insights.find(
    (insight) => insight.detectorId === 'trend.anomaly'
  );
  assert(anomaly, 'Expected a time-series anomaly insight.');
  assert(
    anomaly.evidence.values.latestPeriod === '2026-08' &&
      anomaly.evidence.values.latestValue === 2000 &&
      anomaly.evidence.values.baselineMean === 1000 &&
      anomaly.evidence.values.deviationPercent === 100 &&
      anomaly.evidence.values.baselineStdDev === 0,
    'Anomaly detector returned incorrect baseline or August deviation.'
  );
  assert(
    anomaly.severity === 'HIGH',
    'A 100% deviation from a flat baseline should be HIGH.'
  );

  const concentration = result.insights.find(
    (insight) => insight.detectorId === 'customer.concentration'
  );
  assert(concentration, 'Expected a customer concentration insight.');
  assert(
    concentration.evidence.values.topCustomer === 'Acme' &&
      concentration.evidence.values.topCustomerValue === 4000 &&
      concentration.evidence.values.grandTotal === 6000,
    'Customer concentration totals are incorrect.'
  );
  const topShare = concentration.evidence.values.topCustomerShare;
  assert(
    typeof topShare === 'number' &&
      Math.abs(topShare - 2 / 3) < 0.000001 &&
      concentration.severity === 'HIGH',
    'Customer concentration share or severity is incorrect.'
  );

  const margin = result.insights.find(
    (insight) => insight.detectorId === 'margin.opportunity'
  );
  assert(margin, 'Expected a product margin opportunity insight.');
  assert(
    margin.evidence.values.product === 'Chair' &&
      margin.evidence.values.productRevenue === 4000 &&
      margin.evidence.values.productCost === 1200,
    'Margin opportunity product totals are incorrect.'
  );
  const productMargin = margin.evidence.values.productMargin;
  const overallMargin = margin.evidence.values.overallMargin;
  const marginLift = margin.evidence.values.marginLift;
  assert(
    typeof productMargin === 'number' &&
      typeof overallMargin === 'number' &&
      typeof marginLift === 'number' &&
      Math.abs(productMargin - 0.7) < 0.000001 &&
      Math.abs(overallMargin - 3050 / 6000) < 0.000001 &&
      marginLift > 0.19 &&
      margin.type === 'OPPORTUNITY',
    'Margin opportunity calculation is incorrect.'
  );

  assert(
    result.insights.every(
      (insight) =>
        insight.evidence.sourceType === 'DATASET' &&
        insight.evidence.datasetVersionId === imported.version.id &&
        insight.evidence.sourceSha256 === imported.version.source.sha256
    ),
    'Richer detector findings must preserve immutable dataset provenance.'
  );

  const ranked = discoveryService.listInsights({
    accountId,
    datasetId: imported.dataset.id,
    latestRunOnly: true,
    limit: 20,
  });
  assert(
    ranked.some((insight) => insight.detectorId === 'trend.anomaly') &&
      ranked.some((insight) => insight.detectorId === 'customer.concentration') &&
      ranked.some((insight) => insight.detectorId === 'margin.opportunity'),
    'Prioritized latest-run output must retain all verified richer findings.'
  );

  console.log('PHASE_2D_RICHER_DETECTORS_CHECK_PASSED');
  console.log(
    'Anomaly baseline math, customer concentration, margin opportunity, provenance, and prioritized retrieval are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_2D_RICHER_DETECTORS_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
