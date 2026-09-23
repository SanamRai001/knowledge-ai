import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  postgresDatasetMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  postgresSourceObjectRepository,
} from '../server/storage/postgresSourceObjectRepository.js';
import {
  setSourceByteStorageForTesting,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  datasetService,
} from '../server/datasets/datasetService.js';
import {
  datasetStore,
} from '../server/datasets/datasetStore.js';
import {
  integrationPersistence,
} from '../server/integrations/integrationPersistence.js';
import {
  integrationRuntimeService,
} from '../server/integrations/integrationRuntimeService.js';
import {
  integrationSourceRecoveryService,
} from '../server/integrations/integrationSourceRecoveryService.js';
import {
  testIntegrationConnector,
} from '../server/integrations/connectors/testConnector.js';
import type {
  ExternalImportState,
  SyncRun,
} from '../server/integrations/types.js';
import {
  MemorySourceByteStorage,
} from './support/memorySourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function csv(
  balanceA: number,
  balanceB?: number
): Buffer {
  const rows = [
    'order_id,customer_name,balance_due,status',
    'C6-1,Acme,' +
      balanceA +
      ',OPEN',
  ];
  if (balanceB !== undefined) {
    rows.push(
      'C6-2,Beta,' +
        balanceB +
        ',OPEN'
    );
  }
  return Buffer.from(
    rows.join('\n'),
    'utf8'
  );
}

