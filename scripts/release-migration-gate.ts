import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  expectedPostgresMigrations,
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';

async function main() {
  const result =
    await runPostgresMigrations();
  const expected =
    expectedPostgresMigrations();

  const applied =
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

  if (
    applied.rows.length !==
    expected.length
  ) {
    throw new Error(
      'RELEASE_MIGRATION_INVENTORY_MISMATCH: applied migration count differs from the release artifact.'
    );
  }

  for (
    let index = 0;
    index < expected.length;
    index += 1
  ) {
    const actual =
      applied.rows[index];
    const wanted =
      expected[index];

    if (
      actual?.version !==
        wanted.version ||
      actual?.filename !==
        wanted.filename ||
      actual?.checksum !==
        wanted.checksum
    ) {
      throw new Error(
        'RELEASE_MIGRATION_INVENTORY_MISMATCH: migration/checksum differs at index ' +
          index +
          '.'
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        verified: true,
        appliedNow:
          result.applied,
        alreadyApplied:
          result.alreadyApplied,
        inventory: expected,
      },
      null,
      2
    )
  );
}

main()
  .catch((error: any) => {
    console.error(
      JSON.stringify({
        verified: false,
        errorCode:
          String(
            error?.code ||
              error?.name ||
              'RELEASE_MIGRATION_GATE_FAILED'
          ).slice(0, 120),
        message:
          String(
            error?.message ||
              'Release migration gate failed.'
          ).slice(0, 500),
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
