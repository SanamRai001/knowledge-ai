import { datasetService } from '../server/datasets/datasetService.js';
import {
  AnalyticalQueryError,
  structuredAnalyticsEngine,
} from '../server/datasets/structuredAnalyticsEngine.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function closeTo(actual: number, expected: number, tolerance = 0.0001) {
  return Math.abs(actual - expected) <= tolerance;
}

async function main() {
  const accountA = 'acc_analytics_phase1c_a';
  const accountB = 'acc_analytics_phase1c_b';

  const csv = [
    'order_id,order_date,category,customer,amount',
    'O-1,2026-08-02,Chair,Acme,1000',
    'O-2,2026-08-10,Chair,Beta,500',
    'O-3,2026-08-20,Table,Gamma,700',
    'O-4,2026-09-03,Chair,Acme,1200',
    'O-5,2026-09-11,Chair,Delta,800',
    'O-6,2026-09-15,Table,Echo,400',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'sales.csv',
    datasetName: 'Sales',
  });

  const datasetId = imported.dataset.id;
  const version1 = imported.version.id;

  const august = structuredAnalyticsEngine.execute({
    accountId: accountA,
    datasetId,
    plan: {
      tableName: 'sales',
      filters: [
        { column: 'order_date', operator: 'GTE', value: '2026-08-01' },
        { column: 'order_date', operator: 'LTE', value: '2026-08-31' },
      ],
      aggregates: [
        { operator: 'SUM', column: 'amount', alias: 'revenue' },
        { operator: 'COUNT', alias: 'orders' },
      ],
    },
  });

  assert(august.rows.length === 1, 'Aggregate query should return one row.');
  assert(august.rows[0].revenue === 2200, 'August revenue must equal 2200.');
  assert(august.rows[0].orders === 3, 'August order count must equal 3.');
  assert(
    august.provenance.datasetVersionId === version1,
    'Query provenance must identify the exact dataset version.'
  );
  assert(
    august.provenance.sourceSha256 === imported.version.source.sha256,
    'Query provenance must include the source file hash.'
  );
  assert(
    august.provenance.scannedRowCount === 6 &&
      august.provenance.matchedRowCount === 3,
    'Query provenance row counts are incorrect.'
  );

  const byCategory = structuredAnalyticsEngine.execute({
    accountId: accountA,
    datasetId,
    plan: {
      tableName: 'Sales',
      groupBy: ['category'],
      aggregates: [
        { operator: 'SUM', column: 'amount', alias: 'revenue' },
        { operator: 'COUNT', alias: 'orders' },
      ],
      sort: [{ key: 'revenue', direction: 'DESC' }],
      limit: 10,
    },
  });

  assert(byCategory.rows.length === 2, 'Expected two category groups.');
  assert(
    byCategory.rows[0].category === 'Chair' &&
      byCategory.rows[0].revenue === 3500,
    'Chair should be the highest-revenue category at 3500.'
  );
  assert(
    byCategory.rows[1].category === 'Table' &&
      byCategory.rows[1].revenue === 1100,
    'Table revenue should equal 1100.'
  );

  const filtered = structuredAnalyticsEngine.execute({
    accountId: accountA,
    datasetId,
    plan: {
      tableName: 'Sales',
      filters: [
        { column: 'customer', operator: 'IN', value: ['Acme', 'Delta'] },
      ],
      select: ['order_id', 'customer', 'amount'],
      sort: [{ key: 'amount', direction: 'DESC' }],
      limit: 2,
    },
  });

  assert(filtered.rows.length === 2, 'Projection query should honor limit 2.');
  assert(
    filtered.rows[0].amount === 1200 &&
      filtered.rows[1].amount === 1000,
    'Projection numeric sort is incorrect.'
  );

  const comparison = structuredAnalyticsEngine.comparePeriods({
    accountId: accountA,
    datasetId,
    plan: {
      tableName: 'Sales',
      dateColumn: 'order_date',
      metric: { operator: 'SUM', column: 'amount', alias: 'revenue' },
      firstPeriod: {
        label: 'August',
        start: '2026-08-01',
        end: '2026-08-31',
      },
      secondPeriod: {
        label: 'September',
        start: '2026-09-01',
        end: '2026-09-30',
      },
    },
  });

  assert(
    comparison.firstPeriod.value === 2200,
    'August period comparison value is incorrect.'
  );
  assert(
    comparison.secondPeriod.value === 2400,
    'September period comparison value is incorrect.'
  );
  assert(
    comparison.absoluteChange === 200,
    'Period absolute change should equal 200.'
  );
  assert(
    comparison.percentChange !== null &&
      closeTo(comparison.percentChange, 9.0909090909),
    'Period percentage change is incorrect.'
  );
  assert(
    comparison.provenance.firstPeriodMatchedRowCount === 3 &&
      comparison.provenance.secondPeriodMatchedRowCount === 3,
    'Period comparison provenance counts are incorrect.'
  );

  const changedCsv = csv.replace('O-1,2026-08-02,Chair,Acme,1000', 'O-1,2026-08-02,Chair,Acme,5000');
  const second = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(changedCsv, 'utf8'),
    filename: 'sales.csv',
    existingDatasetId: datasetId,
  });

  const currentAugust = structuredAnalyticsEngine.execute({
    accountId: accountA,
    datasetId,
    plan: {
      tableName: 'Sales',
      filters: [
        { column: 'order_date', operator: 'GTE', value: '2026-08-01' },
        { column: 'order_date', operator: 'LTE', value: '2026-08-31' },
      ],
      aggregates: [{ operator: 'SUM', column: 'amount', alias: 'revenue' }],
    },
  });
  assert(
    currentAugust.rows[0].revenue === 6200,
    'Current version should reflect updated deterministic revenue.'
  );
  assert(
    currentAugust.provenance.datasetVersionId === second.version.id,
    'Current query must use newest dataset version.'
  );

  const oldAugust = structuredAnalyticsEngine.execute({
    accountId: accountA,
    datasetId,
    versionId: version1,
    plan: {
      tableName: 'Sales',
      filters: [
        { column: 'order_date', operator: 'GTE', value: '2026-08-01' },
        { column: 'order_date', operator: 'LTE', value: '2026-08-31' },
      ],
      aggregates: [{ operator: 'SUM', column: 'amount', alias: 'revenue' }],
    },
  });
  assert(
    oldAugust.rows[0].revenue === 2200,
    'Historical dataset version must remain reproducible.'
  );

  let nonNumericRejected = false;
  try {
    structuredAnalyticsEngine.execute({
      accountId: accountA,
      datasetId,
      plan: {
        tableName: 'Sales',
        aggregates: [{ operator: 'SUM', column: 'customer' }],
      },
    });
  } catch (error) {
    nonNumericRejected =
      error instanceof AnalyticalQueryError &&
      error.code === 'TYPE_MISMATCH';
  }
  assert(nonNumericRejected, 'SUM on a text column must be rejected.');

  let unknownColumnRejected = false;
  try {
    structuredAnalyticsEngine.execute({
      accountId: accountA,
      datasetId,
      plan: {
        tableName: 'Sales',
        filters: [{ column: 'does_not_exist', operator: 'EQ', value: 'x' }],
        select: ['order_id'],
      },
    });
  } catch (error) {
    unknownColumnRejected =
      error instanceof AnalyticalQueryError &&
      error.code === 'COLUMN_NOT_FOUND';
  }
  assert(unknownColumnRejected, 'Unknown query columns must be rejected.');

  let unsafeLimitRejected = false;
  try {
    structuredAnalyticsEngine.execute({
      accountId: accountA,
      datasetId,
      plan: {
        tableName: 'Sales',
        limit: 50000,
      },
    });
  } catch (error) {
    unsafeLimitRejected =
      error instanceof AnalyticalQueryError &&
      error.code === 'QUERY_LIMIT_EXCEEDED';
  }
  assert(unsafeLimitRejected, 'Oversized result limits must be rejected.');

  let foreignDenied = false;
  try {
    structuredAnalyticsEngine.execute({
      accountId: accountB,
      datasetId,
      plan: {
        tableName: 'Sales',
        aggregates: [{ operator: 'COUNT' }],
      },
    });
  } catch (error: any) {
    foreignDenied =
      error?.code === 'DATASET_NOT_FOUND' &&
      error?.statusCode === 404;
  }
  assert(foreignDenied, 'Foreign account analytics access must be denied.');

  console.log('DETERMINISTIC_ANALYTICS_CHECK_PASSED');
  console.log(
    'Filtering, grouping, aggregation, period comparison, version reproducibility, limits, provenance, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('DETERMINISTIC_ANALYTICS_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
