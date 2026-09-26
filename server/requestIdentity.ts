import type express from 'express';
import { apiKeyStore } from './apiKeyStore.js';
import { apiKeyRuntimeService } from './apiKeyRuntimeService.js';
import {
  humanAuthService,
} from './identity/humanAuthService.js';
import {
  AUTH_SESSION_COOKIE,
  parseCookieHeader,
} from './identity/authHttpSecurity.js';
import type {
  AccountMembershipRole,
} from './identity/types.js';

export type RequestIdentitySource =
  | 'API_KEY'
  | 'HUMAN_SESSION'
  | 'DEFAULT_WEB';

export interface RequestIdentity {
  accountId: string;
  source: RequestIdentitySource;
  authenticated: boolean;
  apiKeyId?: string;
  userId?: string;
  membershipRole?: AccountMembershipRole;
  sessionId?: string;
  workspaceId?: string;
}

export type RequestIdentityErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'AMBIGUOUS_CREDENTIALS'
  | 'ACCOUNT_SELECTION_REQUIRED'
  | 'RATE_LIMITED';

export class RequestIdentityError extends Error {
  public statusCode: number;
  public code: RequestIdentityErrorCode;
  public readonly retryAfterSeconds?: number;

  constructor(
    code: RequestIdentityErrorCode,
    statusCode: number,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'RequestIdentityError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds =
      retryAfterSeconds;
  }
}

function humanSessionSecret(
  req: express.Request
): string | undefined {
  return parseCookieHeader(req.headers.cookie)[
    AUTH_SESSION_COOKIE
  ];
}

async function resolveApiKeyIdentity(
  authHeader: string | string[] | undefined
): Promise<RequestIdentity | null> {
  if (!authHeader) return null;

  if (typeof authHeader !== 'string') {
    throw new RequestIdentityError(
      'UNAUTHORIZED',
      401,
      'Invalid Authorization header.'
    );
  }

  const parts = authHeader.trim().split(/\s+/);
  if (
    parts.length !== 2 ||
    parts[0].toLowerCase() !== 'bearer'
  ) {
    throw new RequestIdentityError(
      'UNAUTHORIZED',
      401,
      'Invalid Authorization header format. Expected "Bearer <API_KEY>".'
    );
  }

  const validation = apiKeyStore.validateApiKey(parts[1]);
  if (!validation.valid || !validation.apiKey) {
    const revoked =
      validation.error
        ?.toLowerCase()
        .includes('revoked') || false;
    throw new RequestIdentityError(
      revoked ? 'FORBIDDEN' : 'UNAUTHORIZED',
      revoked ? 403 : 401,
      validation.error || 'Invalid API key.'
    );
  }

  const rateLimit =
    await apiKeyRuntimeService
      .checkRateLimit(
        validation.apiKey.id
      );
  if (!rateLimit.allowed) {
    throw new RequestIdentityError(
      'RATE_LIMITED',
      429,
      'Rate limit exceeded. Please try again later.',
      rateLimit.resetSeconds
    );
  }

  apiKeyRuntimeService.noteValidatedKey(
    validation.apiKey
  );

  return {
    accountId: validation.apiKey.accountId,
    source: 'API_KEY',
    authenticated: true,
    apiKeyId: validation.apiKey.id,
  };
}

function allowLegacyDefaultWeb(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB ===
      'true'
  );
}

function defaultWebIdentity(): RequestIdentity {
  if (!allowLegacyDefaultWeb()) {
    throw new RequestIdentityError(
      'UNAUTHORIZED',
      401,
      'Authentication is required.'
    );
  }

  return {
    accountId: 'acc_default',
    source: 'DEFAULT_WEB',
    authenticated: false,
  };
}

function assertSingleCredentialClass(
  authHeader: string | string[] | undefined,
  sessionSecret: string | undefined
): void {
  if (authHeader && sessionSecret) {
    throw new RequestIdentityError(
      'AMBIGUOUS_CREDENTIALS',
      400,
      'Use either a human browser session or an API key, not both.'
    );
  }
}

/**
 * Legacy synchronous account-scoped resolver.
 *
 * B2B2 security invariant:
 * - API keys remain synchronous machine credentials
 * - human sessions are never silently treated as DEFAULT_WEB
 * - missing credentials may use DEFAULT_WEB only when an explicit
 *   non-production compatibility switch is enabled
 * - production never silently becomes acc_default
 *
 * B2C will replace product-router use of this resolver with
 * resolveAuthenticatedRequestIdentity().
 */
export function resolveRequestIdentity(
  req: express.Request
): RequestIdentity {
  const authHeader = req.headers.authorization;
  const sessionSecret = humanSessionSecret(req);

  assertSingleCredentialClass(
    authHeader,
    sessionSecret
  );

  const apiKeyIdentity =
    await resolveApiKeyIdentity(
      authHeader
    );
  if (apiKeyIdentity) {
    return apiKeyIdentity;
  }

  if (sessionSecret) {
    throw new RequestIdentityError(
      'UNAUTHORIZED',
      401,
      'This route has not yet been cut over to human-session identity.'
    );
  }

  return defaultWebIdentity();
}

/**
 * Async human-aware resolver for B2C browser route cutover.
 *
 * Credential classes are deliberately distinct:
 * - Authorization: Bearer <key> => API_KEY
 * - ka_session cookie => HUMAN_SESSION
 * - neither => explicit non-production DEFAULT_WEB compatibility only
 */
export async function resolveAuthenticatedRequestIdentity(
  req: express.Request
): Promise<RequestIdentity> {
  const authHeader = req.headers.authorization;
  const sessionSecret = humanSessionSecret(req);

  assertSingleCredentialClass(
    authHeader,
    sessionSecret
  );

  const apiKeyIdentity =
    resolveApiKeyIdentity(authHeader);
  if (apiKeyIdentity) {
    return apiKeyIdentity;
  }

  if (!sessionSecret) {
    return defaultWebIdentity();
  }

  let context;
  try {
    context =
      await humanAuthService.resolveSession(
        sessionSecret
      );
  } catch {
    throw new RequestIdentityError(
      'UNAUTHORIZED',
      401,
      'Human session is invalid or expired.'
    );
  }

  const accountId =
    context.session.selectedAccountId;
  const membership = context.membership;

  if (!accountId || !membership) {
    throw new RequestIdentityError(
      'ACCOUNT_SELECTION_REQUIRED',
      409,
      'Select an account before using account-scoped application routes.'
    );
  }

  return {
    accountId,
    source: 'HUMAN_SESSION',
    authenticated: true,
    userId: context.user.id,
    membershipRole: membership.role,
    sessionId: context.session.id,
    workspaceId:
      context.session.selectedWorkspaceId,
  };
}
