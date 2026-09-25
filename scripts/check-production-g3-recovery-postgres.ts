import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  setSourceByteStorageForTesting,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  documentSourceStorageService,
} from '../server/storage/documentSourceStorageService.js';
import {
  workspaceRuntimeService,
} from '../server/workspaceRuntimeService.js';
import {
  datasetService,
} from '../server/datasets/datasetService.js';
import {
  PostgresSecretStore,
} from '../server/security/postgresSecretStore.js';
import {
  VersionedAesGcmKmsService,
  type AesGcmKeyringConfig,
} from '../server/security/versionedAesGcmKmsService.js';
import {
  postgresWorkerJobRepository,
} from '../server/worker/postgresWorkerJobRepository.js';
import {
  IsolatedRestoreVerifier,
} from '../server/operations/recovery/isolatedRestoreVerifier.js';
import {
  RecoveryDrillService,
} from '../server/operations/recovery/recoveryDrillService.js';
import type {
  ObjectStorageRecoveryInspector,
  RecoveryEvidenceProvider,
} from '../server/operations/recovery/recoveryContracts.js';
import {
  MemorySourceByteStorage,
} from './support/memorySourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function csv(
  first: number,
  second?: number
): Buffer {
  const rows = [
    'id,name,amount',
    '1,alpha,' + first,
  ];
  if (second !== undefined) {
    rows.push(
      '2,beta,' + second
    );
  }
  return Buffer.from(
    rows.join('\n'),
    'utf8'
  );
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'G3 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the G3 PostgreSQL proof.'
  );

  await runPostgresMigrations();
  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const storage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    storage
  );

  const now = Date.now();
  const accountId = 'acc_g3';
  const buildId = 'build-g3-proof';

  const oldKey = Buffer.alloc(
    32,
    11
  );
  const newKey = Buffer.alloc(
    32,
    22
  );
  let activeKeyId =
    'kms-g3-old';
  const keys = {
    'kms-g3-old': oldKey,
    'kms-g3-new': newKey,
  };

  const kms =
    new VersionedAesGcmKmsService(
      () => ({
        activeKeyId,
        keys,
      })
    );
  const secretStore =
    new PostgresSecretStore(kms);

  try {
    const workspace =
      await workspaceRuntimeService
        .createKB(
          accountId,
          'G3 Recovery Workspace',
          'Recovery drill corpus'
        );

    const source =
      await documentSourceStorageService
        .persistUploadedPdf({
          accountId,
          workspaceId:
            workspace.id,
          filename:
            'g3-recovery.pdf',
          contentType:
            'application/pdf',
          bytes: Buffer.from(
            'G3 immutable PDF source bytes',
            'utf8'
          ),
        });

    const persistedDocument =
      await workspaceRuntimeService
        .addDocument(
          accountId,
          workspace.id,
          {
            id: 'doc_g3_recovery',
            filename:
              'g3-recovery.pdf',
            fileType:
              'application/pdf',
            fileSize:
              source.sourceVersion
                .sizeBytes,
            uploadTimestamp:
              now,
            processingStatus:
              'processed',
            sourceVersionId:
              source.sourceVersion.id,
            pageCount: 1,
            pages: [
              {
                pageNumber: 1,
                text:
                  'G3 restored document corpus.',
              },
            ],
            summary:
              'G3 restored document corpus.',
          }
        );

    assert(
      Boolean(
        persistedDocument
          .derivedPayloadId
      ),
      'G3 proof document must have a durable derived payload.'
    );

    const firstDataset =
      await datasetService
        .importFile({
          accountId,
          buffer: csv(10),
          filename:
            'g3-ledger.csv',
          mimeType: 'text/csv',
          datasetName:
            'G3 Ledger',
        });

    const secondDataset =
      await datasetService
        .importFile({
          accountId,
          buffer: csv(20, 30),
          filename:
            'g3-ledger.csv',
          mimeType: 'text/csv',
          existingDatasetId:
            firstDataset.dataset.id,
        });

    assert(
      secondDataset.dataset
        .currentVersionId ===
        secondDataset.version.id,
      'G3 proof requires a current Dataset version.'
    );

    const secret =
      await secretStore.create({
        accountId,
        purpose:
          'INTEGRATION_OAUTH',
        provider: 'TEST',
        secret: {
          refreshToken:
            'g3-secret-one',
        },
      });

    activeKeyId =
      'kms-g3-new';

    await secretStore.rotate({
      accountId,
      secretId: secret.id,
      purpose:
        'INTEGRATION_OAUTH',
      provider: 'TEST',
      secret: {
        refreshToken:
          'g3-secret-two',
      },
    });

    const workerJob =
      await postgresWorkerJobRepository
        .enqueue({
          accountId,
          jobType:
            'ACTION_DISCOVERY_REFRESH',
          payload: {
            source: 'g3-proof',
          },
          idempotencyKey:
            'g3-worker-proof',
        });

    const beforeJob =
      await postgresWorkerJobRepository
        .get(
          accountId,
          workerJob.id
        );

    const evidence:
      RecoveryEvidenceProvider = {
        async relationalBackup() {
          return {
            evidenceSource:
              'g3-test-backup',
            checkedAt: now,
            latestRecoveryPointAt:
              now - 60_000,
            continuousBackupEnabled:
              true,
            pitrEnabled: true,
            estimatedRestoreMinutes:
              30,
            backupBuildId:
              buildId,
          };
        },
        async externalRestore() {
          return {
            evidenceSource:
              'g3-test-restore',
            restoredAt:
              now - 20_000,
            recoveryPointAt:
              now - 60_000,
            backupBuildId:
              buildId,
          };
        },
      };

    const inspector:
      ObjectStorageRecoveryInspector = {
        async inspect() {
          return {
            evidenceSource:
              'g3-test-object-policy',
            checkedAt: now,
            backend:
              storage.backend,
            versioningEnabled:
              true,
            recoverableDeleteWindowDays:
              30,
          };
        },
      };

    const keyring:
      AesGcmKeyringConfig = {
      activeKeyId:
        'kms-g3-new',
      keys,
    };

    const verifier =
      new IsolatedRestoreVerifier(
        postgresPool(),
        storage,
        keyring
      );
    const drill =
      new RecoveryDrillService(
        evidence,
        inspector,
        verifier
      );

    const report =
      await drill.run(
        {
          environment:
            'recovery',
          databaseUrl:
            'postgres://isolated/recovery',
          storageBackend:
            storage.backend,
          storageBucket:
            'g3-recovery-bucket',
          buildId,
        },
        now
      );

    assert(
      report.valid &&
        report.smoke
          .workspaceId ===
          workspace.id &&
        report.smoke
          .documentCount === 1 &&
        report.smoke
          .documentPageCount === 1 &&
        report.smoke.datasetId ===
          firstDataset.dataset.id &&
        report.smoke
          .datasetVersionCount ===
          2 &&
        report.smoke
          .datasetHistoricalVersionCount ===
          1 &&
        report.smoke
          .workerJobCount === 1 &&
        report.smoke
          .secretVersionCount === 2 &&
        report.smoke
          .kmsKeyIdsValidated
          .includes(
            'kms-g3-old'
          ) &&
        report.smoke
          .kmsKeyIdsValidated
          .includes(
            'kms-g3-new'
          ),
      'G3 recovery drill must reconstruct durable document/Dataset state, validate historical KMS keys, and inspect worker jobs.'
    );

    const afterJob =
      await postgresWorkerJobRepository
        .get(
          accountId,
          workerJob.id
        );

    assert(
      beforeJob?.status ===
        'PENDING' &&
        beforeJob.attemptCount === 0 &&
        afterJob?.status ===
          'PENDING' &&
        afterJob.attemptCount === 0,
      'G3 restore drill must inspect durable worker jobs without executing or claiming them.'
    );

    const missingHistoricalKey =
      new IsolatedRestoreVerifier(
        postgresPool(),
        storage,
        {
          activeKeyId:
            'kms-g3-new',
          keys: {
            'kms-g3-new':
              newKey,
          },
        }
      );

    const missingKeyResult =
      await missingHistoricalKey
        .verify();

    assert(
      !missingKeyResult.valid &&
        missingKeyResult.checks.some(
          (item) =>
            item.id ===
              'RESTORE_SECRET_KMS_HISTORY' &&
            item.status ===
              'FAIL'
        ),
      'G3 must fail closed when a historical KMS key required by restored ciphertext is unavailable.'
    );

    const payloadRow =
      await postgresPool().query<{
        payload_key: string;
      }>(
        `SELECT payload_key
         FROM document_derived_payloads
         WHERE account_id = $1
           AND workspace_id = $2
           AND is_current = true
         LIMIT 1`,
        [
          accountId,
          workspace.id,
        ]
      );

    const payloadKey =
      payloadRow.rows[0]
        ?.payload_key;
    assert(
      Boolean(payloadKey),
      'G3 proof requires a durable document payload key.'
    );

    const original =
      Buffer.from(
        storage.objects.get(
          payloadKey!
        )!
      );
    storage.objects.set(
      payloadKey!,
      Buffer.from(
        'tampered-restore-payload',
        'utf8'
      )
    );

    const tampered =
      await verifier.verify();

    assert(
      !tampered.valid &&
        tampered.checks.some(
          (item) =>
            item.id ===
              'RESTORE_WORKSPACE_DOCUMENT_CORPUS' &&
            item.status ===
              'FAIL'
        ),
      'G3 restore smoke must fail closed when restored object bytes do not match relational integrity metadata.'
    );

    storage.objects.set(
      payloadKey!,
      original
    );

    console.log(
      'PRODUCTION_G3_RECOVERY_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Workspace/document reconstruction, current/historical Dataset recovery, SecretStore historical-key validation, object integrity, and non-executing worker-job recovery are verified.'
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
      'PRODUCTION_G3_RECOVERY_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
