import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  expectedPostgresMigrations,
  MIGRATION_ADVISORY_LOCK_KEY,
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'H4 PostgreSQL proof must run in postgres mode.'
  );

  await runPostgresMigrations();

  const lockClient =
    await postgresPool().connect();

  try {
    await lockClient.query(
      'SELECT pg_advisory_lock($1)',
      [
        MIGRATION_ADVISORY_LOCK_KEY,
      ]
    );

    let blocked = false;
    try {
      await runPostgresMigrations();
    } catch (error: any) {
      blocked =
        error?.code ===
          'MIGRATION_LOCK_HELD';
    }

    assert(
      blocked,
      'H4 migration runner must fail closed when another deployment writer holds the migration lock.'
    );
  } finally {
    await lockClient
      .query(
        'SELECT pg_advisory_unlock($1)',
        [
          MIGRATION_ADVISORY_LOCK_KEY,
        ]
      )
      .catch(() => undefined);
    lockClient.release();
  }

  const rerun =
    await runPostgresMigrations();
  const expected =
    expectedPostgresMigrations();

  assert(
    rerun.applied.length ===
      0 &&
      rerun.alreadyApplied
        .length ===
        expected.length,
    'H4 migration gate must remain idempotent after the deployment lock is released.'
  );

  const actual =
    await postgresPool().query<{
      version: string;
      filename: string;
      checksum: string;
    }>(
      `SELECT
         version,
         filename,
         checksum
       FROM schema_migrations
       ORDER BY version`
    );

  assert(
    actual.rows.length ===
      expected.length,
    'H4 applied migration inventory must match the release artifact.'
  );

  for (
    let i = 0;
    i < expected.length;
    i += 1
  ) {
    assert(
      actual.rows[i]?.version ===
        expected[i]?.version &&
        actual.rows[i]?.filename ===
          expected[i]?.filename &&
        actual.rows[i]?.checksum ===
          expected[i]?.checksum,
      'H4 applied migration checksum drift at index ' +
        i
    );
  }

  console.log(
    'PRODUCTION_H4_MIGRATION_GATE_POSTGRES_CHECK_PASSED'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_H4_MIGRATION_GATE_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
