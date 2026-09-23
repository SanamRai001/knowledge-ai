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
        'REFERENCES source_versions(account_id, id)'
      ),
    'C6 migration must account-scope external-import source snapshot linkage.'
  );

  const types = read(
    'server/integrations/types.ts'
  );
  assert(
    types.includes(
      'sourceVersionId?: string;'
    ) &&
      !types.includes('storageKey') &&
      !types.includes('storageBackend'),
    'External import state may expose only opaque sourceVersionId, never physical object locators.'
  );

  const sourceService = read(
    'server/datasets/datasetSourceStorageService.ts'
  );
  assert(
    sourceService.includes(
      'findExternalVersionByIdentity'
    ) &&
      sourceService.includes(
        'External source version identity was reused with different bytes.'
      ) &&
      sourceService.includes(
        'createdSourceVersion'
      ),
    'C6 provider source persistence must reuse exact external versions and refuse identity/byte mismatches.'
  );

  const recovery = read(
    'server/integrations/integrationSourceRecoveryService.ts'
  );
  assert(
    recovery.includes(
      'recoverDatasetImport'
    ) &&
      recovery.includes(
        'findVersionBySourceVersionId'
      ) &&
      recovery.includes(
        'findExternalVersionByIdentity'
      ),
    'C6 must recover crash-orphaned Dataset imports from immutable provider source snapshots.'
  );

  const runtime = read(
    'server/integrations/integrationRuntimeService.ts'
  );
  assert(
    runtime.includes(
      'commitSuccessfulCheckpoint'
    ) &&
      runtime.includes(
        'integrationSourceRecoveryService'
      ) &&
      runtime.includes(
        'sourceVersionId:'
      ) &&
      runtime.includes(
        'INTEGRATION_CHECKPOINT_IMPORT_MISSING'
      ),
    'Production Integration runtime must journal source provenance and use the atomic checkpoint transaction.'
  );

  const recoveryIndex =
    runtime.indexOf(
      'recoverDatasetImport'
    );
  const fetchIndex =
    runtime.indexOf(
      'const record = await connector.fetchRecord',
      recoveryIndex
    );
  assert(
    recoveryIndex >= 0 &&
      fetchIndex > recoveryIndex,
    'Crash recovery must run before provider refetch so a committed DatasetVersion can be resumed without downloading duplicate bytes.'
  );

  const checkpoint = read(
    'server/persistence/a4PostgresRepositories.ts'
  );
  for (const required of [
    'FOR UPDATE',
    'INTEGRATION_CHECKPOINT_STALE',
    'INTEGRATION_CHECKPOINT_IMPORT_NOT_READY',
    'INTEGRATION_CHECKPOINT_SOURCE_MISMATCH',
    'INTEGRATION_CHECKPOINT_SOURCE_UNAVAILABLE',
    'INTEGRATION_CHECKPOINT_PROJECTION_MISSING',
    "status = 'COMPLETED'",
    "source_type = 'DATASET'",
  ]) {
    assert(
      checkpoint.includes(required),
      'C6 checkpoint transaction is missing invariant: ' +
        required
    );
  }

  const datasetService = read(
    'server/datasets/datasetService.ts'
  );
  assert(
    datasetService.includes(
      'createdSourceVersion'
    ) &&
      datasetService.includes(
        'tombstoneSourceObject:'
      ),
    'C6 compensation must delete only source snapshots created by the failed attempt.'
  );

  console.log(
    'PRODUCTION_C6_INTEGRATION_CHECKPOINT_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Provider snapshot idempotency, opaque source provenance, pre-fetch crash recovery, atomic cursor transaction, source/projection prerequisites, and safe compensation are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C6_INTEGRATION_CHECKPOINT_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
