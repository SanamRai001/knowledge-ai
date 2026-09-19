import {
  Pool,
  PoolClient,
  PoolConfig,
  QueryResult,
  QueryResultRow,
} from 'pg';

let pool: Pool | null = null;
let poolSignature = '';

export interface PostgresRuntimeConfig {
  databaseUrl: string;
  ssl: false | { rejectUnauthorized: boolean };
  maxConnections: number;
}

export class PostgresConfigurationError extends Error {
  public readonly code = 'POSTGRES_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'PostgresConfigurationError';
  }
}

export function postgresRuntimeConfig(): PostgresRuntimeConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim() || '';
  if (!databaseUrl) {
    throw new PostgresConfigurationError(
      'DATABASE_URL is required when PostgreSQL persistence is used.'
    );
  }

  const sslMode =
    process.env.DATABASE_SSL?.trim().toLowerCase() || 'disable';
  const max = Number(process.env.DATABASE_POOL_MAX || '10');

  return {
    databaseUrl,
    ssl:
      sslMode === 'require'
        ? { rejectUnauthorized: false }
        : false,
    maxConnections:
      Number.isInteger(max) && max > 0 && max <= 100
        ? max
        : 10,
  };
}

export function postgresPersistenceEnabled(): boolean {
  return (
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE
      ?.trim()
      .toLowerCase() === 'postgres'
  );
}

export function postgresPool(): Pool {
  const config = postgresRuntimeConfig();
  const signature = JSON.stringify(config);

  if (!pool || poolSignature !== signature) {
    if (pool) {
      void pool.end();
    }

    const poolConfig: PoolConfig = {
      connectionString: config.databaseUrl,
      max: config.maxConnections,
      ssl: config.ssl,
      application_name: 'knowledge-ai',
    };
    pool = new Pool(poolConfig);
    poolSignature = signature;
  }

  return pool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return postgresPool().query<T>(text, values);
}

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await postgresPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  poolSignature = '';
  await current.end();
}
