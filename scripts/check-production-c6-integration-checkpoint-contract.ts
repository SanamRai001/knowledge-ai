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

async function main() {
  const migration = read(
    'server/persistence/migrations/012_integration_source_checkpoint.sql'
  );
  assert(
    migration.includes(
      'ADD COLUMN source_version_id text'
    ) &&
      migration.includes(
        'integration_external_import_source_version_fk'
      ) &&
      migration.includes(
        'dataset_versions_one_source_version_idx'
      ),
    'C6 migration must link external imports to durable source versions and make DatasetVersion/source mapping recoverable.'
  );

  const runtime = read(
    'server/integrations/integrationRuntimeService.ts'
  );
  const recoveryIndex =
    runtime.indexOf(
      'findCommittedDataset'
    );
  const fetchIndex =
    runtime.indexOf(
      'connector.fetchRecord'
    );
  assert(
    recoveryIndex >= 0 &&
      fetchIndex > recoveryIndex &&
      runtime.includes(
        'sourceOriginForProvider'
      ) &&
      runtime.includes(
        'externalConnectionId:'
      ) &&
      runtime.includes(
        'externalVersion:'
      ) &&
      runtime.includes(
        'sourceVersionId:'
      ) &&
      runtime.includes(
        'commitSuccessfulCheckpoint'
      ),
    'C6 PostgreSQL runtime must recover committed source snapshots before refetching and keep the existing transactional checkpoint path.'
  );

  const recovery = read(
    'server/integrations/integrationSourceRecoveryService.ts'
  );
  assert(
    recovery.includes(
      'listExternalVersions'
    ) &&
      recovery.includes(
        'findVersionBySourceVersion'
      ) &&
      recovery.includes(
        'postgresDatasetMetadataRepository.get'
      ),
    'C6 recovery must require both an active external source snapshot and a committed owned DatasetVersion.'
  );

  const sourceRepository = read(
    'server/storage/postgresSourceObjectRepository.ts'
  );
  assert(
    sourceRepository.includes(
      'so.external_connection_id = $2'
    ) &&
      sourceRepository.includes(
        'so.external_id = $3'
      ) &&
      sourceRepository.includes(
        'sv.external_version = $4'
      ) &&
      sourceRepository.includes(
        "so.kind = 'DATASET_SOURCE'"
      ) &&
      sourceRepository.includes(
        "sv.retention_state = 'ACTIVE'"
      ),
    'C6 external source recovery lookup must be account/connection/resource/version scoped and active-only.'
  );

  const datasetRepository = read(
    'server/persistence/postgresRepositories.ts'
  );
  assert(
    datasetRepository.includes(
      'findVersionBySourceVersion'
    ) &&
      datasetRepository.includes(
        'version.source_version_id = $2'
      ),
    'C6 must recover DatasetVersion metadata from an opaque sourceVersionId.'
  );

  const integrationRepository = read(
    'server/persistence/a4PostgresRepositories.ts'
  );
  assert(
    integrationRepository.includes(
      'source_version_id'
    ) &&
      integrationRepository.includes(
        'INTEGRATION_CHECKPOINT_INCOMPLETE'
      ) &&
      integrationRepository.includes(
        'INTEGRATION_CHECKPOINT_SOURCE_MISMATCH'
      ) &&
      integrationRepository.includes(
        'return withTransaction(async (client) =>'
      ),
    'C6 must persist source linkage and refuse incomplete/mismatched imports inside the existing transactional checkpoint commit.'
  );

  const syncService = read(
    'server/integrations/integrationSyncService.ts'
  );
  assert(
    !syncService.includes(
      'integrationSourceRecoveryService'
    ),
    'C6 must not widen the production PostgreSQL recovery change into the legacy/file-mode integration runtime.'
  );

  console.log(
    'PRODUCTION_C6_INTEGRATION_CHECKPOINT_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'External source linkage, recovery-before-fetch, DatasetVersion provenance, and transactional checkpoint guards are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C6_INTEGRATION_CHECKPOINT_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
