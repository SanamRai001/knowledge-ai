import fs from 'fs';
import {
  InMemoryOperationalSink,
  operationalTelemetry,
  runWithOperationalContext,
  setOperationalSinkForTesting,
  setOperationalTenantAccount,
} from '../server/operations/operationalTelemetry.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const sink =
    new InMemoryOperationalSink();

  setOperationalSinkForTesting(
    sink
  );

  try {
    runWithOperationalContext(
      {
        requestId:
          'req_g2_contract',
        traceId:
          'trace_g2_contract',
        processRole: 'web',
      },
      () => {
        setOperationalTenantAccount(
          'acc_g2_private'
        );

        operationalTelemetry.emitEvent({
          level: 'info',
          eventName:
            'g2.privacy.proof',
          component: 'g2-proof',
          outcome: 'success',
          metadata: {
            prompt:
              'never log this',
            accessToken:
              'secret-token',
            safeMessage:
              'Bearer abc.def.ghi',
          },
        });
      }
    );

    const event =
      sink.events[0];
    assert(
      event.request_id ===
        'req_g2_contract' &&
        event.trace_id ===
          'trace_g2_contract' &&
        event.tenant_correlation_id
          ?.startsWith(
            'tenant_'
          ) &&
        !event.tenant_correlation_id
          ?.includes(
            'acc_g2_private'
          ),
      'G2 operational events must carry request/trace correlation and privacy-safe tenant correlation.'
    );
    assert(
      event.metadata?.prompt ===
        '[REDACTED]' &&
        event.metadata
          ?.accessToken ===
          '[REDACTED]' &&
        event.metadata
          ?.safeMessage ===
          '[REDACTED]',
      'G2 operational event sanitization must remove prompt/token material.'
    );
  } finally {
    setOperationalSinkForTesting(
      null
    );
  }

  const server = read(
    'server.ts'
  );
  assert(
    server.includes(
      "app.get('/api/health'"
    ) &&
      server.includes(
        "app.get('/api/ready'"
      ) &&
      server.includes(
        'checkWebReadiness'
      ),
    'G2 must keep liveness shallow and expose a separate real web readiness endpoint.'
  );

  const http = read(
    'server/operations/httpObservabilityMiddleware.ts'
  );
  for (const required of [
    'http_requests_total',
    'http_request_duration_ms',
    'route_template',
    'status_class',
    'X-Request-ID',
    'runWithOperationalContext',
  ]) {
    assert(
      http.includes(required),
      'G2 HTTP observability is missing: ' +
        required
    );
  }
  assert(
    !http.includes(
      'query_string'
    ) &&
      !http.includes(
        'raw_path'
      ),
    'G2 HTTP metric labels must not use raw paths or query strings.'
  );

  const identity = read(
    'server/requestIdentityMiddleware.ts'
  );
  assert(
    identity.includes(
      'setOperationalTenantAccount'
    ) &&
      identity.includes(
        'identity.accountId'
      ),
    'G2 authenticated requests must add hashed tenant correlation after identity resolution.'
  );

  const provider = read(
    'server/providers/geminiProvider.ts'
  );
  assert(
    provider.includes(
      'provider_requests_total'
    ) &&
      provider.includes(
        'provider_request_duration_ms'
      ) &&
      provider.includes(
        'failure_category'
      ) &&
      provider.includes(
        'provider.request.completed'
      ),
    'G2 must aggregate real provider latency/outcome/failure categories.'
  );

  const query = read(
    'server/querying/unifiedQueryService.ts'
  );
  assert(
    query.includes(
      'retrieval_stage_duration_ms'
    ) &&
      query.includes(
        'retrieval_failures_total'
      ) &&
      query.includes(
        "'route_selection'"
      ) &&
      query.includes(
        "'dataset_analytics'"
      ) &&
      query.includes(
        "'workspace_materialization'"
      ) &&
      query.includes(
        "'document_answer'"
      ),
    'G2 must instrument real query/retrieval stages.'
  );

  const postgres = read(
    'server/persistence/postgres.ts'
  );
  assert(
    postgres.includes(
      'db_query_duration_ms'
    ) &&
      postgres.includes(
        'db_pool_connections'
      ) &&
      postgres.includes(
        'database.query.slow'
      ) &&
      !postgres.includes(
        'raw_sql:'
      ) &&
      !postgres.includes(
        'bound_values:'
      ),
    'G2 PostgreSQL metrics must expose duration/pool state without raw SQL/value labels.'
  );

  const worker = read(
    'server/worker/workerJobRuntime.ts'
  );
  for (const required of [
    'worker_queue_depth',
    'worker_job_attempts_total',
    'worker_job_age_ms',
    'worker_dead_letter_total',
    'getHealthSnapshot',
    'worker.cycle.completed',
    'worker.cycle.failed',
  ]) {
    assert(
      worker.includes(required),
      'G2 worker instrumentation is missing: ' +
        required
    );
  }

  const readiness = read(
    'server/operations/productionReadinessService.ts'
  );
  for (const required of [
    'PROCESS_ROLE_VALID',
    'POSTGRES_REACHABLE',
    'SCHEMA_CURRENT',
    'OBJECT_STORAGE_CONFIGURED',
    'SECRET_KMS_CONFIGURED',
    'WORKER_HANDLERS_REGISTERED',
    'WORKER_LOOP_HEALTHY',
    'expectedPostgresMigrations',
    'sourceStorageRuntimeConfig',
    'secretKeyringRuntimeConfig',
  ]) {
    assert(
      readiness.includes(required),
      'G2 readiness is missing: ' +
        required
    );
  }

  assert(
    !readiness.includes(
      'geminiProvider'
    ) &&
      !readiness.includes(
        '.healthCheck('
      ),
    'External provider availability must remain degraded feature state, not global readiness.'
  );

  const workerEntrypoint =
    read('worker.ts');
  assert(
    workerEntrypoint.includes(
      'checkWorkerReadiness'
    ) &&
      workerEntrypoint.includes(
        'worker.readiness.signal'
      ),
    'G2 worker process must emit a steady-state readiness signal.'
  );

  const legacyReadiness = read(
    'server/mediator/systemReadinessService.ts'
  );
  assert(
    legacyReadiness.includes(
      'p50LatencyMs: 42'
    ),
    'G2 must keep synthetic mediator readiness visibly separate from the new production readiness service.'
  );

  console.log(
    'PRODUCTION_G2_OBSERVABILITY_READINESS_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Privacy-safe correlation, HTTP/provider/query/DB/worker instrumentation, real readiness separation, and degraded-provider semantics are verified.'
  );
}

main().catch((error) => {
  setOperationalSinkForTesting(
    null
  );
  console.error(
    'PRODUCTION_G2_OBSERVABILITY_READINESS_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
