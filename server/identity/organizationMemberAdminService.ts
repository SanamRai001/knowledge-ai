import type {
  AccountMembershipRole,
  AccountMembershipStatus,
} from './types.js';
import {
  OrganizationMemberAdminError,
  type OrganizationMemberAdminRepository,
} from './organizationMemberAdminTypes.js';
import {
  organizationAuditId,
  postgresOrganizationMemberAdminRepository,
} from './postgresOrganizationMemberAdminRepository.js';

const ROLES:
  readonly AccountMembershipRole[] = [
    'OWNER',
    'ADMIN',
    'MEMBER',
  ];
const STATUSES:
  readonly AccountMembershipStatus[] = [
    'ACTIVE',
    'REVOKED',
  ];

export class OrganizationMemberAdminService {
  constructor(
    private readonly repository:
      OrganizationMemberAdminRepository =
        postgresOrganizationMemberAdminRepository
  ) {}

  async listMembers(
    accountId: string
  ) {
    return this.repository.listMembers(
      accountId
    );
  }

  async changeRole(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    nextRole: unknown;
  }) {
    if (
      typeof params.nextRole !==
        'string' ||
      !ROLES.includes(
        params.nextRole as
          AccountMembershipRole
      )
    ) {
      throw new OrganizationMemberAdminError(
        'ORG_MEMBER_ROLE_INVALID',
        400,
        'Role must be OWNER, ADMIN, or MEMBER.'
      );
    }

    return this.repository.changeRole({
      accountId: params.accountId,
      actorUserId:
        params.actorUserId,
      targetUserId:
        params.targetUserId,
      nextRole:
        params.nextRole as
          AccountMembershipRole,
      auditId: organizationAuditId(),
      at: Date.now(),
    });
  }

  async changeStatus(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    nextStatus: unknown;
  }) {
    if (
      typeof params.nextStatus !==
        'string' ||
      !STATUSES.includes(
        params.nextStatus as
          AccountMembershipStatus
      )
    ) {
      throw new OrganizationMemberAdminError(
        'ORG_MEMBER_STATUS_INVALID',
        400,
        'Membership status must be ACTIVE or REVOKED.'
      );
    }

    return this.repository.changeStatus({
      accountId: params.accountId,
      actorUserId:
        params.actorUserId,
      targetUserId:
        params.targetUserId,
      nextStatus:
        params.nextStatus as
          AccountMembershipStatus,
      auditId: organizationAuditId(),
      at: Date.now(),
    });
  }

  async listAudit(
    accountId: string,
    limit?: number
  ) {
    return this.repository.listAudit({
      accountId,
      limit,
    });
  }
}

export const organizationMemberAdminService =
  new OrganizationMemberAdminService();
