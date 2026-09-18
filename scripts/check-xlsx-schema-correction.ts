import ExcelJS from '@ayocore/exceljs';
import { datasetService } from '../server/datasets/datasetService.js';
import { SchemaCorrectionError } from '../server/datasets/schemaInference.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function buildWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const orders = workbook.addWorksheet('Orders');
  orders.addRow([
    'order_id',
    'customer',
    'amount',
    'order_date',
    'computed_total',
    'segment',
  ]);
  orders.addRow([
    'ORD-001',
    'Acme',
    1250.5,
    '2026-09-01',
    null,
    'Retail',
  ]);
  orders.addRow([
    'ORD-002',
    'Beta',
    500,
    '2026-09-02',
    null,
    'Wholesale',
  ]);
  orders.addRow([
    'ORD-003',
    'Gamma',
    750,
    '2026-09-03',
    null,
    'Retail',
  ]);
  orders.getCell('E2').value = {
    formula: 'C2*2',
    result: 2501,
  } as any;
  orders.getCell('E3').value = {
    formula: 'C3*2',
    result: 1000,
  } as any;
  // Formula without a cached scalar result must not be evaluated by Knowledge AI.
  orders.getCell('E4').value = {
    formula: 'C4*2',
  } as any;

  const inventory = workbook.addWorksheet('Inventory');
  inventory.addRow(['sku', 'product', 'stock', 'active']);
  inventory.addRow(['SKU-1', 'Chair', 12, true]);
  inventory.addRow(['SKU-2', 'Table', 7, false]);

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

async function main() {
  const accountA = 'acc_xlsx_phase1b_a';
  const accountB = 'acc_xlsx_phase1b_b';
  const buffer = await buildWorkbook();

  const preview = await datasetService.previewXlsx({
    accountId: accountA,
    buffer,
    filename: 'business.xlsx',
  });

  assert(preview.source.format === 'XLSX', 'XLSX source format was not recorded.');
  assert(preview.source.sha256.length === 64, 'XLSX source hash is missing.');
  assert(preview.tables.length === 2, 'Expected two non-empty workbook sheets.');

  const orders = preview.tables.find((table) => table.name === 'Orders');
  const inventory = preview.tables.find((table) => table.name === 'Inventory');
  assert(orders, 'Orders sheet missing from preview.');
  assert(inventory, 'Inventory sheet missing from preview.');
  assert(orders.rowCount === 3, 'Orders row count is incorrect.');
  assert(inventory.rowCount === 2, 'Inventory row count is incorrect.');

  const orderId = orders.columns.find((column) => column.name === 'order_id');
  const amount = orders.columns.find((column) => column.name === 'amount');
  const orderDate = orders.columns.find((column) => column.name === 'order_date');
  const computed = orders.columns.find(
    (column) => column.name === 'computed_total'
  );
  const active = inventory.columns.find((column) => column.name === 'active');

  assert(orderId?.inferredType === 'IDENTIFIER', 'order_id should be IDENTIFIER.');
  assert(amount?.inferredType === 'CURRENCY', 'amount should be CURRENCY.');
  assert(orderDate?.inferredType === 'DATE', 'order_date should be DATE.');
  assert(active?.inferredType === 'BOOLEAN', 'active should be BOOLEAN.');
  assert(
    orders.previewRows[0][4] === 2501 &&
      orders.previewRows[1][4] === 1000,
    'Cached formula results were not preserved.'
  );
  assert(
    orders.previewRows[2][4] === null,
    'Formula without cached result must not be evaluated during import.'
  );
  assert(
    computed?.missingCount === 1,
    'Formula without cached result should be represented as a missing value.'
  );

  const corrected = await datasetService.previewXlsx({
    accountId: accountA,
    buffer,
    filename: 'business.xlsx',
    schemaOverrides: {
      Orders: {
        customer: 'CATEGORICAL',
      },
    },
  });

  const correctedCustomer = corrected.tables
    .find((table) => table.name === 'Orders')
    ?.columns.find((column) => column.name === 'customer');

  assert(
    correctedCustomer?.inferredType === 'CATEGORICAL',
    'User schema override was not applied.'
  );
  assert(
    correctedCustomer?.typeSource === 'USER_OVERRIDE',
    'Corrected column must record USER_OVERRIDE provenance.'
  );

  let impossibleCorrectionRejected = false;
  try {
    await datasetService.previewXlsx({
      accountId: accountA,
      buffer,
      filename: 'business.xlsx',
      schemaOverrides: {
        Orders: {
          amount: 'DATE',
        },
      },
    });
  } catch (error) {
    impossibleCorrectionRejected =
      error instanceof SchemaCorrectionError &&
      error.message.includes('cannot be DATE');
  }
  assert(
    impossibleCorrectionRejected,
    'Impossible schema correction should fail with a clear validation error.'
  );

  const imported = await datasetService.importXlsx({
    accountId: accountA,
    buffer,
    filename: 'business.xlsx',
    datasetName: 'Business Workbook',
    schemaOverrides: {
      Orders: {
        customer: 'CATEGORICAL',
      },
    },
  });

  assert(
    imported.version.tables.length === 2,
    'Imported XLSX version must retain all non-empty sheets.'
  );
  assert(
    imported.version.source.format === 'XLSX',
    'Imported version must retain XLSX provenance.'
  );
  assert(
    imported.version.source.sha256 === preview.source.sha256,
    'Preview and import of identical workbook bytes must share a source hash.'
  );

  const foreignDatasets = datasetService.listDatasets(accountB);
  assert(
    !foreignDatasets.some((dataset) => dataset.id === imported.dataset.id),
    'Foreign account dataset listing leaked XLSX dataset.'
  );

  let foreignReadDenied = false;
  try {
    datasetService.getDataset(accountB, imported.dataset.id);
  } catch (error: any) {
    foreignReadDenied =
      error?.code === 'DATASET_NOT_FOUND' &&
      error?.statusCode === 404;
  }
  assert(foreignReadDenied, 'Foreign account must not read XLSX dataset.');

  console.log('XLSX_SCHEMA_CORRECTION_CHECK_PASSED');
  console.log(
    'Multi-sheet XLSX parsing, cached-formula handling, schema correction, provenance, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('XLSX_SCHEMA_CORRECTION_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
