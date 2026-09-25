import fs from 'fs';
import {
  DEGRADED_MODE_EXPECTATIONS,
  OPERATIONAL_LOG_FORBIDDEN_FIELDS,
  OPERATIONAL_LOG_REQUIRED_FIELDS,
  PRODUCTION_METRIC_CONTRACT,
  PRODUCTION_READINESS_REQUIREMENTS,
  RECOVERY_OBJECTIVES,
} from '../server/operations/productionOperationsContract.js';

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

function hasAll(
  source: readonly string[],
  required: readonly string[]
): boolean {
  return required.every((item) =>
    source.includes(item)
  );
}

async function main() {
  const metricNames =
    PRODUCTION_METRIC_CONTRACT.map(
      (item) => item.name
    );

  assert(
    hasAll(metricNames, [
      'http_requests_total',
      'http_request_duration_ms',
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
      'integration_sync_total',
      'integration_sync_lag_seconds',
      'watch_evaluation_total',
      'watch_job_lag_seconds',
      'action_execution_total',
      'automation_run_total',
      'secret_store_operation_total',
    ]),
    'G1 production metric contract is incomplete.'
  );

  assert(
    hasAll(
      [...OPERATIONAL_LOG_REQUIRED_FIELDS],
      [
        'timestamp',
        'level',
        'event_name',
        'component',
        'process_role',
        'outcome',
      ]
    ),
    'G1 structured log contract is missing required fields.'
  );

  assert(
    hasAll(
      [...OPERATIONAL_LOG_FORBIDDEN_FIELDS],
      [
        'prompt',
        'document_content',
        'dataset_rows',
        'oauth_access_token',
        'oauth_refresh_token',
        'api_key',
        'session_token',
        'password',
        'secret_ciphertext',
        'kms_key_material',
        'raw_authorization_header',
      ]
    ),
    'G1 privacy contract must forbid user content and secret material in operational logs.'
  );

  const readinessIds =
    PRODUCTION_READINESS_REQUIREMENTS.map(
      (item) => item.id
    );
  assert(
    hasAll(readinessIds, [
      'PROCESS_ROLE_VALID',
      'POSTGRES_REACHABLE',
      'SCHEMA_CURRENT',
      'OBJECT_STORAGE_CONFIGURED',
      'SECRET_KMS_CONFIGURED',
      'WORKER_HANDLERS_REGISTERED',
      'WORKER_LOOP_HEALTHY',
    ]),
    'G1 readiness contract is incomplete.'
  );

  assert(
    RECOVERY_OBJECTIVES.relationalState
      .targetRpoMinutes === 5 &&
      RECOVERY_OBJECTIVES.relationalState
        .targetRtoMinutes === 60 &&
      RECOVERY_OBJECTIVES.objectPayloads
        .minimumRecoverableDeleteWindowDays ===
        30 &&
      RECOVERY_OBJECTIVES.workerJobs
        .targetRpoMinutes === 0 &&
      RECOVERY_OBJECTIVES.restoreValidation
        .automatedRestoreTestAtLeastEveryDays ===
        30 &&
      RECOVERY_OBJECTIVES.restoreValidation
        .fullRecoveryExerciseAtLeastEveryDays ===
        90,
    'G1 recovery objectives drifted without an explicit audit update.'
  );

  assert(
    Object.keys(
      DEGRADED_MODE_EXPECTATIONS
    ).sort().join(',') ===
      [
        'integrationProviderUnavailable',
        'llmProviderUnavailable',
        'objectStorageUnavailable',
        'postgresUnavailable',
        'secretStoreOrKmsUnavailable',
      ].sort().join(','),
    'G1 degraded-mode contract is incomplete.'
  );

  const server = read('server.ts');
  assert(
    server.includes(
      "app.get('/api/health'"
    ) &&
      server.includes(
        "res.json({ status: 'ok', timestamp: Date.now() })"
      ),
    'G1 expects /api/health to remain a liveness-only compatibility endpoint until G2 replaces readiness internals.'
  );

  const readiness = read(
    'server/mediator/systemReadinessService.ts'
  );
  assert(
    readiness.includes(
      'latencyMs: 1.4'
    ) &&
      readiness.includes(
        "mode: 'in-memory-with-audit-ledger'"
      ) &&
      readiness.includes(
        'p50LatencyMs: 42'
      ),
    'G1 must keep the legacy mediator readiness service classified as synthetic/non-authoritative until it is replaced.'
  );

  const simulatedProvider = read(
    'server/mediator/realProviderAdapter.ts'
  );
  assert(
    simulatedProvider.includes(
      'does not make live provider API calls'
    ) &&
      simulatedProvider.includes(
        "validationSource: 'SIMULATED'"
      ),
    'G1 must not treat mediator provider fixtures as production-observed provider health.'
  );

  const gemini = read(
    'server/providers/geminiProvider.ts'
  );
  assert(
    gemini.includes(
      'latencyMs: Date.now() - started'
    ) &&
      gemini.includes(
        "category: 'RATE_LIMITED'"
      ) &&
      gemini.includes(
        "category: 'AUTHENTICATION'"
      ) &&
      gemini.includes(
        "category: 'TIMEOUT'"
      ) &&
      gemini.includes(
        "category: 'UNAVAILABLE'"
      ),
    'G1 expects real Gemini per-call latency and normalized failure classification to remain available for G2 instrumentation.'
  );

  const postgres = read(
    'server/persistence/postgres.ts'
  );
  assert(
    postgres.includes(
      "application_name: 'knowledge-ai'"
    ) &&
      postgres.includes(
        'maxConnections'
      ) &&
      postgres.includes(
        'withTransaction'
      ),
    'G1 expects the PostgreSQL runtime seam needed for pool/query instrumentation.'
  );

  const workerEntrypoint = read(
    'worker.ts'
  );
  assert(
    workerEntrypoint.includes(
      'SELECT 1 FROM worker_jobs LIMIT 1'
    ) &&
      workerEntrypoint.includes(
        'SELECT 1 FROM integration_sync_worker_jobs LIMIT 1'
      ) &&
      workerEntrypoint.includes(
        'SELECT 1 FROM automation_execution_worker_jobs LIMIT 1'
      ) &&
      workerEntrypoint.includes(
        'SELECT 1 FROM account_secrets LIMIT 1'
      ) &&
      workerEntrypoint.includes(
        'closePostgresPool'
      ),
    'G1 expects worker startup schema probes and graceful PostgreSQL shutdown to remain present.'
  );

  const workerTypes = read(
    'server/worker/workerJobTypes.ts'
  );
  assert(
    [
      'PENDING',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'DEAD_LETTER',
    ].every((status) =>
      workerTypes.includes(
        "'" + status + "'"
      )
    ) &&
      workerTypes.includes(
        'attemptCount'
      ) &&
      workerTypes.includes(
        'lastHeartbeatAt'
      ) &&
      workerTypes.includes(
        'lastError'
      ),
    'G1 expects durable worker state to expose attempts, heartbeat, and failure evidence.'
  );

  const workerRuntime = read(
    'server/worker/workerJobRuntime.ts'
  );
  assert(
    workerRuntime.includes(
      'recoveredJobIds'
    ) &&
      workerRuntime.includes(
        'retryingJobIds'
      ) &&
      workerRuntime.includes(
        'deadLetterJobIds'
      ) &&
      workerRuntime.includes(
        'leaseLostJobIds'
      ),
    'G1 expects real worker-cycle outcome categories to remain available for G2 metrics.'
  );

  const integrationFailure = read(
    'server/integrations/integrationFailure.ts'
  );
  assert(
    hasAll(
      integrationFailure.split(
        /[^A-Z_]+/
      ),
      [
        'CURSOR_INVALID',
        'AUTHORIZATION',
        'PERMISSION',
        'RATE_LIMIT',
        'TRANSIENT',
        'CONFLICT',
        'UNSUPPORTED',
        'DATA_INVALID',
        'UNKNOWN',
      ]
    ),
    'G1 expects Integration failures to remain operationally classified.'
  );

  const sourceTypes = read(
    'server/storage/sourceObjectTypes.ts'
  );
  assert(
    sourceTypes.includes(
      "'PURGE_PENDING'"
    ) &&
      sourceTypes.includes(
        "'TOMBSTONED'"
      ),
    'G1 expects durable source retention state to remain explicit.'
  );

  const sourceRuntime = read(
    'server/storage/sourceByteStorageRuntime.ts'
  );
  assert(
    sourceRuntime.includes(
      'SOURCE_STORAGE_BUCKET'
    ) &&
      sourceRuntime.includes(
        'SOURCE_STORAGE_REGION'
      ) &&
      !sourceRuntime.includes(
        'VERSIONING_ENABLED'
      ),
    'G1 currently classifies object versioning/retention verification as an unimplemented recovery control.'
  );

  const secretMigration = read(
    'server/persistence/migrations/019_account_secret_store.sql'
  );
  assert(
    secretMigration.includes(
      'CREATE TABLE account_secret_audit_events'
    ) &&
      secretMigration.includes(
        'kms_key_id'
      ) &&
      secretMigration.includes(
        'ciphertext'
      ),
    'G1 expects durable SecretStore audit/version metadata for recovery analysis.'
  );

  const kms = read(
    'server/security/versionedAesGcmKmsService.ts'
  );
  assert(
    kms.includes(
      'KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID'
    ) &&
      kms.includes(
        'KNOWLEDGE_AI_SECRET_KEYRING_JSON'
      ) &&
      kms.includes(
        'The KMS key version required for this secret is unavailable.'
      ),
    'G1 must preserve the explicit database-backup/KMS-key recovery dependency.'
  );

  const migrationRunner = read(
    'server/persistence/migrationRunner.ts'
  );
  assert(
    migrationRunner.includes(
      'schema_migrations'
    ) &&
      migrationRunner.includes(
        'checksum'
      ) &&
      migrationRunner.includes(
        'was already applied with different content.'
      ),
    'G1 restore compatibility depends on immutable migration checksum tracking.'
  );

  const pkg = JSON.parse(
    read('package.json')
  );
  const productionBackupCommands =
    Object.keys(
      pkg.scripts || {}
    ).filter((name) =>
      /(^|:)(backup|restore)(:|$)/i.test(
        name
      )
    );

  assert(
    productionBackupCommands.length === 0,
    'A backup/restore command now exists; advance the G1 historical audit and define its production recovery semantics.'
  );

  const evidence = read(
    'docs/PRODUCTION_G1_OPERATIONAL_RECOVERY_AUDIT.md'
  );
  for (const phrase of [
    'PROTOTYPE / NON-AUTHORITATIVE FOR PRODUCTION HEALTH',
    'PITR capability therefore depends entirely',
    '30 days minimum',
    'G2 — Production Observability + Real Readiness Foundation',
    'G3 — Backup/Restore + Recovery Drill Foundation',
  ]) {
    assert(
      evidence.includes(phrase),
      'G1 evidence is missing required audit conclusion: ' +
        phrase
    );
  }

  console.log(
    'PRODUCTION_G1_OPERATIONAL_RECOVERY_AUDIT_CHECK_PASSED'
  );
  console.log(
    'Production signal inventory, synthetic-vs-real health classification, privacy-safe metric/log contracts, readiness requirements, backup gaps, KMS/object recovery dependencies, and RPO/RTO targets are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_G1_OPERATIONAL_RECOVERY_AUDIT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
