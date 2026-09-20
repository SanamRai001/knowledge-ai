import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  googleDriveServerConfig,
} from './googleDriveConfig.js';
import {
  IntegrationCredentialStore,
  integrationCredentialStore,
} from './integrationCredentialStore.js';
import { publicConnection } from './integrationStore.js';
import { integrationRuntimeService } from './integrationRuntimeService.js';
import {
  GoogleDriveOAuthStateStore,
  googleDriveOAuthStateStore,
} from './googleDriveOAuthStateStore.js';
import {
  GoogleDriveCredentialSecret,
  googleDriveConnector,
} from './connectors/googleDriveConnector.js';
import { PublicIntegrationConnection } from './types.js';

type FetchLike = typeof fetch;

async function jsonOrText(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class GoogleDriveOAuthError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'OAUTH_CODE_MISSING'
    | 'OAUTH_TOKEN_EXCHANGE_FAILED'
    | 'OAUTH_REFRESH_TOKEN_MISSING'
    | 'OAUTH_SCOPE_INVALID';

  constructor(
    code:
      | 'OAUTH_CODE_MISSING'
      | 'OAUTH_TOKEN_EXCHANGE_FAILED'
      | 'OAUTH_REFRESH_TOKEN_MISSING'
      | 'OAUTH_SCOPE_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'GoogleDriveOAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class GoogleDriveOAuthService {
  constructor(
    private readonly stateStore: GoogleDriveOAuthStateStore =
      googleDriveOAuthStateStore,
    private readonly credentialStore: IntegrationCredentialStore =
      integrationCredentialStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public async begin(params: {
    accountId: string;
    displayName?: string;
    connectionId?: string;
  }): Promise<{
    authorizationUrl: string;
    expiresAt: number;
    scope: string;
    accessModel: 'PER_FILE';
  }> {
    const config = googleDriveServerConfig({
      requireRedirectUri: true,
    });
    let displayName =
      params.displayName?.trim() || 'Google Drive';

    if (params.connectionId) {
      const existing = await integrationRuntimeService.getInternalConnection(
        params.accountId,
        params.connectionId
      );
      if (existing.provider !== 'GOOGLE_DRIVE') {
        throw new GoogleDriveOAuthError(
          'OAUTH_SCOPE_INVALID',
          422,
          'Only a Google Drive integration can be reauthorized with the Google Drive OAuth flow.'
        );
      }
      if (existing.status === 'REVOKED') {
        throw new GoogleDriveOAuthError(
          'OAUTH_SCOPE_INVALID',
          409,
          'Revoked Google Drive connections cannot be reauthorized in place.'
        );
      }
      displayName = existing.displayName;
    }

    const { state, attempt } = this.stateStore.create({
      accountId: params.accountId,
      displayName,
      redirectUri: config.redirectUri,
      connectionId: params.connectionId,
    });

    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    });

    return {
      authorizationUrl:
        GOOGLE_OAUTH_AUTHORIZE_URL + '?' + query.toString(),
      expiresAt: attempt.expiresAt,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      accessModel: 'PER_FILE',
    };
  }

  public async complete(params: {
    state: string;
    code: string;
  }): Promise<{
    connection: PublicIntegrationConnection;
    scope: string;
    accessModel: 'PER_FILE';
  }> {
    if (!params.code.trim()) {
      throw new GoogleDriveOAuthError(
        'OAUTH_CODE_MISSING',
        400,
        'Google OAuth callback did not include an authorization code.'
      );
    }

    const attempt = this.stateStore.consume(params.state);
    const config = googleDriveServerConfig({
      requireRedirectUri: true,
    });

    if (attempt.redirectUri !== config.redirectUri) {
      throw new GoogleDriveOAuthError(
        'OAUTH_TOKEN_EXCHANGE_FAILED',
        400,
        'Google OAuth redirect configuration changed before the callback completed.'
      );
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: attempt.redirectUri,
    });

    const response = await this.fetchImpl(
      GOOGLE_OAUTH_TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
        },
        body,
      }
    );
    const payload = await jsonOrText(response);

    if (
      !response.ok ||
      typeof payload.access_token !== 'string'
    ) {
      throw new GoogleDriveOAuthError(
        'OAUTH_TOKEN_EXCHANGE_FAILED',
        response.status || 400,
        payload?.error_description ||
          payload?.error ||
          'Google OAuth token exchange failed.'
      );
    }

    if (typeof payload.refresh_token !== 'string') {
      throw new GoogleDriveOAuthError(
        'OAUTH_REFRESH_TOKEN_MISSING',
        422,
        'Google did not return a refresh token. Knowledge AI requires offline access for background synchronization; start a fresh authorization flow and grant consent.'
      );
    }

    const grantedScope =
      typeof payload.scope === 'string' && payload.scope.trim()
        ? payload.scope.trim()
        : GOOGLE_DRIVE_FILE_SCOPE;

    if (
      !grantedScope
        .split(/\s+/)
        .includes(GOOGLE_DRIVE_FILE_SCOPE)
    ) {
      throw new GoogleDriveOAuthError(
        'OAUTH_SCOPE_INVALID',
        422,
        'Google OAuth did not grant the required per-file Drive scope.'
      );
    }

    const secret: GoogleDriveCredentialSecret = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt:
        Date.now() +
        Math.max(1, Number(payload.expires_in) || 3600) *
          1000,
      scope: grantedScope,
      tokenType:
        typeof payload.token_type === 'string'
          ? payload.token_type
          : 'Bearer',
    };

    const credentialRef = this.credentialStore.create({
      accountId: attempt.accountId,
      provider: 'GOOGLE_DRIVE',
      secret,
    });

    try {
      let connection;
      if (attempt.connectionId) {
        const current = await integrationRuntimeService.getInternalConnection(
          attempt.accountId,
          attempt.connectionId
        );
        if (
          current.provider !== 'GOOGLE_DRIVE' ||
          current.status === 'REVOKED'
        ) {
          throw new GoogleDriveOAuthError(
            'OAUTH_SCOPE_INVALID',
            409,
            'Existing Google Drive connection cannot be reauthorized in its current state.'
          );
        }

        const oldCredentialRef = current.credentialRef;
        connection = await integrationRuntimeService.updateConnection(
          attempt.accountId,
          current.id,
          {
            credentialRef,
            status: 'ACTIVE',
            attentionReason: undefined,
            lastFailureCategory: undefined,
            consecutiveFailureCount: 0,
            nextRetryAt: undefined,
            lastError: undefined,
            settings: {
              ...current.settings,
              accessModel: 'PER_FILE',
              oauthScope: GOOGLE_DRIVE_FILE_SCOPE,
              fileSelection: 'GOOGLE_PICKER',
              reauthorizedAt: Date.now(),
            },
          }
        );

        if (
          oldCredentialRef &&
          oldCredentialRef !== credentialRef
        ) {
          this.credentialStore.delete({
            accountId: attempt.accountId,
            provider: 'GOOGLE_DRIVE',
            credentialRef: oldCredentialRef,
          });
        }
      } else {
        connection = await integrationRuntimeService.createConnection({
          accountId: attempt.accountId,
          provider: 'GOOGLE_DRIVE',
          displayName: attempt.displayName,
          credentialRef,
          settings: {
            accessModel: 'PER_FILE',
            oauthScope: GOOGLE_DRIVE_FILE_SCOPE,
            fileSelection: 'GOOGLE_PICKER',
            connectedAt: Date.now(),
          },
        });
      }

      return {
        connection: publicConnection(connection),
        scope: GOOGLE_DRIVE_FILE_SCOPE,
        accessModel: 'PER_FILE',
      };
    } catch (error) {
      this.credentialStore.delete({
        accountId: attempt.accountId,
        provider: 'GOOGLE_DRIVE',
        credentialRef,
      });
      throw error;
    }
  }

  public async disconnect(params: {
    accountId: string;
    connectionId: string;
  }): Promise<{
    connection: PublicIntegrationConnection;
    remoteRevoked: boolean;
  }> {
    const connection = await integrationRuntimeService.getInternalConnection(
      params.accountId,
      params.connectionId
    );

    if (connection.provider !== 'GOOGLE_DRIVE') {
      throw new GoogleDriveOAuthError(
        'OAUTH_SCOPE_INVALID',
        422,
        'This connection is not a Google Drive integration.'
      );
    }

    let remoteRevoked = false;
    if (connection.credentialRef) {
      try {
        const secret =
          this.credentialStore.get<GoogleDriveCredentialSecret>({
            accountId: params.accountId,
            provider: 'GOOGLE_DRIVE',
            credentialRef: connection.credentialRef,
          });
        const token =
          secret.refreshToken || secret.accessToken;

        if (token) {
          const body = new URLSearchParams({ token });
          const response = await this.fetchImpl(
            GOOGLE_OAUTH_REVOKE_URL,
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/x-www-form-urlencoded',
              },
              body,
            }
          );
          remoteRevoked = response.ok;
        }
      } catch {
        remoteRevoked = false;
      }

      this.credentialStore.delete({
        accountId: params.accountId,
        provider: 'GOOGLE_DRIVE',
        credentialRef: connection.credentialRef,
      });
    }

    const revoked = await integrationRuntimeService.updateConnection(
      params.accountId,
      connection.id,
      {
        status: 'REVOKED',
      }
    );

    return {
      connection: publicConnection(revoked),
      remoteRevoked,
    };
  }

  public async health(params: {
    accountId: string;
    connectionId: string;
  }): Promise<{ ok: boolean; message?: string }> {
    const connection = integrationStore.requireConnection(
      params.accountId,
      params.connectionId
    );
    if (connection.provider !== 'GOOGLE_DRIVE') {
      return {
        ok: false,
        message: 'Connection is not a Google Drive integration.',
      };
    }
    return googleDriveConnector.healthCheck({ connection });
  }
}

export const googleDriveOAuthService =
  new GoogleDriveOAuthService();
