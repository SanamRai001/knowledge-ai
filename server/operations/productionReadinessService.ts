import {
  postgresPersistenceEnabled,
  postgresPool,
} from '../persistence/postgres.js';
import {
  expectedPostgresMigrations,
} from '../persistence/migrationRunner.js';
import {
  sourceStorageRuntimeConfig,
} from '../storage/sourceByteStorageRuntime.js';
import {
  secretKeyringRuntimeConfig,
} from '../security/versionedAesGcmKmsService.js';
import {
  resolveProcessRole,
  roleRunsWeb,
  roleRunsWorkers,
  type KnowledgeAiProcessRole,
} from '../runtime/processRole.js';
import {
  workerJobHandlerRegistry,
} from '../worker/workerJobHandlerRegistry.js';
import {
  workerJobRuntime,
} from '../worker/workerJobRuntime.js';
import {
  ACTION_DISCOVERY_REFRESH_JOB_TYPE,
} from '../actions/actionDiscoveryWorker.js';
import {
  INTEGRATION_SYNC_JOB_TYPE,
} from '../integrations/integrationSyncWorker.js';
import {
  AUTOMATION_EXECUTION_JOB_TYPE,
} from '../automation/automationExecutionWorker.js';
import {
  operationalTelemetry,
} from './operationalTelemetry.js';

export type ProductionReadinessTarget =
  | 'WEB'
  | 'WORKER';

export interface ProductionReadinessCheck {
  id: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  detail?: string;
}

export interface ProductionReadinessReport {
  target: ProductionReadinessTarget;
  ready: boolean;
  checkedAt: number;
  processRole?: KnowledgeAiProcessRole;
  checks: ProductionReadinessCheck[];
}

export type ReadinessProbeResult = {
  ok: boolean;
  detail?: string;
};

export type ReadinessDependencies = {
  now: () => number;
  resolveRole: () => KnowledgeAiProcessRole;
  postgresReachable: () => Promise<ReadinessProbeResult>;
  schemaCurrent: () => Promise<ReadinessProbeResult>;
  objectStorageConfigured: () => ReadinessProbeResult;
  secretKmsConfigured: () => ReadinessProbeResult;
  workerHandlersReady: () => ReadinessProbeResult;
  workerLoopHealthy: () => ReadinessProbeResult;
};

const REQUIRED_WORKER_JOB_TYPES = [
  ACTION_DISCOVERY_REFRESH_JOB_TYPE,
  INTEGRATION_SYNC_JOB_TYPE,
  AUTOMATION_EXECUTION_JOB_TYPE,
] as const;

function safeErrorCode(
  error: unknown
): string {
  const typed = error as {
    code?: unknown;
    name?: unknown;
  };
  return String(
    typed?.code ||
      typed?.name ||
      'READINESS_CHECK_FAILED'
  )
    .replace(
      /[^A-Za-z0-9_.:-]/g,
      '_'
    )
    .slice(0, 120);
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer:
    | ReturnType<typeof setTimeout>
    | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<T>(
        (_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(
                  new Error(
                    'Readiness probe timed out.'
                  ),
                  {
                    code:
                      'READINESS_TIMEOUT',
                  }
                )
              ),
            timeoutMs
          );
          timer.unref?.();
        }
      ),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function readinessTimeoutMs(): number {
  return Math.max(
    250,
    Math.min(
      10_000,
      Number(
        process.env
          .KNOWLEDGE_AI_READINESS_TIMEOUT_MS ||
          '2000'
      ) || 2_000
    )
  );
}

function defaultDependencies():
  ReadinessDependencies {
  return {
    now: () => Date.now(),

    resolveRole: () =>
      resolveProcessRole(
        process.env,
        {
          nonProductionDefault:
            'combined',
        }
      ),

    postgresReachable: async () => {
      if (
        !postgresPersistenceEnabled()
      ) {
        return {
          ok: false,
          detail:
            'POSTGRES_PERSISTENCE_REQUIRED',
        };
      }

      await withTimeout(
        postgresPool().query(
          'SELECT 1'
        ),
        readinessTimeoutMs()
      );
      return { ok: true };
    },

    schemaCurrent: async () => {
      if (
        !postgresPersistenceEnabled()
      ) {
        return {
          ok: false,
          detail:
            'POSTGRES_PERSISTENCE_REQUIRED',
        };
      }

      const expected =
        expectedPostgresMigrations();
      const applied =
        await withTimeout(
          postgresPool().query<{
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
          ),
          readinessTimeoutMs()
        );

      const byVersion =
        new Map(
          applied.rows.map((row) => [
            row.version,
            row,
          ])
        );

      for (const migration of expected) {
        const row =
          byVersion.get(
            migration.version
          );
        if (!row) {
          return {
            ok: false,
            detail:
              'MIGRATION_MISSING_' +
              migration.version,
          };
        }
        if (
          row.filename !==
            migration.filename ||
          row.checksum !==
            migration.checksum
        ) {
          return {
            ok: false,
            detail:
              'MIGRATION_DRIFT_' +
              migration.version,
          };
        }
      }

      return {
        ok: true,
        detail:
          'MIGRATIONS_' +
          expected.length,
      };
    },

    objectStorageConfigured: () => {
      sourceStorageRuntimeConfig();
      return { ok: true };
    },

    secretKmsConfigured: () => {
      secretKeyringRuntimeConfig();
      return { ok: true };
    },

    workerHandlersReady: () => {
      const missing =
        REQUIRED_WORKER_JOB_TYPES.filter(
          (jobType) =>
            !workerJobHandlerRegistry
              .has(jobType)
        );

      return missing.length
        ? {
            ok: false,
            detail:
              'HANDLERS_MISSING_' +
              missing.join('_'),
          }
        : {
            ok: true,
            detail:
              'HANDLERS_' +
              REQUIRED_WORKER_JOB_TYPES
                .length,
          };
    },

    workerLoopHealthy: () => {
      const health =
        workerJobRuntime
          .getHealthSnapshot();

      return health.healthy
        ? {
            ok: true,
            detail:
              'WORKER_LOOP_RECENT',
          }
        : {
            ok: false,
            detail:
              health.started
                ? health
                    .lastCycleErrorCode ||
                  'WORKER_LOOP_STALE'
                : 'WORKER_LOOP_NOT_STARTED',
          };
    },
  };
}

