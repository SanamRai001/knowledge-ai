import path from 'path';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { closePostgresPool } from '../server/persistence/postgres.js';
import { importLegacyMetadata } from '../server/persistence/legacyImporter.js';
import { importLegacyA3 } from '../server/persistence/a3LegacyImporter.js';

function argValue(name: string): string | undefined {
  const direct = process.argv.find((arg) =>
    arg.startsWith(name + '=')
  );
  if (direct) return direct.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dataDir = path.resolve(
    argValue('--data-dir') || path.join(process.cwd(), 'data')
  );

  if (!dryRun) {
    await runPostgresMigrations();
  }

  const a2 = await importLegacyMetadata({
    dataDir,
    dryRun,
  });

  console.log(
    JSON.stringify({ phase: 'A2', report: a2 }, null, 2)
  );

  if (a2.conflicts.length > 0) {
    console.error(
      'LEGACY_A2_IMPORT_CONFLICTS: A3 import was not attempted.'
    );
    process.exitCode = 2;
    return;
  }

  const a3 = await importLegacyA3({
    dataDir,
    dryRun,
  });

  console.log(
    JSON.stringify({ phase: 'A3', report: a3 }, null, 2)
  );

  if (a3.conflicts.length > 0) {
    console.error(
      'LEGACY_A3_IMPORT_CONFLICTS: no cutover should occur until conflicts are resolved.'
    );
    process.exitCode = 2;
    return;
  }

  console.log(
    dryRun
      ? 'LEGACY_METADATA_DRY_RUN_PASSED'
      : 'LEGACY_METADATA_IMPORT_PASSED'
  );
}

main()
  .catch((error) => {
    console.error('LEGACY_METADATA_IMPORT_FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
