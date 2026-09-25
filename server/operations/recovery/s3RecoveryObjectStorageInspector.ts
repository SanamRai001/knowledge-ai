import {
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  S3SourceByteStorageConfig,
} from '../../storage/s3SourceByteStorage.js';
import {
  RecoveryValidationError,
  type ObjectStorageProtectionEvidence,
  type ObjectStorageRecoveryInspector,
} from './recoveryContracts.js';

function clientFor(
  config: S3SourceByteStorageConfig
): S3Client {
  return new S3Client({
    region: config.region,
    endpoint:
      config.endpoint?.trim() ||
      undefined,
    forcePathStyle:
      Boolean(
        config.forcePathStyle
      ),
    credentials:
      config.accessKeyId &&
      config.secretAccessKey
        ? {
            accessKeyId:
              config.accessKeyId,
            secretAccessKey:
              config.secretAccessKey,
          }
        : undefined,
  });
}

function noLifecycle(
  error: any
): boolean {
  const code = String(
    error?.name ||
      error?.Code ||
      error?.code ||
      ''
  );
  return (
    code ===
      'NoSuchLifecycleConfiguration' ||
    code ===
      'NoSuchLifecycle'
  );
}

export class S3RecoveryObjectStorageInspector
  implements ObjectStorageRecoveryInspector
{
  private readonly client: S3Client;

  constructor(
    private readonly config:
      S3SourceByteStorageConfig
  ) {
    this.client =
      clientFor(config);
  }

  async inspect():
    Promise<ObjectStorageProtectionEvidence> {
    const bucket =
      this.config.bucket.trim();
    if (!bucket) {
      throw new RecoveryValidationError(
        'OBJECT_RECOVERY_POLICY_UNVERIFIABLE',
        'S3 recovery policy inspection requires a bucket.'
      );
    }

    let versioning;
    try {
      versioning =
        await this.client.send(
          new GetBucketVersioningCommand({
            Bucket: bucket,
          })
        );
    } catch (error: any) {
      throw new RecoveryValidationError(
        'OBJECT_RECOVERY_POLICY_UNVERIFIABLE',
        'Object-storage versioning state could not be verified: ' +
          String(
            error?.name ||
              error?.code ||
              'S3_VERSIONING_CHECK_FAILED'
          )
      );
    }

    const versioningEnabled =
      versioning.Status ===
      'Enabled';

    if (!versioningEnabled) {
      return {
        evidenceSource:
          's3-control-plane',
        checkedAt: Date.now(),
        backend: 's3',
        versioningEnabled: false,
        recoverableDeleteWindowDays:
          0,
        detailCode:
          versioning.Status ===
          'Suspended'
            ? 'VERSIONING_SUSPENDED'
            : 'VERSIONING_DISABLED',
      };
    }

    let rules: any[] = [];
    try {
      const lifecycle =
        await this.client.send(
          new GetBucketLifecycleConfigurationCommand({
            Bucket: bucket,
          })
        );
      rules =
        lifecycle.Rules || [];
    } catch (error: any) {
      if (!noLifecycle(error)) {
        throw new RecoveryValidationError(
          'OBJECT_RECOVERY_POLICY_UNVERIFIABLE',
          'Object-storage lifecycle state could not be verified: ' +
            String(
              error?.name ||
                error?.code ||
                'S3_LIFECYCLE_CHECK_FAILED'
            )
        );
      }
    }

    const expiryDays = rules
      .filter(
        (rule) =>
          rule?.Status ===
          'Enabled'
      )
      .map(
        (rule) =>
          Number(
            rule
              ?.NoncurrentVersionExpiration
              ?.NoncurrentDays
          )
      )
      .filter(
        (days) =>
          Number.isFinite(days) &&
          days >= 0
      );

    const recoverableDeleteWindowDays =
      expiryDays.length === 0
        ? null
        : Math.min(
            ...expiryDays
          );

    return {
      evidenceSource:
        's3-control-plane',
      checkedAt: Date.now(),
      backend: 's3',
      versioningEnabled: true,
      recoverableDeleteWindowDays,
      detailCode:
        recoverableDeleteWindowDays ===
          null
          ? 'NONCURRENT_VERSIONS_UNBOUNDED'
          : 'NONCURRENT_VERSION_EXPIRY_CONFIGURED',
    };
  }
}
