export type HumanUserStatus = 'ACTIVE' | 'DISABLED';
export type AccountMembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type AccountMembershipStatus = 'ACTIVE' | 'REVOKED';
export type BrowserSessionStatus = 'ACTIVE' | 'REVOKED';

export interface HumanUser {
  id: string;
  email: string;
  normalizedEmail: string;
  displayName?: string;
  status: HumanUserStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AccountMembership {
  accountId: string;
  userId: string;
  role: AccountMembershipRole;
  status: AccountMembershipStatus;
  createdAt: number;
  updatedAt: number;
}

export interface BrowserSession {
  id: string;
  userId: string;
  tokenHash: string;
  selectedAccountId?: string;
  selectedWorkspaceId?: string;
  status: BrowserSessionStatus;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export interface BrowserSessionContext {
  user: HumanUser;
  session: BrowserSession;
  membership?: AccountMembership;
}

export interface IdentityFoundationRepository {
  createUser(user: HumanUser): Promise<HumanUser>;
  getUserById(userId: string): Promise<HumanUser | null>;
  getUserByNormalizedEmail(
    normalizedEmail: string
  ): Promise<HumanUser | null>;

  upsertMembership(
    membership: AccountMembership
  ): Promise<AccountMembership>;
  getMembership(
    accountId: string,
    userId: string
  ): Promise<AccountMembership | null>;
  listMemberships(userId: string): Promise<AccountMembership[]>;
  revokeMembership(
    accountId: string,
    userId: string,
    at: number
  ): Promise<AccountMembership | null>;

  createSession(
    session: BrowserSession
  ): Promise<BrowserSession>;
  getSessionByTokenHash(
    tokenHash: string
  ): Promise<BrowserSession | null>;
  updateSessionSelection(params: {
    sessionId: string;
    selectedAccountId?: string;
    selectedWorkspaceId?: string;
    at: number;
  }): Promise<BrowserSession | null>;
  revokeSession(
    sessionId: string,
    at: number
  ): Promise<boolean>;
  revokeAllSessionsForUser(
    userId: string,
    at: number
  ): Promise<number>;

  workspaceBelongsToAccount(
    accountId: string,
    workspaceId: string
  ): Promise<boolean>;
}
