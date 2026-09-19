import {
  MICROSOFT_GRAPH_FILES_READ_SCOPE,
  MICROSOFT_OFFLINE_SCOPE,
  microsoftOneDriveServerConfig,
} from './microsoftOneDriveConfig.js';
import {
  IntegrationCredentialStore,
  integrationCredentialStore,
} from './integrationCredentialStore.js';
import {
  integrationStore,
  publicConnection,
} from './integrationStore.js';
import { integrationSyncService } from './integrationSyncService.js';
import {
  MicrosoftOneDriveOAuthStateStore,
  microsoftOneDriveOAuthStateStore,
} from './microsoftOneDriveOAuthStateStore.js';
import {
  MicrosoftOneDriveCredentialSecret,
  microsoftOneDriveConnector,
} from './connectors/microsoftOneDriveConnector.js';
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

function scopeIncludesFilesRead(scope: string): boolean {
  return scope
    .split(/\s+/)
    .some(
      (value) =>
        value.toLowerCase() ===
        MICROSOFT_GRAPH_FILES_READ_SCOPE.toLowerCase()
    );
}

export class MicrosoftOneDriveOAuthError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'ONEDRIVE_OAUTH_CODE_MISSING'
    | 'ONEDRIVE_OAUTH_TOKEN_EXCHANGE_FAILED'
    | 'ONEDRIVE_OAUTH_REFRESH_TOKEN_MISSING'
    | 'ONEDRIVE_OAUTH_SCOPE_INVALID';

  constructor(
    code:
      | 'ONEDRIVE_OAUTH_CODE_MISSING'
      | 'ONEDRIVE_OAUTH_TOKEN_EXCHANGE_FAILED'
      | 'ONEDRIVE_OAUTH_REFRESH_TOKEN_MISSING'
      | 'ONEDRIVE_OAUTH_SCOPE_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'MicrosoftOneDriveOAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class MicrosoftOneDriveOAuthService {
  constructor(
    private readonly stateStore: MicrosoftOneDriveOAuthStateStore =
      microsoftOneDriveOAuthStateStore,
    private readonly credentialStore: IntegrationCredentialStore =
      integrationCredentialStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public begin(params: {
    accountId: string;
    displayName?: string;
    connectionId?: string;
  }): {
    authorizationUrl: string;
    expiresAt: number;
    scopes: string[];
    pkce: 'S256';
  } {
    const config = microsoftOneDriveServerConfig({
      requireRedirectUri: true,
    });
    let displayName =
      params.displayName?.trim() || 'Microsoft OneDrive';

    if (params.connectionId) {
      const existing = integrationStore.requireConnection(
        params.accountId,
        params.connectionId
      );
      if (existing.provider !== 'MICROSOFT_ONEDRIVE') {
        throw new MicrosoftOneDriveOAuthError(
          'ONEDRIVE_OAUTH_SCOPE_INVALID',
          422,
          'Only a Microsoft OneDrive integration can be reauthorized with this OAuth flow.'
        );
      }
      if (existing.status === 'REVOKED') {
        throw new MicrosoftOneDriveOAuthError(
          'ONEDRIVE_OAUTH_SCOPE_INVALID',
          409,
          'Revoked OneDrive connections cannot be reauthorized in place.'
        );
      }
      displayName = existing.displayName;
    }

    const { state, codeChallenge, attempt } =
      this.stateStore.create({
        accountId: params.accountId,
        displayName,
        redirectUri: config.redirectUri,
        tenant: config.tenant,
        connectionId: params.connectionId,
      });

    const scopes = [
      MICROSOFT_OFFLINE_SCOPE,
      MICROSOFT_GRAPH_FILES_READ_SCOPE,
    ];

    const query = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      response_mode: 'query',
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      authorizationUrl:
        config.authorizeUrl + '?' + query.toString(),
      expiresAt: attempt.expiresAt,
      scopes,
      pkce: 'S256',
    };
  }

  public async complete(params: {
    state: string;
    code: string;
  }): Promise<{
    connection: PublicIntegrationConnection;
    scopes: string[];
    pkce: 'S256';
  }> {
    if (!params.code.trim()) {
      throw new MicrosoftOneDriveOAuthError(
        'ONEDRIVE_OAUTH_CODE_MISSING',
        400,
        'Microsoft OAuth callback did not include an authorization code.'
      );
    }

    const attempt = this.stateStore.consume(params.state);
    const config = microsoftOneDriveServerConfig({
      requireRedirectUri: true,
    });

    if (
      attempt.redirectUri !== config.redirectUri ||
      attempt.tenant !== config.tenant
    ) {
      throw new MicrosoftOneDriveOAuthError(
        'ONEDRIVE_OAUTH_TOKEN_EXCHANGE_FAILED',
        400,
        'Microsoft OAuth configuration changed before the callback completed.'
      );
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: attempt.redirectUri,
      code_verifier: attempt.codeVerifier,
      scope:
        MICROSOFT_OFFLINE_SCOPE +
        ' ' +
        MICROSOFT_GRAPH_FILES_READ_SCOPE,
    });

    const response = await this.fetchImpl(
      config.tokenUrl,
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
      throw new MicrosoftOneDriveOAuthError(
        'ONEDRIVE_OAUTH_TOKEN_EXCHANGE_FAILED',
        response.status || 400,
        payload?.error_description ||
          payload?.error ||
          'Microsoft OAuth token exchange failed.'
      );
    }

    if (typeof payload.refresh_token !== 'string') {
      throw new MicrosoftOneDriveOAuthError(
        'ONEDRIVE_OAUTH_REFRESH_TOKEN_MISSING',
        422,
        'Microsoft identity did not return a refresh token. Knowledge AI requires offline_access for background synchronization.'
      );
    }

    const grantedScope =
      typeof payload.scope === 'string' && payload.scope.trim()
        ? payload.scope.trim()
        : MICROSOFT_GRAPH_FILES_READ_SCOPE;

    if (!scopeIncludesFilesRead(grantedScope)) {
      throw new MicrosoftOneDriveOAuthError(
        'ONEDRIVE_OAUTH_SCOPE_INVALID',
        422,
        'Microsoft identity did not grant the required Files.Read delegated permission.'
      );
    }

    const secret: MicrosoftOneDriveCredentialSecret = {
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
      provider: 'MICROSOFT_ONEDRIVE',
      secret,
    });

    try {
      let connection;
      if (attempt.connectionId) {
        const current = integrationStore.requireConnection(
          attempt.accountId,
          attempt.connectionId
        );
        if (
          current.provider !== 'MICROSOFT_ONEDRIVE' ||
          current.status === 'REVOKED'
        ) {
          throw new MicrosoftOneDriveOAuthError(
            'ONEDRIVE_OAUTH_SCOPE_INVALID',
            409,
            'Existing OneDrive connection cannot be reauthorized in its current state.'
          );
        }

        const oldCredentialRef = current.credentialRef;
        connection = integrationStore.updateConnection(
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
              oauthScope:
                MICROSOFT_OFFLINE_SCOPE +
                ' ' +
                MICROSOFT_GRAPH_FILES_READ_SCOPE,
              tenant: attempt.tenant,
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
            provider: 'MICROSOFT_ONEDRIVE',
            credentialRef: oldCredentialRef,
          });
        }
      } else {
        connection = integrationSyncService.createConnection({
          accountId: attempt.accountId,
          provider: 'MICROSOFT_ONEDRIVE',
          displayName: attempt.displayName,
          credentialRef,
          settings: {
            oauthScope:
              MICROSOFT_OFFLINE_SCOPE +
              ' ' +
              MICROSOFT_GRAPH_FILES_READ_SCOPE,
            tenant: attempt.tenant,
            connectedAt: Date.now(),
          },
        });
      }

      return {
        connection: publicConnection(connection),
        scopes: [
          MICROSOFT_OFFLINE_SCOPE,
          MICROSOFT_GRAPH_FILES_READ_SCOPE,
        ],
        pkce: 'S256',
      };
    } catch (error) {
      this.credentialStore.delete({
        accountId: attempt.accountId,
        provider: 'MICROSOFT_ONEDRIVE',
        credentialRef,
      });
      throw error;
    }
  }

  public async health(params: {
    accountId: string;
    connectionId: string;
  }): Promise<{ ok: boolean; message?: string }> {
    const connection = integrationStore.requireConnection(
      params.accountId,
      params.connectionId
    );
    if (connection.provider !== 'MICROSOFT_ONEDRIVE') {
      return {
        ok: false,
        message:
          'Connection is not a Microsoft OneDrive integration.',
      };
    }
    return microsoftOneDriveConnector.healthCheck({
      connection,
    });
  }

  public disconnect(params: {
    accountId: string;
    connectionId: string;
  }): {
    connection: PublicIntegrationConnection;
    localCredentialDeleted: boolean;
  } {
    const connection = integrationStore.requireConnection(
      params.accountId,
      params.connectionId
    );

    if (connection.provider !== 'MICROSOFT_ONEDRIVE') {
      throw new MicrosoftOneDriveOAuthError(
        'ONEDRIVE_OAUTH_SCOPE_INVALID',
        422,
        'This connection is not a Microsoft OneDrive integration.'
      );
    }

    const localCredentialDeleted = connection.credentialRef
      ? this.credentialStore.delete({
          accountId: params.accountId,
          provider: 'MICROSOFT_ONEDRIVE',
          credentialRef: connection.credentialRef,
        })
      : false;

    const revoked = integrationStore.setConnectionStatus(
      params.accountId,
      params.connectionId,
      'REVOKED'
    );

    return {
      connection: publicConnection(revoked),
      localCredentialDeleted,
    };
  }
}

export const microsoftOneDriveOAuthService =
  new MicrosoftOneDriveOAuthService();
