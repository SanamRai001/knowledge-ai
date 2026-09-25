import crypto from 'crypto';
import type { PoolClient } from 'pg';
import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import type {
  KmsService,
  SecretMetadata,
  SecretPurpose,
  SecretStore,
} from './secretStoreContract.js';
import {
  versionedAesGcmKmsService,
} from './versionedAesGcmKmsService.js';

export type SecretStoreErrorCode =
  | 'SECRET_NOT_FOUND'
  | 'SECRET_REVOKED'
  | 'SECRET_SCOPE_MISMATCH'
  | 'SECRET_PAYLOAD_INVALID';

export class SecretStoreError extends Error {
  constructor(
    public readonly code:
      SecretStoreErrorCode,
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

type SecretRow = {
  id: string;
  account_id: string;
  purpose: SecretPurpose;
  provider: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'DELETED';
  current_version: number;
  created_at: Date | string;
  updated_at: Date | string;
  revoked_at: Date | string | null;
};

function epoch(
  value: Date | string | null
): number | undefined {
  if (!value) return undefined;
  return value instanceof Date
    ? value.getTime()
    : Date.parse(value);
}

function normalizedProvider(
  provider: string | undefined
): string | undefined {
  const value = provider?.trim();
  return value || undefined;
}

function metadata(
  row: SecretRow
): SecretMetadata {
  return {
    id: row.id,
    accountId: row.account_id,
    purpose: row.purpose,
    provider:
      row.provider || undefined,
    version:
      String(row.current_version),
    createdAt:
      epoch(row.created_at)!,
    updatedAt:
      epoch(row.updated_at)!,
    revokedAt:
      epoch(row.revoked_at),
  };
}

function secretId(): string {
  return (
    'sec_' +
    crypto.randomBytes(16).toString('hex')
  );
}

function auditId(): string {
  return (
    'secaud_' +
    crypto.randomBytes(16).toString('hex')
  );
}

function context(params: {
  accountId: string;
  secretId: string;
  purpose: SecretPurpose;
  provider?: string;
  version: number;
}): Record<string, string> {
  return {
    accountId: params.accountId,
    secretId: params.secretId,
    purpose: params.purpose,
    provider: params.provider || '',
    version: String(params.version),
  };
}

function serialize(value: unknown): Buffer {
  return Buffer.from(
    JSON.stringify(value),
    'utf8'
  );
}

function deserialize<T>(
  value: Buffer
): T {
  try {
    return JSON.parse(
      value.toString('utf8')
    ) as T;
  } catch {
    throw new SecretStoreError(
      'SECRET_PAYLOAD_INVALID',
      500,
      'Stored secret payload is invalid.'
    );
  }
}

async function audit(
  client: PoolClient,
  params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
    operation:
      | 'CREATE'
      | 'READ'
      | 'ROTATE'
      | 'REVOKE'
      | 'DELETE'
      | 'MIGRATE';
    version?: number;
    outcome: 'SUCCEEDED' | 'FAILED';
    errorCode?: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO account_secret_audit_events
      (id, account_id, secret_id, purpose, provider,
       operation, secret_version, occurred_at, outcome, error_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9)`,
    [
      auditId(),
      params.accountId,
      params.secretId,
      params.purpose,
      params.provider ?? null,
      params.operation,
      params.version ?? null,
      params.outcome,
      params.errorCode ?? null,
    ]
  );
}

export class PostgresSecretStore
  implements SecretStore
{
  constructor(
    private readonly kms:
      KmsService =
        versionedAesGcmKmsService
  ) {}

  async create<T>(params: {
    accountId: string;
    purpose: SecretPurpose;
    provider?: string;
    secret: T;
  }): Promise<SecretMetadata> {
    return this.createWithId({
      ...params,
      secretId: secretId(),
      operation: 'CREATE',
    });
  }

  async importLegacyWithId<T>(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
    secret: T;
  }): Promise<SecretMetadata> {
    const existing =
      await this.findMetadata(
        params.accountId,
        params.secretId
      );

    if (existing) {
      this.assertScope(
        existing,
        params.purpose,
        params.provider
      );
      if (existing.revokedAt) {
        throw new SecretStoreError(
          'SECRET_REVOKED',
          409,
          'Stored secret has been revoked.'
        );
      }
      return existing;
    }

    try {
      return await this.createWithId({
        ...params,
        operation: 'MIGRATE',
      });
    } catch (error: any) {
      if (
        String(error?.code || '') !==
        '23505'
      ) {
        throw error;
      }

      const raced =
        await this.findMetadata(
          params.accountId,
          params.secretId
        );
      if (!raced) {
        throw error;
      }
      this.assertScope(
        raced,
        params.purpose,
        params.provider
      );
      return raced;
    }
  }

  private async createWithId<T>(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
    secret: T;
    operation: 'CREATE' | 'MIGRATE';
  }): Promise<SecretMetadata> {
    const provider =
      normalizedProvider(
        params.provider
      );
    const version = 1;
    const envelope =
      await this.kms.encrypt({
        plaintext:
          serialize(params.secret),
        encryptionContext:
          context({
            accountId:
              params.accountId,
            secretId:
              params.secretId,
            purpose:
              params.purpose,
            provider,
            version,
          }),
      });
    const now = Date.now();

    return withTransaction(
      async (client) => {
        const result =
          await client.query<SecretRow>(
            `INSERT INTO account_secrets
              (id, account_id, purpose, provider, status,
               current_version, created_at, updated_at)
             VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$6)
             RETURNING *`,
            [
              params.secretId,
              params.accountId,
              params.purpose,
              provider ?? null,
              version,
              new Date(now),
            ]
          );

        await client.query(
          `INSERT INTO account_secret_versions
            (account_id, secret_id, version, kms_key_id,
             kms_algorithm, ciphertext, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`,
          [
            params.accountId,
            params.secretId,
            version,
            envelope.keyId,
            envelope.algorithm,
            envelope.ciphertext,
            new Date(now),
          ]
        );

        await audit(client, {
          accountId:
            params.accountId,
          secretId:
            params.secretId,
          purpose: params.purpose,
          provider,
          operation:
            params.operation,
          version,
          outcome: 'SUCCEEDED',
        });

        return metadata(
          result.rows[0]
        );
      }
    );
  }

  async get<T>(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
  }): Promise<T> {
    const provider =
      normalizedProvider(
        params.provider
      );

    const result =
      await postgresPool().query<
        SecretRow & {
          kms_key_id: string;
          kms_algorithm: string;
          ciphertext: string;
        }
      >(
        `SELECT s.*,
                v.kms_key_id,
                v.kms_algorithm,
                v.ciphertext
         FROM account_secrets s
         JOIN account_secret_versions v
           ON v.account_id = s.account_id
          AND v.secret_id = s.id
          AND v.version = s.current_version
         WHERE s.account_id = $1
           AND s.id = $2`,
        [
          params.accountId,
          params.secretId,
        ]
      );

    if (!result.rowCount) {
      throw new SecretStoreError(
        'SECRET_NOT_FOUND',
        404,
        'Stored secret was not found in the current account scope.'
      );
    }

    const row = result.rows[0];
    const meta = metadata(row);
    this.assertScope(
      meta,
      params.purpose,
      provider
    );

    if (row.status !== 'ACTIVE') {
      throw new SecretStoreError(
        row.status === 'REVOKED'
          ? 'SECRET_REVOKED'
          : 'SECRET_NOT_FOUND',
        row.status === 'REVOKED'
          ? 409
          : 404,
        row.status === 'REVOKED'
          ? 'Stored secret has been revoked.'
          : 'Stored secret is unavailable.'
      );
    }

    try {
      const plaintext =
        await this.kms.decrypt({
          envelope: {
            keyId:
              row.kms_key_id,
            algorithm:
              row.kms_algorithm,
            ciphertext:
              row.ciphertext,
          },
          encryptionContext:
            context({
              accountId:
                params.accountId,
              secretId:
                params.secretId,
              purpose:
                params.purpose,
              provider,
              version:
                row.current_version,
            }),
        });

      await withTransaction(
        async (client) => {
          await audit(client, {
            accountId:
              params.accountId,
            secretId:
              params.secretId,
            purpose:
              params.purpose,
            provider,
            operation: 'READ',
            version:
              row.current_version,
            outcome: 'SUCCEEDED',
          });
        }
      );

      return deserialize<T>(
        plaintext
      );
    } catch (error: any) {
      await withTransaction(
        async (client) => {
          await audit(client, {
            accountId:
              params.accountId,
            secretId:
              params.secretId,
            purpose:
              params.purpose,
            provider,
            operation: 'READ',
            version:
              row.current_version,
            outcome: 'FAILED',
            errorCode:
              typeof error?.code ===
              'string'
                ? error.code
                : 'SECRET_READ_FAILED',
          });
        }
      ).catch(() => undefined);
      throw error;
    }
  }

  async rotate<T>(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
    secret: T;
  }): Promise<SecretMetadata> {
    const provider =
      normalizedProvider(
        params.provider
      );

    return withTransaction(
      async (client) => {
        const locked =
          await client.query<SecretRow>(
            `SELECT *
             FROM account_secrets
             WHERE account_id = $1
               AND id = $2
             FOR UPDATE`,
            [
              params.accountId,
              params.secretId,
            ]
          );

        if (!locked.rowCount) {
          throw new SecretStoreError(
            'SECRET_NOT_FOUND',
            404,
            'Stored secret was not found in the current account scope.'
          );
        }

        const row = locked.rows[0];
        const current =
          metadata(row);
        this.assertScope(
          current,
          params.purpose,
          provider
        );
        if (row.status !== 'ACTIVE') {
          throw new SecretStoreError(
            'SECRET_REVOKED',
            409,
            'Stored secret is not active and cannot be rotated.'
          );
        }

        const nextVersion =
          row.current_version + 1;
        const envelope =
          await this.kms.encrypt({
            plaintext:
              serialize(params.secret),
            encryptionContext:
              context({
                accountId:
                  params.accountId,
                secretId:
                  params.secretId,
                purpose:
                  params.purpose,
                provider,
                version:
                  nextVersion,
              }),
          });
        const now = new Date();

        await client.query(
          `UPDATE account_secret_versions
           SET status = 'RETIRED',
               retired_at = $4
           WHERE account_id = $1
             AND secret_id = $2
             AND version = $3
             AND status = 'ACTIVE'`,
          [
            params.accountId,
            params.secretId,
            row.current_version,
            now,
          ]
        );

        await client.query(
          `INSERT INTO account_secret_versions
            (account_id, secret_id, version, kms_key_id,
             kms_algorithm, ciphertext, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`,
          [
            params.accountId,
            params.secretId,
            nextVersion,
            envelope.keyId,
            envelope.algorithm,
            envelope.ciphertext,
            now,
          ]
        );

        const updated =
          await client.query<SecretRow>(
            `UPDATE account_secrets
             SET current_version = $3,
                 updated_at = $4
             WHERE account_id = $1
               AND id = $2
             RETURNING *`,
            [
              params.accountId,
              params.secretId,
              nextVersion,
              now,
            ]
          );

        await audit(client, {
          accountId:
            params.accountId,
          secretId:
            params.secretId,
          purpose:
            params.purpose,
          provider,
          operation: 'ROTATE',
          version: nextVersion,
          outcome: 'SUCCEEDED',
        });

        return metadata(
          updated.rows[0]
        );
      }
    );
  }

  async revoke(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
    at?: number;
  }): Promise<boolean> {
    const provider =
      normalizedProvider(
        params.provider
      );

    return withTransaction(
      async (client) => {
        const locked =
          await client.query<SecretRow>(
            `SELECT *
             FROM account_secrets
             WHERE account_id = $1
               AND id = $2
             FOR UPDATE`,
            [
              params.accountId,
              params.secretId,
            ]
          );
        if (!locked.rowCount) {
          return false;
        }

        const row = locked.rows[0];
        this.assertScope(
          metadata(row),
          params.purpose,
          provider
        );

        if (
          row.status === 'DELETED'
        ) {
          return false;
        }

        const at = new Date(
          params.at ?? Date.now()
        );

        await client.query(
          `UPDATE account_secrets
           SET status = 'REVOKED',
               revoked_at = COALESCE(revoked_at, $3),
               updated_at = $3
           WHERE account_id = $1
             AND id = $2`,
          [
            params.accountId,
            params.secretId,
            at,
          ]
        );

        await client.query(
          `UPDATE account_secret_versions
           SET status = 'REVOKED',
               retired_at = COALESCE(retired_at, $3)
           WHERE account_id = $1
             AND secret_id = $2`,
          [
            params.accountId,
            params.secretId,
            at,
          ]
        );

        await audit(client, {
          accountId:
            params.accountId,
          secretId:
            params.secretId,
          purpose:
            params.purpose,
          provider,
          operation: 'REVOKE',
          version:
            row.current_version,
          outcome: 'SUCCEEDED',
        });

        return true;
      }
    );
  }

  async delete(params: {
    accountId: string;
    secretId: string;
    purpose: SecretPurpose;
    provider?: string;
  }): Promise<boolean> {
    const provider =
      normalizedProvider(
        params.provider
      );

    return withTransaction(
      async (client) => {
        const locked =
          await client.query<SecretRow>(
            `SELECT *
             FROM account_secrets
             WHERE account_id = $1
               AND id = $2
             FOR UPDATE`,
            [
              params.accountId,
              params.secretId,
            ]
          );
        if (!locked.rowCount) {
          return false;
        }

        const row = locked.rows[0];
        this.assertScope(
          metadata(row),
          params.purpose,
          provider
        );
        if (
          row.status === 'DELETED'
        ) {
          return false;
        }

        const now = new Date();

        await client.query(
          `DELETE FROM account_secret_versions
           WHERE account_id = $1
             AND secret_id = $2`,
          [
            params.accountId,
            params.secretId,
          ]
        );

        await client.query(
          `UPDATE account_secrets
           SET status = 'DELETED',
               deleted_at = $3,
               updated_at = $3
           WHERE account_id = $1
             AND id = $2`,
          [
            params.accountId,
            params.secretId,
            now,
          ]
        );

        await audit(client, {
          accountId:
            params.accountId,
          secretId:
            params.secretId,
          purpose:
            params.purpose,
          provider,
          operation: 'DELETE',
          version:
            row.current_version,
          outcome: 'SUCCEEDED',
        });

        return true;
      }
    );
  }

  async cleanupUnreferencedIntegrationOAuthSecrets(params: {
    accountId: string;
    provider: string;
    olderThanMs?: number;
  }): Promise<number> {
    const cutoff = new Date(
      Date.now() -
        Math.max(
          0,
          params.olderThanMs ??
            5 * 60 * 1000
        )
    );

    const result =
      await postgresPool().query<{
        id: string;
      }>(
        `SELECT s.id
         FROM account_secrets s
         WHERE s.account_id = $1
           AND s.purpose = 'INTEGRATION_OAUTH'
           AND s.provider = $2
           AND s.status = 'ACTIVE'
           AND s.created_at <= $3
           AND NOT EXISTS (
             SELECT 1
             FROM integration_connections c
             WHERE c.account_id = s.account_id
               AND c.credential_ref = s.id
           )
         ORDER BY s.created_at ASC
         LIMIT 100`,
        [
          params.accountId,
          params.provider,
          cutoff,
        ]
      );

    let deleted = 0;
    for (const row of result.rows) {
      const removed =
        await this.delete({
          accountId:
            params.accountId,
          secretId: row.id,
          purpose:
            'INTEGRATION_OAUTH',
          provider:
            params.provider,
        });
      if (removed) deleted += 1;
    }
    return deleted;
  }

  async findMetadata(
    accountId: string,
    secretIdValue: string
  ): Promise<SecretMetadata | null> {
    const result =
      await postgresPool().query<SecretRow>(
        `SELECT *
         FROM account_secrets
         WHERE account_id = $1
           AND id = $2
           AND status <> 'DELETED'`,
        [
          accountId,
          secretIdValue,
        ]
      );

    return result.rowCount
      ? metadata(result.rows[0])
      : null;
  }

  private assertScope(
    current: SecretMetadata,
    purpose: SecretPurpose,
    provider?: string
  ): void {
    const normalized =
      normalizedProvider(provider);

    if (
      current.purpose !== purpose ||
      current.provider !== normalized
    ) {
      throw new SecretStoreError(
        'SECRET_SCOPE_MISMATCH',
        404,
        'Stored secret was not found in the requested account/purpose/provider scope.'
      );
    }
  }
}

export const postgresSecretStore =
  new PostgresSecretStore();
