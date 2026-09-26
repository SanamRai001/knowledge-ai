import crypto from 'crypto';
import type {
  PoolClient,
} from 'pg';
import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import type {
  AccountMembershipRole,
  AccountMembershipStatus,
} from './types.js';
import {
  OrganizationMemberAdminError,
  type MembershipAdminAuditEntry,
  type OrganizationMember,
  type OrganizationMemberAdminRepository,
} from './organizationMemberAdminTypes.js';

function epoch(
  value: Date | string | number
): number {
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(
      'PostgreSQL returned an invalid organization membership timestamp.'
    );
  }
  return parsed;
}

function memberFromRow(
  row: any
): OrganizationMember {
  return {
    userId: row.user_id,
    email: row.email,
    displayName:
      row.display_name ?? undefined,
    userStatus: row.user_status,
    role: row.role,
    membershipStatus:
      row.membership_status,
    createdAt: epoch(
      row.membership_created_at
    ),
    updatedAt: epoch(
      row.membership_updated_at
    ),
  };
}

function auditFromRow(
  row: any
): MembershipAdminAuditEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    action: row.action,
    previousRole: row.previous_role,
    nextRole: row.next_role,
    previousStatus:
      row.previous_status,
    nextStatus: row.next_status,
    occurredAt: epoch(row.occurred_at),
  };
}

async function memberRow(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  userId: string
): Promise<OrganizationMember | null> {
  const result = await client.query(
    `SELECT
       membership.user_id,
       membership.role,
       membership.status AS membership_status,
       membership.created_at AS membership_created_at,
       membership.updated_at AS membership_updated_at,
       users.email,
       users.display_name,
       users.status AS user_status
     FROM account_memberships membership
     JOIN users
       ON users.id = membership.user_id
     WHERE membership.account_id = $1
       AND membership.user_id = $2`,
    [accountId, userId]
  );

  return result.rowCount
    ? memberFromRow(result.rows[0])
    : null;
}

async function lockedMembership(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  userId: string
): Promise<{
  userId: string;
  role: AccountMembershipRole;
  status: AccountMembershipStatus;
} | null> {
  const result = await client.query(
    `SELECT user_id, role, status
     FROM account_memberships
     WHERE account_id = $1
       AND user_id = $2
     FOR UPDATE`,
    [accountId, userId]
  );

  if (!result.rowCount) return null;
  return {
    userId: result.rows[0].user_id,
    role: result.rows[0].role,
    status: result.rows[0].status,
  };
}

async function requireActor(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  actorUserId: string
) {
  const actor =
    await lockedMembership(
      client,
      accountId,
      actorUserId
    );

  if (
    !actor ||
    actor.status !== 'ACTIVE' ||
    (actor.role !== 'OWNER' &&
      actor.role !== 'ADMIN')
  ) {
    throw new OrganizationMemberAdminError(
      'ORG_MEMBER_ADMIN_REQUIRED',
      403,
      'An active OWNER or ADMIN membership is required.'
    );
  }

  return actor;
}

async function lockActiveOwners(
  client: Pick<PoolClient, 'query'>,
  accountId: string
): Promise<string[]> {
  const owners = await client.query(
    `SELECT user_id
     FROM account_memberships
     WHERE account_id = $1
       AND role = 'OWNER'
       AND status = 'ACTIVE'
     ORDER BY user_id ASC
     FOR UPDATE`,
    [accountId]
  );
  return owners.rows.map(
    (row) => row.user_id
  );
}

function protectActorAndOwner(params: {
  actor: {
    userId: string;
    role: AccountMembershipRole;
  };
  target: {
    userId: string;
    role: AccountMembershipRole;
  };
  nextRole?: AccountMembershipRole;
}) {
  if (
    params.actor.userId ===
    params.target.userId
  ) {
    throw new OrganizationMemberAdminError(
      'ORG_MEMBER_SELF_MUTATION_FORBIDDEN',
      409,
      'Use another privileged member to change your own membership.'
    );
  }

  if (
    params.actor.role === 'ADMIN' &&
    (params.target.role === 'OWNER' ||
      params.nextRole === 'OWNER')
  ) {
    throw new OrganizationMemberAdminError(
      'ORG_MEMBER_OWNER_PROTECTED',
      403,
      'ADMIN members cannot change OWNER membership.'
    );
  }
}

async function insertAudit(
  client: Pick<PoolClient, 'query'>,
  input: {
    id: string;
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    action:
      | 'ROLE_CHANGED'
      | 'STATUS_CHANGED';
    previousRole: AccountMembershipRole;
    nextRole: AccountMembershipRole;
    previousStatus:
      AccountMembershipStatus;
    nextStatus:
      AccountMembershipStatus;
    at: number;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO account_membership_admin_audit
      (id, account_id, actor_user_id, target_user_id,
       action, previous_role, next_role,
       previous_status, next_status, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.id,
      input.accountId,
      input.actorUserId,
      input.targetUserId,
      input.action,
      input.previousRole,
      input.nextRole,
      input.previousStatus,
      input.nextStatus,
      new Date(input.at),
    ]
  );
}

