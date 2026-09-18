import { parseCsvBuffer, CsvParseError } from '../server/datasets/csvParser.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { datasetStore, DatasetAccessError } from '../server/datasets/datasetStore.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function columnType(columns: any[], name: string): string | undefined {
  return columns.find((column) => column.name === name)?.inferredType;
}

async function main() {
  const accountA = 'acc_dataset_phase1a_a';
  const accountB = 'acc_dataset_phase1a_b';

  const csv = [
    'order_id,customer,amount,order_date,paid,category,notes',
    'ORD-001,"Acme, Inc.","NPR 1,250.50",2026-09-01,true,Chair,"Priority, deliver early"',
    'ORD-002,Beta Ltd,"NPR 500",2026-09-02,false,Table,',
    'ORD-003,Gamma Co,"NPR 750",2026-09-03,true,Chair,Normal',
    'ORD-004,Delta Co,"NPR 900",2026-09-04,false,Table,Normal',
    'ORD-004,Delta Co,"NPR 900",2026-09-04,false,Table,Normal',
  ].join('\n');

  const preview = datasetService.previewCsv({
    accountId: accountA,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'orders.csv',
    mimeType: 'text/csv',
  });

  assert(preview.source.format === 'CSV', 'Preview source format should be CSV.');
  assert(preview.source.sha256.length === 64, 'Source SHA-256 must be recorded.');
  assert(preview.tables.length === 1, 'CSV should produce one table.');

  const table = preview.tables[0];
  assert(table.rowCount === 5, `Expected 5 data rows, got ${table.rowCount}.`);
  assert(table.duplicateRowCount === 1, 'Expected one duplicate row.');
  assert(
    table.previewRows[0][1] === 'Acme, Inc.',
    'Quoted delimiter inside customer name was parsed incorrectly.'
  );
  assert(
    table.previewRows[0][6] === 'Priority, deliver early',
    'Quoted delimiter inside notes was parsed incorrectly.'
  );

  assert(
    columnType(table.columns, 'order_id') === 'IDENTIFIER',
    'order_id should infer as IDENTIFIER.'
  );
  assert(
    columnType(table.columns, 'amount') === 'CURRENCY',
    'amount should infer as CURRENCY.'
  );
  assert(
    columnType(table.columns, 'order_date') === 'DATE',
    'order_date should infer as DATE.'
  );
  assert(
    columnType(table.columns, 'paid') === 'BOOLEAN',
    'paid should infer as BOOLEAN.'
  );
  assert(
    columnType(table.columns, 'category') === 'CATEGORICAL',
    'category should infer as CATEGORICAL.'
  );

  const notes = table.columns.find((column) => column.name === 'notes');
  assert(notes?.nullable === true, 'notes should be nullable.');
  assert(notes?.missingCount === 1, 'notes should report one missing value.');

  const imported = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'orders.csv',
    datasetName: 'Orders',
  });

  assert(imported.version.versionNumber === 1, 'First import must create version 1.');
  assert(
    imported.version.source.sha256 === preview.source.sha256,
    'Preview/import of identical bytes must preserve source hash.'
  );

  const current = datasetService.getDataset(accountA, imported.dataset.id);
  assert(
    current.currentVersion.id === imported.version.id,
    'Current dataset version should point at first import.'
  );

  const updatedCsv = csv.replace('NPR 500', 'NPR 650');
  const second = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(updatedCsv, 'utf8'),
    filename: 'orders.csv',
    existingDatasetId: imported.dataset.id,
  });

  assert(second.version.versionNumber === 2, 'Second import must create version 2.');
  assert(
    second.version.id !== imported.version.id,
    'Dataset versions must be immutable distinct records.'
  );
  assert(
    second.version.source.sha256 !== imported.version.source.sha256,
    'Changed source bytes must produce a new source hash.'
  );
  assert(
    second.dataset.versionIds.length === 2,
    'Dataset should retain both immutable version IDs.'
  );

  assert(
    datasetStore.getDataset(accountB, imported.dataset.id) === null,
    'Foreign account must not read another account dataset.'
  );

  let foreignVersionBlocked = false;
  try {
    datasetStore.addVersion({
      accountId: accountB,
      datasetId: imported.dataset.id,
      source: second.version.source,
      tables: second.version.tables,
      importRunId: 'imp_foreign_attempt',
    });
  } catch (error) {
    foreignVersionBlocked =
      error instanceof DatasetAccessError &&
      error.code === 'DATASET_NOT_FOUND';
  }
  assert(
    foreignVersionBlocked,
    'Foreign account must not append a version to another account dataset.'
  );

  const semicolon = parseCsvBuffer(
    Buffer.from('sku;name;stock\nSKU-1;Chair;12\nSKU-2;Table;7', 'utf8'),
    'Inventory'
  );
  assert(semicolon.headers.length === 3, 'Semicolon delimiter was not detected.');
  assert(semicolon.rows[1][2] === '7', 'Semicolon CSV value parsed incorrectly.');

  let malformedRejected = false;
  try {
    parseCsvBuffer(
      Buffer.from('id,name\n1,"unclosed value', 'utf8'),
      'Malformed'
    );
  } catch (error) {
    malformedRejected =
      error instanceof CsvParseError &&
      error.message.toLowerCase().includes('unclosed');
  }
  assert(malformedRejected, 'Malformed quoted CSV must fail safely.');

  const tooWide = Array.from({ length: 101 }, (_, index) => `c${index}`).join(',');
  let widthRejected = false;
  try {
    parseCsvBuffer(Buffer.from(tooWide + '\n' + tooWide, 'utf8'), 'Too Wide');
  } catch (error) {
    widthRejected =
      error instanceof CsvParseError &&
      error.message.includes('column');
  }
  assert(widthRejected, 'CSV column safety limit must be enforced.');

  console.log('STRUCTURED_DATA_FOUNDATION_CHECK_PASSED');
  console.log(
    'CSV parsing, schema inference, source hashing, immutable dataset versioning, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('STRUCTURED_DATA_FOUNDATION_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
