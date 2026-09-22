import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import { postgresSourceObjectRepository } from '../server/storage/postgresSourceObjectRepository.js';
import {
  buildSourceStorageKey,
  sha256Bytes,
} from '../server/storage/sourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'C2 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for C2 PostgreSQL proof.'
  );

  const first = await runPostgresMigrations();
  assert(
    first.applied.includes('009') ||
      first.alreadyApplied.includes('009'),
    'Migration 009 must be in migration history.'
  );

  const second = await runPostgresMigrations();
  assert(
    second.applied.length === 0 &&
      second.alreadyApplied.includes('009'),
    'Migration 009 must be repeatable without reapplication.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const accountA = 'acc_c2_pg_a';
  const accountB = 'acc_c2_pg_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const now = Date.now();
  await postgresWorkspaceMetadataRepository.create({
    id: 'kb_c2_a',
    accountId: accountA,
    name: 'C2 A',
    processingStatus: 'empty',
    currentVersionTag: 'v1.0',
    createdAt: now,
    updatedAt: now,
  });
  await postgresWorkspaceMetadataRepository.create({
    id: 'kb_c2_b',
    accountId: accountB,
    name: 'C2 B',
    processingStatus: 'empty',
    currentVersionTag: 'v1.0',
    createdAt: now,
    updatedAt: now,
  });

  const sourceObject =
    await postgresSourceObjectRepository.createObject({
      id: 'srcobj_c2_a',
      accountId: accountA,
      workspaceId: 'kb_c2_a',
      kind: 'DOCUMENT',
      origin: 'UPLOAD',
      createdAt: now,
      updatedAt: now,
    });

  assert(
    sourceObject.accountId === accountA &&
      sourceObject.workspaceId === 'kb_c2_a' &&
      sourceObject.status === 'ACTIVE',
    'Source object must preserve explicit tenant/workspace ownership.'
  );

  assert(
    (await postgresSourceObjectRepository.getObject(
      accountB,
      sourceObject.id
    )) === null,
    'Account B must not read account A source object.'
  );

  let crossWorkspaceBlocked = false;
  try {
    await postgresSourceObjectRepository.createObject({
      id: 'srcobj_c2_illegal_workspace',
      accountId: accountA,
      workspaceId: 'kb_c2_b',
      kind: 'DOCUMENT',
      origin: 'UPLOAD',
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    crossWorkspaceBlocked = true;
  }
  assert(
    crossWorkspaceBlocked,
    'Database ownership constraint must reject a workspace from another account.'
  );

  const bytes = Buffer.from('c2-postgres-source-version');
  const sha256 = sha256Bytes(bytes);
  const storageKey = buildSourceStorageKey({
    accountId: accountA,
    sourceObjectId: sourceObject.id,
    sourceVersionId: 'srcver_c2_a1',
  });

  const version =
    await postgresSourceObjectRepository.createVersion({
      id: 'srcver_c2_a1',
      accountId: accountA,
      sourceObjectId: sourceObject.id,
      originalFilename: 'manual.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256,
      storageBackend: 'foundation-placeholder',
      storageKey,
      createdAt: now,
    });

  assert(
    version.accountId === accountA &&
      version.sourceObjectId === sourceObject.id &&
      version.sha256 === sha256 &&
      version.retentionState === 'ACTIVE',
    'Source version must persist immutable byte identity metadata.'
  );

  assert(
    (await postgresSourceObjectRepository.getVersion(
      accountB,
      sourceObject.id,
      version.id
    )) === null,
    'Account B must not read account A source version.'
  );

  let crossAccountVersionBlocked = false;
  try {
    await postgresSourceObjectRepository.createVersion({
      id: 'srcver_c2_illegal',
      accountId: accountB,
      sourceObjectId: sourceObject.id,
      originalFilename: 'stolen.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256,
      storageBackend: 'foundation-placeholder',
      storageKey: buildSourceStorageKey({
        accountId: accountB,
        sourceObjectId: sourceObject.id,
        sourceVersionId: 'srcver_c2_illegal',
      }),
      createdAt: now,
    });
  } catch {
    crossAccountVersionBlocked = true;
  }
  assert(
    crossAccountVersionBlocked,
    'Database ownership constraint must reject cross-account source version creation.'
  );

  let foreignRetentionBlocked = false;
  try {
    await postgresSourceObjectRepository.setVersionRetentionState(
      accountB,
      sourceObject.id,
      version.id,
      'TOMBSTONED'
    );
  } catch {
    foreignRetentionBlocked = true;
  }
  assert(
    foreignRetentionBlocked,
    'Account B must not mutate account A source-version retention state.'
  );

  const tombstoned =
    await postgresSourceObjectRepository.setVersionRetentionState(
      accountA,
      sourceObject.id,
      version.id,
      'TOMBSTONED',
      now + 1000
    );
  assert(
    tombstoned.retentionState === 'TOMBSTONED' &&
      tombstoned.sha256 === sha256 &&
      tombstoned.storageKey === storageKey,
    'Retention lifecycle may change without rewriting immutable byte identity.'
  );

  let immutableHashBlocked = false;
  try {
    await postgresPool().query(
      `UPDATE source_versions
       SET sha256 = $2
       WHERE id = $1`,
      [version.id, 'f'.repeat(64)]
    );
  } catch {
    immutableHashBlocked = true;
  }
  assert(
    immutableHashBlocked,
    'Database trigger must reject source-version SHA-256 rewrites.'
  );

  let immutableObjectBlocked = false;
  try {
    await postgresPool().query(
      `UPDATE source_versions
       SET source_object_id = $2
       WHERE id = $1`,
      [version.id, 'srcobj_rewritten']
    );
  } catch {
    immutableObjectBlocked = true;
  }
  assert(
    immutableObjectBlocked,
    'Database trigger must reject source-version ownership identity rewrites.'
  );

  const afterImmutableAttempts =
    await postgresSourceObjectRepository.getVersion(
      accountA,
      sourceObject.id,
      version.id
    );
  assert(
    afterImmutableAttempts?.sha256 === sha256 &&
      afterImmutableAttempts.sourceObjectId ===
        sourceObject.id,
    'Rejected immutable updates must leave source-version identity intact.'
  );

  let duplicateStorageKeyBlocked = false;
  try {
    await postgresSourceObjectRepository.createVersion({
      id: 'srcver_c2_a2',
      accountId: accountA,
      sourceObjectId: sourceObject.id,
      originalFilename: 'manual-copy.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256,
      storageBackend: 'foundation-placeholder',
      storageKey,
      createdAt: now + 1,
    });
  } catch {
    duplicateStorageKeyBlocked = true;
  }
  assert(
    duplicateStorageKeyBlocked,
    'Physical backend/key locator must not be reused by two source versions.'
  );

  const objectTombstone =
    await postgresSourceObjectRepository.tombstoneObject(
      accountA,
      sourceObject.id,
      now + 2000
    );
  assert(
    objectTombstone.status === 'TOMBSTONED',
    'Source object lifecycle must support tombstoning without deleting immutable versions.'
  );

  const versions =
    await postgresSourceObjectRepository.listVersions(
      accountA,
      sourceObject.id
    );
  assert(
    versions.length === 1 &&
      versions[0].id === version.id,
    'Tombstoning a source object must preserve its source-version history.'
  );

  const columns = await postgresPool().query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('source_objects','source_versions')
     ORDER BY table_name, ordinal_position`
  );
  assert(
    columns.rows.filter(
      (row) => row.column_name === 'account_id'
    ).length === 2,
    'Every tenant-owned source metadata table must carry explicit account_id.'
  );

  console.log(
    'PRODUCTION_C2_SOURCE_METADATA_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Migration 009 repeatability, account/workspace isolation, source-version immutability, retention lifecycle, unique physical locator, and tombstone history preservation are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_C2_SOURCE_METADATA_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
