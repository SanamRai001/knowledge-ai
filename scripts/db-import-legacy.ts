import path from 'path';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { closePostgresPool } from '../server/persistence/postgres.js';
import { importLegacyMetadata } from '../server/persistence/legacyImporter.js';

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

  const report = await importLegacyMetadata({
    dataDir,
    dryRun,
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.conflicts.length > 0) {
    console.error(
      'LEGACY_METADATA_IMPORT_CONFLICTS: no cutover should occur until conflicts are resolved.'
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
