import {
  validateEnvironmentSeparation,
  type ReleaseEnvironmentIdentity,
} from './releaseGate.js';
import {
  sourceStorageRuntimeConfig,
} from '../storage/sourceByteStorageRuntime.js';
import {
  secretKeyringRuntimeConfig,
} from '../security/versionedAesGcmKmsService.js';

export class StagingPreflightError
  extends Error
{
  readonly code: string;

  constructor(
    code: string,
    message: string
  ) {
    super(message);
    this.name =
      'StagingPreflightError';
    this.code = code;
  }
}

export interface StagingPreflightResult {
  ready: true;
  environment: 'staging';
  publicOrigin: string;
  databaseIdentity: string;
  objectBucket: string;
  secretBoundary: string;
  storageBackend: 's3';
  activeSecretKeyId: string;
  runtimes: {
    web: string;
    worker: string;
    migration: string;
  };
}

function required(
  value: string | undefined,
  label: string
): string {
  const normalized =
    value?.trim() || '';
  if (!normalized) {
    throw new StagingPreflightError(
      'STAGING_CONFIG_MISSING',
      label + ' is required.'
    );
  }
  return normalized;
}

function parseIdentity(
  raw: string | undefined,
  label: string
): ReleaseEnvironmentIdentity {
  const serialized =
    required(raw, label);

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new StagingPreflightError(
      'STAGING_IDENTITY_INVALID',
      label +
        ' must be valid JSON.'
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new StagingPreflightError(
      'STAGING_IDENTITY_INVALID',
      label +
        ' must be a JSON object.'
    );
  }

  const source =
    parsed as Record<
      string,
      unknown
    >;

  const identity:
    ReleaseEnvironmentIdentity = {
      database:
        required(
          typeof source.database ===
            'string'
            ? source.database
            : undefined,
          label + '.database'
        ),
      objectBucket:
        required(
          typeof source.objectBucket ===
            'string'
            ? source.objectBucket
            : undefined,
          label + '.objectBucket'
        ),
      secretBoundary:
        required(
          typeof source.secretBoundary ===
            'string'
            ? source.secretBoundary
            : undefined,
          label + '.secretBoundary'
        ),
      publicOrigin:
        required(
          typeof source.publicOrigin ===
            'string'
            ? source.publicOrigin
            : undefined,
          label + '.publicOrigin'
        ),
      webRuntime:
        required(
          typeof source.webRuntime ===
            'string'
            ? source.webRuntime
            : undefined,
          label + '.webRuntime'
        ),
      workerRuntime:
        required(
          typeof source.workerRuntime ===
            'string'
            ? source.workerRuntime
            : undefined,
          label + '.workerRuntime'
        ),
      migrationRuntime:
        required(
          typeof source.migrationRuntime ===
            'string'
            ? source.migrationRuntime
            : undefined,
          label + '.migrationRuntime'
        ),
    };

  return identity;
}

function assertManagedDatabase(
  raw: string
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StagingPreflightError(
      'STAGING_DATABASE_INVALID',
      'DATABASE_URL must be a valid PostgreSQL URL.'
    );
  }

  if (
    url.protocol !== 'postgres:' &&
    url.protocol !== 'postgresql:'
  ) {
    throw new StagingPreflightError(
      'STAGING_DATABASE_INVALID',
      'DATABASE_URL must use the postgres/postgresql protocol.'
    );
  }

  const host =
    url.hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1'
  ) {
    throw new StagingPreflightError(
      'STAGING_DATABASE_LOCAL_FORBIDDEN',
      'L1 requires a real managed/non-local staging PostgreSQL target.'
    );
  }
}

function assertDistinctRuntimes(
  identity:
    ReleaseEnvironmentIdentity
): void {
  const values = [
    identity.webRuntime,
    identity.workerRuntime,
    identity.migrationRuntime,
  ].map((value) =>
    value.trim()
  );

  if (
    new Set(values).size !==
    values.length
  ) {
    throw new StagingPreflightError(
      'STAGING_RUNTIME_ROLES_NOT_SEPARATED',
      'Staging web, worker, and migration runtime identities must be distinct.'
    );
  }
}

export function validateStagingPreflight(
  env: NodeJS.ProcessEnv =
    process.env
): StagingPreflightResult {
  if (
    required(
      env.NODE_ENV,
      'NODE_ENV'
    ) !== 'production'
  ) {
    throw new StagingPreflightError(
      'STAGING_NODE_ENV_INVALID',
      'L1 staging must run with NODE_ENV=production.'
    );
  }

  if (
    required(
      env.KNOWLEDGE_AI_PERSISTENCE_MODE,
      'KNOWLEDGE_AI_PERSISTENCE_MODE'
    ) !== 'postgres'
  ) {
    throw new StagingPreflightError(
      'STAGING_PERSISTENCE_INVALID',
      'L1 staging must use PostgreSQL-authoritative persistence.'
    );
  }

  assertManagedDatabase(
    required(
      env.DATABASE_URL,
      'DATABASE_URL'
    )
  );

  if (
    required(
      env.SOURCE_STORAGE_BACKEND,
      'SOURCE_STORAGE_BACKEND'
    ).toLowerCase() !== 's3'
  ) {
    throw new StagingPreflightError(
      'STAGING_STORAGE_BACKEND_INVALID',
      'L1 staging must explicitly configure SOURCE_STORAGE_BACKEND=s3.'
    );
  }

  const storage =
    sourceStorageRuntimeConfig(env);
  const keyring =
    secretKeyringRuntimeConfig(env);

  const staging =
    parseIdentity(
      env.KNOWLEDGE_AI_STAGING_IDENTITY_JSON,
      'KNOWLEDGE_AI_STAGING_IDENTITY_JSON'
    );
  const production =
    parseIdentity(
      env.KNOWLEDGE_AI_PRODUCTION_IDENTITY_JSON,
      'KNOWLEDGE_AI_PRODUCTION_IDENTITY_JSON'
    );

  validateEnvironmentSeparation(
    staging,
    production
  );
  assertDistinctRuntimes(
    staging
  );

  const publicOrigin =
    required(
      env.KNOWLEDGE_AI_PUBLIC_ORIGIN,
      'KNOWLEDGE_AI_PUBLIC_ORIGIN'
    );

  if (
    staging.publicOrigin !==
    publicOrigin
  ) {
    throw new StagingPreflightError(
      'STAGING_PUBLIC_ORIGIN_MISMATCH',
      'Staging identity publicOrigin must exactly match KNOWLEDGE_AI_PUBLIC_ORIGIN.'
    );
  }

  if (
    staging.objectBucket !==
    storage.s3.bucket
  ) {
    throw new StagingPreflightError(
      'STAGING_OBJECT_BUCKET_MISMATCH',
      'Staging identity objectBucket must exactly match SOURCE_STORAGE_BUCKET.'
    );
  }

  return {
    ready: true,
    environment: 'staging',
    publicOrigin,
    databaseIdentity:
      staging.database,
    objectBucket:
      staging.objectBucket,
    secretBoundary:
      staging.secretBoundary,
    storageBackend: 's3',
    activeSecretKeyId:
      keyring.activeKeyId,
    runtimes: {
      web: staging.webRuntime,
      worker:
        staging.workerRuntime,
      migration:
        staging.migrationRuntime,
    },
  };
}
