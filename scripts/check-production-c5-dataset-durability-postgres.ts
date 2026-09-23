import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
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
  SourceIntegrityError,
} from '../server/storage/sourceByteStorage.js';
import {
  datasetService,
} from '../server/datasets/datasetService.js';
import {
  datasetRuntimePersistence,
} from '../server/datasets/datasetRuntimePersistence.js';
import {
  datasetStore,
} from '../server/datasets/datasetStore.js';
import {
  durableDatasetPayloadStore,
} from '../server/datasets/durableDatasetPayloadStore.js';
import {
  datasetSourceStorageService,
} from '../server/datasets/datasetSourceStorageService.js';
import {
  structuredAnalyticsEngine,
} from '../server/datasets/structuredAnalyticsEngine.js';
import {
  MemorySourceByteStorage,
} from './support/memorySourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function csv(balanceA: number, balanceB?: number) {
  const rows = [
    'order_id,customer_name,balance_due,status',
    'C5-1,Acme,' +
      balanceA +
      ',OPEN',
  ];
  if (balanceB !== undefined) {
    rows.push(
      'C5-2,Beta,' +
        balanceB +
        ',OPEN'
    );
  }
  return Buffer.from(
    rows.join('\n'),
    'utf8'
  );
}

function total(
  accountId: string,
  datasetId: string,
  versionId?: string
): number {
  const result =
    structuredAnalyticsEngine.execute({
      accountId,
      datasetId,
      versionId,
      plan: {
        tableName: 'c5-orders',
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
  return Number(
    result.rows[0]?.total
  );
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'C5 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for C5 PostgreSQL proof.'
  );

  const migration =
    await runPostgresMigrations();
  assert(
    migration.applied.includes('011') ||
      migration.alreadyApplied.includes(
        '011'
      ),
    'C5 requires migration 011.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const storage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    storage
  );

  const accountA = 'acc_c5_a';
  const accountB = 'acc_c5_b';

  try {
    const firstBytes = csv(12000);
    const first =
      await datasetService.importFile({
        accountId: accountA,
        buffer: firstBytes,
        filename: 'c5-orders.csv',
        mimeType: 'text/csv',
        datasetName: 'C5 Orders',
      });

    assert(
      Boolean(
        first.version.sourceVersionId
      ),
      'C5 imported DatasetVersion must expose its opaque sourceVersionId.'
    );

    const firstMeta =
      await postgresDatasetMetadataRepository
        .getVersionMetadata(
          accountA,
          first.dataset.id,
          first.version.id
        );
    assert(
      firstMeta?.sourceVersionId ===
        first.version.sourceVersionId &&
        firstMeta.payload.backend ===
          'durable-dataset-payload' &&
        firstMeta.payload.storageBackend ===
          storage.backend &&
        Boolean(
          firstMeta.payload.sha256
        ) &&
        Number(
          firstMeta.payload.sizeBytes
        ) > 0,
      'C5 PostgreSQL version metadata must bind durable source and analytical payload integrity.'
    );

    const sourceReload =
      await datasetSourceStorageService
        .loadSourceBytes({
          accountId: accountA,
          sourceVersionId:
            first.version
              .sourceVersionId!,
        });
    assert(
      sourceReload.bytes.equals(
        firstBytes
      ),
      'C5 must reload the exact immutable CSV source bytes.'
    );

    const sourceObject =
      await postgresSourceObjectRepository
        .getObject(
          accountA,
          sourceReload.sourceVersion
            .sourceObjectId
        );
    assert(
      sourceObject?.kind ===
        'DATASET_SOURCE' &&
        sourceObject.origin ===
          'UPLOAD',
      'Direct C5 upload must persist DATASET_SOURCE provenance.'
    );

    let foreignSourceBlocked = false;
    try {
      await datasetSourceStorageService
        .loadSourceBytes({
          accountId: accountB,
          sourceVersionId:
            first.version
              .sourceVersionId!,
        });
    } catch {
      foreignSourceBlocked = true;
    }
    assert(
      foreignSourceBlocked,
      'Foreign account must not load another account Dataset source version.'
    );

    let foreignPayloadBlocked = false;
    try {
      await durableDatasetPayloadStore
        .get({
          accountId: accountB,
          datasetId:
            first.dataset.id,
          versionId:
            first.version.id,
          locator:
            firstMeta!.payload,
        });
    } catch {
      foreignPayloadBlocked = true;
    }
    assert(
      foreignPayloadBlocked,
      'Foreign account must not use another account durable Dataset payload locator.'
    );

    assert(
      total(
        accountA,
        first.dataset.id
      ) === 12000,
      'C5 deterministic analytics must work immediately after durable import.'
    );

    const secondBytes =
      csv(4000, 2000);
    const second =
      await datasetService.importFile({
        accountId: accountA,
        buffer: secondBytes,
        filename: 'c5-orders.csv',
        mimeType: 'text/csv',
        existingDatasetId:
          first.dataset.id,
      });

    assert(
      total(
        accountA,
        first.dataset.id
      ) === 6000 &&
        total(
          accountA,
          first.dataset.id,
          first.version.id
        ) === 12000,
      'C5 must preserve deterministic current and historical Dataset analytics.'
    );

    datasetStore.replaceRuntimeState({
      datasets: [],
      versions: [],
      importRuns: [],
    });

    await datasetRuntimePersistence
      .bootstrap();

    const restored =
      datasetStore.requireDataset(
        accountA,
        first.dataset.id
      );
    assert(
      restored.currentVersionId ===
        second.version.id &&
        restored.versionIds.length ===
          2 &&
        total(
          accountA,
          first.dataset.id
        ) === 6000 &&
        total(
          accountA,
          first.dataset.id,
          first.version.id
        ) === 12000,
      'C5 bootstrap must reconstruct current and historical analytical rows entirely from PostgreSQL metadata plus durable object payloads.'
    );

    const secondMeta =
      await postgresDatasetMetadataRepository
        .getVersionMetadata(
          accountA,
          first.dataset.id,
          second.version.id
        );
    const payloadBytes =
      storage.objects.get(
        secondMeta!.payload.ref
      )!;
    storage.objects.set(
      secondMeta!.payload.ref,
      Buffer.from(
        'tampered-dataset-payload'
      )
    );

    datasetStore.replaceRuntimeState({
      datasets: [],
      versions: [],
      importRuns: [],
    });

    let payloadTamperBlocked = false;
    try {
      await datasetRuntimePersistence
        .bootstrap();
    } catch (error) {
      payloadTamperBlocked =
        error instanceof
          SourceIntegrityError;
    }
    assert(
      payloadTamperBlocked,
      'C5 bootstrap must fail closed on analytical payload integrity mismatch.'
    );
    storage.objects.set(
      secondMeta!.payload.ref,
      payloadBytes
    );

    const firstSourceVersion =
      await postgresSourceObjectRepository
        .getVersionById(
          accountA,
          first.version
            .sourceVersionId!
        );
    const sourceBytes =
      storage.objects.get(
        firstSourceVersion!.storageKey
      )!;
    storage.objects.set(
      firstSourceVersion!.storageKey,
      Buffer.from(
        'tampered-source-bytes'
      )
    );

    let sourceTamperBlocked = false;
    try {
      await datasetSourceStorageService
        .loadSourceBytes({
          accountId: accountA,
          sourceVersionId:
            first.version
              .sourceVersionId!,
        });
    } catch (error) {
      sourceTamperBlocked =
        error instanceof
          SourceIntegrityError;
    }
    assert(
      sourceTamperBlocked,
      'C5 source reload must fail closed on source-byte integrity mismatch.'
    );
    storage.objects.set(
      firstSourceVersion!.storageKey,
      sourceBytes
    );

    const objectCountBeforeFailure =
      storage.objects.size;
    let missingDatasetBlocked = false;
    try {
      await datasetService.importFile({
        accountId: accountA,
        buffer: csv(1),
        filename:
          'c5-invalid-target.csv',
        mimeType: 'text/csv',
        existingDatasetId:
          'ds_missing_c5',
      });
    } catch {
      missingDatasetBlocked = true;
    }
    assert(
      missingDatasetBlocked &&
        storage.objects.size ===
          objectCountBeforeFailure,
      'C5 failed import must compensate its newly stored source object instead of leaking bytes.'
    );

    console.log(
      'PRODUCTION_C5_DATASET_DURABILITY_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Durable Dataset source bytes, payload metadata, account isolation, restart reconstruction, historical analytics, tamper rejection, and failed-import source compensation are verified.'
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
      'PRODUCTION_C5_DATASET_DURABILITY_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
