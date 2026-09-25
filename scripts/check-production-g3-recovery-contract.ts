import fs from 'fs';
import {
  recoveryTargetConfig,
} from '../server/operations/recovery/recoveryRuntimeConfig.js';
import {
  validateRecoveryEvidence,
} from '../server/operations/recovery/recoveryEvidenceService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function read(path: string): string {
  return fs.readFileSync(
    path,
    'utf8'
  );
}

function snapshotEnv(
  names: string[]
): Map<string, string | undefined> {
  return new Map(
    names.map(
      (name) => [
        name,
        process.env[name],
      ]
    )
  );
}

function restoreEnv(
  snapshot:
    Map<string, string | undefined>
): void {
  for (const [name, value] of snapshot) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

async function main() {
  const metrics = read(
    'server/operations/productionOperationsContract.ts'
  );
  for (const name of [
    'backup_recovery_point_age_seconds',
    'recovery_validation_total',
    'recovery_validation_age_seconds',
  ]) {
    assert(
      metrics.includes(
        "'" + name + "'"
      ),
      'G3 must surface recovery evidence through the G2 telemetry contract: ' +
        name
    );
  }

  const inspector = read(
    'server/operations/recovery/s3RecoveryObjectStorageInspector.ts'
  );
  assert(
    inspector.includes(
      'GetBucketVersioningCommand'
    ) &&
      inspector.includes(
        'GetBucketLifecycleConfigurationCommand'
      ) &&
      inspector.includes(
        'NoncurrentVersionExpiration'
      ),
    'G3 object recovery verification must inspect real S3-compatible versioning/lifecycle state.'
  );

  const verifier = read(
    'server/operations/recovery/isolatedRestoreVerifier.ts'
  );
  for (const sqlMutation of [
    'INSERT INTO',
    'UPDATE ',
    'DELETE FROM',
    'TRUNCATE ',
    'ALTER TABLE',
    'CREATE TABLE',
  ]) {
    assert(
      !verifier.includes(
        sqlMutation
      ),
      'G3 isolated restore verifier must remain read-only: ' +
        sqlMutation
    );
  }

  assert(
    verifier.includes(
      'account_secret_versions'
    ) &&
      verifier.includes(
        'VersionedAesGcmKmsService'
      ) &&
      verifier.includes(
        'document_derived_payloads'
      ) &&
      verifier.includes(
        'dataset_versions'
      ) &&
      verifier.includes(
        'worker_jobs'
      ),
    'G3 restore verification must cover SecretStore, document/Dataset payloads, and durable worker jobs.'
  );

  const cli = read(
    'scripts/recovery-validate.ts'
  );
  for (const forbidden of [
    'workerJobRuntime',
    'GeminiProvider',
    'integrationRuntimeService',
    '.put(',
    '.delete(',
  ]) {
    assert(
      !cli.includes(forbidden),
      'G3 recovery drill must not execute production work or mutate restored objects: ' +
        forbidden
    );
  }

  const envNames = [
    'KNOWLEDGE_AI_RECOVERY_ALLOW',
    'KNOWLEDGE_AI_RECOVERY_TARGET_ENV',
    'KNOWLEDGE_AI_RECOVERY_DATABASE_URL',
    'KNOWLEDGE_AI_RECOVERY_STORAGE_BACKEND',
    'KNOWLEDGE_AI_RECOVERY_STORAGE_BUCKET',
    'KNOWLEDGE_AI_BUILD_ID',
    'DATABASE_URL',
    'SOURCE_STORAGE_BUCKET',
  ];
  const before =
    snapshotEnv(envNames);

  try {
    process.env
      .KNOWLEDGE_AI_RECOVERY_ALLOW =
      'true';
    process.env
      .KNOWLEDGE_AI_RECOVERY_TARGET_ENV =
      'production';
    process.env
      .KNOWLEDGE_AI_RECOVERY_DATABASE_URL =
      'postgres://recovery@db/recovery';
    process.env
      .KNOWLEDGE_AI_RECOVERY_STORAGE_BACKEND =
      's3';
    process.env
      .KNOWLEDGE_AI_RECOVERY_STORAGE_BUCKET =
      'recovery-bucket';
    process.env.KNOWLEDGE_AI_BUILD_ID =
      'build-g3';

    let productionBlocked = false;
    try {
      recoveryTargetConfig();
    } catch (error: any) {
      productionBlocked =
        error?.code ===
        'RECOVERY_PRODUCTION_TARGET_BLOCKED';
    }
    assert(
      productionBlocked,
      'G3 must fail closed against a production restore target.'
    );

    process.env
      .KNOWLEDGE_AI_RECOVERY_TARGET_ENV =
      'recovery';
    process.env.DATABASE_URL =
      'postgres://prod@db/prod';
    process.env
      .KNOWLEDGE_AI_RECOVERY_DATABASE_URL =
      'postgres://other@db/prod';

    let sameDatabaseBlocked = false;
    try {
      recoveryTargetConfig();
    } catch (error: any) {
      sameDatabaseBlocked =
        error?.code ===
        'RECOVERY_PRODUCTION_TARGET_BLOCKED';
    }
    assert(
      sameDatabaseBlocked,
      'G3 must compare database identity without relying on credential differences.'
    );

    process.env
      .KNOWLEDGE_AI_RECOVERY_DATABASE_URL =
      'postgres://recovery@db/recovery';
    process.env.SOURCE_STORAGE_BUCKET =
      'production-bucket';
    process.env
      .KNOWLEDGE_AI_RECOVERY_STORAGE_BUCKET =
      'production-bucket';

    let sameBucketBlocked = false;
    try {
      recoveryTargetConfig();
    } catch (error: any) {
      sameBucketBlocked =
        error?.code ===
        'RECOVERY_PRODUCTION_TARGET_BLOCKED';
    }
    assert(
      sameBucketBlocked,
      'G3 must reject validation against the production object bucket.'
    );

    process.env
      .KNOWLEDGE_AI_RECOVERY_STORAGE_BUCKET =
      'recovery-bucket';
    const safeTarget =
      recoveryTargetConfig();
    assert(
      safeTarget.environment ===
        'recovery' &&
        safeTarget.storageBucket ===
          'recovery-bucket',
      'G3 must accept an explicitly authorized isolated recovery target.'
    );
  } finally {
    restoreEnv(before);
  }

  const now = Date.now();
  const good =
    validateRecoveryEvidence({
      relational: {
        evidenceSource:
          'test-backup',
        checkedAt: now,
        latestRecoveryPointAt:
          now - 60_000,
        continuousBackupEnabled:
          true,
        pitrEnabled: true,
        estimatedRestoreMinutes:
          30,
        backupBuildId:
          'build-g3',
      },
      objectStorage: {
        evidenceSource:
          'test-object-policy',
        checkedAt: now,
        backend: 's3',
        versioningEnabled: true,
        recoverableDeleteWindowDays:
          30,
      },
      restore: {
        evidenceSource:
          'test-restore',
        restoredAt:
          now - 30_000,
        recoveryPointAt:
          now - 60_000,
        backupBuildId:
          'build-g3',
      },
      buildId: 'build-g3',
      now,
    });

  assert(
    good.valid,
    'G3 evidence at the 5-minute RPO / 60-minute RTO / 30-day delete-window targets must pass.'
  );

  const bad =
    validateRecoveryEvidence({
      relational: {
        evidenceSource:
          'test-backup',
        checkedAt: now,
        latestRecoveryPointAt:
          now - 10 * 60_000,
        continuousBackupEnabled:
          true,
        pitrEnabled: true,
        estimatedRestoreMinutes:
          90,
        backupBuildId:
          'wrong-build',
      },
      objectStorage: {
        evidenceSource:
          'test-object-policy',
        checkedAt: now,
        backend: 's3',
        versioningEnabled: true,
        recoverableDeleteWindowDays:
          7,
      },
      restore: {
        evidenceSource:
          'test-restore',
        restoredAt: now,
        recoveryPointAt:
          now - 10 * 60_000,
        backupBuildId:
          'wrong-build',
      },
      buildId: 'build-g3',
      now,
    });

  assert(
    !bad.valid &&
      bad.checks.some(
        (item) =>
          item.id ===
            'RELATIONAL_RPO' &&
          item.status === 'FAIL'
      ) &&
      bad.checks.some(
        (item) =>
          item.id ===
            'OBJECT_RECOVERABLE_DELETE_WINDOW' &&
          item.status === 'FAIL'
      ),
    'G3 must fail stale recovery points, RTO drift, build mismatch, and short recoverable-delete policy.'
  );

  console.log(
    'PRODUCTION_G3_RECOVERY_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Fail-closed isolated targets, real object-policy inspection, read-only restore verification, RPO/RTO/build/retention evidence, and G2 telemetry integration are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_G3_RECOVERY_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
