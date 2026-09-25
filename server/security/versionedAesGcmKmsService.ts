import crypto from 'crypto';
import type {
  KmsEnvelope,
  KmsService,
} from './secretStoreContract.js';

export class KmsConfigurationError extends Error {
  readonly code = 'SECRET_KMS_NOT_CONFIGURED';
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'KmsConfigurationError';
  }
}

export class KmsDecryptionError extends Error {
  readonly code = 'SECRET_KMS_DECRYPTION_FAILED';
  readonly statusCode = 500;

  constructor(message: string) {
    super(message);
    this.name = 'KmsDecryptionError';
  }
}

export interface AesGcmKeyringConfig {
  activeKeyId: string;
  keys: Record<string, Buffer>;
}

const KEY_ID = /^[A-Za-z0-9._-]{1,128}$/;

function canonicalContext(
  context: Record<string, string>
): Buffer {
  const entries = Object.entries(context)
    .sort(([left], [right]) =>
      left.localeCompare(right)
    );
  return Buffer.from(
    JSON.stringify(
      Object.fromEntries(entries)
    ),
    'utf8'
  );
}

export function secretKeyringRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): AesGcmKeyringConfig {
  const activeKeyId =
    env.KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID?.trim() ||
    '';
  const raw =
    env.KNOWLEDGE_AI_SECRET_KEYRING_JSON?.trim() ||
    '';

  if (!activeKeyId || !KEY_ID.test(activeKeyId) || !raw) {
    throw new KmsConfigurationError(
      'KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID and KNOWLEDGE_AI_SECRET_KEYRING_JSON are required for PostgreSQL managed OAuth secret storage.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KmsConfigurationError(
      'KNOWLEDGE_AI_SECRET_KEYRING_JSON must be a JSON object mapping key IDs to base64-encoded 32-byte keys.'
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new KmsConfigurationError(
      'KNOWLEDGE_AI_SECRET_KEYRING_JSON must be a JSON object.'
    );
  }

  const keys: Record<string, Buffer> = {};
  for (const [keyId, encoded] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (
      !KEY_ID.test(keyId) ||
      typeof encoded !== 'string'
    ) {
      throw new KmsConfigurationError(
        'Secret keyring contains an invalid key ID or key value.'
      );
    }

    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) {
      throw new KmsConfigurationError(
        'Each secret keyring entry must decode to exactly 32 bytes.'
      );
    }
    keys[keyId] = key;
  }

  if (!keys[activeKeyId]) {
    throw new KmsConfigurationError(
      'The active secret key ID is not present in KNOWLEDGE_AI_SECRET_KEYRING_JSON.'
    );
  }

  return {
    activeKeyId,
    keys,
  };
}

export class VersionedAesGcmKmsService
  implements KmsService
{
  constructor(
    private readonly configProvider: () =>
      AesGcmKeyringConfig =
        () => secretKeyringRuntimeConfig()
  ) {}

  async encrypt(params: {
    plaintext: Buffer;
    encryptionContext: Record<string, string>;
  }): Promise<KmsEnvelope> {
    const config = this.configProvider();
    const key =
      config.keys[config.activeKeyId];
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      key,
      iv
    );
    cipher.setAAD(
      canonicalContext(
        params.encryptionContext
      )
    );

    const ciphertext = Buffer.concat([
      cipher.update(params.plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      keyId: config.activeKeyId,
      algorithm: 'AES-256-GCM',
      ciphertext: [
        'v1',
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.'),
    };
  }

  async decrypt(params: {
    envelope: KmsEnvelope;
    encryptionContext: Record<string, string>;
  }): Promise<Buffer> {
    if (params.envelope.algorithm !== 'AES-256-GCM') {
      throw new KmsDecryptionError(
        'Stored secret uses an unsupported envelope algorithm.'
      );
    }

    const config = this.configProvider();
    const key =
      config.keys[params.envelope.keyId];
    if (!key) {
      throw new KmsDecryptionError(
        'The KMS key version required for this secret is unavailable.'
      );
    }

    const parts =
      params.envelope.ciphertext.split('.');
    if (
      parts.length !== 4 ||
      parts[0] !== 'v1'
    ) {
      throw new KmsDecryptionError(
        'Stored secret envelope format is invalid.'
      );
    }

    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(parts[1], 'base64url')
      );
      decipher.setAAD(
        canonicalContext(
          params.encryptionContext
        )
      );
      decipher.setAuthTag(
        Buffer.from(parts[2], 'base64url')
      );

      return Buffer.concat([
        decipher.update(
          Buffer.from(parts[3], 'base64url')
        ),
        decipher.final(),
      ]);
    } catch {
      throw new KmsDecryptionError(
        'Stored secret could not be decrypted in the required account/purpose/provider context.'
      );
    }
  }
}

export const versionedAesGcmKmsService =
  new VersionedAesGcmKmsService();
