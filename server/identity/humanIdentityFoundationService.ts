import crypto from 'crypto';
import { postgresIdentityFoundationRepository } from './postgresIdentityFoundationRepository.js';
import type {
  AccountMembership,
  AccountMembershipRole,
  BrowserSession,
  BrowserSessionContext,
  HumanUser,
  IdentityFoundationRepository,
} from './types.js';

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type HumanIdentityFoundationErrorCode =
  | 'IDENTITY_EMAIL_INVALID'
  | 'IDENTITY_USER_NOT_FOUND'
  | 'IDENTITY_USER_DISABLED'
  | 'IDENTITY_MEMBERSHIP_REQUIRED'
  | 'IDENTITY_MEMBERSHIP_REVOKED'
  | 'IDENTITY_WORKSPACE_OUT_OF_SCOPE'
  | 'IDENTITY_SESSION_NOT_FOUND'
  | 'IDENTITY_SESSION_REVOKED'
  | 'IDENTITY_SESSION_EXPIRED'
  | 'IDENTITY_SESSION_SELECTION_INVALID';

export class HumanIdentityFoundationError extends Error {
  public readonly code: HumanIdentityFoundationErrorCode;

  constructor(
    code: HumanIdentityFoundationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'HumanIdentityFoundationError';
    this.code = code;
  }
}

export function normalizeHumanEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    !normalized.includes('@')
  ) {
    throw new HumanIdentityFoundationError(
      'IDENTITY_EMAIL_INVALID',
      'A valid user email is required.'
    );
  }
  return normalized;
}

