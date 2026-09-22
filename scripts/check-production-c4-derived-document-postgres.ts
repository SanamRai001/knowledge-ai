import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import { kbStore } from '../server/kbStore.js';
import {
  workspaceRuntimeService,
} from '../server/workspaceRuntimeService.js';
import {
  postgresSourceObjectRepository,
} from '../server/storage/postgresSourceObjectRepository.js';
import {
  postgresDocumentDerivedPayloadRepository,
} from '../server/storage/postgresDocumentDerivedPayloadRepository.js';
import {
  setSourceByteStorageForTesting,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  SourceIntegrityError,
  verifySourceIntegrity,
  type SourceBytePutInput,
  type SourceByteStorage,
  type StoredByteObject,
} from '../server/storage/sourceByteStorage.js';
import type {
  KnowledgeDocument,
} from '../src/types.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

class DurableMemoryStorage
  implements SourceByteStorage
{
  readonly backend =
    'c4-memory-object-store';
  readonly objects =
    new Map<string, Buffer>();

  async put(
    input: SourceBytePutInput
  ): Promise<StoredByteObject> {
    const integrity =
      verifySourceIntegrity({
        bytes: input.bytes,
        expectedSizeBytes:
          input.expectedSizeBytes,
        expectedSha256:
          input.expectedSha256,
      });
    this.objects.set(
      input.key,
      Buffer.from(input.bytes)
    );
    return {
      backend: this.backend,
      key: input.key,
      ...integrity,
    };
  }

  async get(key: string): Promise<Buffer> {
    const bytes =
      this.objects.get(key);
    if (!bytes) {
      throw new Error(
        'Object not found'
      );
    }
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

async function createSourceVersion(input: {
  accountId: string;
  workspaceId: string;
  suffix: string;
}): Promise<string> {
  const now = Date.now();
  const objectId =
    'srcobj_c4_' + input.suffix;
  const versionId =
    'srcver_c4_' + input.suffix;

  await postgresSourceObjectRepository
    .createObject({
      id: objectId,
      accountId: input.accountId,
      workspaceId:
        input.workspaceId,
      kind: 'DOCUMENT',
      origin: 'UPLOAD',
      createdAt: now,
      updatedAt: now,
    });

  await postgresSourceObjectRepository
    .createVersion({
      id: versionId,
      accountId: input.accountId,
      sourceObjectId: objectId,
      originalFilename:
        'manual.pdf',
      contentType:
        'application/pdf',
      sizeBytes: 100,
      sha256: (
        input.suffix === 'one'
          ? '1'
          : '2'
      ).repeat(64),
      storageBackend:
        'c3-source-test',
      storageKey:
        'source/' + versionId,
      createdAt: now,
    });

  return versionId;
}

function document(input: {
  id: string;
  sourceVersionId: string;
  text: string;
}): KnowledgeDocument {
  return {
    id: input.id,
    filename: 'manual.pdf',
    fileType:
      'application/pdf',
    fileSize: 100,
    uploadTimestamp: Date.now(),
    processingStatus:
      'processed',
    sourceVersionId:
      input.sourceVersionId,
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text: input.text,
      },
    ],
    summary: input.text,
  };
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'C4 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for C4 PostgreSQL proof.'
  );

  const migration =
    await runPostgresMigrations();
  assert(
    migration.applied.includes('010') ||
      migration.alreadyApplied.includes(
        '010'
      ),
    'C4 requires migration 010.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const accountA = 'acc_c4_a';
  const accountB = 'acc_c4_b';
  const workspaceA = 'kb_c4_a';
  const now = Date.now();

  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  await postgresWorkspaceMetadataRepository
    .create({
      id: workspaceA,
      accountId: accountA,
      name: 'C4 Workspace',
      processingStatus: 'empty',
      currentVersionTag: 'v1.0',
      createdAt: now,
      updatedAt: now,
    });

  if (
    !kbStore.getKB(
      workspaceA,
      accountA
    )
  ) {
    kbStore.createKBWithId(
      workspaceA,
      'C4 Workspace',
      undefined,
      accountA
    );
  }

  const storage =
    new DurableMemoryStorage();
  setSourceByteStorageForTesting(
    storage
  );

  try {
    const sourceOne =
      await createSourceVersion({
        accountId: accountA,
        workspaceId: workspaceA,
        suffix: 'one',
      });

    const persistedOne =
      await workspaceRuntimeService
        .addDocument(
          accountA,
          workspaceA,
          document({
            id: 'doc_c4_one',
            sourceVersionId:
              sourceOne,
            text:
              'C4 durable parsed page one.',
          })
        );

    assert(
      Boolean(
        persistedOne.derivedPayloadId
      ),
      'C4 addDocument must attach an opaque derived payload id.'
    );

    const snapshotOne =
      await workspaceRuntimeService
        .createVersionSnapshot(
          accountA,
          workspaceA,
          'Durable version one'
        );

    assert(
      snapshotOne.documentRefs
        ?.length === 1 &&
        snapshotOne.documentRefs[0]
          .derivedPayloadId ===
          persistedOne.derivedPayloadId &&
        (
          snapshotOne.documents ||
          []
        ).length === 0,
      'C4 durable snapshots must reference payload ids instead of duplicating full parsed documents.'
    );

    kbStore.replaceDocuments(
      workspaceA,
      [],
      accountA
    );

    const reconstructed =
      await workspaceRuntimeService
        .requireKB(
          accountA,
          workspaceA
        );

    assert(
      reconstructed.documents
        .length === 1 &&
        reconstructed.documents[0]
          .pages?.[0]?.text ===
          'C4 durable parsed page one.' &&
        reconstructed.documents[0]
          .derivedPayloadId ===
          persistedOne.derivedPayloadId,
      'C4 workspace runtime must reconstruct parsed pages from durable derived payloads after local document loss.'
    );

    const crossAccount =
      await postgresDocumentDerivedPayloadRepository
        .listCurrentForWorkspace(
          accountB,
          workspaceA
        );
    assert(
      crossAccount.length === 0,
      'C4 derived payload metadata must deny cross-account workspace lookup.'
    );

    const firstRecord =
      await postgresDocumentDerivedPayloadRepository
        .getById(
          accountA,
          workspaceA,
          persistedOne
            .derivedPayloadId!
        );
    assert(
      Boolean(firstRecord),
      'C4 persisted derived metadata must be retrievable in owner scope.'
    );

    const originalBytes =
      storage.objects.get(
        firstRecord!.payloadKey
      )!;
    storage.objects.set(
      firstRecord!.payloadKey,
      Buffer.from(
        'tampered-derived-payload'
      )
    );

    let tamperBlocked = false;
    try {
      await workspaceRuntimeService
        .requireKB(
          accountA,
          workspaceA
        );
    } catch (error) {
      tamperBlocked =
        error instanceof
          SourceIntegrityError;
    }
    assert(
      tamperBlocked,
      'C4 workspace reconstruction must fail closed on derived payload integrity mismatch.'
    );

    storage.objects.set(
      firstRecord!.payloadKey,
      originalBytes
    );

    const sourceTwo =
      await createSourceVersion({
        accountId: accountA,
        workspaceId: workspaceA,
        suffix: 'two',
      });

    const persistedTwo =
      await workspaceRuntimeService
        .addDocument(
          accountA,
          workspaceA,
          document({
            id: 'doc_c4_two',
            sourceVersionId:
              sourceTwo,
            text:
              'C4 durable parsed page two.',
          })
        );

    const currentAfterReplace =
      await workspaceRuntimeService
        .requireKB(
          accountA,
          workspaceA
        );
    assert(
      currentAfterReplace.documents
        .length === 1 &&
        currentAfterReplace.documents[0]
          .id ===
          persistedTwo.id,
      'Same-name document replacement must make only the new durable payload current.'
    );

    const snapshotTwo =
      await workspaceRuntimeService
        .createVersionSnapshot(
          accountA,
          workspaceA,
          'Durable version two'
        );
    assert(
      snapshotTwo.documentRefs
        ?.length === 1 &&
        snapshotTwo.documentRefs[0]
          .derivedPayloadId ===
          persistedTwo.derivedPayloadId,
      'Second C4 snapshot must reference the replacement durable payload.'
    );

    const rolledBack =
      await workspaceRuntimeService
        .rollbackToVersion(
          accountA,
          workspaceA,
          snapshotOne.id
        );

    assert(
      rolledBack.documents.length ===
        1 &&
        rolledBack.documents[0].id ===
          persistedOne.id &&
        rolledBack.documents[0]
          .pages?.[0]?.text ===
          'C4 durable parsed page one.',
      'C4 rollback must reactivate and hydrate the exact durable document payload referenced by the target version.'
    );

    const currentRows =
      await postgresDocumentDerivedPayloadRepository
        .listCurrentForWorkspace(
          accountA,
          workspaceA
        );
    assert(
      currentRows.length === 1 &&
        currentRows[0].id ===
          persistedOne.derivedPayloadId,
      'C4 rollback must make the target version derived payload set authoritative.'
    );

    console.log(
      'PRODUCTION_C4_DERIVED_DOCUMENT_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Derived payload persistence, local-document-loss reconstruction, tenant isolation, tamper rejection, non-duplicating version refs, replacement authority, and durable rollback are verified.'
    );
  } finally {
    setSourceByteStorageForTesting(
      null
    );
  }
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_C4_DERIVED_DOCUMENT_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
