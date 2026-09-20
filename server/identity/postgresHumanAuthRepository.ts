import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import type {
  AccountMembership,
  HumanUser,
} from './types.js';
import type {
  BootstrapOwnerInput,
  HumanAuthRepository,
  LoginIdentity,
  PasswordCredential,
} from './authTypes.js';

function epoch(value: Date | string | number): number {
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error('PostgreSQL returned an invalid auth timestamp.');
  }
  return parsed;
}

function userFromRow(row: any): HumanUser {
  return {
    id: row.id,
    email: row.email,
    normalizedEmail: row.normalized_email,
    displayName: row.display_name ?? undefined,
    status: row.status,
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
  };
}

function membershipFromRow(row: any): AccountMembership {
  return {
    accountId: row.account_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
  };
}

function credentialFromRow(row: any): PasswordCredential {
  return {
    userId: row.credential_user_id,
    algorithm: row.algorithm,
    saltBase64: row.salt_base64,
    hashBase64: row.hash_base64,
    scryptN: row.scrypt_n,
    scryptR: row.scrypt_r,
    scryptP: row.scrypt_p,
    keyLength: row.key_length,
    createdAt: epoch(row.credential_created_at),
    updatedAt: epoch(row.credential_updated_at),
  };
}

export class PostgresHumanAuthRepository
  implements HumanAuthRepository
{
  async bootstrapInitialOwner(
    input: BootstrapOwnerInput
  ): Promise<{
    user: HumanUser;
    membership: AccountMembership;
  }> {
    return withTransaction(async (client) => {
      const state = await client.query(
        `SELECT consumed_at
         FROM auth_bootstrap_state
         WHERE id = 'initial-owner'
         FOR UPDATE`
      );

      if (!state.rowCount) {
        throw new Error('AUTH_BOOTSTRAP_STATE_MISSING');
      }
      if (state.rows[0].consumed_at) {
        throw new Error('AUTH_BOOTSTRAP_ALREADY_USED');
      }

      const existingIdentity = await client.query(
        `SELECT
           EXISTS(SELECT 1 FROM users) AS has_users,
           EXISTS(SELECT 1 FROM account_memberships) AS has_memberships,
           EXISTS(SELECT 1 FROM user_password_credentials) AS has_credentials`
      );
      const flags = existingIdentity.rows[0];
      if (
        flags.has_users ||
        flags.has_memberships ||
        flags.has_credentials
      ) {
        throw new Error('AUTH_BOOTSTRAP_ALREADY_USED');
      }

      await client.query(
        `INSERT INTO accounts (id, created_at, updated_at)
         VALUES ($1,$2,$2)
         ON CONFLICT (id) DO NOTHING`,
        [input.accountId, new Date(input.user.createdAt)]
      );

      const userResult = await client.query(
        `INSERT INTO users
          (id, email, normalized_email, display_name, status,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          input.user.id,
          input.user.email,
          input.user.normalizedEmail,
          input.user.displayName ?? null,
          input.user.status,
          new Date(input.user.createdAt),
          new Date(input.user.updatedAt),
        ]
      );

      await client.query(
        `INSERT INTO user_password_credentials
          (user_id, algorithm, salt_base64, hash_base64,
           scrypt_n, scrypt_r, scrypt_p, key_length,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.credential.userId,
          input.credential.algorithm,
          input.credential.saltBase64,
          input.credential.hashBase64,
          input.credential.scryptN,
          input.credential.scryptR,
          input.credential.scryptP,
          input.credential.keyLength,
          new Date(input.credential.createdAt),
          new Date(input.credential.updatedAt),
        ]
      );

      const membershipResult = await client.query(
        `INSERT INTO account_memberships
          (account_id, user_id, role, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          input.membership.accountId,
          input.membership.userId,
          input.membership.role,
          input.membership.status,
          new Date(input.membership.createdAt),
          new Date(input.membership.updatedAt),
        ]
      );

      await client.query(
        `UPDATE auth_bootstrap_state
         SET consumed_at = $1,
             consumed_by_user_id = $2
         WHERE id = 'initial-owner'`,
        [new Date(input.user.createdAt), input.user.id]
      );

      return {
        user: userFromRow(userResult.rows[0]),
        membership: membershipFromRow(
          membershipResult.rows[0]
        ),
      };
    });
  }

  async findLoginIdentity(
    normalizedEmail: string
  ): Promise<LoginIdentity | null> {
    const result = await postgresPool().query(
      `SELECT
         u.*,
         c.user_id AS credential_user_id,
         c.algorithm,
         c.salt_base64,
         c.hash_base64,
         c.scrypt_n,
         c.scrypt_r,
         c.scrypt_p,
         c.key_length,
         c.created_at AS credential_created_at,
         c.updated_at AS credential_updated_at
       FROM users u
       JOIN user_password_credentials c
         ON c.user_id = u.id
       WHERE u.normalized_email = $1`,
      [normalizedEmail]
    );

    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      user: userFromRow(row),
      credential: credentialFromRow(row),
    };
  }
}

export const postgresHumanAuthRepository =
  new PostgresHumanAuthRepository();
