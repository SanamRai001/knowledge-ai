import {
  Pool,
} from 'pg';
import {
  sourceStorageRuntimeConfig,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  S3SourceByteStorage,
} from '../server/storage/s3SourceByteStorage.js';
import {
  secretKeyringRuntimeConfig,
} from '../server/security/versionedAesGcmKmsService.js';
import {
  EnvRecoveryEvidenceProvider,
  recoveryTargetConfig,
  recoveryTargetS3Config,
} from '../server/operations/recovery/recoveryRuntimeConfig.js';
import {
  S3RecoveryObjectStorageInspector,
} from '../server/operations/recovery/s3RecoveryObjectStorageInspector.js';
import {
  IsolatedRestoreVerifier,
} from '../server/operations/recovery/isolatedRestoreVerifier.js';
import {
  RecoveryDrillService,
} from '../server/operations/recovery/recoveryDrillService.js';

async function main() {
  const target =
    recoveryTargetConfig();
  const recoveryS3 =
    recoveryTargetS3Config();
  const productionStorage =
    sourceStorageRuntimeConfig();

  const sslMode =
    process.env
      .KNOWLEDGE_AI_RECOVERY_DATABASE_SSL
      ?.trim()
      .toLowerCase() ||
    'disable';

  const pool = new Pool({
    connectionString:
      target.databaseUrl,
    max: 1,
    application_name:
      'knowledge-ai-recovery-validator',
    ssl:
      sslMode === 'require'
        ? {
            rejectUnauthorized:
              false,
          }
        : false,
  });

  try {
    const verifier =
      new IsolatedRestoreVerifier(
        pool,
        new S3SourceByteStorage(
          recoveryS3
        ),
        secretKeyringRuntimeConfig()
      );

    const service =
      new RecoveryDrillService(
        new EnvRecoveryEvidenceProvider(),
        new S3RecoveryObjectStorageInspector(
          productionStorage.s3
        ),
        verifier
      );

    const report =
      await service.run(target);

    console.log(
      JSON.stringify(
        {
          valid: report.valid,
          targetEnvironment:
            report.targetEnvironment,
          checkedAt:
            report.checkedAt,
          buildId:
            report.buildId,
          recoveryPointAt:
            report.recoveryPointAt,
          checks:
            report.checks,
          smoke:
            report.smoke,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: any) => {
  console.error(
    JSON.stringify({
      valid: false,
      errorCode:
        String(
          error?.code ||
            error?.name ||
            'RECOVERY_VALIDATION_FAILED'
        ).slice(0, 120),
      message:
        String(
          error?.message ||
            'Recovery validation failed.'
        ).slice(0, 500),
    })
  );
  process.exit(1);
});
