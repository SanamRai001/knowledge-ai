import {
  StagingPreflightError,
  validateStagingPreflight,
} from '../server/deployment/stagingPreflight.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function key(): string {
  return Buffer.alloc(
    32,
    7
  ).toString('base64');
}

function validEnv():
  NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    KNOWLEDGE_AI_PERSISTENCE_MODE:
      'postgres',
    DATABASE_URL:
      'postgresql://staging-user:secret@staging-db.internal:5432/knowledge_ai',
    DATABASE_SSL: 'require',
    KNOWLEDGE_AI_PUBLIC_ORIGIN:
      'https://staging.knowledge.example',
    SOURCE_STORAGE_BACKEND:
      's3',
    SOURCE_STORAGE_BUCKET:
      'knowledge-ai-staging',
    SOURCE_STORAGE_REGION:
      'us-east-1',
    SOURCE_STORAGE_ACCESS_KEY_ID:
      'staging-access-key',
    SOURCE_STORAGE_SECRET_ACCESS_KEY:
      'staging-secret-key',
    SOURCE_STORAGE_FORCE_PATH_STYLE:
      'false',
    KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID:
      'staging-key-v1',
    KNOWLEDGE_AI_SECRET_KEYRING_JSON:
      JSON.stringify({
        'staging-key-v1': key(),
      }),
    KNOWLEDGE_AI_STAGING_IDENTITY_JSON:
      JSON.stringify({
        database:
          'managed-postgres-staging',
        objectBucket:
          'knowledge-ai-staging',
        secretBoundary:
          'staging-kms-boundary',
        publicOrigin:
          'https://staging.knowledge.example',
        webRuntime:
          'staging-web-service',
        workerRuntime:
          'staging-worker-service',
        migrationRuntime:
          'staging-migration-job',
      }),
    KNOWLEDGE_AI_PRODUCTION_IDENTITY_JSON:
      JSON.stringify({
        database:
          'managed-postgres-production',
        objectBucket:
          'knowledge-ai-production',
        secretBoundary:
          'production-kms-boundary',
        publicOrigin:
          'https://knowledge.example',
        webRuntime:
          'production-web-service',
        workerRuntime:
          'production-worker-service',
        migrationRuntime:
          'production-migration-job',
      }),
  };
}

function expectFailure(
  env: NodeJS.ProcessEnv,
  code?: string
): void {
  let failed = false;

  try {
    validateStagingPreflight(
      env
    );
  } catch (error) {
    failed = true;

    if (code) {
      assert(
        error instanceof
          StagingPreflightError &&
          error.code === code,
        'Expected staging preflight error code ' +
          code +
          '.'
      );
    }
  }

  assert(
    failed,
    'Expected staging preflight to fail.'
  );
}

async function main() {
  const env = validEnv();
  const result =
    validateStagingPreflight(
      env
    );

  assert(
    result.ready === true &&
      result.environment ===
        'staging' &&
      result.objectBucket ===
        'knowledge-ai-staging' &&
      result.runtimes.web !==
        result.runtimes.worker &&
      result.runtimes.worker !==
        result.runtimes.migration,
    'Valid managed staging configuration must pass.'
  );

  const serialized =
    JSON.stringify(result);
  assert(
    !serialized.includes(
      'staging-user'
    ) &&
      !serialized.includes(
        'staging-secret-key'
      ) &&
      !serialized.includes(
        key()
      ),
    'Sanitized staging preflight output must not expose database/object/KMS secret material.'
  );

  expectFailure(
    {
      ...validEnv(),
      NODE_ENV: 'development',
    },
    'STAGING_NODE_ENV_INVALID'
  );

  expectFailure(
    {
      ...validEnv(),
      KNOWLEDGE_AI_PERSISTENCE_MODE:
        'file',
    },
    'STAGING_PERSISTENCE_INVALID'
  );

  expectFailure(
    {
      ...validEnv(),
      DATABASE_URL:
        'postgresql://postgres:postgres@127.0.0.1:5432/test',
    },
    'STAGING_DATABASE_LOCAL_FORBIDDEN'
  );

  const sameBucket =
    validEnv();
  sameBucket.KNOWLEDGE_AI_PRODUCTION_IDENTITY_JSON =
    JSON.stringify({
      ...JSON.parse(
        sameBucket
          .KNOWLEDGE_AI_PRODUCTION_IDENTITY_JSON!
      ),
      objectBucket:
        'knowledge-ai-staging',
    });
  expectFailure(
    sameBucket
  );

  expectFailure(
    {
      ...validEnv(),
      KNOWLEDGE_AI_PUBLIC_ORIGIN:
        'https://wrong.example',
    },
    'STAGING_PUBLIC_ORIGIN_MISMATCH'
  );

  const sharedRuntime =
    validEnv();
  const identity = JSON.parse(
    sharedRuntime
      .KNOWLEDGE_AI_STAGING_IDENTITY_JSON!
  );
  identity.workerRuntime =
    identity.webRuntime;
  sharedRuntime.KNOWLEDGE_AI_STAGING_IDENTITY_JSON =
    JSON.stringify(identity);
  expectFailure(
    sharedRuntime,
    'STAGING_RUNTIME_ROLES_NOT_SEPARATED'
  );

  console.log(
    'LAUNCH_L1_STAGING_PREFLIGHT_CHECK_PASSED'
  );
  console.log(
    'Managed PostgreSQL, durable object storage, SecretStore/KMS, HTTPS origin, staging/production separation, runtime-role separation, and secret-redacted output are verified.'
  );
}

main().catch((error) => {
  console.error(
    'LAUNCH_L1_STAGING_PREFLIGHT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
