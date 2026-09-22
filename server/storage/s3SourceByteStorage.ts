import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  verifySourceIntegrity,
  type SourceBytePutInput,
  type SourceByteStorage,
  type StoredByteObject,
} from './sourceByteStorage.js';

export interface S3SourceByteStorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

function required(
  value: string | undefined,
  label: string
): string {
  const trimmed = value?.trim() || '';
  if (!trimmed) {
    throw new Error(label + ' is required.');
  }
  return trimmed;
}

export class S3SourceByteStorage
  implements SourceByteStorage
{
  readonly backend = 's3';
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: S3SourceByteStorageConfig) {
    this.bucket = required(
      config.bucket,
      'S3 source bucket'
    );
    const region = required(
      config.region,
      'S3 source region'
    );

    if (
      Boolean(config.accessKeyId) !==
      Boolean(config.secretAccessKey)
    ) {
      throw new Error(
        'S3 source access key ID and secret access key must be provided together.'
      );
    }

    this.client = new S3Client({
      region,
      endpoint: config.endpoint?.trim() || undefined,
      forcePathStyle: Boolean(
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

  async put(
    input: SourceBytePutInput
  ): Promise<StoredByteObject> {
    const integrity = verifySourceIntegrity({
      bytes: input.bytes,
      expectedSizeBytes:
        input.expectedSizeBytes,
      expectedSha256:
        input.expectedSha256,
    });

    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.bytes,
        ContentType: input.contentType,
        Metadata: {
          sha256: integrity.sha256,
        },
      })
    );

    return {
      backend: this.backend,
      key: input.key,
      sizeBytes: integrity.sizeBytes,
      sha256: integrity.sha256,
      etag: response.ETag
        ? response.ETag.replace(
            /^"|"$/g,
            ''
          )
        : undefined,
    };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error(
        'Stored source object returned no body.'
      );
    }

    const body = response.Body as any;
    if (
      typeof body.transformToByteArray ===
      'function'
    ) {
      const bytes =
        await body.transformToByteArray();
      return Buffer.from(bytes);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }
}
