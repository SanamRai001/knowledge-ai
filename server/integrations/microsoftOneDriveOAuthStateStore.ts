import crypto from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

export interface MicrosoftOneDriveOAuthAttempt {
  accountId: string;
  displayName: string;
  redirectUri: string;
  tenant: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
}

type StoredAttempt = MicrosoftOneDriveOAuthAttempt & {
  stateHash: string;
};

function hashState(state: string): string {
  return crypto
    .createHash('sha256')
    .update(state, 'utf8')
    .digest('hex');
}

export class MicrosoftOneDriveOAuthStateError extends Error {
  public readonly statusCode = 400;
  public readonly code:
    | 'ONEDRIVE_OAUTH_STATE_INVALID'
    | 'ONEDRIVE_OAUTH_STATE_EXPIRED';

  constructor(
    code:
      | 'ONEDRIVE_OAUTH_STATE_INVALID'
      | 'ONEDRIVE_OAUTH_STATE_EXPIRED',
    message: string
  ) {
    super(message);
    this.name = 'MicrosoftOneDriveOAuthStateError';
    this.code = code;
  }
}

export class MicrosoftOneDriveOAuthStateStore {
  private attempts = new Map<string, StoredAttempt>();

  public create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
    tenant: string;
  }): {
    state: string;
    codeChallenge: string;
    attempt: MicrosoftOneDriveOAuthAttempt;
  } {
    this.prune();

    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto
      .randomBytes(48)
      .toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier, 'utf8')
      .digest('base64url');
    const now = Date.now();

    const attempt: StoredAttempt = {
      accountId: params.accountId,
      displayName: params.displayName,
      redirectUri: params.redirectUri,
      tenant: params.tenant,
      codeVerifier,
      createdAt: now,
      expiresAt: now + STATE_TTL_MS,
      stateHash: hashState(state),
    };

    this.attempts.set(attempt.stateHash, attempt);

    return {
      state,
      codeChallenge,
      attempt: {
        accountId: attempt.accountId,
        displayName: attempt.displayName,
        redirectUri: attempt.redirectUri,
        tenant: attempt.tenant,
        codeVerifier: attempt.codeVerifier,
        createdAt: attempt.createdAt,
        expiresAt: attempt.expiresAt,
      },
    };
  }

  public consume(
    state: string
  ): MicrosoftOneDriveOAuthAttempt {
    this.prune();

    const key = hashState(state);
    const attempt = this.attempts.get(key);
    if (!attempt) {
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_STATE_INVALID',
        'OneDrive OAuth state is invalid or has already been consumed.'
      );
    }

    this.attempts.delete(key);

    if (attempt.expiresAt <= Date.now()) {
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_STATE_EXPIRED',
        'OneDrive OAuth state expired before the callback completed.'
      );
    }

    const { stateHash: _stateHash, ...safe } = attempt;
    return structuredClone(safe);
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

export const microsoftOneDriveOAuthStateStore =
  new MicrosoftOneDriveOAuthStateStore();
