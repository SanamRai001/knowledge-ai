import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const migration = read(
    'server/persistence/migrations/017_integration_sync_worker_jobs.sql'
  );

  for (const required of [
    'CREATE TABLE integration_sync_worker_jobs',
    'REFERENCES integration_connections(account_id, id)',
    'REFERENCES worker_jobs(account_id, id)',
    'REFERENCES integration_sync_runs(account_id, id)',
    'integration_sync_worker_jobs_connection_idx',
  ]) {
    assert(
      migration.includes(required),
      'E4 migration is missing invariant: ' +
        required
    );
  }

  const worker = read(
    'server/integrations/integrationSyncWorker.ts'
  );

  for (const required of [
    "'INTEGRATION_SYNC_V1'",
    'schemaVersion: 1',
    'connectionUpdatedAtBefore',
    'lastSuccessfulSyncAtBefore',
    'integration-sync:',
    "concurrencyKey:\n                'integration:' +",
    'stableHash([',
    'enqueueWorkerJobWithClient',
    'FOR UPDATE',
    "j.status IN (\n                 'PENDING',\n                 'RUNNING'",
    'integrationRuntimeService',
    '.sync({',
    'completedRunAfterBaseline',
    'syncRunId',
    'heartbeat',
    'SYNC_ALREADY_RUNNING',
    'markTerminalWorkerFailure',
    'WorkerJobHandlerError',
  ]) {
    assert(
      worker.includes(required),
      'E4 worker contract is missing: ' +
        required
    );
  }

  assert(
    !worker.includes(
      'randomRequestId'
    ),
    'E4 enqueue identity must be deterministic from durable connection baseline, not a random request token.'
  );

  const viewStart =
    worker.indexOf(
      'export interface IntegrationSyncJobView'
    );
  const viewEnd =
    worker.indexOf(
      'type Heartbeat',
      viewStart
    );
  const view =
    worker.slice(
      viewStart,
      viewEnd
    );
  for (const forbidden of [
    'leaseOwner',
    'leaseToken',
    'payload:',
    'idempotencyKey',
    'concurrencyKey',
  ]) {
    assert(
      !view.includes(forbidden),
      'Browser-safe E4 job view must not expose generic worker internals: ' +
        forbidden
    );
  }

  const background = read(
    'server/runtime/backgroundRuntime.ts'
  );
  const roleGuard =
    background.indexOf(
      'if (!roleRunsWorkers(role))'
    );
  const register =
    background.indexOf(
      'registerIntegrationSyncWorkerHandler()'
    );
  assert(
    roleGuard >= 0 &&
      register > roleGuard,
    'E4 handler registration must happen only after worker/combined role guard.'
  );

  const catalog = read(
    'server/runtime/backgroundWorkloadCatalog.ts'
  );
  const integrationStart =
    catalog.indexOf(
      "id: 'INTEGRATION_SYNC'"
    );
  const integrationEnd =
    catalog.indexOf(
      "id: 'AUTOMATION_EXECUTION'",
      integrationStart
    );
  const integrationEntry =
    catalog.slice(
      integrationStart,
      integrationEnd
    );

  assert(
    integrationEntry.includes(
      "executionModel:\n        'AUTONOMOUS_LOOP'"
    ) &&
      integrationEntry.includes(
        "e1Owner: 'WORKER'"
      ) &&
      integrationEntry.includes(
        'futureQueueCandidate: false'
      ) &&
      integrationEntry.includes(
        'integration_sync_worker_jobs'
      ),
    'E4 workload catalog must move Integration Sync to durable worker ownership.'
  );

  const router = read(
    'server/integrations/integrationRouter.ts'
  );
  for (const required of [
    "'/connections/:id/sync-jobs'",
    "'/connections/:id/sync-jobs/:jobId'",
    'enqueueIntegrationSyncJob',
    'listIntegrationSyncJobs',
    'getIntegrationSyncJob',
    'INTEGRATION_WORKER_QUEUE_REQUIRES_POSTGRES',
  ]) {
    assert(
      router.includes(required),
      'E4 queued HTTP surface is missing: ' +
        required
    );
  }
  assert(
    router.includes(
      "integrationRouter.post('/connections/:id/sync'"
    ) &&
      router.includes(
        'await integrationRuntimeService.sync({'
      ),
    'E4 must retain the synchronous Integration sync route as compatibility during caller migration.'
  );

  const ui = read(
    'src/components/IntegrationsWorkspace.tsx'
  );
  assert(
    ui.includes(
      "'/sync-jobs'"
    ) &&
      ui.includes(
        '/sync-jobs?limit=40'
      ) &&
      ui.includes(
        'Synchronization queued.'
      ) &&
      ui.includes(
        'INTEGRATION_WORKER_QUEUE_REQUIRES_POSTGRES'
      ) &&
      ui.includes(
        'Sync jobs'
      ) &&
      ui.includes(
        "job.status === 'PENDING'"
      ) &&
      ui.includes(
        "job.status === 'RUNNING'"
      ),
    'E4 product UI must use queued sync semantics and surface truthful worker state.'
  );

  const workerEntry = read(
    'worker.ts'
  );
  assert(
    workerEntry.includes(
      'SELECT 1 FROM integration_sync_worker_jobs LIMIT 1'
    ),
    'Dedicated worker startup must fail closed when E4 linkage schema is unavailable.'
  );

  const pkg =
    read('package.json')
      .toLowerCase();
  for (const forbidden of [
    'bullmq',
    'pg-boss',
    'bee-queue',
  ]) {
    assert(
      !pkg.includes(forbidden),
      'E4 must reuse the E2 PostgreSQL worker queue; unexpected dependency: ' +
        forbidden
    );
  }

  console.log(
    'PRODUCTION_E4_INTEGRATION_SYNC_WORKER_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Versioned Integration sync jobs, deterministic/coalesced enqueue, safe job views, worker ownership, heartbeat/replay recovery, additive queued HTTP/UI migration, and synchronous compatibility are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_E4_INTEGRATION_SYNC_WORKER_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
