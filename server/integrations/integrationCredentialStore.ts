import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { IntegrationProvider } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const CREDENTIAL_FILE = path.join(
  DATA_DIR,
  'integration_credentials.json'
);

type EncryptedCredentialRecord = {
  id: string;
  accountId: string;
  provider: IntegrationProvider;
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: number;
  updatedAt: number;
};

type PersistedCredentialState = {
  records: EncryptedCredentialRecord[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function secretId(): string {
  return 'cred_' + crypto.randomBytes(16).toString('hex');
}

export class IntegrationCredentialError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'CREDENTIAL_KEY_NOT_CONFIGURED'
    | 'CREDENTIAL_NOT_FOUND'
    | 'CREDENTIAL_DECRYPTION_FAILED';

  constructor(
    code:
      | 'CREDENTIAL_KEY_NOT_CONFIGURED'
      | 'CREDENTIAL_NOT_FOUND'
      | 'CREDENTIAL_DECRYPTION_FAILED',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'IntegrationCredentialError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class IntegrationCredentialStore {
  private records = new Map<string, EncryptedCredentialRecord>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(CREDENTIAL_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(CREDENTIAL_FILE, 'utf8')
      ) as Partial<PersistedCredentialState>;

      for (const record of parsed.records || []) {
        this.records.set(record.id, record);
      }
    } catch (error) {
      console.warn(
        'Could not load encrypted integration credentials:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedCredentialState = {
      records: Array.from(this.records.values()).slice(-5000),
    };
    const temporary = CREDENTIAL_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, CREDENTIAL_FILE);
  }

  private key(): Buffer {
    const configured = process.env.INTEGRATION_CREDENTIAL_KEY?.trim();
    if (!configured || configured.length < 32) {
      throw new IntegrationCredentialError(
        'CREDENTIAL_KEY_NOT_CONFIGURED',
        503,
        'INTEGRATION_CREDENTIAL_KEY must be configured with at least 32 characters before external OAuth credentials can be stored.'
      );
    }

    return crypto
      .createHash('sha256')
      .update(configured, 'utf8')
      .digest();
  }

  private encrypt(value: unknown): Pick<
    EncryptedCredentialRecord,
    'iv' | 'authTag' | 'ciphertext'
  > {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.key(),
      iv
    );
    const plaintext = Buffer.from(
      JSON.stringify(value),
      'utf8'
    );
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    return {
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt<T>(record: EncryptedCredentialRecord): T {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.key(),
        Buffer.from(record.iv, 'base64')
      );
      decipher.setAuthTag(
        Buffer.from(record.authTag, 'base64')
      );
      const plaintext = Buffer.concat([
        decipher.update(
          Buffer.from(record.ciphertext, 'base64')
        ),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString('utf8')) as T;
    } catch (error) {
      if (error instanceof IntegrationCredentialError) {
        throw error;
      }
      throw new IntegrationCredentialError(
        'CREDENTIAL_DECRYPTION_FAILED',
        500,
        'Stored integration credentials could not be decrypted with the configured credential key.'
      );
    }
  }

  public create<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    secret: T;
  }): string {
    const now = Date.now();
    const id = secretId();
    const encrypted = this.encrypt(params.secret);
    this.records.set(id, {
      id,
      accountId: params.accountId,
      provider: params.provider,
      ...encrypted,
      createdAt: now,
      updatedAt: now,
    });
    this.save();
    return id;
  }

  public get<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
  }): T {
    const record = this.records.get(params.credentialRef);
    if (
      !record ||
      record.accountId !== params.accountId ||
      record.provider !== params.provider
    ) {
      throw new IntegrationCredentialError(
        'CREDENTIAL_NOT_FOUND',
        404,
        'Integration credential was not found in the current account/provider scope.'
      );
    }
    return clone(this.decrypt<T>(record));
  }

  public update<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
    secret: T;
  }): void {
    const record = this.records.get(params.credentialRef);
    if (
      !record ||
      record.accountId !== params.accountId ||
      record.provider !== params.provider
    ) {
      throw new IntegrationCredentialError(
        'CREDENTIAL_NOT_FOUND',
        404,
        'Integration credential was not found in the current account/provider scope.'
      );
    }

    this.records.set(record.id, {
      ...record,
      ...this.encrypt(params.secret),
      updatedAt: Date.now(),
    });
    this.save();
  }

  public delete(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
  }): boolean {
    const record = this.records.get(params.credentialRef);
    if (
      !record ||
      record.accountId !== params.accountId ||
      record.provider !== params.provider
    ) {
      return false;
    }
    const deleted = this.records.delete(record.id);
    if (deleted) this.save();
    return deleted;
  }
}

export const integrationCredentialStore =
  new IntegrationCredentialStore();