export class ProductionReadinessService {
  private readonly deps:
    ReadinessDependencies;

  constructor(
    overrides: Partial<
      ReadinessDependencies
    > = {}
  ) {
    this.deps = {
      ...defaultDependencies(),
      ...overrides,
    };
  }

  private async runCheck(
    id: string,
    probe:
      | (() => ReadinessProbeResult)
      | (() => Promise<ReadinessProbeResult>)
  ): Promise<ProductionReadinessCheck> {
    const started =
      this.deps.now();

    try {
      const result =
        await probe();
      return {
        id,
        status:
          result.ok
            ? 'PASS'
            : 'FAIL',
        durationMs: Math.max(
          0,
          this.deps.now() -
            started
        ),
        detail:
          result.detail,
      };
    } catch (error) {
      return {
        id,
        status: 'FAIL',
        durationMs: Math.max(
          0,
          this.deps.now() -
            started
        ),
        detail:
          safeErrorCode(error),
      };
    }
  }

  private async check(
    target: ProductionReadinessTarget
  ): Promise<ProductionReadinessReport> {
    const checks:
      ProductionReadinessCheck[] = [];
    let role:
      | KnowledgeAiProcessRole
      | undefined;

    checks.push(
      await this.runCheck(
        'PROCESS_ROLE_VALID',
        () => {
          role =
            this.deps.resolveRole();
          const allowed =
            target === 'WEB'
              ? roleRunsWeb(role)
              : roleRunsWorkers(role);

          return allowed
            ? { ok: true }
            : {
                ok: false,
                detail:
                  'ROLE_' +
                  role +
                  '_NOT_' +
                  target,
              };
        }
      )
    );

    checks.push(
      await this.runCheck(
        'POSTGRES_REACHABLE',
        this.deps
          .postgresReachable
      )
    );
    checks.push(
      await this.runCheck(
        'SCHEMA_CURRENT',
        this.deps.schemaCurrent
      )
    );
    checks.push(
      await this.runCheck(
        'OBJECT_STORAGE_CONFIGURED',
        this.deps
          .objectStorageConfigured
      )
    );
    checks.push(
      await this.runCheck(
        'SECRET_KMS_CONFIGURED',
        this.deps
          .secretKmsConfigured
      )
    );

    if (target === 'WORKER') {
      checks.push(
        await this.runCheck(
          'WORKER_HANDLERS_REGISTERED',
          this.deps
            .workerHandlersReady
        )
      );
      checks.push(
        await this.runCheck(
          'WORKER_LOOP_HEALTHY',
          this.deps
            .workerLoopHealthy
        )
      );
    }

    const ready =
      checks.every(
        (check) =>
          check.status === 'PASS'
      );

    operationalTelemetry.emitEvent({
      level:
        ready ? 'info' : 'warn',
      eventName:
        'runtime.readiness.checked',
      component: 'readiness',
      processRole:
        role || 'unknown',
      outcome:
        ready
          ? 'ready'
          : 'not_ready',
      metadata: {
        target,
        failedCheckIds:
          checks
            .filter(
              (check) =>
                check.status ===
                'FAIL'
            )
            .map(
              (check) => check.id
            ),
      },
    });

    return {
      target,
      ready,
      checkedAt:
        this.deps.now(),
      processRole: role,
      checks,
    };
  }

  async checkWebReadiness():
    Promise<ProductionReadinessReport> {
    return this.check('WEB');
  }

  async checkWorkerReadiness():
    Promise<ProductionReadinessReport> {
    return this.check('WORKER');
  }
}

export const productionReadinessService =
  new ProductionReadinessService();
