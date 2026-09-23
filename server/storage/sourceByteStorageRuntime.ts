import type { SourceByteStorage } from './sourceByteStorage.js';
import {
  S3SourceByteStorage,
  type S3SourceByteStorageConfig,
} from './s3SourceByteStorage.js';

export class SourceStorageConfigurationError
  extends Error
{
  readonly code =
    'SOURCE_STORAGE_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name =
      'SourceStorageConfigurationError';
  }
}

let testStorage: SourceByteStorage | null =
  null;
let runtimeStorage:
  | SourceByteStorage
  | null = null;
let runtimeSignature = '';

function boolFromEnv(
  value: string | undefined
): boolean {
  return (
    value?.trim().toLowerCase() === 'true'
  );
}

function s3ConfigFromEnv():
  S3SourceByteStorageConfig {
  const bucket =
    process.env.SOURCE_STORAGE_BUCKET?.trim() ||
    '';
  const region =
    process.env.SOURCE_STORAGE_REGION?.trim() ||
    '';
  const endpoint =
    process.env.SOURCE_STORAGE_ENDPOINT?.trim() ||
    undefined;
  const accessKeyId =
    process.env
      .SOURCE_STORAGE_ACCESS_KEY_ID?.trim() ||
    undefined;
  const secretAccessKey =
    process.env
      .SOURCE_STORAGE_SECRET_ACCESS_KEY?.trim() ||
    undefined;

  if (!bucket || !region) {
    throw new SourceStorageConfigurationError(
      'SOURCE_STORAGE_BUCKET and SOURCE_STORAGE_REGION are required for durable source/object storage.'
    );
  }

  if (
    Boolean(accessKeyId) !==
    Boolean(secretAccessKey)
  ) {
    throw new SourceStorageConfigurationError(
      'SOURCE_STORAGE_ACCESS_KEY_ID and SOURCE_STORAGE_SECRET_ACCESS_KEY must be configured together.'
    );
  }

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: boolFromEnv(
      process.env
        .SOURCE_STORAGE_FORCE_PATH_STYLE
    ),
  };
}

export function sourceStorageRuntimeConfig() {
  const backend =
    process.env
      .SOURCE_STORAGE_BACKEND
      ?.trim()
      .toLowerCase() || 's3';

  if (backend !== 's3') {
    throw new SourceStorageConfigurationError(
      'SOURCE_STORAGE_BACKEND must be "s3" for production durable source/object storage.'
    );
  }

  return {
    backend,
    s3: s3ConfigFromEnv(),
  };
}

export function sourceByteStorageRuntime():
  SourceByteStorage {
  if (testStorage) return testStorage;

  const config = sourceStorageRuntimeConfig();
  const signature = JSON.stringify(config);

  if (
    !runtimeStorage ||
    runtimeSignature !== signature
  ) {
    runtimeStorage =
      new S3SourceByteStorage(config.s3);
    runtimeSignature = signature;
  }

  return runtimeStorage;
}

export function setSourceByteStorageForTesting(
  storage: SourceByteStorage | null
): void {
  testStorage = storage;
}
