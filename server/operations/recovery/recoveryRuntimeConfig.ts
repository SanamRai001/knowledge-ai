import {
  SourceStorageConfigurationError,
} from '../../storage/sourceByteStorageRuntime.js';
import type {
  S3SourceByteStorageConfig,
} from '../../storage/s3SourceByteStorage.js';
import {
  RecoveryValidationError,
  type ExternalRestoreEvidence,
  type RecoveryEvidenceProvider,
  type RecoveryTarget,
  type RecoveryTargetEnvironment,
  type RelationalBackupEvidence,
} from './recoveryContracts.js';

const SAFE_TARGETS:
  readonly RecoveryTargetEnvironment[] =
  ['recovery', 'staging', 'test'];

function required(
  env: NodeJS.ProcessEnv,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new RecoveryValidationError(
      'RECOVERY_CONFIGURATION_MISSING',
      name + ' is required for recovery validation.'
    );
  }
  return value;
}

function parseJsonObject(
  raw: string,
  label: string
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RecoveryValidationError(
      'RECOVERY_EVIDENCE_INVALID',
      label + ' must be valid JSON.'
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new RecoveryValidationError(
      'RECOVERY_EVIDENCE_INVALID',
      label + ' must be a JSON object.'
    );
  }

  return parsed as Record<
    string,
    unknown
  >;
}

function finiteNumber(
  value: unknown,
  label: string
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RecoveryValidationError(
      'RECOVERY_EVIDENCE_INVALID',
      label + ' must be a finite number.'
    );
  }
  return number;
}

function databaseIdentity(
  raw: string
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RecoveryValidationError(
      'RECOVERY_TARGET_INVALID',
      'Recovery database URL is invalid.'
    );
  }

  const port =
    url.port ||
    (url.protocol === 'postgres:'
      ? '5432'
      : '');

  return [
    url.protocol,
    url.hostname.toLowerCase(),
    port,
    url.pathname,
  ].join('|');
}

export function recoveryTargetConfig(
  env: NodeJS.ProcessEnv =
    process.env
): RecoveryTarget {
  if (
    env.KNOWLEDGE_AI_RECOVERY_ALLOW
      ?.trim()
      .toLowerCase() !== 'true'
  ) {
    throw new RecoveryValidationError(
      'RECOVERY_NOT_AUTHORIZED',
      'KNOWLEDGE_AI_RECOVERY_ALLOW=true is required before isolated restore validation.'
    );
  }

  const environment =
    required(
      env,
      'KNOWLEDGE_AI_RECOVERY_TARGET_ENV'
    ) as RecoveryTargetEnvironment;

  if (
    !SAFE_TARGETS.includes(
      environment
    )
  ) {
    throw new RecoveryValidationError(
      'RECOVERY_PRODUCTION_TARGET_BLOCKED',
      'Recovery target environment must be recovery, staging, or test.'
    );
  }

  const databaseUrl = required(
    env,
    'KNOWLEDGE_AI_RECOVERY_DATABASE_URL'
  );
  const productionUrl =
    env.DATABASE_URL?.trim();

  if (
    productionUrl &&
    databaseIdentity(productionUrl) ===
      databaseIdentity(databaseUrl)
  ) {
    throw new RecoveryValidationError(
      'RECOVERY_PRODUCTION_TARGET_BLOCKED',
      'Recovery target database must not be the configured production database.'
    );
  }

  const storageBackend =
    required(
      env,
      'KNOWLEDGE_AI_RECOVERY_STORAGE_BACKEND'
    ).toLowerCase();

  if (storageBackend !== 's3') {
    throw new RecoveryValidationError(
      'RECOVERY_STORAGE_UNSUPPORTED',
      'G3 recovery validation currently supports the S3-compatible recovery adapter only.'
    );
  }

  const storageBucket = required(
    env,
    'KNOWLEDGE_AI_RECOVERY_STORAGE_BUCKET'
  );
  const productionBucket =
    env.SOURCE_STORAGE_BUCKET?.trim();

  if (
    productionBucket &&
    productionBucket ===
      storageBucket
  ) {
    throw new RecoveryValidationError(
      'RECOVERY_PRODUCTION_TARGET_BLOCKED',
      'Recovery target object bucket must be distinct from the configured production source bucket.'
    );
  }

  return {
    environment,
    databaseUrl,
    storageBackend,
    storageBucket,
    buildId: required(
      env,
      'KNOWLEDGE_AI_BUILD_ID'
    ),
  };
}

