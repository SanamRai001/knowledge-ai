import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  InMemoryOperationalSink,
  setOperationalSinkForTesting,
} from '../server/operations/operationalTelemetry.js';
import {
  productionReadinessService,
} from '../server/operations/productionReadinessService.js';
import {
  geminiProvider,
} from '../server/providers/geminiProvider.js';
import {
  unifiedQueryService,
} from '../server/querying/unifiedQueryService.js';
import {
  postgresWorkerJobRepository,
} from '../server/worker/postgresWorkerJobRepository.js';
import {
  WorkerJobRuntime,
  workerJobRuntime,
} from '../server/worker/workerJobRuntime.js';
import {
  WorkerJobHandlerRegistry,
} from '../server/worker/workerJobHandlerRegistry.js';
import {
  WorkerJobHandlerError,
} from '../server/worker/workerJobTypes.js';
import {
  registerActionDiscoveryWorkerHandler,
} from '../server/actions/actionDiscoveryWorker.js';
import {
  registerIntegrationSyncWorkerHandler,
} from '../server/integrations/integrationSyncWorker.js';
import {
  registerAutomationExecutionWorkerHandler,
} from '../server/automation/automationExecutionWorker.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number) {
  return new Promise<void>(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for G2 PostgreSQL proof.'
  );

  const envBefore = {
    nodeEnv: process.env.NODE_ENV,
    role:
      process.env
        .KNOWLEDGE_AI_PROCESS_ROLE,
    mode:
      process.env
        .KNOWLEDGE_AI_PERSISTENCE_MODE,
    bucket:
      process.env
        .SOURCE_STORAGE_BUCKET,
    region:
      process.env
        .SOURCE_STORAGE_REGION,
    backend:
      process.env
        .SOURCE_STORAGE_BACKEND,
    activeKey:
      process.env
        .KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID,
    keyring:
      process.env
        .KNOWLEDGE_AI_SECRET_KEYRING_JSON,
    gemini:
      process.env.GEMINI_API_KEY,
  };

  process.env.NODE_ENV =
    'production';
  process.env
    .KNOWLEDGE_AI_PERSISTENCE_MODE =
    'postgres';
  process.env
    .KNOWLEDGE_AI_PROCESS_ROLE =
    'web';
  process.env
    .SOURCE_STORAGE_BACKEND =
    's3';
  process.env
    .SOURCE_STORAGE_BUCKET =
    'g2-readiness-proof';
  process.env
    .SOURCE_STORAGE_REGION =
    'us-east-1';
  process.env
    .KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID =
    'g2-key';
  process.env
    .KNOWLEDGE_AI_SECRET_KEYRING_JSON =
    JSON.stringify({
      'g2-key':
        Buffer.alloc(32, 7)
          .toString('base64'),
    });
  delete process.env.GEMINI_API_KEY;

  const sink =
    new InMemoryOperationalSink(
      20_000
    );
  setOperationalSinkForTesting(
    sink
  );

  try {
    await runPostgresMigrations();
    await postgresPool().query(
      'TRUNCATE TABLE accounts CASCADE'
    );

    const accountId =
      'acc_g2_observe';
    await postgresAccountRepository
      .ensureAccount(accountId);

    const web =
      await productionReadinessService
        .checkWebReadiness();

    assert(
      web.ready &&
        web.checks.every(
          (check) =>
            check.status ===
            'PASS'
        ),
      'G2 web readiness must pass when core production dependencies and schema are valid.'
    );

    const providerResult =
      await geminiProvider.generate({
        prompt:
          'G2 non-billable provider observability proof',
      });

    assert(
      !providerResult.ok &&
        providerResult.failure
          ?.category ===
          'NOT_CONFIGURED',
      'G2 provider proof must use the non-billable NOT_CONFIGURED path.'
    );

    const webAfterProviderFailure =
      await productionReadinessService
        .checkWebReadiness();
    assert(
      webAfterProviderFailure.ready,
      'External provider outage/config absence must not make the whole web process unready.'
    );

    let sourceRequired = false;
    try {
      await unifiedQueryService.answer({
        accountId,
        question:
          'What should I inspect?',
      });
    } catch (error: any) {
      sourceRequired =
        error?.code ===
          'SOURCE_REQUIRED';
    }
    assert(
      sourceRequired,
      'G2 retrieval proof requires a deterministic route-selection failure.'
    );

    const registry =
      new WorkerJobHandlerRegistry();
    registry.register(
      'G2_OK_JOB',
      async () => undefined
    );
    registry.register(
      'G2_FAIL_JOB',
      async () => {
        throw new WorkerJobHandlerError(
          'expected G2 dead letter',
          true
        );
      }
    );

    const runtime =
      new WorkerJobRuntime(
        postgresWorkerJobRepository,
        registry,
        'worker_g2_metrics'
      );

    await postgresWorkerJobRepository
      .enqueue({
        accountId,
        jobType:
          'G2_OK_JOB',
        idempotencyKey:
          'g2-ok',
      });
    await postgresWorkerJobRepository
      .enqueue({
        accountId,
        jobType:
          'G2_FAIL_JOB',
        idempotencyKey:
          'g2-fail',
        maxAttempts: 1,
      });
    await postgresWorkerJobRepository
      .enqueue({
        accountId,
        jobType:
          'G2_PENDING_JOB',
        idempotencyKey:
          'g2-pending',
        runAt:
          Date.now() +
          60_000,
      });

    const cycle =
      await runtime.runCycle({
        maxJobs: 10,
      });

    assert(
      cycle.succeededJobIds
        .length === 1 &&
        cycle.deadLetterJobIds
          .length === 1,
      'G2 worker proof must exercise successful and dead-letter outcomes.'
    );

    registerActionDiscoveryWorkerHandler();
    registerIntegrationSyncWorkerHandler();
    registerAutomationExecutionWorkerHandler();

    process.env
      .KNOWLEDGE_AI_PROCESS_ROLE =
      'worker';

    workerJobRuntime.start({
      tickMs: 60_000,
      maxJobs: 1,
      keepProcessAlive: false,
    });

    for (
      let attempt = 0;
      attempt < 30;
      attempt += 1
    ) {
      if (
        workerJobRuntime
          .getHealthSnapshot()
          .healthy
      ) {
        break;
      }
      await sleep(25);
    }

    const worker =
      await productionReadinessService
        .checkWorkerReadiness();

    assert(
      worker.ready &&
        worker.checks.every(
          (check) =>
            check.status ===
            'PASS'
        ),
      'G2 worker readiness must require real schema, handlers, dependencies, and recent loop health.'
    );

    const metrics =
      sink.metrics;
    const metricNames =
      new Set(
        metrics.map(
          (metric) =>
            metric.name
        )
      );

    for (const required of [
      'provider_requests_total',
      'provider_request_duration_ms',
      'retrieval_stage_duration_ms',
      'retrieval_failures_total',
      'db_query_duration_ms',
      'db_pool_connections',
      'worker_queue_depth',
      'worker_job_attempts_total',
      'worker_job_age_ms',
      'worker_dead_letter_total',
    ] as const) {
      assert(
        metricNames.has(required),
        'G2 runtime proof did not observe metric: ' +
          required
      );
    }

    assert(
      metrics.some(
        (metric) =>
          metric.name ===
            'provider_requests_total' &&
          metric.labels
            .failure_category ===
            'NOT_CONFIGURED'
      ),
      'G2 provider metric must preserve normalized failure category.'
    );

    assert(
      metrics.some(
        (metric) =>
          metric.name ===
            'worker_queue_depth' &&
          metric.labels.job_type ===
            'G2_PENDING_JOB' &&
          metric.labels.status ===
            'PENDING' &&
          metric.value >= 1
      ),
      'G2 worker queue-depth metric must reflect real durable pending work.'
    );

    assert(
      sink.events.some(
        (event) =>
          event.event_name ===
            'runtime.readiness.checked' &&
          event.outcome ===
            'ready'
      ) &&
        sink.events.some(
          (event) =>
            event.event_name ===
              'worker.cycle.completed'
        ),
      'G2 runtime must emit structured readiness and worker-cycle events.'
    );

    console.log(
      'PRODUCTION_G2_OBSERVABILITY_READINESS_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Real PostgreSQL/schema readiness, degraded-provider behavior, provider/query/DB/worker metrics, queue depth/age/dead-letter signals, and worker-loop readiness are verified.'
    );
  } finally {
    workerJobRuntime.stop();
    setOperationalSinkForTesting(
      null
    );

    if (
      envBefore.nodeEnv ===
      undefined
    ) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV =
        envBefore.nodeEnv;
    }
    for (const [
      key,
      value,
    ] of [
      [
        'KNOWLEDGE_AI_PROCESS_ROLE',
        envBefore.role,
      ],
      [
        'KNOWLEDGE_AI_PERSISTENCE_MODE',
        envBefore.mode,
      ],
      [
        'SOURCE_STORAGE_BUCKET',
        envBefore.bucket,
      ],
      [
        'SOURCE_STORAGE_REGION',
        envBefore.region,
      ],
      [
        'SOURCE_STORAGE_BACKEND',
        envBefore.backend,
      ],
      [
        'KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID',
        envBefore.activeKey,
      ],
      [
        'KNOWLEDGE_AI_SECRET_KEYRING_JSON',
        envBefore.keyring,
      ],
      [
        'GEMINI_API_KEY',
        envBefore.gemini,
      ],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] =
          value;
      }
    }

    await closePostgresPool();
  }
}

main().catch((error) => {
  console.error(
    'PRODUCTION_G2_OBSERVABILITY_READINESS_POSTGRES_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
