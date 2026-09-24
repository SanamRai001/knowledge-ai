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
        'repository.recoverStale'
      ) &&
      runtime.includes(
        'repository.claim'
      ) &&
      runtime.includes(
        'repository.heartbeat'
      ) &&
      runtime.includes(
        'repository.complete'
      ) &&
      runtime.includes(
        'repository.fail'
      ),
    'E2 runtime must poll only registered job types and settle them through the fenced repository contract.'
  );

  const worker = read('worker.ts');
  assert(
    worker.includes(
      'SELECT 1 FROM worker_jobs LIMIT 1'
    ),
    'Dedicated worker startup must fail closed when migration 015 is unavailable.'
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
  assert(
    catalog.includes(
      "id: 'INTEGRATION_SYNC'"
    ) &&
      catalog.includes(
        "id: 'AUTOMATION_EXECUTION'"
      ) &&
      catalog.includes(
        "id: 'DISCOVERY_ANALYSIS'"
      ) &&
      catalog.includes(
        "e1Owner: 'REQUEST_PATH'"
      ) &&
      catalog.includes(
        "e1Owner: 'POST_COMMIT_PATH'"
      ),
    'E2 foundation must not silently migrate product workloads before a later explicit phase.'
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
