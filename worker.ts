import dotenv from 'dotenv';
import {
  closePostgresPool,
  postgresPersistenceEnabled,
  postgresPool,
} from './server/persistence/postgres.js';
import {
  backgroundRuntime,
} from './server/runtime/backgroundRuntime.js';
import {
  assertWorkerEntrypointRole,
  resolveProcessRole,
} from './server/runtime/processRole.js';
import {
  productionReadinessService,
} from './server/operations/productionReadinessService.js';
import {
  operationalTelemetry,
} from './server/operations/operationalTelemetry.js';

dotenv.config();

async function startWorker() {
  const role = resolveProcessRole(
    process.env,
    {
      nonProductionDefault:
        'worker',
    }
  );
  assertWorkerEntrypointRole(role);

  if (!postgresPersistenceEnabled()) {
    throw new Error(
      'Knowledge AI worker runtime requires KNOWLEDGE_AI_PERSISTENCE_MODE=postgres.'
    );
  }

  // Fail before starting loops if PostgreSQL or required worker schemas
  // are unavailable. Migrations remain a deployment responsibility.
  await postgresPool().query(
    'SELECT 1 FROM watch_jobs LIMIT 1'
  );
  await postgresPool().query(
    'SELECT 1 FROM worker_jobs LIMIT 1'
  );
  await postgresPool().query(
    'SELECT 1 FROM action_execution_discovery_jobs LIMIT 1'
  );
  await postgresPool().query(
    'SELECT 1 FROM integration_sync_worker_jobs LIMIT 1'
  );
  await postgresPool().query(
    'SELECT 1 FROM automation_execution_worker_jobs LIMIT 1'
  );
  await postgresPool().query(
    'SELECT 1 FROM account_secrets LIMIT 1'
  );

  const started =
    backgroundRuntime.startForRole(
      role,
      {
        keepProcessAlive: true,
      }
    );

  console.log(
    'Knowledge AI worker running: ' +
      started.workloads.join(', ')
  );

  const readinessTick = async () => {
    const report =
      await productionReadinessService
        .checkWorkerReadiness();

    operationalTelemetry.emitEvent({
      level:
        report.ready
          ? 'info'
          : 'warn',
      eventName:
        'worker.readiness.signal',
      component: 'worker',
      processRole: role,
      outcome:
        report.ready
          ? 'ready'
          : 'not_ready',
      metadata: {
        failedCheckIds:
          report.checks
            .filter(
              (check) =>
                check.status ===
                  'FAIL'
            )
            .map(
              (check) =>
                check.id
            ),
      },
    });
  };

  const readinessTimer =
    setInterval(
      () => {
        void readinessTick();
      },
      Math.max(
        5_000,
        Number(
          process.env
            .KNOWLEDGE_AI_WORKER_READINESS_INTERVAL_MS ||
            '15000'
        ) || 15_000
      )
    );
  readinessTimer.unref?.();
  setTimeout(
    () => {
      void readinessTick();
    },
    1_000
  ).unref?.();

  let closing = false;
  const shutdown = async (
    signal: string
  ) => {
    if (closing) return;
    closing = true;
    console.log(
      'Knowledge AI worker shutting down after ' +
        signal
    );
    clearInterval(
      readinessTimer
    );
    backgroundRuntime.stop();
    await closePostgresPool();
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

startWorker().catch((error) => {
  console.error(
    'Knowledge AI worker failed to start:',
    error
  );
  process.exitCode = 1;
});