function completedRun(
  run: SyncRun,
  cursorAfter: string
): SyncRun {
  return {
    ...run,
    status: 'COMPLETED',
    cursorAfter,
    completedAt: Date.now(),
    attemptCount: Math.max(
      1,
      run.attemptCount
    ),
    retryable: false,
    processedCount:
      run.processedCount,
    importedCount:
      run.importedCount,
    skippedCount:
      run.skippedCount,
    tombstoneCount:
      run.tombstoneCount,
    failedCount:
      run.failedCount,
    recordResults:
      run.recordResults,
    error: undefined,
  };
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'C6 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for C6 PostgreSQL proof.'
  );

  process.env.INTEGRATION_SYNC_RETRY_BASE_MS =
    '0';

  const migration =
    await runPostgresMigrations();
  assert(
    migration.applied.includes('012') ||
      migration.alreadyApplied.includes(
        '012'
      ),
    'C6 requires migration 012.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  datasetStore.replaceRuntimeState({
    datasets: [],
    versions: [],
    importRuns: [],
  });

  const storage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    storage
  );

  const accountA = 'acc_c6_a';
  const accountB = 'acc_c6_b';

  try {
    const connection =
      await integrationRuntimeService
        .createConnection({
          accountId: accountA,
          provider: 'TEST',
          displayName:
            'C6 recovery connector',
        });

    const v1Bytes = csv(12000);
    testIntegrationConnector
      .configureConnection({
        connectionId:
          connection.id,
        fixtures: [
          {
            externalId:
              'c6-orders',
            externalVersion:
              'v1',
            name:
              'c6-orders.csv',
            mimeType:
              'text/csv',
            content: v1Bytes,
            modifiedAt: 1,
            failFetch: true,
          },
        ],
      });

    // Simulate a process crash after C5 committed the Dataset/source
    // but before Integration recorded its external-import row.
    const precommitted =
      await datasetService.importFile({
        accountId: accountA,
        buffer: v1Bytes,
        filename:
          'c6-orders.csv',
        mimeType: 'text/csv',
        datasetName:
          'C6 Orders',
        externalConnectionId:
          connection.id,
        externalId:
          'c6-orders',
        externalVersion: 'v1',
      });

    assert(
      Boolean(
        precommitted.version
          .sourceVersionId
      ),
      'Crash fixture must have a durable sourceVersionId.'
    );

    const missingImport =
      await integrationPersistence
        .findExactImport({
          accountId: accountA,
          connectionId:
            connection.id,
          externalId:
            'c6-orders',
          externalVersion: 'v1',
        });
    assert(
      missingImport === null,
      'Crash fixture must begin with committed Dataset metadata but no external-import row.'
    );

    const beforeRecovery =
      await integrationRuntimeService
        .getInternalConnection(
          accountA,
          connection.id
        );
    assert(
      beforeRecovery.cursor ===
        undefined,
      'Cursor must remain unadvanced before crash recovery.'
    );

    const recoveryRun =
      await integrationRuntimeService
        .sync({
          accountId: accountA,
          connectionId:
            connection.id,
          maxAttempts: 1,
        });

    assert(
      recoveryRun.status ===
        'COMPLETED' &&
        recoveryRun.cursorBefore ===
          undefined &&
        recoveryRun.cursorAfter ===
          '1' &&
        recoveryRun.importedCount ===
          1,
      'C6 must recover the committed Dataset without provider refetch and complete the checkpoint.'
    );

    const recoveredImport =
      await integrationPersistence
        .findExactImport({
          accountId: accountA,
          connectionId:
            connection.id,
          externalId:
            'c6-orders',
          externalVersion: 'v1',
        });

    assert(
      recoveredImport?.status ===
        'READY' &&
        recoveredImport.internalId ===
          precommitted.dataset.id &&
        recoveredImport
          .internalVersionId ===
          precommitted.version.id &&
        recoveredImport
          .sourceVersionId ===
          precommitted.version
            .sourceVersionId &&
        Boolean(
          recoveredImport
            .knowledgeProjectionRunId
        ),
      'Recovered external import must point to the exact precommitted DatasetVersion/source snapshot and be READY.'
    );

    const datasetsAfterRecovery =
      await postgresDatasetMetadataRepository
        .list(accountA);
    assert(
      datasetsAfterRecovery.length ===
        1 &&
        datasetsAfterRecovery[0]
          .id ===
          precommitted.dataset.id,
      'Crash recovery must not create a duplicate Dataset.'
    );

    const v1Source =
      await postgresSourceObjectRepository
        .getVersionById(
          accountA,
          precommitted.version
            .sourceVersionId!
        );
    const v1SourceObject =
      await postgresSourceObjectRepository
        .getObject(
          accountA,
          v1Source!.sourceObjectId
        );
    assert(
      v1Source?.externalVersion ===
        'v1' &&
        v1SourceObject
          ?.externalConnectionId ===
          connection.id &&
        v1SourceObject
          ?.externalId ===
          'c6-orders',
      'C6 source snapshot must retain external connection/resource/version provenance.'
    );

    const foreignRecovery =
      await integrationSourceRecoveryService
        .findCommittedDataset({
          accountId: accountB,
          connectionId:
            connection.id,
          externalId:
            'c6-orders',
          externalVersion: 'v1',
        });
    assert(
      foreignRecovery === null,
      'Cross-account source recovery must return no committed Dataset.'
    );

    const v2Bytes = csv(
      4000,
      2000
    );
    testIntegrationConnector
      .appendFixture({
        connectionId:
          connection.id,
        externalId:
          'c6-orders',
        externalVersion:
          'v2',
        name:
          'c6-orders.csv',
        mimeType: 'text/csv',
        content: v2Bytes,
        modifiedAt: 2,
      });

    const secondRun =
      await integrationRuntimeService
        .sync({
          accountId: accountA,
          connectionId:
            connection.id,
          maxAttempts: 1,
        });
    assert(
      secondRun.status ===
        'COMPLETED' &&
        secondRun.cursorBefore ===
          '1' &&
        secondRun.cursorAfter ===
          '2' &&
        secondRun.importedCount ===
          1,
      'Second provider version must commit and advance the next checkpoint.'
    );

    const v2Import =
      await integrationPersistence
        .findExactImport({
          accountId: accountA,
          connectionId:
            connection.id,
          externalId:
            'c6-orders',
          externalVersion: 'v2',
        });
    assert(
      v2Import?.status ===
        'READY' &&
        v2Import.internalId ===
          precommitted.dataset.id &&
        Boolean(
          v2Import.sourceVersionId
        ),
      'Changed external version must preserve Dataset identity and link its new source snapshot.'
    );

    const versions =
      await postgresDatasetMetadataRepository
        .listVersions(
          accountA,
          precommitted.dataset.id
        );
    assert(
      versions.length === 2 &&
        versions[0].id ===
          precommitted.version.id &&
        versions[1].id ===
          v2Import!
            .internalVersionId &&
        versions[1]
          .sourceVersionId ===
          v2Import!
            .sourceVersionId,
      'C6 must preserve same-Dataset immutable versioning with exact source linkage.'
    );

    // Stale checkpoint cannot partially complete a run or overwrite a
    // connection cursor that changed before commit.
    const stableConnection =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );
    const staleRun =
      await integrationPersistence
        .createSyncRun({
          accountId: accountA,
          connectionId:
            connection.id,
          provider: 'TEST',
          cursorBefore:
            stableConnection.cursor,
          maxAttempts: 1,
        });

    await integrationPersistence
      .updateConnection(
        accountA,
        connection.id,
        {
          cursor:
            'concurrent-cursor',
        }
      );

    let staleBlocked = false;
    try {
      await integrationPersistence
        .commitSuccessfulCheckpoint({
          accountId: accountA,
          connectionId:
            connection.id,
          runId: staleRun.id,
          expectedCursor:
            stableConnection.cursor,
          nextCursor: '3',
          completedAt: Date.now(),
          imports: [],
          run: completedRun(
            staleRun,
            '3'
          ),
        });
    } catch (error: any) {
      staleBlocked = String(
        error?.message || error
      ).includes(
        'INTEGRATION_CHECKPOINT_STALE'
      );
    }

    const staleRunAfter =
      await integrationPersistence
        .requireSyncRun(
          accountA,
          staleRun.id
        );
    const staleConnectionAfter =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );

    assert(
      staleBlocked &&
        staleRunAfter.status ===
          'RUNNING' &&
        staleConnectionAfter
          .cursor ===
          'concurrent-cursor',
      'Stale checkpoint rejection must leave run/cursor state uncommitted.'
    );

    await integrationPersistence
      .updateConnection(
        accountA,
        connection.id,
        {
          cursor: '2',
        }
      );

    const incompleteRun =
      await integrationPersistence
        .createSyncRun({
          accountId: accountA,
          connectionId:
            connection.id,
          provider: 'TEST',
          cursorBefore: '2',
          maxAttempts: 1,
        });

    const incomplete: Omit<
      ExternalImportState,
      'id'
    > = {
      status: 'INGESTED',
      accountId: accountA,
      connectionId:
        connection.id,
      provider: 'TEST',
      externalId:
        'c6-incomplete',
      externalVersion: 'v1',
      externalName:
        'c6-incomplete.csv',
      resourceKind: 'FILE',
      internalKind: 'DATASET',
      internalId:
        precommitted.dataset.id,
      internalVersionId:
        v2Import!
          .internalVersionId,
      sourceVersionId:
        v2Import!
          .sourceVersionId,
      importedAt: Date.now(),
      updatedAt: Date.now(),
      provenance: {
        provider: 'TEST',
        connectionId:
          connection.id,
        externalId:
          'c6-incomplete',
        externalVersion: 'v1',
        name:
          'c6-incomplete.csv',
        mimeType: 'text/csv',
      },
    };

    const incompleteState =
      await integrationPersistence
        .recordImport(incomplete);

    let incompleteBlocked = false;
    try {
      await integrationPersistence
        .commitSuccessfulCheckpoint({
          accountId: accountA,
          connectionId:
            connection.id,
          runId:
            incompleteRun.id,
          expectedCursor: '2',
          nextCursor: '3',
          completedAt: Date.now(),
          imports: [
            incompleteState,
          ],
          run: completedRun(
            incompleteRun,
            '3'
          ),
        });
    } catch (error: any) {
      incompleteBlocked = String(
        error?.message || error
      ).includes(
        'INTEGRATION_CHECKPOINT_INCOMPLETE'
      );
    }

    const incompleteRunAfter =
      await integrationPersistence
        .requireSyncRun(
          accountA,
          incompleteRun.id
        );
    const finalConnection =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );

    assert(
      incompleteBlocked &&
        incompleteRunAfter.status ===
          'RUNNING' &&
        finalConnection.cursor ===
          '2',
      'Checkpoint must not advance while any checkpoint import remains INGESTED.'
    );

    console.log(
      'PRODUCTION_C6_INTEGRATION_CHECKPOINT_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Crash-window Dataset recovery, source snapshot linkage, cross-account denial, same-Dataset versioning, stale checkpoint atomicity, and incomplete-import cursor guards are verified.'
    );
  } finally {
    setSourceByteStorageForTesting(
      null
    );
  }
}

main()
  .catch((error) => {
    setSourceByteStorageForTesting(
      null
    );
    console.error(
      'PRODUCTION_C6_INTEGRATION_CHECKPOINT_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
