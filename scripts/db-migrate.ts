import {
  closePostgresPool,
  postgresRuntimeConfig,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';

async function main() {
  const config = postgresRuntimeConfig();
  console.log(
    'Running Knowledge AI PostgreSQL migrations with pool max ' +
      config.maxConnections +
      '.'
  );

  const result = await runPostgresMigrations();
  console.log(
    JSON.stringify(
      {
        applied: result.applied,
        alreadyApplied: result.alreadyApplied,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('POSTGRES_MIGRATION_FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
