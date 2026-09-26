import crypto from 'crypto';
import {
  postgresPersistenceEnabled,
} from '../persistence/postgres.js';
import {
  distributedSecurityState,
  hashOAuthState,
} from '../security/distributedSecurityState.js';
import {
  postgresSecretStore,
} from '../security/postgresSecretStore.js';
import {
  cleanupExpiredOAuthSecurityState,
} from './oauthAttemptSecurityCleanup.js';

const STATE_TTL_MS = 10 * 60 * 1000;

export interface MicrosoftOneDriveOAuthAttempt {
  accountId: string;
  displayName: string;
  redirectUri: string;
  tenant: string;
  connectionId?: string;
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
  public readonly statusCode: number;
  public readonly code:
    | 'ONEDRIVE_OAUTH_STATE_INVALID'
    | 'ONEDRIVE_OAUTH_STATE_EXPIRED'
    | 'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH';

  constructor(
    code:
      | 'ONEDRIVE_OAUTH_STATE_INVALID'
      | 'ONEDRIVE_OAUTH_STATE_EXPIRED'
      | 'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'MicrosoftOneDriveOAuthStateError';
    this.code = code;
    this.statusCode =
      code ===
        'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH'
        ? 403
        : 400;
  }
}

export class MicrosoftOneDriveOAuthStateStore {
  private attempts = new Map<string, StoredAttempt>();

  public create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
    tenant: string;
    connectionId?: string;
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
      connectionId: params.connectionId,
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
        connectionId: attempt.connectionId,
        codeVerifier: attempt.codeVerifier,
        createdAt: attempt.createdAt,
        expiresAt: attempt.expiresAt,
      },
    };
  }

  public consume(
    state: string,
    expectedAccountId?: string
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

    if (
      expectedAccountId &&
      attempt.accountId !==
        expectedAccountId
    ) {
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH',
        'OneDrive OAuth state belongs to a different account.'
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


export interface MicrosoftOneDriveOAuthStateAccess {
  create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
    tenant: string;
    connectionId?: string;
  }):
    | {
        state: string;
        codeChallenge: string;
        attempt: MicrosoftOneDriveOAuthAttempt;
      }
    | Promise<{
        state: string;
        codeChallenge: string;
        attempt: MicrosoftOneDriveOAuthAttempt;
      }>;

  consume(
    state: string,
    expectedAccountId?: string
  ):
    | MicrosoftOneDriveOAuthAttempt
    | Promise<MicrosoftOneDriveOAuthAttempt>;
}

interface MicrosoftOneDriveOAuthAttemptSecret {
  codeVerifier: string;
}

