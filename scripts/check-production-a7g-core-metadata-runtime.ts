import fs from 'fs';
import path from 'path';
import { apiKeyStore } from '../server/apiKeyStore.js';
import {
  ApiKeyRuntimeService,
  apiKeyRuntimeService,
} from '../server/apiKeyRuntimeService.js';
import { datasetStore } from '../server/datasets/datasetStore.js';
import {
  DatasetRuntimePayloadStore,
} from '../server/datasets/datasetRuntimePayloadStore.js';
import {
  DatasetRuntimePersistence,
  datasetRuntimePersistence,
} from '../server/datasets/datasetRuntimePersistence.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { structuredAnalyticsEngine } from '../server/datasets/structuredAnalyticsEngine.js';
import { setSourceByteStorageForTesting } from '../server/storage/sourceByteStorageRuntime.js';
import { MemorySourceByteStorage } from './support/memorySourceByteStorage.js';
import { kbStore } from '../server/kbStore.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  postgresApiKeyRepository,
  postgresDatasetMetadataRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  WorkspaceRuntimeService,
  workspaceRuntimeService,
} from '../server/workspaceRuntimeService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function snapshot(file: string): string | null {
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : null;
}

async function resetRuntimeTables(): Promise<void> {
  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'A7G proof must run in PostgreSQL persistence mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the A7G proof.'
  );

  await runPostgresMigrations();
  await resetRuntimeTables();

  const sourceStorage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    sourceStorage
  );

  const dataDir = path.join(process.cwd(), 'data');
  const apiKeyFile = path.join(dataDir, 'api_keys.json');
  const apiUsageFile = path.join(dataDir, 'api_usage.json');
  const datasetMetadataFile = path.join(
    dataDir,
    'datasets.json'
  );
  const datasetPayloadFile = path.join(
    dataDir,
    'dataset_runtime_payloads.json'
  );
  const knowledgePayloadFile = path.join(
    dataDir,
    'knowledge_bases.json'
  );

  const legacyBefore = new Map<string, string | null>([
    [apiKeyFile, snapshot(apiKeyFile)],
    [apiUsageFile, snapshot(apiUsageFile)],
    [datasetMetadataFile, snapshot(datasetMetadataFile)],
  ]);
  const payloadBefore = snapshot(datasetPayloadFile);
  const knowledgeBefore = snapshot(knowledgePayloadFile);

  const accountA = 'acc_a7g_core_a';
  const accountB = 'acc_a7g_core_b';

  // ------------------------------------------------------------------
  // 1. API keys + usage: PostgreSQL durable, synchronous auth cache.
  // ------------------------------------------------------------------
  const key = await apiKeyRuntimeService.createApiKey({
    name: 'A7G Production Key',
    accountId: accountA,
    environment: 'test',
    scopes: ['chat:read', 'knowledge:read'],
  });

  const dbKey = await postgresApiKeyRepository.get(
    accountA,
    key.apiKey.id
  );
  assert(
    dbKey?.keyHash === key.apiKey.keyHash &&
      dbKey.accountId === accountA,
    'A7G API-key creation must persist PostgreSQL metadata before the key is usable.'
  );

  const rawDbKeys = JSON.stringify(
    (
      await postgresPool().query(
        'SELECT id, key_hash, masked_key FROM api_keys WHERE account_id = $1',
        [accountA]
      )
    ).rows
  );
  assert(
    !rawDbKeys.includes(key.secret),
    'Raw API key secret must never enter PostgreSQL.'
  );

  const initialValidation =
    apiKeyStore.validateApiKey(key.secret);
  assert(
    initialValidation.valid &&
      initialValidation.apiKey?.accountId === accountA,
    'Fresh PostgreSQL-created API key must immediately authenticate through the validation cache.'
  );

  apiKeyStore.replaceValidationCache([]);
  assert(
    !apiKeyStore.validateApiKey(key.secret).valid,
    'Clearing the process cache must remove transient authentication state.'
  );

  const reconstructedApiRuntime =
    new ApiKeyRuntimeService();
  await reconstructedApiRuntime.bootstrap();
  const restartedValidation =
    apiKeyStore.validateApiKey(key.secret);
  assert(
    restartedValidation.valid &&
      restartedValidation.apiKey?.id === key.apiKey.id,
    'API-key validation cache must reconstruct from PostgreSQL after a simulated process restart.'
  );

  await reconstructedApiRuntime.recordUsage({
    requestId: 'req_a7g_usage_1',
    apiKeyId: key.apiKey.id,
    accountId: accountA,
    aiId: 'ai_a7g',
    endpoint: '/api/v1/chat',
    timestamp: Date.now(),
    status: 200,
    latencyMs: 17,
    refused: false,
    grounded: true,
  });
  const usage =
    await reconstructedApiRuntime.getUsageStats(accountA);
  assert(
    usage.totalRequests === 1 &&
      usage.successfulRequests === 1 &&
      usage.recentLogs[0]?.apiKeyId === key.apiKey.id,
    'API usage statistics must be PostgreSQL-authoritative in production mode.'
  );

  const revoked =
    await reconstructedApiRuntime.revokeApiKey(
      key.apiKey.id,
      accountA
    );
  assert(
    revoked &&
      !apiKeyStore.validateApiKey(key.secret).valid &&
      (
        await postgresApiKeyRepository.get(
          accountA,
          key.apiKey.id
        )
      )?.status === 'revoked',
    'API-key revocation must update PostgreSQL and the synchronous validation cache together.'
  );
  assert(
    (
      await reconstructedApiRuntime.listApiKeyMetadata(
        accountB
      )
    ).length === 0,
    'Foreign accounts must not list another account API keys.'
  );

  // ------------------------------------------------------------------
  // 2. Workspace metadata: PostgreSQL identity + per-account active state.
  // ------------------------------------------------------------------
  const workspaceA1 =
    await workspaceRuntimeService.createKB(
      accountA,
      'A7G Workspace A1',
      'First A workspace'
    );
  const workspaceA2 =
    await workspaceRuntimeService.createKB(
      accountA,
      'A7G Workspace A2',
      'Second A workspace'
    );
  const workspaceB =
    await workspaceRuntimeService.createKB(
      accountB,
      'A7G Workspace B',
      'B workspace'
    );

  await workspaceRuntimeService.setActiveKB(
    accountA,
    workspaceA1.id
  );
  await workspaceRuntimeService.setActiveKB(
    accountB,
    workspaceB.id
  );

  assert(
    (
      await postgresWorkspaceMetadataRepository.getActive(
        accountA
      )
    ) === workspaceA1.id &&
      (
        await postgresWorkspaceMetadataRepository.getActive(
          accountB
        )
      ) === workspaceB.id,
    'Active workspace selection must be persisted independently per account.'
  );

  // Legacy payload still has one global active id. It must not control runtime.
  kbStore.setActiveKB(workspaceA2.id, accountA);
  kbStore.setActiveKB(workspaceB.id, accountB);

  const activeA =
    await workspaceRuntimeService.getActiveKB(accountA);
  const activeB =
    await workspaceRuntimeService.getActiveKB(accountB);
  assert(
    activeA.id === workspaceA1.id &&
      activeB.id === workspaceB.id,
    'PostgreSQL per-account active workspace must override the legacy payload store global active ID.'
  );

  const renamed =
    await workspaceRuntimeService.updateKB(
      accountA,
      workspaceA1.id,
      { name: 'A7G Authoritative Workspace' }
    );
  assert(
    renamed.name === 'A7G Authoritative Workspace',
    'Workspace metadata update failed.'
  );

  // Deliberately make the payload metadata stale; relational metadata wins.
  kbStore.updateKB(
    workspaceA1.id,
    { name: 'STALE PAYLOAD NAME' },
    accountA
  );
  const overlaid =
    await workspaceRuntimeService.requireKB(
      accountA,
      workspaceA1.id
    );
  assert(
    overlaid.name === 'A7G Authoritative Workspace',
    'PostgreSQL workspace metadata must override stale metadata embedded in the legacy payload.'
  );

  let foreignWorkspaceBlocked = false;
  try {
    await workspaceRuntimeService.requireKB(
      accountB,
      workspaceA1.id
    );
  } catch (error: any) {
    foreignWorkspaceBlocked =
      error?.code === 'KNOWLEDGE_BASE_NOT_FOUND';
  }
  assert(
    foreignWorkspaceBlocked,
    'Foreign account must not resolve another account workspace through the selected runtime.'
  );

  await closePostgresPool();
  const reconstructedWorkspace =
    new WorkspaceRuntimeService();
  assert(
    (
      await reconstructedWorkspace.getActiveKB(accountA)
    ).id === workspaceA1.id &&
      (
        await reconstructedWorkspace.getActiveKB(accountB)
      ).id === workspaceB.id,
    'Per-account active workspace state must survive PostgreSQL pool/runtime reconstruction.'
  );

  // ------------------------------------------------------------------
  // 3. Dataset identity/version metadata: PostgreSQL + payload backend.
  // ------------------------------------------------------------------
  const firstCsv = [
    'order_id,customer_name,balance_due,status',
    'A7G-1,Acme,12000,OPEN',
  ].join('\n');

  const firstImport = await datasetService.importFile({
    accountId: accountA,
    buffer: Buffer.from(firstCsv, 'utf8'),
    filename: 'a7g-orders.csv',
    mimeType: 'text/csv',
    datasetName: 'A7G Orders',
  });

  const firstMetadata =
    await postgresDatasetMetadataRepository.get(
      accountA,
      firstImport.dataset.id
    );
  const firstVersionMetadata =
    await postgresDatasetMetadataRepository.getVersionMetadata(
      accountA,
      firstImport.dataset.id,
      firstImport.version.id
    );

  assert(
    firstMetadata?.currentVersionId ===
      firstImport.version.id &&
      firstVersionMetadata?.payload.backend ===
        'durable-dataset-payload' &&
      Boolean(
        firstVersionMetadata.sourceVersionId
      ) &&
      firstVersionMetadata.payload.storageBackend ===
        sourceStorage.backend &&
      Boolean(
        firstVersionMetadata.payload.sha256
      ) &&
      Number(
        firstVersionMetadata.payload.sizeBytes
      ) > 0,
    'Production Dataset import must commit relational identity/version metadata with durable source and analytical payload locators.'
  );

  const firstAnalytics = structuredAnalyticsEngine.execute({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
    plan: {
      tableName: 'a7g-orders',
      aggregates: [
        {
          operator: 'SUM',
          column: 'balance_due',
          alias: 'total',
        },
      ],
      limit: 1,
    },
  });
  assert(
    firstAnalytics.rows[0]?.total === 12000,
    'Synchronous deterministic analytics must work from the production runtime cache after relational import.'
  );

  const secondCsv = [
    'order_id,customer_name,balance_due,status',
    'A7G-1,Acme,4000,OPEN',
    'A7G-2,Beta,2000,OPEN',
  ].join('\n');

  const secondImport = await datasetService.importFile({
    accountId: accountA,
    buffer: Buffer.from(secondCsv, 'utf8'),
    filename: 'a7g-orders.csv',
    mimeType: 'text/csv',
    existingDatasetId: firstImport.dataset.id,
  });

  const dbVersions =
    await postgresDatasetMetadataRepository.listVersions(
      accountA,
      firstImport.dataset.id
    );
  const secondMetadata =
    await postgresDatasetMetadataRepository.get(
      accountA,
      firstImport.dataset.id
    );

  assert(
    dbVersions.length === 2 &&
      dbVersions[0].versionNumber === 1 &&
      dbVersions[1].versionNumber === 2 &&
      secondMetadata?.currentVersionId ===
        secondImport.version.id,
    'A new production Dataset version must append relational history and atomically advance the current-version pointer.'
  );
  assert(
    (
      await postgresDatasetMetadataRepository.get(
        accountB,
        firstImport.dataset.id
      )
    ) === null,
    'Foreign account must not resolve Dataset metadata.'
  );

  // Simulate process cache loss, then reconstruct from DB + payload backend.
  datasetStore.replaceRuntimeState({
    datasets: [],
    versions: [],
    importRuns: [],
  });
  await closePostgresPool();

  const reconstructedDatasetRuntime =
    new DatasetRuntimePersistence(
      new DatasetRuntimePayloadStore()
    );
  await reconstructedDatasetRuntime.bootstrap();

  const restored = datasetStore.requireDataset(
    accountA,
    firstImport.dataset.id
  );
  assert(
    restored.currentVersionId ===
      secondImport.version.id &&
      restored.versionIds.length === 2,
    'Dataset runtime cache must reconstruct from PostgreSQL metadata after restart.'
  );

  const restoredAnalytics =
    structuredAnalyticsEngine.execute({
      accountId: accountA,
      datasetId: firstImport.dataset.id,
      plan: {
        tableName: 'a7g-orders',
        aggregates: [
          {
            operator: 'SUM',
            column: 'balance_due',
            alias: 'total',
          },
        ],
        limit: 1,
      },
    });
  assert(
    restoredAnalytics.rows[0]?.total === 6000,
    'Reconstructed Dataset cache must load current analytical rows from the explicit payload backend.'
  );

  let foreignDatasetBlocked = false;
  try {
    datasetStore.requireDataset(
      accountB,
      firstImport.dataset.id
    );
  } catch (error: any) {
    foreignDatasetBlocked =
      error?.code === 'DATASET_NOT_FOUND';
  }
  assert(
    foreignDatasetBlocked,
    'Reconstructed analytical cache must preserve Dataset account isolation.'
  );

  // ------------------------------------------------------------------
  // 4. Legacy metadata JSON is not authoritative in PostgreSQL mode.
  // ------------------------------------------------------------------
  for (const file of [
    apiKeyFile,
    apiUsageFile,
    datasetMetadataFile,
  ]) {
    assert(
      snapshot(file) === legacyBefore.get(file),
      'PostgreSQL A7G runtime must not mutate legacy metadata JSON file: ' +
        path.basename(file)
    );
  }

  assert(
    snapshot(datasetPayloadFile) === payloadBefore,
    'C5 PostgreSQL Dataset imports must no longer mutate the legacy local analytical payload file.'
  );

  // Workspace payload remains intentionally local until Track C.
  assert(
    snapshot(knowledgePayloadFile) !== knowledgeBefore,
    'A7G explicitly expects the temporary workspace document/chat payload backend to remain local until Track C.'
  );

  setSourceByteStorageForTesting(
    null
  );

  console.log('PRODUCTION_A7G_CORE_METADATA_RUNTIME_CHECK_PASSED');
  console.log(
    'PostgreSQL-authoritative API keys/usage, per-account workspace metadata and active selection, Dataset metadata/version identity, analytical payload reconstruction, restart durability, account isolation, and zero legacy API-key/Dataset metadata JSON mutation are verified. Workspace document/chat payload remains an explicit Track C limitation.'
  );
}

main().catch(async (error) => {
  console.error(
    'PRODUCTION_A7G_CORE_METADATA_RUNTIME_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
