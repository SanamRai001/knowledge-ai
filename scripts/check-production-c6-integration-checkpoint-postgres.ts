import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresDatasetMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  postgresSourceObjectRepository,
} from '../server/storage/postgresSourceObjectRepository.js';
import {
  setSourceByteStorageForTesting,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  datasetSourceStorageService,
} from '../server/datasets/datasetSourceStorageService.js';
import {
  datasetService,
} from '../server/datasets/datasetService.js';
import {
  integrationRuntimeService,
} from '../server/integrations/integrationRuntimeService.js';
import {
  integrationPersistence,
} from '../server/integrations/integrationPersistence.js';
import {
  integrationSourceRecoveryService,
} from '../server/integrations/integrationSourceRecoveryService.js';
import {
  testIntegrationConnector,
} from '../server/integrations/connectors/testConnector.js';
import {
  structuredKnowledgeRuntimeProjectionService,
} from '../server/companyKnowledge/structuredKnowledgeRuntimeProjectionService.js';
import type {
  ExternalImportState,
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

function csv(value: number): Buffer {
  return Buffer.from(
    [
      'product_id,product_name,current_stock,reorder_level',
      'C6-P1,C6 Pine,' +
        value +
        ',4',
    ].join('\n'),
    'utf8'
  );
}

function provenance(input: {
  connectionId: string;
  externalId: string;
  externalVersion: string;
  name: string;
}) {
  return {
    provider: 'TEST' as const,
    connectionId:
      input.connectionId,
    externalId: input.externalId,
    externalVersion:
      input.externalVersion,
    name: input.name,
    mimeType: 'text/csv',
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

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes('012') ||
      migrations.alreadyApplied.includes(
        '012'
      ),
    'C6 requires migration 012.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const storage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    storage
  );

  const accountA = 'acc_c6_a';
  const accountB = 'acc_c6_b';
  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  try {
    const connection =
      await integrationRuntimeService
        .createConnection({
          accountId: accountA,
          provider: 'TEST',
          displayName:
            'C6 checkpoint proof',
        });

    // Crash window 1:
    // source snapshot exists, Dataset metadata does not.
    const sourceFirstBytes = csv(11);
    const sourceFirst =
      await datasetSourceStorageService
        .persistUploadedSource({
          accountId: accountA,
          filename:
            'c6-source-first.csv',
          contentType: 'text/csv',
          bytes: sourceFirstBytes,
          externalConnectionId:
            connection.id,
          externalId:
            'c6-source-first',
          externalVersion: 'v1',
        });

    assert(
      sourceFirst.createdSourceVersion,
      'Precondition: first crash window must create a provider source snapshot.'
    );

    testIntegrationConnector
      .configureConnection({
        connectionId:
          connection.id,
        fixtures: [
          {
            externalId:
              'c6-source-first',
            externalVersion: 'v1',
            name:
              'c6-source-first.csv',
            mimeType: 'text/csv',
            content:
              sourceFirstBytes,
            modifiedAt: 1,
          },
        ],
      });

    const firstRun =
      await integrationRuntimeService.sync({
        accountId: accountA,
        connectionId:
          connection.id,
        maxAttempts: 1,
      });

    assert(
      firstRun.status ===
        'COMPLETED' &&
        firstRun.cursorAfter === '1' &&
        firstRun.importedCount === 1,
      'C6 must recover from source-snapshot-only state and complete the checkpoint.'
    );

    const firstImport =
      await integrationPersistence
        .findExactImport({
          accountId: accountA,
          connectionId:
            connection.id,
          externalId:
            'c6-source-first',
          externalVersion: 'v1',
        });

    assert(
      firstImport?.status ===
        'READY' &&
        firstImport.sourceVersionId ===
          sourceFirst.sourceVersion.id &&
        Boolean(
          firstImport
            .knowledgeProjectionRunId
        ),
      'Recovered first provider record must bind the exact immutable source snapshot and completed projection.'
    );

    const sourceIdentityRows =
      await postgresPool().query(
        `SELECT sv.id
         FROM source_versions sv
         JOIN source_objects so
           ON so.account_id = sv.account_id
          AND so.id = sv.source_object_id
         WHERE sv.account_id = $1
           AND so.external_connection_id = $2
           AND so.external_id = $3
           AND sv.external_version = $4`,
        [
          accountA,
          connection.id,
          'c6-source-first',
          'v1',
        ]
      );
    assert(
      sourceIdentityRows.rowCount ===
        1,
      'Retry after source-only crash must not duplicate the exact provider source snapshot.'
    );

    // Crash window 2:
    // Dataset + source snapshot committed, external-import journal missing.
    const datasetFirstBytes = csv(22);
    const datasetFirst =
      await datasetService.importFile({
        accountId: accountA,
        buffer: datasetFirstBytes,
        filename:
          'c6-dataset-first.csv',
        mimeType: 'text/csv',
        datasetName:
          'C6 Dataset First',
        externalConnectionId:
          connection.id,
        externalId:
          'c6-dataset-first',
        externalVersion: 'v1',
      });

    assert(
      Boolean(
        datasetFirst.version
          .sourceVersionId
      ),
      'Precondition: crash-orphaned DatasetVersion must have durable source provenance.'
    );
    assert(
      (
        await integrationPersistence
          .findExactImport({
            accountId: accountA,
            connectionId:
              connection.id,
            externalId:
              'c6-dataset-first',
            externalVersion: 'v1',
          })
      ) === null,
      'Precondition: no external-import journal row should exist for the crash-orphaned DatasetVersion.'
    );

    testIntegrationConnector
      .appendFixture({
        connectionId:
          connection.id,
        externalId:
          'c6-dataset-first',
        externalVersion: 'v1',
        name:
          'c6-dataset-first.csv',
        mimeType: 'text/csv',
        content:
          datasetFirstBytes,
        modifiedAt: 2,
        failFetch: true,
      });

    const secondRun =
      await integrationRuntimeService.sync({
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
        secondRun.importedCount === 1,
      'C6 must recover a committed DatasetVersion before provider fetch and advance the next checkpoint.'
    );

    const secondImport =
      await integrationPersistence
        .findExactImport({
          accountId: accountA,
          connectionId:
            connection.id,
          externalId:
            'c6-dataset-first',
          externalVersion: 'v1',
        });

    assert(
      secondImport?.status ===
        'READY' &&
        secondImport.internalId ===
          datasetFirst.dataset.id &&
        secondImport
          .internalVersionId ===
          datasetFirst.version.id &&
        secondImport.sourceVersionId ===
          datasetFirst.version
            .sourceVersionId &&
        Boolean(
          secondImport
            .knowledgeProjectionRunId
        ),
      'Crash recovery must journal the already-committed DatasetVersion and exact source snapshot.'
    );

    const recovered =
      await integrationSourceRecoveryService
        .recoverDatasetImport({
          accountId: accountA,
          connectionId:
            connection.id,
          externalId:
            'c6-dataset-first',
          externalVersion: 'v1',
        });
    assert(
      recovered?.datasetId ===
        datasetFirst.dataset.id &&
        recovered
          .datasetVersionId ===
          datasetFirst.version.id,
      'C6 recovery service must deterministically resolve committed Dataset identity from provider source identity.'
    );

    assert(
      (
        await integrationSourceRecoveryService
          .recoverDatasetImport({
            accountId: accountB,
            connectionId:
              connection.id,
            externalId:
              'c6-dataset-first',
            externalVersion: 'v1',
          })
      ) === null,
      'Foreign account must not recover another account provider snapshot.'
    );

    // Crash window 3:
    // READY journal exists, cursor/checkpoint commit did not happen.
    const readyBytes = csv(33);
    const readyDataset =
      await datasetService.importFile({
        accountId: accountA,
        buffer: readyBytes,
        filename:
          'c6-ready-before-checkpoint.csv',
        mimeType: 'text/csv',
        datasetName:
          'C6 Ready Before Checkpoint',
        externalConnectionId:
          connection.id,
        externalId:
          'c6-ready-before-checkpoint',
        externalVersion: 'v1',
      });

    const projection =
      await structuredKnowledgeRuntimeProjectionService
        .projectDataset({
          accountId: accountA,
          datasetId:
            readyDataset.dataset.id,
          versionId:
            readyDataset.version.id,
        });

    const readyJournal =
      await integrationPersistence
        .recordImport({
          status: 'READY',
          accountId: accountA,
          connectionId:
            connection.id,
          provider: 'TEST',
          externalId:
            'c6-ready-before-checkpoint',
          externalVersion: 'v1',
          externalName:
            'c6-ready-before-checkpoint.csv',
          resourceKind: 'FILE',
          internalKind:
            'DATASET',
          internalId:
            readyDataset.dataset.id,
          internalVersionId:
            readyDataset.version.id,
          sourceVersionId:
            readyDataset.version
              .sourceVersionId,
          knowledgeProjectionRunId:
            projection.id,
          importedAt: Date.now(),
          updatedAt: Date.now(),
          provenance: provenance({
            connectionId:
              connection.id,
            externalId:
              'c6-ready-before-checkpoint',
            externalVersion: 'v1',
            name:
              'c6-ready-before-checkpoint.csv',
          }),
        });

    assert(
      readyJournal.status ===
        'READY',
      'Precondition: third crash window must have a durable READY journal before cursor advance.'
    );

    testIntegrationConnector
      .appendFixture({
        connectionId:
          connection.id,
        externalId:
          'c6-ready-before-checkpoint',
        externalVersion: 'v1',
        name:
          'c6-ready-before-checkpoint.csv',
        mimeType: 'text/csv',
        content: readyBytes,
        modifiedAt: 3,
        failFetch: true,
      });

    const thirdRun =
      await integrationRuntimeService.sync({
        accountId: accountA,
        connectionId:
          connection.id,
        maxAttempts: 1,
      });

    assert(
      thirdRun.status ===
        'COMPLETED' &&
        thirdRun.cursorBefore ===
          '2' &&
        thirdRun.cursorAfter ===
          '3' &&
        thirdRun.skippedCount === 1,
      'C6 must finalize a READY journal without refetching the provider record.'
    );

    const connectionAtThree =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );
    assert(
      connectionAtThree.cursor ===
        '3',
      'C6 checkpoint transaction must durably advance the connection cursor after all prerequisites are committed.'
    );

    // Checkpoint transaction must roll back cursor/run on source mismatch.
    const mismatchRun =
      await integrationPersistence
        .createSyncRun({
          accountId: accountA,
          connectionId:
            connection.id,
          provider: 'TEST',
          cursorBefore: '3',
          maxAttempts: 1,
        });

    const mismatchImport:
      ExternalImportState = {
        ...secondImport!,
        id: 'extimp_c6_bad_source',
        externalId:
          'c6-bad-source',
        externalVersion: 'v1',
        externalName:
          'c6-bad-source.csv',
        sourceVersionId:
          sourceFirst.sourceVersion.id,
        importedAt: Date.now(),
        updatedAt: Date.now(),
      };

    let sourceMismatchBlocked = false;
    try {
      await integrationPersistence
        .commitSuccessfulCheckpoint({
          accountId: accountA,
          connectionId:
            connection.id,
          runId:
            mismatchRun.id,
          expectedCursor: '3',
          nextCursor: '4',
          completedAt: Date.now(),
          imports: [
            mismatchImport,
          ],
          run: {
            ...mismatchRun,
            status: 'COMPLETED',
            cursorAfter: '4',
            completedAt:
              Date.now(),
            attemptCount: 1,
            processedCount: 1,
            importedCount: 1,
            skippedCount: 0,
            tombstoneCount: 0,
            failedCount: 0,
            recordResults: [],
          },
        });
    } catch (error: any) {
      sourceMismatchBlocked =
        String(error?.message || '')
          .includes(
            'INTEGRATION_CHECKPOINT_SOURCE_MISMATCH'
          );
    }
    assert(
      sourceMismatchBlocked,
      'C6 checkpoint must reject a READY import whose source snapshot does not match the committed DatasetVersion.'
    );

    const afterMismatch =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );
    const mismatchRunAfter =
      await integrationPersistence
        .requireSyncRun(
          accountA,
          mismatchRun.id
        );
    assert(
      afterMismatch.cursor === '3' &&
        mismatchRunAfter.status ===
          'RUNNING',
      'Rejected checkpoint must roll back both cursor movement and SyncRun completion.'
    );

    // Completed projection is independently mandatory.
    const missingProjectionRun =
      await integrationPersistence
        .createSyncRun({
          accountId: accountA,
          connectionId:
            connection.id,
          provider: 'TEST',
          cursorBefore: '3',
          maxAttempts: 1,
        });

    const noProjectionImport:
      ExternalImportState = {
        ...secondImport!,
        id: 'extimp_c6_no_projection',
        externalId:
          'c6-no-projection',
        externalVersion: 'v1',
        externalName:
          'c6-no-projection.csv',
        knowledgeProjectionRunId:
          undefined,
        importedAt: Date.now(),
        updatedAt: Date.now(),
      };

    let projectionBlocked = false;
    try {
      await integrationPersistence
        .commitSuccessfulCheckpoint({
          accountId: accountA,
          connectionId:
            connection.id,
          runId:
            missingProjectionRun.id,
          expectedCursor: '3',
          nextCursor: '4',
          completedAt: Date.now(),
          imports: [
            noProjectionImport,
          ],
          run: {
            ...missingProjectionRun,
            status: 'COMPLETED',
            cursorAfter: '4',
            completedAt:
              Date.now(),
            attemptCount: 1,
            processedCount: 1,
            importedCount: 1,
            skippedCount: 0,
            tombstoneCount: 0,
            failedCount: 0,
            recordResults: [],
          },
        });
    } catch (error: any) {
      projectionBlocked =
        String(error?.message || '')
          .includes(
            'INTEGRATION_CHECKPOINT_PROJECTION_MISSING'
          );
    }
    assert(
      projectionBlocked,
      'C6 checkpoint must reject cursor advancement without the exact completed Dataset projection.'
    );

    const finalConnection =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );
    assert(
      finalConnection.cursor === '3',
      'Failed source/projection checkpoints must never advance the provider cursor.'
    );

    const exactSource =
      await postgresSourceObjectRepository
        .findExternalVersionByIdentity(
          accountA,
          connection.id,
          'c6-dataset-first',
          'v1'
        );
    const exactDatasetVersion =
      exactSource
        ? await postgresDatasetMetadataRepository
            .findVersionBySourceVersionId(
              accountA,
              exactSource.id
            )
        : null;

    assert(
      exactDatasetVersion?.id ===
        datasetFirst.version.id,
      'C6 provider source identity must resolve back to the exact committed DatasetVersion.'
    );

    console.log(
      'PRODUCTION_C6_INTEGRATION_CHECKPOINT_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Source-only crash recovery, Dataset-before-journal recovery, READY-before-checkpoint recovery, exact snapshot reuse, cross-account denial, atomic checkpoint rollback, and projection/source cursor guards are verified.'
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
