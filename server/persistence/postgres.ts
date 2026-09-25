import {
  Pool,
  PoolClient,
  PoolConfig,
  QueryResult,
  QueryResultRow,
} from 'pg';
import {
  operationalTelemetry,
} from '../operations/operationalTelemetry.js';

let pool: Pool | null = null;
let poolSignature = '';

function processRoleLabel(): string {
  const role =
    process.env
      .KNOWLEDGE_AI_PROCESS_ROLE
      ?.trim()
      .toLowerCase();
  return (
    role === 'web' ||
    role === 'worker' ||
    role === 'combined'
      ? role
      : 'unknown'
  );
}

function sqlOperation(
  input: unknown
): string {
  const text =
    typeof input === 'string'
      ? input
      : input &&
          typeof input ===
            'object' &&
          typeof (
            input as {
              text?: unknown;
            }
          ).text ===
            'string'
        ? String(
            (
              input as {
                text: string;
              }
            ).text
          )
        : '';

  const match =
    text
      .trim()
      .match(
        /^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|TRUNCATE|BEGIN|COMMIT|ROLLBACK)\b/i
      );
  return (
    match?.[1]
      ?.toUpperCase() ||
    'OTHER'
  );
}

function observePoolState(
  target: Pool
): void {
  const labels = {
    process_role:
      processRoleLabel(),
  };
  for (const [state, value] of [
    ['total', target.totalCount],
    ['idle', target.idleCount],
    ['waiting', target.waitingCount],
  ] as const) {
    operationalTelemetry.recordMetric({
      name:
        'db_pool_connections',
      kind: 'GAUGE',
      value,
      labels: {
        ...labels,
        state,
      },
    });
  }
}

function installPoolObservability(
  target: Pool
): void {
  const rawQuery =
    target.query.bind(target) as any;
  const slowThresholdMs =
    Math.max(
      1,
      Number(
        process.env
          .KNOWLEDGE_AI_DB_SLOW_QUERY_MS ||
          '1000'
      ) || 1000
    );

  (target as any).query = (
    ...args: any[]
  ) => {
    const operation =
      sqlOperation(args[0]);
    const started =
      process.hrtime.bigint();
    const maybeCallback =
      args.length > 0 &&
      typeof args[
        args.length - 1
      ] === 'function'
        ? args.pop()
        : null;

    const finish = (
      outcome: 'success' | 'failure',
      error?: any
    ) => {
      const durationMs =
        Number(
          process.hrtime.bigint() -
            started
        ) /
        1_000_000;

      operationalTelemetry.recordMetric({
        name:
          'db_query_duration_ms',
        kind: 'HISTOGRAM',
        value: durationMs,
        labels: {
          operation,
          outcome,
        },
      });
      observePoolState(target);

      if (
        outcome === 'failure' ||
        durationMs >=
          slowThresholdMs
      ) {
        operationalTelemetry.emitEvent({
          level:
            outcome === 'failure'
              ? 'error'
              : 'warn',
          eventName:
            outcome === 'failure'
              ? 'database.query.failed'
              : 'database.query.slow',
          component: 'postgres',
          outcome,
          metadata: {
            operation,
            durationMs:
              Math.round(
                durationMs * 100
              ) / 100,
            errorCode:
              error?.code,
          },
        });
      }
    };

    if (maybeCallback) {
      return rawQuery(
        ...args,
        (
          error: any,
          result: any
        ) => {
          finish(
            error
              ? 'failure'
              : 'success',
            error
          );
          maybeCallback(
            error,
            result
          );
        }
      );
    }

    try {
      const result =
        rawQuery(...args);
      if (
        result &&
        typeof result.then ===
          'function'
      ) {
        return result.then(
          (value: any) => {
            finish('success');
            return value;
          },
          (error: any) => {
            finish(
              'failure',
              error
            );
            throw error;
          }
        );
      }
      finish('success');
      return result;
    } catch (error: any) {
      finish(
        'failure',
        error
      );
      throw error;
    }
  };

  target.on(
    'error',
    (error: any) => {
      operationalTelemetry.emitEvent({
        level: 'error',
        eventName:
          'database.pool.error',
        component: 'postgres',
        outcome: 'failure',
        metadata: {
          errorCode:
            error?.code,
        },
      });
      observePoolState(target);
    }
  );

  observePoolState(target);
}

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
    installPoolObservability(
      pool
    );
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
  const acquireStarted =
    process.hrtime.bigint();
  const client =
    await postgresPool().connect();
  const acquiredAt =
    process.hrtime.bigint();

  operationalTelemetry.recordMetric({
    name:
      'db_query_duration_ms',
    kind: 'HISTOGRAM',
    value:
      Number(
        acquiredAt -
          acquireStarted
      ) / 1_000_000,
    labels: {
      operation:
        'POOL_ACQUIRE',
      outcome: 'success',
    },
  });

  const started =
    process.hrtime.bigint();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    operationalTelemetry.recordMetric({
      name:
        'db_query_duration_ms',
      kind: 'HISTOGRAM',
      value:
        Number(
          process.hrtime.bigint() -
            started
        ) / 1_000_000,
      labels: {
        operation:
          'TRANSACTION',
        outcome: 'success',
      },
    });
    return result;
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction failure.
    }
    operationalTelemetry.recordMetric({
      name:
        'db_query_duration_ms',
      kind: 'HISTOGRAM',
      value:
        Number(
          process.hrtime.bigint() -
            started
        ) / 1_000_000,
      labels: {
        operation:
          'TRANSACTION',
        outcome: 'failure',
      },
    });
    operationalTelemetry.emitEvent({
      level: 'error',
      eventName:
        'database.transaction.failed',
      component: 'postgres',
      outcome: 'failure',
      metadata: {
        errorCode:
          error?.code,
      },
    });
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