export class MicrosoftOneDriveOAuthStateRuntime
  implements MicrosoftOneDriveOAuthStateAccess
{
  constructor(
    private readonly localStore:
      MicrosoftOneDriveOAuthStateStore =
        microsoftOneDriveOAuthStateStore
  ) {}

  async create(params: {
    accountId: string;
    displayName: string;
    redirectUri: string;
    tenant: string;
    connectionId?: string;
  }): Promise<{
    state: string;
    codeChallenge: string;
    attempt: MicrosoftOneDriveOAuthAttempt;
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
    const codeVerifier =
      crypto.randomBytes(48)
        .toString('base64url');
    const codeChallenge =
      crypto
        .createHash('sha256')
        .update(
          codeVerifier,
          'utf8'
        )
        .digest('base64url');
    const now = Date.now();

    const secretMetadata =
      await postgresSecretStore
        .create<MicrosoftOneDriveOAuthAttemptSecret>({
          accountId:
            params.accountId,
          purpose:
            'INTEGRATION_OAUTH_ATTEMPT',
          provider:
            'MICROSOFT_ONEDRIVE',
          secret: {
            codeVerifier,
          },
        });

    const attempt:
      MicrosoftOneDriveOAuthAttempt = {
        accountId:
          params.accountId,
        displayName:
          params.displayName,
        redirectUri:
          params.redirectUri,
        tenant:
          params.tenant,
        connectionId:
          params.connectionId,
        codeVerifier,
        createdAt: now,
        expiresAt:
          now + STATE_TTL_MS,
      };

    try {
      await distributedSecurityState
        .createOAuthAttempt({
          stateHash:
            hashOAuthState(state),
          attempt: {
            provider:
              'MICROSOFT_ONEDRIVE',
            accountId:
              attempt.accountId,
            displayName:
              attempt.displayName,
            redirectUri:
              attempt.redirectUri,
            tenant:
              attempt.tenant,
            connectionId:
              attempt.connectionId,
            secretRef:
              secretMetadata.id,
            createdAt:
              attempt.createdAt,
            expiresAt:
              attempt.expiresAt,
          },
        });
    } catch (error) {
      await postgresSecretStore
        .delete({
          accountId:
            params.accountId,
          secretId:
            secretMetadata.id,
          purpose:
            'INTEGRATION_OAUTH_ATTEMPT',
          provider:
            'MICROSOFT_ONEDRIVE',
        })
        .catch(() => false);
      throw error;
    }

    await cleanupExpiredOAuthSecurityState()
      .catch(() => undefined);

    return {
      state,
      codeChallenge,
      attempt,
    };
  }

  async consume(
    state: string,
    expectedAccountId?: string
  ): Promise<MicrosoftOneDriveOAuthAttempt> {
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
            'MICROSOFT_ONEDRIVE',
          stateHash:
            hashOAuthState(state),
          expectedAccountId,
        });

    if (
      result.status === 'INVALID'
    ) {
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_STATE_INVALID',
        'OneDrive OAuth state is invalid or has already been consumed.'
      );
    }

    if (
      result.status ===
      'ACCOUNT_MISMATCH'
    ) {
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH',
        'OneDrive OAuth state belongs to a different account.'
      );
    }

    if (
      result.status === 'EXPIRED'
    ) {
      if (result.secretRef) {
        await postgresSecretStore
          .delete({
            accountId:
              result.accountId,
            secretId:
              result.secretRef,
            purpose:
              'INTEGRATION_OAUTH_ATTEMPT',
            provider:
              'MICROSOFT_ONEDRIVE',
          })
          .catch(() => false);
      }
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_STATE_EXPIRED',
        'OneDrive OAuth state expired before the callback completed.'
      );
    }

    const attempt =
      result.attempt;
    if (
      !attempt.secretRef ||
      !attempt.tenant
    ) {
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_STATE_INVALID',
        'OneDrive OAuth state is missing protected PKCE metadata.'
      );
    }

    let secret:
      MicrosoftOneDriveOAuthAttemptSecret;
    try {
      secret =
        await postgresSecretStore
          .get<MicrosoftOneDriveOAuthAttemptSecret>({
            accountId:
              attempt.accountId,
            secretId:
              attempt.secretRef,
            purpose:
              'INTEGRATION_OAUTH_ATTEMPT',
            provider:
              'MICROSOFT_ONEDRIVE',
          });
    } finally {
      await postgresSecretStore
        .delete({
          accountId:
            attempt.accountId,
          secretId:
            attempt.secretRef,
          purpose:
            'INTEGRATION_OAUTH_ATTEMPT',
          provider:
            'MICROSOFT_ONEDRIVE',
        })
        .catch(() => false);
    }

    if (
      !secret.codeVerifier ||
      secret.codeVerifier.length <
        43
    ) {
      throw new MicrosoftOneDriveOAuthStateError(
        'ONEDRIVE_OAUTH_STATE_INVALID',
        'OneDrive OAuth PKCE verifier is unavailable.'
      );
    }

    return {
      accountId:
        attempt.accountId,
      displayName:
        attempt.displayName,
      redirectUri:
        attempt.redirectUri,
      tenant:
        attempt.tenant,
      connectionId:
        attempt.connectionId,
      codeVerifier:
        secret.codeVerifier,
      createdAt:
        attempt.createdAt,
      expiresAt:
        attempt.expiresAt,
    };
  }
}

export const microsoftOneDriveOAuthStateRuntime =
  new MicrosoftOneDriveOAuthStateRuntime();
