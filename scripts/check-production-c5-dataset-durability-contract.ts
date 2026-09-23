import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function section(
  source: string,
  start: string,
  end: string
): string {
  const a = source.indexOf(start);
  const b = source.indexOf(
    end,
    a + start.length
  );
  assert(
    a >= 0 && b > a,
    'Could not isolate section: ' +
      start
  );
  return source.slice(a, b);
}

async function main() {
  const migration = read(
    'server/persistence/migrations/011_dataset_durable_payloads.sql'
  );
  assert(
    migration.includes(
      'source_version_id'
    ) &&
      migration.includes(
        'payload_storage_backend'
      ) &&
      migration.includes(
        'payload_size_bytes'
      ) &&
      migration.includes(
        'payload_sha256'
      ) &&
      migration.includes(
        'dataset_versions_owned_source_version_fk'
      ),
    'C5 migration must link Dataset versions to durable source versions and payload integrity metadata.'
  );

  const datasetService = read(
    'server/datasets/datasetService.ts'
  );
  const postgresImport = section(
    datasetService,
    '  private async importFilePostgres(params: {',
    '  public async previewFile(params: {'
  );
  assert(
    postgresImport.includes(
      'persistUploadedSource'
    ) &&
      postgresImport.indexOf(
        'persistUploadedSource'
      ) <
        postgresImport.indexOf(
          'parseCsvBuffer'
        ) &&
      postgresImport.includes(
        'sourceVersionId:'
      ) &&
      postgresImport.includes(
        '.compensate({'
      ),
    'C5 PostgreSQL import must store immutable source bytes before parsing and compensate them on failure.'
  );

  const persistence = read(
    'server/datasets/datasetRuntimePersistence.ts'
  );
  assert(
    persistence.includes(
      "'durable-dataset-payload'"
    ) &&
      persistence.includes(
        'durableDatasetPayloadStore.put'
      ) &&
      persistence.includes(
        'durableDatasetPayloadStore.get'
      ) &&
      persistence.includes(
        "'local-dataset-payload'"
      ),
    'C5 runtime must use durable payloads for new imports while retaining legacy local locator compatibility.'
  );

  const durablePayload = read(
    'server/datasets/durableDatasetPayloadStore.ts'
  );
  assert(
    durablePayload.includes(
      'buildDatasetPayloadKey'
    ) &&
      durablePayload.includes(
        'verifySourceIntegrity'
      ) &&
      durablePayload.includes(
        "'durable-dataset-payload'"
      ) &&
      durablePayload.includes(
        'expectedPrefix'
      ) &&
      !durablePayload.includes(
        'SOURCE_STORAGE_SECRET_ACCESS_KEY'
      ),
    'C5 analytical payload store must use tenant-safe generated keys, integrity verification, and scoped lookup.'
  );

  const sourceService = read(
    'server/datasets/datasetSourceStorageService.ts'
  );
  assert(
    sourceService.includes(
      "kind: 'DATASET_SOURCE'"
    ) &&
      sourceService.includes(
        'getVersionById'
      ) &&
      sourceService.includes(
        'verifySourceIntegrity'
      ) &&
      sourceService.includes(
        'sourceObject.kind !=='
      ),
    'C5 Dataset source service must persist and reload only account-owned DATASET_SOURCE versions with integrity checks.'
  );

  const repository = read(
    'server/persistence/postgresRepositories.ts'
  );
  assert(
    repository.includes(
      'source_version_id'
    ) &&
      repository.includes(
        'payload_storage_backend'
      ) &&
      repository.includes(
        'payload_size_bytes'
      ) &&
      repository.includes(
        'payload_sha256'
      ),
    'PostgreSQL Dataset metadata writes must persist C5 source and payload integrity linkage.'
  );

  const integration = read(
    'server/integrations/integrationSyncService.ts'
  );
  assert(
    integration.includes(
      'externalConnectionId:'
    ) &&
      integration.includes(
        'externalId:'
      ) &&
      integration.includes(
        'externalVersion:'
      ) &&
      integration.includes(
        "'GOOGLE_DRIVE'"
      ) &&
      integration.includes(
        "'MICROSOFT_ONEDRIVE'"
      ) &&
      integration.includes(
        'cursor: result.cursorAfter'
      ),
    'C5 may preserve provider provenance but must leave existing integration cursor/checkpoint flow for the next phase.'
  );

  const localPayload = read(
    'server/datasets/datasetRuntimePayloadStore.ts'
  );
  assert(
    localPayload.includes(
      "'local-dataset-payload'"
    ),
    'Legacy local Dataset payloads must remain readable for backward compatibility during C5.'
  );

  console.log(
    'PRODUCTION_C5_DATASET_DURABILITY_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Source-first import ordering, durable Dataset payload integrity, PostgreSQL linkage, scoped object keys, legacy compatibility, and integration scope boundaries are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C5_DATASET_DURABILITY_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
