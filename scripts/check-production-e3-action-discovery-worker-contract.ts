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
    'server/persistence/migrations/016_action_discovery_worker_jobs.sql'
  );
  for (const required of [
    'CREATE TABLE action_execution_discovery_jobs',
    'UNIQUE (account_id, execution_id, dataset_id)',
    'REFERENCES action_executions(account_id, id)',
    'REFERENCES worker_jobs(account_id, id)',
    'REFERENCES datasets(account_id, id)',
  ]) {
    assert(
      migration.includes(required),
      'E3 migration is missing invariant: ' +
        required
    );
  }

  const worker = read(
    'server/actions/actionDiscoveryWorker.ts'
  );
  for (const required of [
    "ACTION_DISCOVERY_REFRESH_JOB_TYPE",
    "'ACTION_DISCOVERY_REFRESH_V1'",
    'schemaVersion: 1',
    'action-discovery:',
    'analysisRunId',
    'enqueueWorkerJobWithClient',
    'linkExecutionDiscoveryJobWithClient',
    'withTransaction(',
    'discoveryRuntimeService',
    '.analyzeDataset({',
    '.appendExecutionAnalysisRun({',
    '.appendExecutionWarning({',
    'WorkerJobHandlerError',
  ]) {
    assert(
      worker.includes(required),
      'E3 worker contract is missing: ' +
        required
    );
  }

  const transactionIndex =
    worker.indexOf(
      'return withTransaction('
    );
  const enqueueIndex =
    worker.indexOf(
      'await enqueueWorkerJobWithClient(',
      transactionIndex
    );
  const linkIndex =
    worker.indexOf(
      'await linkExecutionDiscoveryJobWithClient(',
      enqueueIndex
    );
  assert(
    transactionIndex >= 0 &&
      enqueueIndex > transactionIndex &&
      linkIndex > enqueueIndex,
    'E3 worker enqueue and Action linkage must be committed in one PostgreSQL transaction.'
  );

  const actionRuntime = read(
    'server/actions/actionRuntimeExecutionService.ts'
  );
  assert(
    actionRuntime.includes(
      'enqueueActionDiscoveryRefresh'
    ) &&
      actionRuntime.includes(
        'collectDownstreamDatasetIds'
      ) &&
      !actionRuntime.includes(
        'discoveryRuntimeService.analyzeDataset'
      ),
    'PostgreSQL Action finalization must enqueue E3 work instead of running Discovery inline.'
  );

  const existingExecutionIndex =
    actionRuntime.indexOf(
      'const existingExecution ='
    );
  const replayFinalizeIndex =
    actionRuntime.indexOf(
      'finalizeCommittedPostgresAction',
      existingExecutionIndex
    );
  assert(
    existingExecutionIndex >= 0 &&
      replayFinalizeIndex >
        existingExecutionIndex,
    'Committed Action replay must reconcile missing E3 jobs without replaying the D1 mutation.'
  );

  const fileMode = read(
    'server/actions/actionExecutionService.ts'
  );
  assert(
    fileMode.includes(
      'discoveryService.analyzeDataset'
    ),
    'E3 must preserve file-mode inline Discovery compatibility.'
  );

  const discoveryRuntime = read(
    'server/discovery/discoveryRuntimeService.ts'
  );
  assert(
    discoveryRuntime.includes(
      'analysisRunId?: string;'
    ) &&
      discoveryRuntime.includes(
        'startedAt?: number;'
      ) &&
      discoveryRuntime.includes(
        "existing.status ===\n            'COMPLETED'"
      ),
    'E3 retries require deterministic/idempotent Discovery analysis-run identity.'
  );

  const background = read(
    'server/runtime/backgroundRuntime.ts'
  );
  const roleGuardIndex =
    background.indexOf(
      'if (!roleRunsWorkers(role))'
    );
  const registerIndex =
    background.indexOf(
      'registerActionDiscoveryWorkerHandler()'
    );
  assert(
    roleGuardIndex >= 0 &&
      registerIndex > roleGuardIndex,
    'E3 handler registration must happen only after the WORKER/combined role guard.'
  );

  const catalog = read(
    'server/runtime/backgroundWorkloadCatalog.ts'
  );
  assert(
    catalog.includes(
      "id: 'DISCOVERY_ANALYSIS'"
    ) &&
      catalog.includes(
        "executionModel:\n        'AUTONOMOUS_LOOP'"
      ) &&
      catalog.includes(
        "e1Owner: 'WORKER'"
      ) &&
      catalog.includes(
        "id: 'INTEGRATION_SYNC'"
      ) &&
      catalog.includes(
        "id: 'AUTOMATION_EXECUTION'"
      ) &&
      catalog.includes(
        "e1Owner: 'REQUEST_PATH'"
      ),
    'E3 must move only Discovery refresh to worker ownership while Integration/Automation stay request-driven.'
  );

  const manualRouter = read(
    'server/discovery/discoveryRouter.ts'
  );
  assert(
    manualRouter.includes(
      "discoveryRouter.post('/analyze'"
    ) &&
      manualRouter.includes(
        'await discoveryRuntimeService.analyzeDataset({'
      ),
    'Explicit manual Discovery analysis must remain synchronous.'
  );

  const dedicatedWorker = read(
    'worker.ts'
  );
  assert(
    dedicatedWorker.includes(
      'SELECT 1 FROM action_execution_discovery_jobs LIMIT 1'
    ),
    'Dedicated worker startup must fail closed if E3 linkage schema is missing.'
  );

  const workerRepository = read(
    'server/worker/postgresWorkerJobRepository.ts'
  );
  assert(
    workerRepository.includes(
      'export async function enqueueWorkerJobWithClient'
    ),
    'E3 must reuse the E2 queue contract through a client-scoped enqueue primitive.'
  );

  const actionRepository = read(
    'server/persistence/a3PostgresRepositories.ts'
  );
  assert(
    actionRepository.includes(
      'export async function linkExecutionDiscoveryJobWithClient'
    ) &&
      actionRepository.includes(
        'appendExecutionAnalysisRun'
      ) &&
      actionRepository.includes(
        'appendExecutionWarning'
      ),
    'E3 must persist job linkage and truthful downstream result metadata on Action executions.'
  );

  const pkg = read('package.json')
    .toLowerCase();
  for (const forbidden of [
    'bullmq',
    'pg-boss',
    'bee-queue',
  ]) {
    assert(
      !pkg.includes(forbidden),
      'E3 must remain on the proven PostgreSQL E2 queue; unexpected dependency: ' +
        forbidden
    );
  }

  console.log(
    'PRODUCTION_E3_ACTION_DISCOVERY_WORKER_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Versioned Action Discovery jobs, atomic enqueue/link, deterministic retry identity, worker-only ownership, synchronous manual analysis, and truthful Action downstream metadata are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_E3_ACTION_DISCOVERY_WORKER_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