export class PostgresOrganizationMemberAdminRepository
  implements OrganizationMemberAdminRepository
{
  async listMembers(
    accountId: string
  ): Promise<OrganizationMember[]> {
    const result =
      await postgresPool().query(
        `SELECT
           membership.user_id,
           membership.role,
           membership.status AS membership_status,
           membership.created_at AS membership_created_at,
           membership.updated_at AS membership_updated_at,
           users.email,
           users.display_name,
           users.status AS user_status
         FROM account_memberships membership
         JOIN users
           ON users.id = membership.user_id
         WHERE membership.account_id = $1
         ORDER BY
           CASE membership.role
             WHEN 'OWNER' THEN 0
             WHEN 'ADMIN' THEN 1
             ELSE 2
           END,
           users.normalized_email ASC`,
        [accountId]
      );

    return result.rows.map(
      memberFromRow
    );
  }

  async changeRole(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    nextRole: AccountMembershipRole;
    auditId: string;
    at: number;
  }): Promise<OrganizationMember> {
    return withTransaction(
      async (client) => {
        const actor =
          await requireActor(
            client,
            params.accountId,
            params.actorUserId
          );
        const target =
          await lockedMembership(
            client,
            params.accountId,
            params.targetUserId
          );

        if (!target) {
          throw new OrganizationMemberAdminError(
            'ORG_MEMBER_NOT_FOUND',
            404,
            'Account member was not found.'
          );
        }

        protectActorAndOwner({
          actor,
          target,
          nextRole: params.nextRole,
        });

        if (target.status !== 'ACTIVE') {
          throw new OrganizationMemberAdminError(
            'ORG_MEMBER_INACTIVE_ROLE_CHANGE',
            409,
            'Restore the membership before changing its role.'
          );
        }

        if (
          target.role === params.nextRole
        ) {
          return (
            await memberRow(
              client,
              params.accountId,
              params.targetUserId
            )
          )!;
        }

        if (
          target.role === 'OWNER' &&
          params.nextRole !== 'OWNER'
        ) {
          const activeOwners =
            await lockActiveOwners(
              client,
              params.accountId
            );
          if (activeOwners.length <= 1) {
            throw new OrganizationMemberAdminError(
              'ORG_MEMBER_LAST_OWNER',
              409,
              'The last active OWNER cannot be demoted.'
            );
          }
        }

        await client.query(
          `UPDATE account_memberships
           SET role = $3,
               updated_at = $4
           WHERE account_id = $1
             AND user_id = $2`,
          [
            params.accountId,
            params.targetUserId,
            params.nextRole,
            new Date(params.at),
          ]
        );

        await insertAudit(client, {
          id: params.auditId,
          accountId: params.accountId,
          actorUserId:
            params.actorUserId,
          targetUserId:
            params.targetUserId,
          action: 'ROLE_CHANGED',
          previousRole: target.role,
          nextRole: params.nextRole,
          previousStatus:
            target.status,
          nextStatus: target.status,
          at: params.at,
        });

        return (
          await memberRow(
            client,
            params.accountId,
            params.targetUserId
          )
        )!;
      }
    );
  }

  async changeStatus(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    nextStatus:
      AccountMembershipStatus;
    auditId: string;
    at: number;
  }): Promise<OrganizationMember> {
    return withTransaction(
      async (client) => {
        const actor =
          await requireActor(
            client,
            params.accountId,
            params.actorUserId
          );
        const target =
          await lockedMembership(
            client,
            params.accountId,
            params.targetUserId
          );

        if (!target) {
          throw new OrganizationMemberAdminError(
            'ORG_MEMBER_NOT_FOUND',
            404,
            'Account member was not found.'
          );
        }

        protectActorAndOwner({
          actor,
          target,
        });

        if (
          target.status ===
          params.nextStatus
        ) {
          return (
            await memberRow(
              client,
              params.accountId,
              params.targetUserId
            )
          )!;
        }

        if (
          target.role === 'OWNER' &&
          params.nextStatus === 'REVOKED'
        ) {
          const activeOwners =
            await lockActiveOwners(
              client,
              params.accountId
            );
          if (activeOwners.length <= 1) {
            throw new OrganizationMemberAdminError(
              'ORG_MEMBER_LAST_OWNER',
              409,
              'The last active OWNER cannot be revoked.'
            );
          }
        }

        await client.query(
          `UPDATE account_memberships
           SET status = $3,
               updated_at = $4
           WHERE account_id = $1
             AND user_id = $2`,
          [
            params.accountId,
            params.targetUserId,
            params.nextStatus,
            new Date(params.at),
          ]
        );

        if (
          params.nextStatus === 'REVOKED'
        ) {
          await client.query(
            `UPDATE browser_sessions
             SET selected_account_id = NULL,
                 selected_workspace_id = NULL,
                 last_seen_at = $3
             WHERE user_id = $1
               AND selected_account_id = $2
               AND status = 'ACTIVE'`,
            [
              params.targetUserId,
              params.accountId,
              new Date(params.at),
            ]
          );
        }

        await insertAudit(client, {
          id: params.auditId,
          accountId: params.accountId,
          actorUserId:
            params.actorUserId,
          targetUserId:
            params.targetUserId,
          action: 'STATUS_CHANGED',
          previousRole: target.role,
          nextRole: target.role,
          previousStatus:
            target.status,
          nextStatus:
            params.nextStatus,
          at: params.at,
        });

        return (
          await memberRow(
            client,
            params.accountId,
            params.targetUserId
          )
        )!;
      }
    );
  }

  async listAudit(params: {
    accountId: string;
    limit?: number;
  }): Promise<MembershipAdminAuditEntry[]> {
    const limit = Math.max(
      1,
      Math.min(params.limit || 100, 500)
    );
    const result =
      await postgresPool().query(
        `SELECT *
         FROM account_membership_admin_audit
         WHERE account_id = $1
         ORDER BY occurred_at DESC, id DESC
         LIMIT $2`,
        [params.accountId, limit]
      );
    return result.rows.map(
      auditFromRow
    );
  }
}

export const postgresOrganizationMemberAdminRepository =
  new PostgresOrganizationMemberAdminRepository();

export function organizationAuditId(): string {
  return (
    'memaud_' +
    crypto.randomBytes(12).toString('hex')
  );
}