export function recoveryTargetS3Config(
  env: NodeJS.ProcessEnv =
    process.env
): S3SourceByteStorageConfig {
  const bucket = required(
    env,
    'KNOWLEDGE_AI_RECOVERY_STORAGE_BUCKET'
  );
  const region = required(
    env,
    'KNOWLEDGE_AI_RECOVERY_STORAGE_REGION'
  );
  const endpoint =
    env.KNOWLEDGE_AI_RECOVERY_STORAGE_ENDPOINT
      ?.trim() || undefined;
  const accessKeyId =
    env.KNOWLEDGE_AI_RECOVERY_STORAGE_ACCESS_KEY_ID
      ?.trim() || undefined;
  const secretAccessKey =
    env.KNOWLEDGE_AI_RECOVERY_STORAGE_SECRET_ACCESS_KEY
      ?.trim() || undefined;

  if (
    Boolean(accessKeyId) !==
    Boolean(secretAccessKey)
  ) {
    throw new SourceStorageConfigurationError(
      'Recovery storage access key ID and secret access key must be provided together.'
    );
  }

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle:
      env.KNOWLEDGE_AI_RECOVERY_STORAGE_FORCE_PATH_STYLE
        ?.trim()
        .toLowerCase() === 'true',
  };
}

function parseRelationalEvidence(
  raw: string
): RelationalBackupEvidence {
  const value = parseJsonObject(
    raw,
    'KNOWLEDGE_AI_RECOVERY_RELATIONAL_EVIDENCE_JSON'
  );

  return {
    evidenceSource:
      String(
        value.evidenceSource ||
          'external-backup-control-plane'
      ).slice(0, 120),
    checkedAt: finiteNumber(
      value.checkedAt,
      'relational checkedAt'
    ),
    latestRecoveryPointAt:
      finiteNumber(
        value.latestRecoveryPointAt,
        'relational latestRecoveryPointAt'
      ),
    continuousBackupEnabled:
      value.continuousBackupEnabled ===
      true,
    pitrEnabled:
      value.pitrEnabled === true,
    estimatedRestoreMinutes:
      finiteNumber(
        value.estimatedRestoreMinutes,
        'relational estimatedRestoreMinutes'
      ),
    backupBuildId: String(
      value.backupBuildId || ''
    ).trim(),
  };
}

function parseExternalRestoreEvidence(
  raw: string
): ExternalRestoreEvidence {
  const value = parseJsonObject(
    raw,
    'KNOWLEDGE_AI_RECOVERY_RESTORE_EVIDENCE_JSON'
  );

  return {
    evidenceSource:
      String(
        value.evidenceSource ||
          'external-restore-control-plane'
      ).slice(0, 120),
    restoredAt: finiteNumber(
      value.restoredAt,
      'restore restoredAt'
    ),
    recoveryPointAt:
      finiteNumber(
        value.recoveryPointAt,
        'restore recoveryPointAt'
      ),
    backupBuildId: String(
      value.backupBuildId || ''
    ).trim(),
  };
}

export class EnvRecoveryEvidenceProvider
  implements RecoveryEvidenceProvider
{
  constructor(
    private readonly env:
      NodeJS.ProcessEnv =
        process.env
  ) {}

  async relationalBackup():
    Promise<RelationalBackupEvidence> {
    return parseRelationalEvidence(
      required(
        this.env,
        'KNOWLEDGE_AI_RECOVERY_RELATIONAL_EVIDENCE_JSON'
      )
    );
  }

  async externalRestore():
    Promise<ExternalRestoreEvidence> {
    return parseExternalRestoreEvidence(
      required(
        this.env,
        'KNOWLEDGE_AI_RECOVERY_RESTORE_EVIDENCE_JSON'
      )
    );
  }
}
