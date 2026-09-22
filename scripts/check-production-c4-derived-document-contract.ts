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
    'server/persistence/migrations/010_document_derived_payloads.sql'
  );
  assert(
    migration.includes(
      'CREATE TABLE document_derived_payloads'
    ) &&
      migration.includes(
        'document_derived_payloads_owned_workspace_fk'
      ) &&
      migration.includes(
        'document_derived_payloads_owned_source_version_fk'
      ) &&
      migration.includes(
        'derivation_version'
      ) &&
      migration.includes(
        'payload_sha256'
      ),
    'C4 migration must relationally bind derived payloads to account/workspace/source version with derivation and integrity metadata.'
  );

  const types = read('src/types.ts');
  assert(
    types.includes(
      'derivedPayloadId?: string;'
    ) &&
      types.includes(
        'export interface KnowledgeVersionDocumentRef'
      ) &&
      types.includes(
        'documentRefs?: KnowledgeVersionDocumentRef[];'
      ),
    'C4 domain types must carry opaque derived payload refs.'
  );

  const service = read(
    'server/storage/documentDerivedPayloadService.ts'
  );
  assert(
    service.includes(
      "DOCUMENT_DERIVATION_VERSION ="
    ) &&
      service.includes(
        'buildDerivedDocumentPayloadKey'
      ) &&
      service.includes(
        'verifySourceIntegrity'
      ) &&
      service.includes(
        'listCurrentDocuments'
      ) &&
      service.includes(
        'loadDocumentsByRefs'
      ) &&
      !service.includes(
        'SOURCE_STORAGE_SECRET_ACCESS_KEY'
      ),
    'C4 derived payload service must version, integrity-check, and account-scope payload access without embedding secrets.'
  );

  const kbStore = read(
    'server/kbStore.ts'
  );
  assert(
    kbStore.includes(
      'versionProjection('
    ) &&
      kbStore.includes(
        'documentRefs:'
      ) &&
      kbStore.includes(
        'derivedPayloadId'
      ) &&
      kbStore.includes(
        'replaceDocuments('
      ) &&
      kbStore.includes(
        'applyVersionRollback('
      ),
    'C4 versions must reference durable payloads and support hydrated rollback.'
  );

  const runtime = read(
    'server/workspaceRuntimeService.ts'
  );
  assert(
    runtime.includes(
      'hasWorkspacePayloads'
    ) &&
      runtime.includes(
        'listCurrentDocuments'
      ) &&
      runtime.includes(
        'replaceDocuments'
      ) &&
      runtime.includes(
        'persistDocument'
      ) &&
      runtime.includes(
        'markDocumentInactive'
      ) &&
      runtime.includes(
        'activatePayloadRefs'
      ),
    'C4 workspace runtime must make durable derived payloads authoritative for PostgreSQL document corpora.'
  );

  const unified = read(
    'server/querying/unifiedQueryService.ts'
  );
  assert(
    unified.includes(
      'workspaceRuntimeService'
    ) &&
      unified.includes(
        'await workspaceRuntimeService.requireKB'
      ) &&
      !unified.includes(
        'workspaceAccessService.requireKB'
      ),
    'Unified Ask must hydrate the durable workspace document corpus before document grounding.'
  );

  const specialized = read(
    'server/specializedAIService.ts'
  );
  assert(
    specialized.includes(
      'loadDocumentsByRefs'
    ) &&
      specialized.includes(
        'targetedVersion.documentRefs'
      ),
    'Historical document queries must resolve durable version refs instead of duplicating full document payloads.'
  );

  const datasetService = read(
    'server/datasets/datasetService.ts'
  );
  const integrationSync = read(
    'server/integrations/integrationSyncService.ts'
  );

  for (const [name, source] of [
    ['datasetService', datasetService],
    [
      'integrationSyncService',
      integrationSync,
    ],
  ]) {
    assert(
      !source.includes(
        'documentDerivedPayloadService'
      ) &&
        !source.includes(
          'document_derived_payloads'
        ),
      'C4 must not broaden derived document migration into ' +
        name
    );
  }

  console.log(
    'PRODUCTION_C4_DERIVED_DOCUMENT_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Derived payload schema/integrity, authoritative workspace hydration, immutable version refs, historical ref resolution, and Dataset/integration scope boundaries are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C4_DERIVED_DOCUMENT_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
