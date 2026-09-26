import type {
  AccountMembershipRole,
  AccountMembershipStatus,
  HumanUserStatus,
} from './types.js';

export interface OrganizationMember {
  userId: string;
  email: string;
  displayName?: string;
  userStatus: HumanUserStatus;
  role: AccountMembershipRole;
  membershipStatus: AccountMembershipStatus;
  createdAt: number;
  updatedAt: number;
}

export type MembershipAdminAction =
  | 'ROLE_CHANGED'
  | 'STATUS_CHANGED';

export interface MembershipAdminAuditEntry {
  id: string;
  accountId: string;
  actorUserId: string;
  targetUserId: string;
  action: MembershipAdminAction;
  previousRole: AccountMembershipRole;
  nextRole: AccountMembershipRole;
  previousStatus: AccountMembershipStatus;
  nextStatus: AccountMembershipStatus;
  occurredAt: number;
}

export interface OrganizationMemberAdminRepository {
  listMembers(
    accountId: string
  ): Promise<OrganizationMember[]>;

  changeRole(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    nextRole: AccountMembershipRole;
    auditId: string;
    at: number;
  }): Promise<OrganizationMember>;

  changeStatus(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    nextStatus: AccountMembershipStatus;
    auditId: string;
    at: number;
  }): Promise<OrganizationMember>;

  listAudit(params: {
    accountId: string;
    limit?: number;
  }): Promise<MembershipAdminAuditEntry[]>;
}


export type OrganizationMemberAdminErrorCode =
  | 'ORG_MEMBER_NOT_FOUND'
  | 'ORG_MEMBER_ADMIN_REQUIRED'
  | 'ORG_MEMBER_OWNER_PROTECTED'
  | 'ORG_MEMBER_SELF_MUTATION_FORBIDDEN'
  | 'ORG_MEMBER_LAST_OWNER'
  | 'ORG_MEMBER_INACTIVE_ROLE_CHANGE'
  | 'ORG_MEMBER_ROLE_INVALID'
  | 'ORG_MEMBER_STATUS_INVALID';

export class OrganizationMemberAdminError
  extends Error
{
  constructor(
    public readonly code:
      OrganizationMemberAdminErrorCode,
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name =
      'OrganizationMemberAdminError';
  }
}
