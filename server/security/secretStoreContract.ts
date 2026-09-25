export type SecretPurpose =
  | 'INTEGRATION_OAUTH'
  | 'WEBHOOK_SIGNING'
  | 'OTHER_ACCOUNT_CREDENTIAL';

export interface SecretRef {
  id: string;
  accountId: string;
  purpose: SecretPurpose;
  provider?: string;
  version?: string;
}

export interface SecretMetadata extends SecretRef {
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

export interface SecretStore {
  create<T>(params: {
    accountId: string;
    purpose: SecretPurpose;
    provider?: string;
    secret: T;
  }): Promise<SecretMetadata>;

  get<T>(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
  }): Promise<T>;

  rotate<T>(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
    secret: T;
  }): Promise<SecretMetadata>;

  revoke(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
    at?: number;
  }): Promise<boolean>;

  delete(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
  }): Promise<boolean>;
}

export interface KmsEnvelope {
  keyId: string;
  ciphertext: string;
  algorithm: string;
}

export interface KmsService {
  encrypt(params: {
    plaintext: Buffer;
    encryptionContext: Record<string, string>;
  }): Promise<KmsEnvelope>;

  decrypt(params: {
    envelope: KmsEnvelope;
    encryptionContext: Record<string, string>;
  }): Promise<Buffer>;
}
