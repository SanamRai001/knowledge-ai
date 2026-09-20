import type { PoolClient } from 'pg';
import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import type {
  AccountMembership,
  BrowserSession,
  HumanUser,
  IdentityFoundationRepository,
} from './types.js';

function epoch(value: Date | string | number | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error('PostgreSQL returned an invalid identity timestamp.');
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
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function membershipFromRow(row: any): AccountMembership {
  return {
    accountId: row.account_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function sessionFromRow(row: any): BrowserSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    selectedAccountId: row.selected_account_id ?? undefined,
    selectedWorkspaceId: row.selected_workspace_id ?? undefined,
    status: row.status,
    createdAt: epoch(row.created_at)!,
    lastSeenAt: epoch(row.last_seen_at)!,
    expiresAt: epoch(row.expires_at)!,
    revokedAt: epoch(row.revoked_at),
  };
}

async function requireSession(
  client: PoolClient,
  sessionId: string
): Promise<BrowserSession> {
  const result = await client.query(
    'SELECT * FROM browser_sessions WHERE id = $1 FOR UPDATE',
    [sessionId]
  );
  if (!result.rowCount) {
    throw new Error('Browser session was not found.');
  }
  return sessionFromRow(result.rows[0]);
}

async function requireActiveMembership(
  client: PoolClient,
  userId: string,
  accountId: string
): Promise<void> {
  const result = await client.query(
    `SELECT 1
     FROM account_memberships
     WHERE account_id = $1
       AND user_id = $2
       AND status = 'ACTIVE'`,
    [accountId, userId]
  );
  if (!result.rowCount) {
    throw new Error(
      'Active account membership is required for session selection.'
    );
  }
}

async function requireOwnedWorkspace(
  client: PoolClient,
  accountId: string,
  workspaceId: string
): Promise<void> {
  const result = await client.query(
    `SELECT 1
     FROM workspaces
     WHERE account_id = $1 AND id = $2`,
    [accountId, workspaceId]
  );
  if (!result.rowCount) {
    throw new Error(
      'Workspace not found in the selected account scope.'
    );
  }
}

export class PostgresIdentityFoundationRepository
  implements IdentityFoundationRepository
{
  async createUser(user: HumanUser): Promise<HumanUser> {
    const result = await postgresPool().query(
      `INSERT INTO users
        (id, email, normalized_email, display_name, status,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        user.id,
        user.email,
        user.normalizedEmail,
        user.displayName ?? null,
        user.status,
        new Date(user.createdAt),
        new Date(user.updatedAt),
      ]
    );
    return userFromRow(result.rows[0]);
  }

  async getUserById(userId: string): Promise<HumanUser | null> {
    const result = await postgresPool().query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    return result.rowCount ? userFromRow(result.rows[0]) : null;
  }

  async getUserByNormalizedEmail(
    normalizedEmail: string
  ): Promise<HumanUser | null> {
    const result = await postgresPool().query(
      'SELECT * FROM users WHERE normalized_email = $1',
      [normalizedEmail]
    );
    return result.rowCount ? userFromRow(result.rows[0]) : null;
  }

  async upsertMembership(
    membership: AccountMembership
  ): Promise<AccountMembership> {
    const result = await postgresPool().query(
      `INSERT INTO account_memberships
        (account_id, user_id, role, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_id, user_id)
       DO UPDATE SET
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        membership.accountId,
        membership.userId,
        membership.role,
        membership.status,
        new Date(membership.createdAt),
        new Date(membership.updatedAt),
      ]
    );
    return membershipFromRow(result.rows[0]);
  }

  async getMembership(
    accountId: string,
    userId: string
  ): Promise<AccountMembership | null> {
    const result = await postgresPool().query(
      `SELECT *
       FROM account_memberships
       WHERE account_id = $1 AND user_id = $2`,
      [accountId, userId]
    );
    return result.rowCount
      ? membershipFromRow(result.rows[0])
      : null;
  }

  async listMemberships(
    userId: string
  ): Promise<AccountMembership[]> {
    const result = await postgresPool().query(
      `SELECT *
       FROM account_memberships
       WHERE user_id = $1
       ORDER BY account_id ASC`,
      [userId]
    );
    return result.rows.map(membershipFromRow);
  }

  async revokeMembership(
    accountId: string,
    userId: string,
    at: number
  ): Promise<AccountMembership | null> {
    const result = await postgresPool().query(
      `UPDATE account_memberships
       SET status = 'REVOKED',
           updated_at = $3
       WHERE account_id = $1 AND user_id = $2
       RETURNING *`,
      [accountId, userId, new Date(at)]
    );
    return result.rowCount
      ? membershipFromRow(result.rows[0])
      : null;
  }

  async createSession(
    session: BrowserSession
  ): Promise<BrowserSession> {
    return withTransaction(async (client) => {
      if (session.selectedWorkspaceId && !session.selectedAccountId) {
        throw new Error(
          'A selected workspace requires a selected account.'
        );
      }

      if (session.selectedAccountId) {
        await requireActiveMembership(
          client,
          session.userId,
          session.selectedAccountId
        );
      }

      if (
        session.selectedAccountId &&
        session.selectedWorkspaceId
      ) {
        await requireOwnedWorkspace(
          client,
          session.selectedAccountId,
          session.selectedWorkspaceId
        );
      }

      const result = await client.query(
        `INSERT INTO browser_sessions
          (id, user_id, token_hash, selected_account_id,
           selected_workspace_id, status, created_at, last_seen_at,
           expires_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          session.id,
          session.userId,
          session.tokenHash,
          session.selectedAccountId ?? null,
          session.selectedWorkspaceId ?? null,
          session.status,
          new Date(session.createdAt),
          new Date(session.lastSeenAt),
          new Date(session.expiresAt),
          session.revokedAt
            ? new Date(session.revokedAt)
            : null,
        ]
      );
      return sessionFromRow(result.rows[0]);
    });
  }

  async getSessionByTokenHash(
    tokenHash: string
  ): Promise<BrowserSession | null> {
    const result = await postgresPool().query(
      'SELECT * FROM browser_sessions WHERE token_hash = $1',
      [tokenHash]
    );
    return result.rowCount
      ? sessionFromRow(result.rows[0])
      : null;
  }

  async updateSessionSelection(params: {
    sessionId: string;
    selectedAccountId?: string;
    selectedWorkspaceId?: string;
    at: number;
  }): Promise<BrowserSession | null> {
    return withTransaction(async (client) => {
      const session = await requireSession(
        client,
        params.sessionId
      );

      if (
        params.selectedWorkspaceId &&
        !params.selectedAccountId
      ) {
        throw new Error(
          'A selected workspace requires a selected account.'
        );
      }

      if (params.selectedAccountId) {
        await requireActiveMembership(
          client,
          session.userId,
          params.selectedAccountId
        );
      }

      if (
        params.selectedAccountId &&
        params.selectedWorkspaceId
      ) {
        await requireOwnedWorkspace(
          client,
          params.selectedAccountId,
          params.selectedWorkspaceId
        );
      }

      const result = await client.query(
        `UPDATE browser_sessions
         SET selected_account_id = $2,
             selected_workspace_id = $3,
             last_seen_at = $4
         WHERE id = $1
         RETURNING *`,
        [
          params.sessionId,
          params.selectedAccountId ?? null,
          params.selectedWorkspaceId ?? null,
          new Date(params.at),
        ]
      );

      return result.rowCount
        ? sessionFromRow(result.rows[0])
        : null;
    });
  }

  async revokeSession(
    sessionId: string,
    at: number
  ): Promise<boolean> {
    const result = await postgresPool().query(
      `UPDATE browser_sessions
       SET status = 'REVOKED',
           revoked_at = COALESCE(revoked_at, $2),
           last_seen_at = $2
       WHERE id = $1 AND status <> 'REVOKED'`,
      [sessionId, new Date(at)]
    );
    return Boolean(result.rowCount);
  }

  async revokeAllSessionsForUser(
    userId: string,
    at: number
  ): Promise<number> {
    const result = await postgresPool().query(
      `UPDATE browser_sessions
       SET status = 'REVOKED',
           revoked_at = COALESCE(revoked_at, $2),
           last_seen_at = $2
       WHERE user_id = $1 AND status <> 'REVOKED'`,
      [userId, new Date(at)]
    );
    return result.rowCount || 0;
  }

  async workspaceBelongsToAccount(
    accountId: string,
    workspaceId: string
  ): Promise<boolean> {
    const result = await postgresPool().query(
      `SELECT 1
       FROM workspaces
       WHERE account_id = $1 AND id = $2`,
      [accountId, workspaceId]
    );
    return Boolean(result.rowCount);
  }
}

export const postgresIdentityFoundationRepository =
  new PostgresIdentityFoundationRepository();
