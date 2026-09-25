import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import {
  postgresPool,
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

export interface ExpectedPostgresMigration {
  version: string;
  filename: string;
  checksum: string;
}

export function expectedPostgresMigrations():
  ExpectedPostgresMigration[] {
  return migrationFiles().map(
    (migration) => ({
      version: migration.version,
      filename: migration.filename,
      checksum: migration.checksum,
    })
  );
}

export const MIGRATION_ADVISORY_LOCK_KEY =
  1_264_257_041;

export async function runPostgresMigrations(): Promise<MigrationResult> {
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  const client =
    await postgresPool().connect();

  let lockHeld = false;

  try {
    const lock =
      await client.query<{
        locked: boolean;
      }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [MIGRATION_ADVISORY_LOCK_KEY]
      );

    lockHeld =
      Boolean(
        lock.rows[0]?.locked
      );

    if (!lockHeld) {
      throw Object.assign(
        new Error(
          'Another Knowledge AI migration writer currently holds the deployment migration lock.'
        ),
        {
          code:
            'MIGRATION_LOCK_HELD',
        }
      );
    }

    await client.query('BEGIN');
    try {
      await ensureMigrationTable(
        client
      );
      await client.query(
        'COMMIT'
      );
    } catch (error) {
      await client.query(
        'ROLLBACK'
      );
      throw error;
    }

    for (
      const migration of
      migrationFiles()
    ) {
      const existing =
        await client.query<{
          checksum: string;
          filename: string;
        }>(
          'SELECT checksum, filename FROM schema_migrations WHERE version = $1',
          [migration.version]
        );

      if (existing.rowCount) {
        const row =
          existing.rows[0];
        if (
          row.checksum !==
            migration.checksum ||
          row.filename !==
            migration.filename
        ) {
          throw new Error(
            'Migration ' +
              migration.version +
              ' was already applied with different content.'
          );
        }
        alreadyApplied.push(
          migration.version
        );
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(
          migration.sql
        );
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
        await client.query(
          'COMMIT'
        );
      } catch (error) {
        await client.query(
          'ROLLBACK'
        );
        throw error;
      }

      applied.push(
        migration.version
      );
    }

    return {
      applied,
      alreadyApplied,
    };
  } finally {
    if (lockHeld) {
      await client
        .query(
          'SELECT pg_advisory_unlock($1)',
          [
            MIGRATION_ADVISORY_LOCK_KEY,
          ]
        )
        .catch(() => undefined);
    }
    client.release();
  }
}
