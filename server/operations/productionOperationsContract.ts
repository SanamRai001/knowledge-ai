export type OperationalMetricName =
  | 'http_requests_total'
  | 'http_request_duration_ms'
  | 'provider_requests_total'
  | 'provider_request_duration_ms'
  | 'retrieval_stage_duration_ms'
  | 'retrieval_failures_total'
  | 'db_query_duration_ms'
  | 'db_pool_connections'
  | 'worker_queue_depth'
  | 'worker_job_attempts_total'
  | 'worker_job_age_ms'
  | 'worker_dead_letter_total'
  | 'integration_sync_total'
  | 'integration_sync_lag_seconds'
  | 'watch_evaluation_total'
  | 'watch_job_lag_seconds'
  | 'action_execution_total'
  | 'automation_run_total'
  | 'secret_store_operation_total'
  | 'backup_recovery_point_age_seconds'
  | 'recovery_validation_total'
  | 'recovery_validation_age_seconds';

export interface OperationalMetricContract {
  name: OperationalMetricName;
  kind:
    | 'COUNTER'
    | 'HISTOGRAM'
    | 'GAUGE';
  requiredLabels: readonly string[];
  forbiddenLabels?: readonly string[];
}

export const PRODUCTION_METRIC_CONTRACT:
  readonly OperationalMetricContract[] =
  [
    {
      name: 'http_requests_total',
      kind: 'COUNTER',
      requiredLabels: [
        'route_template',
        'method',
        'status_class',
        'process_role',
      ],
      forbiddenLabels: [
        'raw_path',
        'query_string',
        'account_id',
        'prompt',
        'content',
      ],
    },
    {
      name: 'http_request_duration_ms',
      kind: 'HISTOGRAM',
      requiredLabels: [
        'route_template',
        'method',
        'status_class',
        'process_role',
      ],
      forbiddenLabels: [
        'raw_path',
        'query_string',
        'account_id',
        'prompt',
        'content',
      ],
    },
    {
      name: 'provider_requests_total',
      kind: 'COUNTER',
      requiredLabels: [
        'provider',
        'operation',
        'outcome',
        'failure_category',
      ],
    },
    {
      name: 'provider_request_duration_ms',
      kind: 'HISTOGRAM',
      requiredLabels: [
        'provider',
        'operation',
        'outcome',
      ],
    },
    {
      name: 'retrieval_stage_duration_ms',
      kind: 'HISTOGRAM',
      requiredLabels: [
        'stage',
        'outcome',
      ],
    },
    {
      name: 'retrieval_failures_total',
      kind: 'COUNTER',
      requiredLabels: [
        'stage',
        'failure_category',
      ],
    },
    {
      name: 'db_query_duration_ms',
      kind: 'HISTOGRAM',
      requiredLabels: [
        'operation',
        'outcome',
      ],
      forbiddenLabels: [
        'raw_sql',
        'bound_values',
      ],
    },
    {
      name: 'db_pool_connections',
      kind: 'GAUGE',
      requiredLabels: [
        'state',
        'process_role',
      ],
    },
    {
      name: 'worker_queue_depth',
      kind: 'GAUGE',
      requiredLabels: [
        'job_type',
        'status',
      ],
    },
    {
      name: 'worker_job_attempts_total',
      kind: 'COUNTER',
      requiredLabels: [
        'job_type',
        'outcome',
      ],
    },
    {
      name: 'worker_job_age_ms',
      kind: 'HISTOGRAM',
      requiredLabels: [
        'job_type',
        'status',
      ],
    },
    {
      name: 'worker_dead_letter_total',
      kind: 'COUNTER',
      requiredLabels: [
        'job_type',
      ],
    },
    {
      name: 'integration_sync_total',
      kind: 'COUNTER',
      requiredLabels: [
        'provider',
        'outcome',
        'failure_category',
      ],
    },
    {
      name: 'integration_sync_lag_seconds',
      kind: 'GAUGE',
      requiredLabels: [
        'provider',
      ],
    },
    {
      name: 'watch_evaluation_total',
      kind: 'COUNTER',
      requiredLabels: [
        'mode',
        'outcome',
      ],
    },
    {
      name: 'watch_job_lag_seconds',
      kind: 'GAUGE',
      requiredLabels: [
        'status',
      ],
    },
    {
      name: 'action_execution_total',
      kind: 'COUNTER',
      requiredLabels: [
        'intent',
        'execution_mode',
        'outcome',
      ],
    },
    {
      name: 'automation_run_total',
      kind: 'COUNTER',
      requiredLabels: [
        'outcome',
        'failure_category',
      ],
    },
    {
      name: 'secret_store_operation_total',
      kind: 'COUNTER',
      requiredLabels: [
        'operation',
        'purpose',
        'outcome',
      ],
      forbiddenLabels: [
        'secret_id',
        'ciphertext',
        'secret_value',
      ],
    },
    {
      name:
        'backup_recovery_point_age_seconds',
      kind: 'GAUGE',
      requiredLabels: [
        'component',
        'evidence_source',
      ],
    },
    {
      name:
        'recovery_validation_total',
      kind: 'COUNTER',
      requiredLabels: [
        'check',
        'outcome',
      ],
    },
    {
      name:
        'recovery_validation_age_seconds',
      kind: 'GAUGE',
      requiredLabels: [
        'validation',
      ],
    },
  ] as const;

