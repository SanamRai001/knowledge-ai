import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  LegacyDatasetPayloadRepository,
  readLegacyMetadataSnapshot,
} from '../server/persistence/legacyMetadata.js';
import { importLegacyMetadata } from '../server/persistence/legacyImporter.js';
import {
  postgresApiKeyRepository,
  postgresDatasetMetadataRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function writeJson(
  dir: string,
  name: string,
  value: unknown
): void {
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify(value, null, 2),
    'utf8'
  );
}

function fixture(dir: string) {
  const rawA = 'kn_test_phase-a-secret-never-persisted';
  const rawB = 'kn_test_phase-b-secret-never-persisted';
  const keyAHash = sha256(rawA);
  const keyBHash = sha256(rawB);

  writeJson(dir, 'knowledge_bases.json', {
    activeKbId: 'kb_a2',
    kbs: [
      {
        id: 'kb_a1',
        accountId: 'acc_a2_pg_a',
        name: 'A One',
        description: 'First A workspace',
        createdDate: 1000,
        updatedAt: 2000,
        currentVersion: 'v1.0',
        processingStatus: 'ready',
      },
      {
        id: 'kb_a2',
        accountId: 'acc_a2_pg_a',
        name: 'A Two',
        description: 'Second A workspace',
        createdDate: 1100,
        updatedAt: 3000,
        currentVersion: 'v2.0',
        processingStatus: 'ready',
      },
      {
        id: 'kb_b1',
        accountId: 'acc_a2_pg_b',
        name: 'B One',
        description: 'Only B workspace',
        createdDate: 1200,
        updatedAt: 2500,
        currentVersion: 'v1.0',
        processingStatus: 'empty',
      },
    ],
  });

  writeJson(dir, 'api_keys.json', [
    {
      id: 'key_a2_a',
      accountId: 'acc_a2_pg_a',
      name: 'A test key',
      keyPrefix: 'kn_test_',
      keyHash: keyAHash,
      maskedKey: 'kn_test_••••phaseA',
      environment: 'test',
      scopes: ['chat:read', 'knowledge:read'],
      status: 'active',
      createdAt: 1400,
      lastUsedAt: 2400,
      expiresAt: null,
    },
    {
      id: 'key_a2_b',
      accountId: 'acc_a2_pg_b',
      name: 'B test key',
      keyPrefix: 'kn_test_',
      keyHash: keyBHash,
      maskedKey: 'kn_test_••••phaseB',
      environment: 'test',
      scopes: ['chat:read'],
      status: 'active',
      createdAt: 1500,
      lastUsedAt: null,
      expiresAt: null,
    },
  ]);

  writeJson(dir, 'api_usage.json', [
    {
      id: 'usage_a2_a',
      requestId: 'req_a2_a',
      apiKeyId: 'key_a2_a',
      accountId: 'acc_a2_pg_a',
      aiId: 'ai_a2',
      endpoint: '/v1/ask',
      timestamp: 2600,
      status: 200,
      latencyMs: 12,
      refused: false,
      grounded: true,
    },
  ]);

  writeJson(dir, 'datasets.json', {
    datasets: [
      {
        id: 'ds_a2_a',
        accountId: 'acc_a2_pg_a',
        name: 'A Orders',
        description: 'A dataset',
        createdAt: 4000,
        updatedAt: 5000,
        currentVersionId: 'dsv_a2_a1',
        versionIds: ['dsv_a2_a1'],
      },
      {
        id: 'ds_a2_b',
        accountId: 'acc_a2_pg_b',
        name: 'B Inventory',
        description: 'B dataset',
        createdAt: 4100,
        updatedAt: 5100,
        currentVersionId: 'dsv_a2_b1',
        versionIds: ['dsv_a2_b1'],
      },
    ],
    versions: [
      {
        id: 'dsv_a2_a1',
        datasetId: 'ds_a2_a',
        versionNumber: 1,
        createdAt: 4500,
        source: {
          filename: 'a-orders.csv',
          mimeType: 'text/csv',
          sizeBytes: 71,
          sha256: 'a'.repeat(64),
          format: 'CSV',
        },
        tables: [
          {
            id: 'table_a2_a',
            name: 'a-orders',
            columns: [
              {
                name: 'order_id',
                normalizedName: 'order id',
                inferredType: 'IDENTIFIER',
                typeSource: 'INFERRED',
                nullable: false,
                missingCount: 0,
                distinctCount: 1,
                uniqueRatio: 1,
                confidence: 1,
                sampleValues: ['A-1'],
              },
              {
                name: 'balance_due',
                normalizedName: 'balance due',
                inferredType: 'CURRENCY',
                typeSource: 'INFERRED',
                nullable: false,
                missingCount: 0,
                distinctCount: 1,
                uniqueRatio: 1,
                confidence: 1,
                sampleValues: [12000],
              },
            ],
            rows: [['A-1', 12000]],
            rowCount: 1,
            duplicateRowCount: 0,
          },
        ],
        importRunId: 'run_a2_a',
      },
      {
        id: 'dsv_a2_b1',
        datasetId: 'ds_a2_b',
        versionNumber: 1,
        createdAt: 4600,
        source: {
          filename: 'b-inventory.csv',
          mimeType: 'text/csv',
          sizeBytes: 64,
          sha256: 'b'.repeat(64),
          format: 'CSV',
        },
        tables: [
          {
            id: 'table_a2_b',
            name: 'b-inventory',
            columns: [
              {
                name: 'product_id',
                normalizedName: 'product id',
                inferredType: 'IDENTIFIER',
                typeSource: 'INFERRED',
                nullable: false,
                missingCount: 0,
                distinctCount: 1,
                uniqueRatio: 1,
                confidence: 1,
                sampleValues: ['B-1'],
              },
              {
                name: 'current_stock',
                normalizedName: 'current stock',
                inferredType: 'INTEGER',
                typeSource: 'INFERRED',
                nullable: false,
                missingCount: 0,
                distinctCount: 1,
                uniqueRatio: 1,
                confidence: 1,
                sampleValues: [8],
              },
            ],
            rows: [['B-1', 8]],
            rowCount: 1,
            duplicateRowCount: 0,
          },
        ],
        importRunId: 'run_a2_b',
      },
    ],
    importRuns: [
      {
        id: 'run_a2_a',
        accountId: 'acc_a2_pg_a',
        status: 'IMPORTED',
        createdAt: 4300,
        completedAt: 4400,
        filename: 'a-orders.csv',
        format: 'CSV',
        warnings: [],
      },
      {
        id: 'run_a2_b',
        accountId: 'acc_a2_pg_b',
        status: 'IMPORTED',
        createdAt: 4350,
        completedAt: 4450,
        filename: 'b-inventory.csv',
        format: 'CSV',
        warnings: ['fixture warning'],
      },
    ],
  });

  return {
    rawA,
    rawB,
    keyAHash,
    keyBHash,
  };
}

