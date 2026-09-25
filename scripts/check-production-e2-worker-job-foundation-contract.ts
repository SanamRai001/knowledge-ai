import fs from 'fs';
import {
  BackgroundRuntime,
} from '../server/runtime/backgroundRuntime.js';
import {
  WorkerJobHandlerRegistry,
} from '../server/worker/workerJobHandlerRegistry.js';

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
    'server/persistence/migrations/015_worker_jobs.sql'
  );

  for (const required of [
    'CREATE TABLE worker_jobs',
    "'PENDING'",
    "'RUNNING'",
    "'SUCCEEDED'",
    "'FAILED'",
    "'DEAD_LETTER'",
    'worker_jobs_idempotency_idx',
    'worker_jobs_running_concurrency_idx',
    'worker_jobs_ready_idx',
    'worker_jobs_lease_expiry_idx',
    'lease_owner',
    'lease_token',
    'lease_expires_at',
    'last_heartbeat_at',
  ]) {
    assert(
      migration.includes(required),
      'E2 worker job migration is missing: ' +
        required
    );
  }

  const repository = read(
    'server/worker/postgresWorkerJobRepository.ts'
  );

  for (const required of [
    'FOR UPDATE SKIP LOCKED',
    'ON CONFLICT',
    'idempotency_key',
    'concurrency_key',
    'lease_token',
    'lease_expires_at >',
    'WorkerJobLeaseError',
    'workerRetryDelayMs',
    "'DEAD_LETTER'",
    'recoverStale',
  ]) {
    assert(
      repository.includes(required),
      'E2 repository is missing durable queue invariant: ' +
        required
    );
  }

  const runtime = read(
    'server/worker/workerJobRuntime.ts'
  );
  assert(
    runtime.includes(
      'registry.listJobTypes()'
    ) &&
      runtime.includes(
        '.recoverStale('
      ) &&
      runtime.includes(
        '.claim('
      ) &&
      runtime.includes(
        '.heartbeat('
      ) &&
      runtime.includes(
        '.complete('
      ) &&
      runtime.includes(
        '.fail('
      ) &&
      runtime.includes(
        'runCycleCore'
      ),
    'E2 runtime must poll only registered job types and settle them through the fenced repository contract, including when later observability wrappers surround the cycle.'
  );

  const worker = read('worker.ts');
  assert(
    worker.includes(
      'SELECT 1 FROM worker_jobs LIMIT 1'
    ) &&
      worker.includes(
        'SELECT 1 FROM action_execution_discovery_jobs LIMIT 1'
      ),
    'Dedicated worker startup must fail closed when the E2 queue or later E3 workload schema is unavailable.'
  );

  const background = read(
    'server/runtime/backgroundRuntime.ts'
  );
  assert(
    background.includes(
      'workerJobRuntime'
    ) &&
      background.includes(
        'genericJobLoop?.start'
      ) &&
      background.includes(
        'genericJobLoop?.stop'
      ),
    'E2 generic job runtime must be owned by the E1 worker process boundary.'
  );

  const starts: string[] = [];
  const stops: string[] = [];
  const watch = {
    start() {
      starts.push('watch');
    },
    stop() {
      stops.push('watch');
    },
  };
  const generic = {
    start() {
      starts.push('generic');
    },
    stop() {
      stops.push('generic');
    },
  };

  const web =
    new BackgroundRuntime(
      watch,
      generic
    );
  web.startForRole('web');
  assert(
    starts.length === 0,
    'WEB role must not start Watch or the E2 generic job poller.'
  );

  const workerRuntime =
    new BackgroundRuntime(
      watch,
      generic
    );
  workerRuntime.startForRole(
    'worker',
    { keepProcessAlive: true }
  );
  workerRuntime.startForRole(
    'worker',
    { keepProcessAlive: true }
  );
  assert(
    starts.join(',') ===
      'watch,generic',
    'WORKER role must start Watch and generic queue infrastructure exactly once.'
  );
  workerRuntime.stop();
  assert(
    stops.join(',') ===
      'watch,generic',
    'Background runtime must stop both worker loops.'
  );

  const registry =
    new WorkerJobHandlerRegistry();
  registry.register(
    'TEST_HANDLER',
    async () => undefined
  );

  let duplicateBlocked = false;
  try {
    registry.register(
      'TEST_HANDLER',
      async () => undefined
    );
  } catch {
    duplicateBlocked = true;
  }
  assert(
    duplicateBlocked &&
      registry.listJobTypes()
        .join(',') ===
        'TEST_HANDLER',
    'Worker handler registry must reject ambiguous duplicate ownership.'
  );

  const catalog = read(
    'server/runtime/backgroundWorkloadCatalog.ts'
  );
  for (const workload of [
    'INTEGRATION_SYNC',
    'AUTOMATION_EXECUTION',
    'DISCOVERY_ANALYSIS',
  ]) {
    const start =
      catalog.indexOf(
        "id: '" + workload + "'"
      );
    const end =
      catalog.indexOf(
        workload ===
          'DISCOVERY_ANALYSIS'
          ? '] as const'
          : "id: '",
        start + 5
      );
    const entry =
      catalog.slice(
        start,
        end > start
          ? end
          : undefined
      );

    assert(
      start >= 0 &&
        entry.includes(
          "executionModel:\n        'AUTONOMOUS_LOOP'"
        ) &&
        entry.includes(
          "e1Owner: 'WORKER'"
        ) &&
        entry.includes(
          'futureQueueCandidate: false'
        ),
      'E2 historical foundation proof must accept later durable worker migration for ' +
        workload +
        '.'
    );
  }

  const pkg = read('package.json')
    .toLowerCase();
  for (const forbidden of [
    'bullmq',
    'pg-boss',
    'bee-queue',
  ]) {
    assert(
      !pkg.includes(forbidden),
      'E2 remains PostgreSQL-first; unexpected queue dependency found: ' +
        forbidden
    );
  }

  console.log(
    'PRODUCTION_E2_WORKER_JOB_FOUNDATION_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Durable job lifecycle, idempotency/concurrency indexes, fenced leases, handler ownership, WEB/WORKER integration, and PostgreSQL-first scope are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_E2_WORKER_JOB_FOUNDATION_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
