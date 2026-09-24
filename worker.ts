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
