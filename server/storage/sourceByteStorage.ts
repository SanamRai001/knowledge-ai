import crypto from 'crypto';

export interface StoredByteObject {
  backend: string;
  key: string;
  sizeBytes: number;
  sha256: string;
  etag?: string;
}

export interface SourceBytePutInput {
  key: string;
  bytes: Buffer;
  contentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
}

export interface SourceByteStorage {
  readonly backend: string;

  put(
    input: SourceBytePutInput
  ): Promise<StoredByteObject>;

  get(key: string): Promise<Buffer>;

  delete(key: string): Promise<void>;
}

export class SourceIntegrityError extends Error {
  public readonly code = 'SOURCE_INTEGRITY_MISMATCH';

  constructor(message: string) {
    super(message);
    this.name = 'SourceIntegrityError';
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function safeSegment(
  value: string,
  label: string
): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    !SAFE_SEGMENT.test(trimmed)
  ) {
    throw new Error(
      label +
        ' must contain only letters, numbers, underscore, or hyphen.'
    );
  }
  return trimmed;
}

export function buildSourceStorageKey(input: {
  accountId: string;
  sourceObjectId: string;
  sourceVersionId: string;
}): string {
  const accountId = safeSegment(
    input.accountId,
    'accountId'
  );
  const objectId = safeSegment(
    input.sourceObjectId,
    'sourceObjectId'
  );
  const versionId = safeSegment(
    input.sourceVersionId,
    'sourceVersionId'
  );

  return (
    'accounts/' +
    accountId +
    '/sources/' +
    objectId +
    '/versions/' +
    versionId
  );
}

export function sha256Bytes(
  bytes: Buffer
): string {
  return crypto
    .createHash('sha256')
    .update(bytes)
    .digest('hex');
}

export function verifySourceIntegrity(input: {
  bytes: Buffer;
  expectedSizeBytes: number;
  expectedSha256: string;
}): {
  sizeBytes: number;
  sha256: string;
} {
  const expectedSha256 =
    input.expectedSha256.trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new SourceIntegrityError(
      'Expected SHA-256 must be 64 lowercase hexadecimal characters.'
    );
  }

  if (
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes < 0
  ) {
    throw new SourceIntegrityError(
      'Expected byte size must be a non-negative safe integer.'
    );
  }

  const sizeBytes = input.bytes.byteLength;
  const sha256 = sha256Bytes(input.bytes);

  if (sizeBytes !== input.expectedSizeBytes) {
    throw new SourceIntegrityError(
      'Source byte size does not match expected metadata.'
    );
  }

  if (sha256 !== expectedSha256) {
    throw new SourceIntegrityError(
      'Source SHA-256 does not match expected metadata.'
    );
  }

  return {
    sizeBytes,
    sha256,
  };
}