export function hashBrowserSessionToken(token: string): string {
  if (!token) {
    throw new HumanIdentityFoundationError(
      'IDENTITY_SESSION_NOT_FOUND',
      'Browser session token is missing.'
    );
  }
  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

function id(prefix: string): string {
  return (
    prefix +
    '_' +
    crypto.randomBytes(16).toString('hex')
  );
}

function sessionSecret(): string {
  return (
    'kaisess_' +
    crypto.randomBytes(32).toString('base64url')
  );
}

export class HumanIdentityFoundationService {
  constructor(
    private readonly repository: IdentityFoundationRepository =
      postgresIdentityFoundationRepository
  ) {}

  async createUser(params: {
    email: string;
    displayName?: string;
  }): Promise<HumanUser> {
    const normalizedEmail = normalizeHumanEmail(params.email);
    const existing =
      await this.repository.getUserByNormalizedEmail(
        normalizedEmail
      );
    if (existing) return existing;

    const now = Date.now();
    return this.repository.createUser({
      id: id('usr'),
      email: params.email.trim(),
      normalizedEmail,
      displayName: params.displayName?.trim() || undefined,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
  }

  async upsertMembership(params: {
    accountId: string;
    userId: string;
    role: AccountMembershipRole;
  }): Promise<AccountMembership> {
    const user = await this.requireActiveUser(params.userId);
    const existing = await this.repository.getMembership(
      params.accountId,
      user.id
    );
    const now = Date.now();

    return this.repository.upsertMembership({
      accountId: params.accountId,
      userId: user.id,
      role: params.role,
      status: 'ACTIVE',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async revokeMembership(params: {
    accountId: string;
    userId: string;
  }): Promise<AccountMembership> {
    const membership =
      await this.repository.revokeMembership(
        params.accountId,
        params.userId,
        Date.now()
      );
    if (!membership) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_MEMBERSHIP_REQUIRED',
        'Account membership was not found.'
      );
    }
    return membership;
  }

  async createSession(params: {
    userId: string;
    selectedAccountId?: string;
    selectedWorkspaceId?: string;
    ttlMs?: number;
  }): Promise<{
    session: BrowserSession;
    secret: string;
  }> {
    await this.requireActiveUser(params.userId);
    await this.validateSelection(
      params.userId,
      params.selectedAccountId,
      params.selectedWorkspaceId
    );

    const ttlMs =
      params.ttlMs === undefined
        ? DEFAULT_SESSION_TTL_MS
        : params.ttlMs;
    if (
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > MAX_SESSION_TTL_MS
    ) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_SESSION_SELECTION_INVALID',
        'Session TTL must be greater than zero and no more than 30 days.'
      );
    }

    const secret = sessionSecret();
    const now = Date.now();
    const session = await this.repository.createSession({
      id: id('sess'),
      userId: params.userId,
      tokenHash: hashBrowserSessionToken(secret),
      selectedAccountId: params.selectedAccountId,
      selectedWorkspaceId: params.selectedWorkspaceId,
      status: 'ACTIVE',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ttlMs,
    });

    return { session, secret };
  }

  async resolveSession(
    secret: string
  ): Promise<BrowserSessionContext> {
    const session =
      await this.repository.getSessionByTokenHash(
        hashBrowserSessionToken(secret)
      );

    if (!session) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_SESSION_NOT_FOUND',
        'Browser session was not found.'
      );
    }
    if (session.status !== 'ACTIVE') {
      throw new HumanIdentityFoundationError(
        'IDENTITY_SESSION_REVOKED',
        'Browser session has been revoked.'
      );
    }
    if (session.expiresAt <= Date.now()) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_SESSION_EXPIRED',
        'Browser session has expired.'
      );
    }

    const user = await this.requireActiveUser(session.userId);

    let membership: AccountMembership | undefined;
    if (session.selectedAccountId) {
      membership = await this.repository.getMembership(
        session.selectedAccountId,
        user.id
      ) || undefined;

      if (!membership) {
        throw new HumanIdentityFoundationError(
          'IDENTITY_MEMBERSHIP_REQUIRED',
          'Selected account is not available to this user.'
        );
      }
      if (membership.status !== 'ACTIVE') {
        throw new HumanIdentityFoundationError(
          'IDENTITY_MEMBERSHIP_REVOKED',
          'Selected account membership has been revoked.'
        );
      }
    }

    if (
      session.selectedWorkspaceId &&
      session.selectedAccountId
    ) {
      const owned =
        await this.repository.workspaceBelongsToAccount(
          session.selectedAccountId,
          session.selectedWorkspaceId
        );
      if (!owned) {
        throw new HumanIdentityFoundationError(
          'IDENTITY_WORKSPACE_OUT_OF_SCOPE',
          'Selected workspace is outside the selected account.'
        );
      }
    }

    return {
      user,
      session,
      membership,
    };
  }

  async selectAccount(params: {
    secret: string;
    accountId: string;
  }): Promise<BrowserSessionContext> {
    const context = await this.resolveSession(params.secret);
    await this.requireActiveMembership(
      context.user.id,
      params.accountId
    );

    await this.repository.updateSessionSelection({
      sessionId: context.session.id,
      selectedAccountId: params.accountId,
      selectedWorkspaceId: undefined,
      at: Date.now(),
    });

    return this.resolveSession(params.secret);
  }

  async selectWorkspace(params: {
    secret: string;
    workspaceId: string;
  }): Promise<BrowserSessionContext> {
    const context = await this.resolveSession(params.secret);
    const accountId = context.session.selectedAccountId;
    if (!accountId) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_SESSION_SELECTION_INVALID',
        'Select an account before selecting a workspace.'
      );
    }

    const owned =
      await this.repository.workspaceBelongsToAccount(
        accountId,
        params.workspaceId
      );
    if (!owned) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_WORKSPACE_OUT_OF_SCOPE',
        'Workspace is outside the selected account.'
      );
    }

    await this.repository.updateSessionSelection({
      sessionId: context.session.id,
      selectedAccountId: accountId,
      selectedWorkspaceId: params.workspaceId,
      at: Date.now(),
    });

    return this.resolveSession(params.secret);
  }

  async revokeSession(secret: string): Promise<boolean> {
    const session =
      await this.repository.getSessionByTokenHash(
        hashBrowserSessionToken(secret)
      );
    if (!session) return false;
    return this.repository.revokeSession(
      session.id,
      Date.now()
    );
  }

  async revokeAllSessionsForUser(
    userId: string
  ): Promise<number> {
    return this.repository.revokeAllSessionsForUser(
      userId,
      Date.now()
    );
  }

  private async requireActiveUser(
    userId: string
  ): Promise<HumanUser> {
    const user = await this.repository.getUserById(userId);
    if (!user) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_USER_NOT_FOUND',
        'User was not found.'
      );
    }
    if (user.status !== 'ACTIVE') {
      throw new HumanIdentityFoundationError(
        'IDENTITY_USER_DISABLED',
        'User is disabled.'
      );
    }
    return user;
  }

  private async requireActiveMembership(
    userId: string,
    accountId: string
  ): Promise<AccountMembership> {
    const membership = await this.repository.getMembership(
      accountId,
      userId
    );
    if (!membership) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_MEMBERSHIP_REQUIRED',
        'User is not a member of the selected account.'
      );
    }
    if (membership.status !== 'ACTIVE') {
      throw new HumanIdentityFoundationError(
        'IDENTITY_MEMBERSHIP_REVOKED',
        'Account membership has been revoked.'
      );
    }
    return membership;
  }

  private async validateSelection(
    userId: string,
    selectedAccountId?: string,
    selectedWorkspaceId?: string
  ): Promise<void> {
    if (selectedWorkspaceId && !selectedAccountId) {
      throw new HumanIdentityFoundationError(
        'IDENTITY_SESSION_SELECTION_INVALID',
        'A selected workspace requires a selected account.'
      );
    }
    if (!selectedAccountId) return;

    await this.requireActiveMembership(
      userId,
      selectedAccountId
    );

    if (selectedWorkspaceId) {
      const owned =
        await this.repository.workspaceBelongsToAccount(
          selectedAccountId,
          selectedWorkspaceId
        );
      if (!owned) {
        throw new HumanIdentityFoundationError(
          'IDENTITY_WORKSPACE_OUT_OF_SCOPE',
          'Workspace is outside the selected account.'
        );
      }
    }
  }
}

export const humanIdentityFoundationService =
  new HumanIdentityFoundationService();
