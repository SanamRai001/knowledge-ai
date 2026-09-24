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

function sliceBetween(
  source: string,
  start: string,
  end: string
): string {
  const a = source.indexOf(start);
  const b = source.indexOf(
    end,
    a + start.length
  );
  assert(
    a >= 0 && b > a,
    'Could not isolate source section: ' +
      start
  );
  return source.slice(a, b);
}

async function main() {
  const migration = read(
    'server/persistence/migrations/018_automation_execution_worker_jobs.sql'
  );

  for (const required of [
    'CREATE TABLE automation_execution_worker_jobs',
    'REFERENCES action_proposals(account_id, id)',
    'REFERENCES worker_jobs(account_id, id)',
    'REFERENCES automation_runs(account_id, id)',
    'REFERENCES action_executions(account_id, id)',
    'identity_source',
    'principal_id',
    'requested_role',
    'automation_run_id',
    'action_execution_id',
  ]) {
    assert(
      migration.includes(required),
      'E5 migration is missing invariant: ' +
        required
    );
  }

  const identity = read(
    'server/automation/automationWorkerIdentity.ts'
  );

  for (const required of [
    'snapshotAutomationWorkerPrincipal',
    'revalidateAutomationWorkerPrincipal',
    'postgresIdentityFoundationRepository',
    'postgresApiKeyRepository',
    "user.status !== 'ACTIVE'",
    "membership.status !== 'ACTIVE'",
    "key.status !== 'active'",
    'DEFAULT_WEB identities cannot',
  ]) {
    assert(
      identity.includes(required),
      'E5 identity revalidation is missing: ' +
        required
    );
  }

  assert(
    !identity.includes('tokenHash') &&
      !identity.includes('keyHash') &&
      !identity.includes('sessionSecret'),
    'E5 worker identity code must never carry credential secrets into queued work.'
  );

  const worker = read(
    'server/automation/automationExecutionWorker.ts'
  );

  for (const required of [
    "'AUTOMATION_EXECUTION_V1'",
    'schemaVersion: 1',
    'snapshotAutomationWorkerPrincipal',
    'revalidateAutomationWorkerPrincipal',
    "'automation-execution:'",
    "'automation-proposal:'",
    'enqueueWorkerJobWithClient',
    'automationExecutionRuntimeService',
    '.executeEligible({',
    'completedExecution',
    'AUTOMATION_REPLAYED',
    'AUTOMATION_TECHNICAL_FAILURE',
    'WorkerJobHandlerError',
  ]) {
    assert(
      worker.includes(required),
      'E5 Automation worker contract is missing: ' +
        required
    );
  }

  const payload = sliceBetween(
    worker,
    'export interface AutomationExecutionJobPayload',
    'export interface AutomationExecutionJobView'
  );
  for (const forbidden of [
    'sessionId',
    'workspaceId',
    'keyHash',
    'token',
    'secret',
  ]) {
    assert(
      !payload.includes(forbidden),
      'E5 worker payload must not embed credential/session material: ' +
        forbidden
    );
  }

  const view = sliceBetween(
    worker,
    'export interface AutomationExecutionJobView',
    'type Heartbeat'
  );
  for (const forbidden of [
    'principalId',
    'authorizationRevisionAt',
    'leaseOwner',
    'leaseToken',
    'payload:',
    'idempotencyKey',
    'concurrencyKey',
  ]) {
    assert(
      !view.includes(forbidden),
      'Browser-safe E5 job view must not expose worker/principal internals: ' +
        forbidden
    );
  }

  const d2 = read(
    'server/automation/automationExecutionRuntimeService.ts'
  );
  assert(
    d2.includes(
      'claimPolicyExecution'
    ) &&
      d2.includes(
        'commitPolicyExecution'
      ) &&
      d2.includes(
        'preparePostgresConfirmedAction'
      ),
    'E5 must wrap the existing D2 transaction/recovery engine rather than replacing it.'
  );

  const router = read(
    'server/automation/automationRouter.ts'
  );
  for (const required of [
    "'/execute-jobs/:proposalId'",
    "'/execute-jobs/:proposalId/:jobId'",
    'enqueueAutomationExecutionJob',
    'listAutomationExecutionJobs',
    'getAutomationExecutionJob',
    'AUTOMATION_WORKER_QUEUE_REQUIRES_POSTGRES',
  ]) {
    assert(
      router.includes(required),
      'E5 queued Automation API is missing: ' +
        required
    );
  }
  assert(
    router.includes(
      "'/execute/:proposalId'"
    ) &&
      router.includes(
        'automationRuntimeService.execute({'
      ) &&
      router.includes(
        "'/runs/:runId/compensate'"
      ),
    'E5 must retain synchronous execution and manual compensation compatibility.'
  );

  const background = read(
    'server/runtime/backgroundRuntime.ts'
  );
  const roleGuard =
    background.indexOf(
      'if (!roleRunsWorkers(role))'
    );
  const register =
    background.indexOf(
      'registerAutomationExecutionWorkerHandler()'
    );
  assert(
    roleGuard >= 0 &&
      register > roleGuard,
    'E5 Automation handler must register only in worker/combined ownership.'
  );

  const catalog = read(
    'server/runtime/backgroundWorkloadCatalog.ts'
  );
  const start = catalog.indexOf(
    "id: 'AUTOMATION_EXECUTION'"
  );
  const end = catalog.indexOf(
    "id: 'DISCOVERY_ANALYSIS'",
    start
  );
  const entry =
    catalog.slice(start, end);

  assert(
    entry.includes(
      "'AUTONOMOUS_LOOP'"
    ) &&
      entry.includes(
        "e1Owner: 'WORKER'"
      ) &&
      entry.includes(
        'futureQueueCandidate: false'
      ) &&
      entry.includes(
        'automation_execution_worker_jobs'
      ),
    'E5 workload catalog must move Automation execution to durable worker ownership.'
  );

  const workerEntry = read(
    'worker.ts'
  );
  assert(
    workerEntry.includes(
      'SELECT 1 FROM automation_execution_worker_jobs LIMIT 1'
    ),
    'Dedicated worker startup must fail closed when E5 linkage schema is unavailable.'
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
      'E5 must reuse the E2 PostgreSQL queue; unexpected dependency: ' +
        forbidden
    );
  }

  console.log(
    'PRODUCTION_E5_AUTOMATION_EXECUTION_WORKER_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Versioned Automation jobs, deterministic enqueue, current-principal revalidation, D2 execution reuse, safe job views, worker ownership, and synchronous compatibility are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_E5_AUTOMATION_EXECUTION_WORKER_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