async function resetDomainTables(): Promise<void> {
  await postgresPool().query(`
    TRUNCATE TABLE
      account_workspace_state,
      api_usage,
      api_keys,
      dataset_versions,
      datasets,
      dataset_import_runs,
      workspaces,
      accounts
    CASCADE
  `);
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the A2 PostgreSQL proof.'
  );

  const migrationFirst = await runPostgresMigrations();
  assert(
    migrationFirst.applied.includes('001') ||
      migrationFirst.alreadyApplied.includes('001'),
    'Migration 001 must be present in the migration history.'
  );

  const migrationSecond = await runPostgresMigrations();
  assert(
    migrationSecond.applied.length === 0 &&
      migrationSecond.alreadyApplied.includes('001'),
    'Running migrations twice must be repeatable without reapplying migration 001.'
  );

  await resetDomainTables();

  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowledge-ai-a2-')
  );
  const fixtureSecrets = fixture(dataDir);

  const beforeHashes = new Map(
    [
      'knowledge_bases.json',
      'api_keys.json',
      'api_usage.json',
      'datasets.json',
    ].map((name) => [
      name,
      sha256(fs.readFileSync(path.join(dataDir, name), 'utf8')),
    ])
  );

  const snapshot = readLegacyMetadataSnapshot(dataDir);

  assert(
    snapshot.accounts.map((item) => item.id).join(',') ===
      'acc_a2_pg_a,acc_a2_pg_b',
    'Legacy metadata adapter must derive stable account IDs without inventing new identities.'
  );
  assert(
    snapshot.activeWorkspaceByAccount.acc_a2_pg_a ===
      'kb_a2' &&
      snapshot.activeWorkspaceByAccount.acc_a2_pg_b ===
        'kb_b1',
    'Legacy global active workspace must be converted into safe per-account selections.'
  );

  const dryRun = await importLegacyMetadata({
    snapshot,
    dryRun: true,
  });
  assert(
    dryRun.dryRun === true &&
      dryRun.conflicts.length === 0 &&
      dryRun.counts.workspaces === 3 &&
      dryRun.counts.datasets === 2 &&
      dryRun.counts.datasetVersions === 2,
    'Dry-run must report A2 metadata without writing or losing IDs.'
  );

  const emptyAccounts = await postgresPool().query(
    'SELECT count(*)::int AS count FROM accounts'
  );
  assert(
    emptyAccounts.rows[0].count === 0,
    'Dry-run must not write PostgreSQL state.'
  );

  const imported = await importLegacyMetadata({
    snapshot,
  });
  assert(
    imported.conflicts.length === 0 &&
      imported.imported.accounts === 2 &&
      imported.imported.workspaces === 3 &&
      imported.imported.apiKeys === 2 &&
      imported.imported.apiUsage === 1 &&
      imported.imported.datasets === 2 &&
      imported.imported.datasetImportRuns === 2 &&
      imported.imported.datasetVersions === 2 &&
      imported.imported.activeWorkspaceSelections === 2,
    'Legacy importer must write the complete A2 metadata slice exactly once.'
  );

  const repeated = await importLegacyMetadata({
    snapshot,
  });
  assert(
    repeated.conflicts.length === 0 &&
      Object.values(repeated.imported).every(
        (value) => value === 0
      ) &&
      repeated.skippedExisting > 0,
    'Repeated legacy import must be idempotent.'
  );

  for (const [name, before] of beforeHashes) {
    const after = sha256(
      fs.readFileSync(path.join(dataDir, name), 'utf8')
    );
    assert(
      after === before,
      'Legacy import must never mutate source file ' + name + '.'
    );
  }

  const activeA =
    await postgresWorkspaceMetadataRepository.getActive(
      'acc_a2_pg_a'
    );
  const activeB =
    await postgresWorkspaceMetadataRepository.getActive(
      'acc_a2_pg_b'
    );
  assert(
    activeA === 'kb_a2' && activeB === 'kb_b1',
    'Active workspace selection must persist independently per account.'
  );

  await postgresWorkspaceMetadataRepository.setActive(
    'acc_a2_pg_a',
    'kb_a1'
  );
  assert(
    (await postgresWorkspaceMetadataRepository.getActive(
      'acc_a2_pg_a'
    )) === 'kb_a1' &&
      (await postgresWorkspaceMetadataRepository.getActive(
        'acc_a2_pg_b'
      )) === 'kb_b1',
    'Changing account A active workspace must not alter account B selection.'
  );

  assert(
    (await postgresWorkspaceMetadataRepository.get(
      'acc_a2_pg_b',
      'kb_a1'
    )) === null,
    'Account B must not read account A workspace metadata.'
  );

  let foreignWorkspaceUpdateBlocked = false;
  try {
    await postgresWorkspaceMetadataRepository.update(
      'acc_a2_pg_b',
      'kb_a1',
      { name: 'stolen' }
    );
  } catch {
    foreignWorkspaceUpdateBlocked = true;
  }
  assert(
    foreignWorkspaceUpdateBlocked,
    'Account B must not update account A workspace metadata.'
  );

  const keyA = await postgresApiKeyRepository.get(
    'acc_a2_pg_a',
    'key_a2_a'
  );
  assert(
    keyA?.keyHash === fixtureSecrets.keyAHash &&
      keyA.accountId === 'acc_a2_pg_a',
    'API key hash and account ownership must survive import.'
  );
  assert(
    (await postgresApiKeyRepository.get(
      'acc_a2_pg_b',
      'key_a2_a'
    )) === null,
    'Account B must not query account A API key by ID.'
  );

  const storedKeys = JSON.stringify(
    (
      await postgresPool().query(
        'SELECT id, account_id, key_hash, masked_key FROM api_keys ORDER BY id'
      )
    ).rows
  );
  assert(
    !storedKeys.includes(fixtureSecrets.rawA) &&
      !storedKeys.includes(fixtureSecrets.rawB),
    'Raw API secrets must never enter PostgreSQL metadata.'
  );

  const datasetA =
    await postgresDatasetMetadataRepository.get(
      'acc_a2_pg_a',
      'ds_a2_a'
    );
  assert(
    datasetA?.id === 'ds_a2_a' &&
      datasetA.currentVersionId === 'dsv_a2_a1',
    'Dataset identity and current-version pointer must survive import.'
  );
  assert(
    (await postgresDatasetMetadataRepository.get(
      'acc_a2_pg_b',
      'ds_a2_a'
    )) === null,
    'Account B must not query account A Dataset metadata.'
  );

  const versionA =
    await postgresDatasetMetadataRepository.getVersionMetadata(
      'acc_a2_pg_a',
      'ds_a2_a',
      'dsv_a2_a1'
    );
  assert(
    versionA?.id === 'dsv_a2_a1' &&
      versionA.payload.backend === 'legacy-dataset-json' &&
      versionA.payload.ref === 'dsv_a2_a1',
    'DatasetVersion metadata must preserve IDs and use the explicit legacy payload locator.'
  );

  const payloadRepository =
    new LegacyDatasetPayloadRepository(dataDir);
  const payload = await payloadRepository.get(
    versionA!.payload
  );
  assert(
    payload.id === 'dsv_a2_a1' &&
      payload.tables[0].rows[0][0] === 'A-1' &&
      payload.tables[0].rows[0][1] === 12000,
    'Compatibility payload repository must keep existing analytical rows readable.'
  );

  let crossDatasetCurrentBlocked = false;
  try {
    await postgresDatasetMetadataRepository.updateCurrentVersion(
      'acc_a2_pg_a',
      'ds_a2_a',
      'dsv_a2_b1'
    );
  } catch {
    crossDatasetCurrentBlocked = true;
  }
  assert(
    crossDatasetCurrentBlocked,
    'Database constraint must reject a current-version pointer to another dataset/account.'
  );

  const stillCurrent =
    await postgresDatasetMetadataRepository.get(
      'acc_a2_pg_a',
      'ds_a2_a'
    );
  assert(
    stillCurrent?.currentVersionId === 'dsv_a2_a1',
    'Failed cross-dataset pointer update must not corrupt the existing current version.'
  );

  let crossAccountImportRunBlocked = false;
  try {
    await postgresDatasetMetadataRepository.appendVersionMetadata(
      'acc_a2_pg_a',
      {
        id: 'dsv_a2_illegal',
        datasetId: 'ds_a2_a',
        versionNumber: 2,
        createdAt: 6000,
        source: {
          filename: 'illegal.csv',
          mimeType: 'text/csv',
          sizeBytes: 1,
          sha256: 'c'.repeat(64),
          format: 'CSV',
        },
        importRunId: 'run_a2_b',
        payload: {
          backend: 'legacy-dataset-json',
          ref: 'dsv_a2_illegal',
        },
      }
    );
  } catch {
    crossAccountImportRunBlocked = true;
  }
  assert(
    crossAccountImportRunBlocked,
    'Database constraint must reject DatasetVersion/import-run relationships across accounts.'
  );

  const versionCount = await postgresPool().query(
    'SELECT count(*)::int AS count FROM dataset_versions'
  );
  assert(
    versionCount.rows[0].count === 2,
    'Rejected cross-account DatasetVersion must not be partially inserted.'
  );

  const accountScopedVersionColumns =
    await postgresPool().query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'dataset_versions'
       ORDER BY ordinal_position`
    );
  assert(
    accountScopedVersionColumns.rows.some(
      (row) => row.column_name === 'account_id'
    ),
    'Every tenant-owned DatasetVersion row must carry explicit account_id.'
  );

  console.log('PRODUCTION_A2_POSTGRES_CHECK_PASSED');
  console.log(
    'Migration repeatability, dry-run/idempotent legacy metadata import, ID preservation, API-key secrecy, per-account active workspaces, tenant isolation, dataset relational ownership constraints, and legacy payload compatibility are verified.'
  );
}

main()
  .catch((error) => {
    console.error('PRODUCTION_A2_POSTGRES_CHECK_FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
