import {
  PDFDocument,
  StandardFonts,
} from 'pdf-lib';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  DocumentSourceStorageService,
} from '../server/storage/documentSourceStorageService.js';
import {
  postgresSourceObjectRepository,
} from '../server/storage/postgresSourceObjectRepository.js';
import {
  SourceIntegrityError,
  sha256Bytes,
  verifySourceIntegrity,
  type SourceBytePutInput,
  type SourceByteStorage,
  type StoredByteObject,
} from '../server/storage/sourceByteStorage.js';
import { parsePdfBuffer } from '../server/documentService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

class DurableTestStorage
  implements SourceByteStorage
{
  readonly backend =
    'c3-test-object-store';
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
      etag:
        'test-' +
        integrity.sha256.slice(0, 12),
    };
  }

  async get(
    key: string
  ): Promise<Buffer> {
    const value =
      this.objects.get(key);
    if (!value) {
      throw new Error(
        'Object not found'
      );
    }
    return Buffer.from(value);
  }

  async delete(
    key: string
  ): Promise<void> {
    this.objects.delete(key);
  }
}

async function pdfFixture():
  Promise<Buffer> {
  const pdf =
    await PDFDocument.create();
  const page = pdf.addPage([
    500,
    300,
  ]);
  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );
  page.drawText(
    'Knowledge AI C3 durable source document.',
    {
      x: 40,
      y: 230,
      size: 16,
      font,
    }
  );
  page.drawText(
    'Retry must reconstruct these exact PDF bytes.',
    {
      x: 40,
      y: 195,
      size: 12,
      font,
    }
  );
  return Buffer.from(
    await pdf.save()
  );
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'C3 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for C3 PostgreSQL proof.'
  );

  const migration =
    await runPostgresMigrations();
  assert(
    migration.applied.includes(
      '009'
    ) ||
      migration.alreadyApplied.includes(
        '009'
      ),
    'C3 requires source metadata migration 009.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const accountA = 'acc_c3_a';
  const accountB = 'acc_c3_b';
  const workspaceA = 'kb_c3_a';
  const workspaceB = 'kb_c3_b';
  const now = Date.now();

  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  await postgresWorkspaceMetadataRepository
    .create({
      id: workspaceA,
      accountId: accountA,
      name: 'C3 A',
      processingStatus: 'empty',
      currentVersionTag: 'v1.0',
      createdAt: now,
      updatedAt: now,
    });
  await postgresWorkspaceMetadataRepository
    .create({
      id: workspaceB,
      accountId: accountB,
      name: 'C3 B',
      processingStatus: 'empty',
      currentVersionTag: 'v1.0',
      createdAt: now,
      updatedAt: now,
    });

  const bytes = await pdfFixture();
  const storage =
    new DurableTestStorage();

  const firstService =
    new DocumentSourceStorageService(
      postgresSourceObjectRepository,
      () => storage
    );

  const stored =
    await firstService.persistUploadedPdf(
      {
        accountId: accountA,
        workspaceId: workspaceA,
        filename:
          'durable-c3.pdf',
        contentType:
          'application/pdf',
        bytes,
      }
    );

  assert(
    stored.sourceObject.accountId ===
      accountA &&
      stored.sourceObject.workspaceId ===
        workspaceA &&
      stored.sourceVersion.sha256 ===
        sha256Bytes(bytes) &&
      stored.sourceVersion.sizeBytes ===
        bytes.byteLength &&
      storage.objects.has(
        stored.sourceVersion.storageKey
      ),
    'C3 persistence must commit exact source metadata only after durable object write succeeds.'
  );

  const persistedVersion =
    await postgresSourceObjectRepository
      .getVersionForWorkspace(
        accountA,
        workspaceA,
        stored.sourceVersion.id
      );
  assert(
    persistedVersion?.id ===
      stored.sourceVersion.id,
    'C3 source version must be retrievable only through account/workspace scope.'
  );

  assert(
    (
      await postgresSourceObjectRepository
        .getVersionForWorkspace(
          accountB,
          workspaceA,
          stored.sourceVersion.id
        )
    ) === null &&
      (
        await postgresSourceObjectRepository
          .getVersionForWorkspace(
            accountA,
            workspaceB,
            stored.sourceVersion.id
          )
      ) === null,
    'C3 durable source lookup must deny cross-account and cross-workspace access.'
  );

  const restartedService =
    new DocumentSourceStorageService(
      postgresSourceObjectRepository,
      () => storage
    );

  const reloaded =
    await restartedService.loadPdfBytes(
      {
        accountId: accountA,
        workspaceId: workspaceA,
        sourceVersionId:
          stored.sourceVersion.id,
      }
    );

  assert(
    reloaded.bytes.equals(bytes),
    'A recreated C3 service must reconstruct exact source bytes from object storage metadata, independent of request memory.'
  );

  const parsed =
    await parsePdfBuffer(
      'durable-c3.pdf',
      reloaded.bytes
    );
  assert(
    parsed.pageCount >= 1 &&
      parsed.pages.some((page) =>
        page.text.includes(
          'Knowledge AI C3 durable source document'
        )
      ),
    'Durable source bytes must remain parseable for real retry/reprocessing.'
  );

  storage.objects.set(
    stored.sourceVersion.storageKey,
    Buffer.from(
      'tampered-object-bytes'
    )
  );

  let tamperBlocked = false;
  try {
    await restartedService
      .loadPdfBytes({
        accountId: accountA,
        workspaceId: workspaceA,
        sourceVersionId:
          stored.sourceVersion.id,
      });
  } catch (error) {
    tamperBlocked =
      error instanceof
        SourceIntegrityError;
  }
  assert(
    tamperBlocked,
    'C3 retry retrieval must fail closed when stored bytes no longer match immutable SHA-256/size metadata.'
  );

  storage.objects.set(
    stored.sourceVersion.storageKey,
    Buffer.from(bytes)
  );

  const retired =
    await restartedService
      .retireDocumentSource({
        accountId: accountA,
        workspaceId: workspaceA,
        sourceVersionId:
          stored.sourceVersion.id,
      });
  assert(
    retired.found &&
      retired.purged &&
      !storage.objects.has(
        stored.sourceVersion.storageKey
      ),
    'C3 source retirement must tombstone metadata and remove physical bytes when deletion succeeds.'
  );

  const objectAfter =
    await postgresSourceObjectRepository
      .getObject(
        accountA,
        stored.sourceObject.id
      );
  const versionAfter =
    await postgresSourceObjectRepository
      .getVersion(
        accountA,
        stored.sourceObject.id,
        stored.sourceVersion.id
      );
  assert(
    objectAfter?.status ===
      'TOMBSTONED' &&
      versionAfter?.retentionState ===
        'TOMBSTONED',
    'C3 physical deletion must leave truthful tombstone history.'
  );

  const countBefore =
    storage.objects.size;
  let metadataFailureBlocked = false;
  try {
    await restartedService
      .persistUploadedPdf({
        accountId: accountA,
        workspaceId:
          'kb_missing_c3',
        filename:
          'invalid-owner.pdf',
        contentType:
          'application/pdf',
        bytes,
      });
  } catch {
    metadataFailureBlocked = true;
  }
  assert(
    metadataFailureBlocked &&
      storage.objects.size ===
        countBefore,
    'C3 must compensate physical object writes when tenant/workspace metadata commit fails.'
  );

  console.log(
    'PRODUCTION_C3_DOCUMENT_SOURCE_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Durable PDF source persistence, service reconstruction, account/workspace isolation, parse-from-storage retry, tamper detection, tombstone deletion, and metadata-failure compensation are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_C3_DOCUMENT_SOURCE_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
