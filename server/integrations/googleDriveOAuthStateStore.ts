import crypto from 'crypto';
import {
  postgresPersistenceEnabled,
} from '../persistence/postgres.js';
import {
  distributedSecurityState,
  hashOAuthState,
} from '../security/distributedSecurityState.js';
import {
  cleanupExpiredOAuthSecurityState,
} from './oauthAttemptSecurityCleanup.js';

const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleDriveOAuthAttempt {
  accountId: string;
  displayName: string;
  redirectUri: string;
  connectionId?: string;
  createdAt: number;
  expiresAt: number;
}

type StoredAttempt = GoogleDriveOAuthAttempt & {
  stateHash: string;
};

function hashState(state: string): string {
  return crypto
    .createHash('sha256')
    .update(state, 'utf8')
    .digest('hex');
}

export class GoogleDriveOAuthStateError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'OAUTH_STATE_INVALID'
    | 'OAUTH_STATE_EXPIRED'
    | 'OAUTH_ACCOUNT_MISMATCH';

  constructor(
    code:
      | 'OAUTH_STATE_INVALID'
      | 'OAUTH_STATE_EXPIRED'
      | 'OAUTH_ACCOUNT_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'GoogleDriveOAuthStateError';
    this.code = code;
    this.statusCode =
      code ===
        'OAUTH_ACCOUNT_MISMATCH'
        ? 403
        : 400;
  }
}

export class GoogleDriveOAuthStateStore {
  private attempts = new Map<string, StoredAttempt>();

  public create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
    connectionId?: string;
  }): { state: string; attempt: GoogleDriveOAuthAttempt } {
    this.prune();

    const state = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const attempt: StoredAttempt = {
      accountId: params.accountId,
      displayName: params.displayName,
      redirectUri: params.redirectUri,
      connectionId: params.connectionId,
      createdAt: now,
      expiresAt: now + STATE_TTL_MS,
      stateHash: hashState(state),
    };

    this.attempts.set(attempt.stateHash, attempt);
    return {
      state,
      attempt: {
        accountId: attempt.accountId,
        displayName: attempt.displayName,
        redirectUri: attempt.redirectUri,
        connectionId: attempt.connectionId,
        createdAt: attempt.createdAt,
        expiresAt: attempt.expiresAt,
      },
    };
  }

  public consume(
    state: string,
    expectedAccountId?: string
  ): GoogleDriveOAuthAttempt {
    this.prune();

    const stateHash = hashState(state);
    const attempt = this.attempts.get(stateHash);
    if (!attempt) {
      throw new GoogleDriveOAuthStateError(
        'OAUTH_STATE_INVALID',
        'Google Drive OAuth state is invalid or has already been consumed.'
      );
    }

    if (
      expectedAccountId &&
      attempt.accountId !==
        expectedAccountId
    ) {
      throw new GoogleDriveOAuthStateError(
        'OAUTH_ACCOUNT_MISMATCH',
        'Google Drive OAuth state belongs to a different account.'
      );
    }

    this.attempts.delete(stateHash);

    if (attempt.expiresAt <= Date.now()) {
      throw new GoogleDriveOAuthStateError(
        'OAUTH_STATE_EXPIRED',
        'Google Drive OAuth state expired before the callback completed.'
      );
    }

    return {
      accountId: attempt.accountId,
      displayName: attempt.displayName,
      redirectUri: attempt.redirectUri,
      connectionId: attempt.connectionId,
      createdAt: attempt.createdAt,
      expiresAt: attempt.expiresAt,
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, attempt] of this.attempts) {
      if (attempt.expiresAt <= now) {
        this.attempts.delete(key);
      }
    }
  }
}

export const googleDriveOAuthStateStore =
  new GoogleDriveOAuthStateStore();


export interface GoogleDriveOAuthStateAccess {
  create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
    connectionId?: string;
  }):
    | {
        state: string;
        attempt: GoogleDriveOAuthAttempt;
      }
    | Promise<{
        state: string;
        attempt: GoogleDriveOAuthAttempt;
      }>;

  consume(
    state: string,
    expectedAccountId?: string
  ):
    | GoogleDriveOAuthAttempt
    | Promise<GoogleDriveOAuthAttempt>;
}

export class GoogleDriveOAuthStateRuntime
  implements GoogleDriveOAuthStateAccess
{
  constructor(
    private readonly localStore:
      GoogleDriveOAuthStateStore =
        googleDriveOAuthStateStore
  ) {}

  async create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
    connectionId?: string;
  }): Promise<{
    state: string;
    attempt: GoogleDriveOAuthAttempt;
  }> {
    if (
      !postgresPersistenceEnabled()
    ) {
      return this.localStore.create(
        params
      );
    }

    const state =
      crypto.randomBytes(32)
        .toString('base64url');
    const now = Date.now();
    const attempt:
      GoogleDriveOAuthAttempt = {
        accountId: params.accountId,
        displayName:
          params.displayName,
        redirectUri:
          params.redirectUri,
        connectionId:
          params.connectionId,
        createdAt: now,
        expiresAt:
          now + STATE_TTL_MS,
      };

    await distributedSecurityState
      .createOAuthAttempt({
        stateHash:
          hashOAuthState(state),
        attempt: {
          provider:
            'GOOGLE_DRIVE',
          ...attempt,
        },
      });

    await cleanupExpiredOAuthSecurityState()
      .catch(() => undefined);

    return {
      state,
      attempt,
    };
  }

  async consume(
    state: string,
    expectedAccountId?: string
  ): Promise<GoogleDriveOAuthAttempt> {
    if (
      !postgresPersistenceEnabled()
    ) {
      return this.localStore.consume(
        state,
        expectedAccountId
      );
    }

    const result =
      await distributedSecurityState
        .consumeOAuthAttempt({
          provider:
            'GOOGLE_DRIVE',
          stateHash:
            hashOAuthState(state),
          expectedAccountId,
        });

    if (
      result.status === 'INVALID'
    ) {
      throw new GoogleDriveOAuthStateError(
        'OAUTH_STATE_INVALID',
        'Google Drive OAuth state is invalid or has already been consumed.'
      );
    }
    if (
      result.status ===
      'ACCOUNT_MISMATCH'
    ) {
      throw new GoogleDriveOAuthStateError(
        'OAUTH_ACCOUNT_MISMATCH',
        'Google Drive OAuth state belongs to a different account.'
      );
    }
    if (
      result.status === 'EXPIRED'
    ) {
      throw new GoogleDriveOAuthStateError(
        'OAUTH_STATE_EXPIRED',
        'Google Drive OAuth state expired before the callback completed.'
      );
    }

    return {
      accountId:
        result.attempt.accountId,
      displayName:
        result.attempt.displayName,
      redirectUri:
        result.attempt.redirectUri,
      connectionId:
        result.attempt.connectionId,
      createdAt:
        result.attempt.createdAt,
      expiresAt:
        result.attempt.expiresAt,
    };
  }
}

export const googleDriveOAuthStateRuntime =
  new GoogleDriveOAuthStateRuntime();
