import crypto from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleDriveOAuthAttempt {
  accountId: string;
  displayName: string;
  redirectUri: string;
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
  public readonly statusCode = 400;
  public readonly code:
    | 'OAUTH_STATE_INVALID'
    | 'OAUTH_STATE_EXPIRED';

  constructor(
    code: 'OAUTH_STATE_INVALID' | 'OAUTH_STATE_EXPIRED',
    message: string
  ) {
    super(message);
    this.name = 'GoogleDriveOAuthStateError';
    this.code = code;
  }
}

export class GoogleDriveOAuthStateStore {
  private attempts = new Map<string, StoredAttempt>();

  public create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
  }): { state: string; attempt: GoogleDriveOAuthAttempt } {
    this.prune();

    const state = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const attempt: StoredAttempt = {
      accountId: params.accountId,
      displayName: params.displayName,
      redirectUri: params.redirectUri,
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
        createdAt: attempt.createdAt,
        expiresAt: attempt.expiresAt,
      },
    };
  }

  public consume(state: string): GoogleDriveOAuthAttempt {
    this.prune();

    const stateHash = hashState(state);
    const attempt = this.attempts.get(stateHash);
    if (!attempt) {
      throw new GoogleDriveOAuthStateError(
        'OAUTH_STATE_INVALID',
        'Google Drive OAuth state is invalid or has already been consumed.'
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
