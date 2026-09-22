import fs from 'fs';
import {
  buildSourceStorageKey,
  sha256Bytes,
  SourceIntegrityError,
  verifySourceIntegrity,
  type SourceBytePutInput,
  type SourceByteStorage,
  type StoredByteObject,
} from '../server/storage/sourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

class ContractStorage implements SourceByteStorage {
  readonly backend = 'contract-memory';
  private readonly objects = new Map<string, Buffer>();

  async put(
    input: SourceBytePutInput
  ): Promise<StoredByteObject> {
    const integrity = verifySourceIntegrity({
      bytes: input.bytes,
      expectedSizeBytes: input.expectedSizeBytes,
      expectedSha256: input.expectedSha256,
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
    const bytes = this.objects.get(key);
    if (!bytes) {
      throw new Error('Object not found');
    }
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

async function main() {
  const bytes = Buffer.from(
    'knowledge-ai-c2-source-integrity'
  );
  const sha256 = sha256Bytes(bytes);

  const key = buildSourceStorageKey({
    accountId: 'acc_c2_a',
    sourceObjectId: 'srcobj_c2_1',
    sourceVersionId: 'srcver_c2_1',
  });

  assert(
    key ===
      'accounts/acc_c2_a/sources/srcobj_c2_1/versions/srcver_c2_1',
    'Storage keys must be deterministic and tenant namespaced.'
  );
  assert(
    !key.includes('.pdf') &&
      !key.includes('filename'),
    'Storage keys must not depend on client filenames.'
  );

  const otherAccountKey = buildSourceStorageKey({
    accountId: 'acc_c2_b',
    sourceObjectId: 'srcobj_c2_1',
    sourceVersionId: 'srcver_c2_1',
  });
  assert(
    otherAccountKey !== key,
    'Different accounts must never share the same generated storage key.'
  );

  for (const unsafe of [
    '../acc',
    'acc/slash',
    'acc space',
    '',
  ]) {
    let rejected = false;
    try {
      buildSourceStorageKey({
        accountId: unsafe,
        sourceObjectId: 'srcobj',
        sourceVersionId: 'srcver',
      });
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      'Unsafe storage-key segment must be rejected: ' +
        JSON.stringify(unsafe)
    );
  }

  const integrity = verifySourceIntegrity({
    bytes,
    expectedSizeBytes: bytes.byteLength,
    expectedSha256: sha256,
  });
  assert(
    integrity.sizeBytes === bytes.byteLength &&
      integrity.sha256 === sha256,
    'Integrity verifier must return exact byte size and SHA-256.'
  );

  for (const invalid of [
    {
      expectedSizeBytes: bytes.byteLength + 1,
      expectedSha256: sha256,
    },
    {
      expectedSizeBytes: bytes.byteLength,
      expectedSha256: '0'.repeat(64),
    },
  ]) {
    let mismatch = false;
    try {
      verifySourceIntegrity({
        bytes,
        ...invalid,
      });
    } catch (error) {
      mismatch =
        error instanceof SourceIntegrityError &&
        error.code === 'SOURCE_INTEGRITY_MISMATCH';
    }
    assert(
      mismatch,
      'Integrity mismatch must fail closed.'
    );
  }

  const storage = new ContractStorage();
  const stored = await storage.put({
    key,
    bytes,
    contentType: 'application/pdf',
    expectedSizeBytes: bytes.byteLength,
    expectedSha256: sha256,
  });
  assert(
    stored.backend === 'contract-memory' &&
      stored.key === key &&
      stored.sha256 === sha256,
    'Provider-neutral storage contract must carry backend/key/integrity metadata.'
  );
  assert(
    (await storage.get(key)).equals(bytes),
    'Provider-neutral storage contract must support byte retrieval.'
  );
  await storage.delete(key);
  let deleted = false;
  try {
    await storage.get(key);
  } catch {
    deleted = true;
  }
  assert(
    deleted,
    'Provider-neutral storage contract must support deletion semantics.'
  );

  const migration = fs.readFileSync(
    'server/persistence/migrations/009_source_objects.sql',
    'utf8'
  );
  assert(
    migration.includes('CREATE TABLE source_objects') &&
      migration.includes('CREATE TABLE source_versions') &&
      migration.includes(
        'source_versions_immutable_byte_identity'
      ),
    'C2 migration must include source object/version metadata and DB immutability.'
  );

  const workspaceRouter = fs.readFileSync(
    'server/workspaceRouter.ts',
    'utf8'
  );
  const datasetService = fs.readFileSync(
    'server/datasets/datasetService.ts',
    'utf8'
  );
  const integrationSync = fs.readFileSync(
    'server/integrations/integrationSyncService.ts',
    'utf8'
  );

  for (const [name, source] of [
    ['workspaceRouter', workspaceRouter],
    ['datasetService', datasetService],
    ['integrationSyncService', integrationSync],
  ]) {
    assert(
      !source.includes('postgresSourceObjectRepository') &&
        !source.includes('SourceByteStorage') &&
        !source.includes('buildSourceStorageKey'),
      'C2 foundation must not cut runtime traffic over yet: ' +
        name
    );
  }

  const pkg = JSON.parse(
    fs.readFileSync('package.json', 'utf8')
  );
  const dependencies = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  for (const cloudPackage of [
    '@aws-sdk/client-s3',
    '@google-cloud/storage',
    '@azure/storage-blob',
  ]) {
    assert(
      !dependencies[cloudPackage],
      'C2 must remain provider-neutral and not add cloud SDK: ' +
        cloudPackage
    );
  }

  console.log(
    'PRODUCTION_C2_STORAGE_FOUNDATION_CHECK_PASSED'
  );
  console.log(
    'Provider-neutral storage contract, tenant-safe keys, integrity verification, source metadata migration, runtime non-cutover, and no-cloud-SDK scope are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C2_STORAGE_FOUNDATION_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