export const OPERATIONAL_LOG_REQUIRED_FIELDS =
  [
    'timestamp',
    'level',
    'event_name',
    'component',
    'process_role',
    'outcome',
  ] as const;

export const OPERATIONAL_LOG_OPTIONAL_CORRELATION_FIELDS =
  [
    'request_id',
    'trace_id',
    'tenant_correlation_id',
    'job_id',
    'sync_run_id',
    'watch_job_id',
    'action_execution_id',
    'automation_run_id',
  ] as const;

export const OPERATIONAL_LOG_FORBIDDEN_FIELDS =
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
  ] as const;

export interface ReadinessRequirement {
  id: string;
  requiredFor: readonly (
    | 'WEB'
    | 'WORKER'
  )[];
  description: string;
}

export const PRODUCTION_READINESS_REQUIREMENTS:
  readonly ReadinessRequirement[] =
  [
    {
      id: 'PROCESS_ROLE_VALID',
      requiredFor: ['WEB', 'WORKER'],
      description:
        'Configured process role is valid for the selected entrypoint.',
    },
    {
      id: 'POSTGRES_REACHABLE',
      requiredFor: ['WEB', 'WORKER'],
      description:
        'PostgreSQL accepts a lightweight query within the readiness timeout.',
    },
    {
      id: 'SCHEMA_CURRENT',
      requiredFor: ['WEB', 'WORKER'],
      description:
        'Required production migrations/tables for the running build exist.',
    },
    {
      id: 'OBJECT_STORAGE_CONFIGURED',
      requiredFor: ['WEB', 'WORKER'],
      description:
        'Durable object-storage configuration is valid for source and derived payload access.',
    },
    {
      id: 'SECRET_KMS_CONFIGURED',
      requiredFor: ['WEB', 'WORKER'],
      description:
        'Shared SecretStore/KMS configuration is usable without exposing key material.',
    },
    {
      id: 'WORKER_HANDLERS_REGISTERED',
      requiredFor: ['WORKER'],
      description:
        'All production worker job types have registered handlers.',
    },
    {
      id: 'WORKER_LOOP_HEALTHY',
      requiredFor: ['WORKER'],
      description:
        'The worker runtime has completed or attempted a recent cycle and has not fatally stopped.',
    },
  ] as const;

export const RECOVERY_OBJECTIVES = {
  relationalState: {
    targetRpoMinutes: 5,
    targetRtoMinutes: 60,
  },
  objectPayloads: {
    targetRpoMinutes: 5,
    targetRtoMinutes: 60,
    minimumRecoverableDeleteWindowDays: 30,
  },
  secretMetadata: {
    targetRpoMinutes: 5,
    targetRtoMinutes: 60,
  },
  workerJobs: {
    targetRpoMinutes: 0,
    targetRtoMinutes: 15,
  },
  restoreValidation: {
    automatedRestoreTestAtLeastEveryDays: 30,
    fullRecoveryExerciseAtLeastEveryDays: 90,
  },
} as const;

export const DEGRADED_MODE_EXPECTATIONS = {
  llmProviderUnavailable:
    'Keep deterministic/evidence-only capabilities available where supported; never fabricate a provider response.',
  integrationProviderUnavailable:
    'Keep already imported knowledge usable, retry durable sync jobs, and never advance provider checkpoints on failure.',
  objectStorageUnavailable:
    'Reject or degrade source/payload-dependent workflows truthfully; do not mark writes successful without durable bytes.',
  postgresUnavailable:
    'Web and worker readiness must fail; do not accept stateful work that cannot be committed durably.',
  secretStoreOrKmsUnavailable:
    'Fail Integration credential resolution closed, retry only when safe, and never fall back to plaintext/local credentials in production.',
} as const;
