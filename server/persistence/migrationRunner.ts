import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import {
  postgresPool,
  withTransaction,
} from './postgres.js';

const MIGRATION_DIR = path.join(
  process.cwd(),
  'server',
  'persistence',
  'migrations'
);

type MigrationFile = {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
};

function migrationFiles(): MigrationFile[] {
  if (!fs.existsSync(MIGRATION_DIR)) return [];

  return fs
    .readdirSync(MIGRATION_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((filename) => {
      const sql = fs.readFileSync(
        path.join(MIGRATION_DIR, filename),
        'utf8'
      );
      return {
        version: filename.split('_')[0],
        filename,
        sql,
        checksum: crypto
          .createHash('sha256')
          .update(sql, 'utf8')
          .digest('hex'),
      };
    });
}

async function ensureMigrationTable(
  client: PoolClient
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      filename text NOT NULL,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function runPostgresMigrations(): Promise<MigrationResult> {
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  await withTransaction(async (client) => {
    await ensureMigrationTable(client);
  });

  for (const migration of migrationFiles()) {
    const existing = await postgresPool().query<{
      checksum: string;
      filename: string;
    }>(
      'SELECT checksum, filename FROM schema_migrations WHERE version = $1',
      [migration.version]
    );

    if (existing.rowCount) {
      const row = existing.rows[0];
      if (
        row.checksum !== migration.checksum ||
        row.filename !== migration.filename
      ) {
        throw new Error(
          'Migration ' +
            migration.version +
            ' was already applied with different content.'
        );
      }
      alreadyApplied.push(migration.version);
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations
          (version, filename, checksum)
         VALUES ($1, $2, $3)`,
        [
          migration.version,
          migration.filename,
          migration.checksum,
        ]
      );
    });

    applied.push(migration.version);
  }

  return { applied, alreadyApplied };
}
