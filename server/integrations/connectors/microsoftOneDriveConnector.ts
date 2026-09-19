import {
  MICROSOFT_GRAPH_BASE,
  MICROSOFT_GRAPH_FILES_READ_SCOPE,
  MICROSOFT_OFFLINE_SCOPE,
  microsoftOneDriveServerConfig,
} from '../microsoftOneDriveConfig.js';
import {
  IntegrationCredentialStore,
  integrationCredentialStore,
} from '../integrationCredentialStore.js';
import {
  ExternalChangePage,
  ExternalRecord,
  ExternalSourceRef,
  IntegrationCapabilities,
  IntegrationConnector,
  IntegrationConnectorContext,
} from '../types.js';

const CSV_MIME = 'text/csv';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type FetchLike = typeof fetch;

export interface MicrosoftOneDriveCredentialSecret {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType?: string;
}

type GraphDriveItem = {
  id?: string;
  name?: string;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: Record<string, unknown>;
  deleted?: Record<string, unknown>;
};

async function jsonOrText(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function supported(item: GraphDriveItem): boolean {
  if (!item.file || !item.name) return false;
  const lower = item.name.toLowerCase();
  return (
    lower.endsWith('.csv') ||
    lower.endsWith('.xlsx') ||
    item.file.mimeType === CSV_MIME ||
    item.file.mimeType === XLSX_MIME
  );
}

function itemVersion(item: GraphDriveItem): string {
  if (item.eTag) return 'etag:' + item.eTag;
  if (item.cTag) return 'ctag:' + item.cTag;
  if (item.lastModifiedDateTime) {
    return 'modified:' + item.lastModifiedDateTime;
  }
  throw new MicrosoftOneDriveConnectorError(
    'ONEDRIVE_ITEM_INVALID',
    422,
    'OneDrive file did not include a stable version signal.'
  );
}

function itemRef(
  connectionId: string,
  item: GraphDriveItem
): ExternalSourceRef | null {
  if (!item.id) return null;

  if (item.deleted) {
    return {
      provider: 'MICROSOFT_ONEDRIVE',
      connectionId,
      externalId: item.id,
      externalVersion: 'deleted:' + item.id,
      resourceKind: 'FILE',
      name: item.name || 'Removed OneDrive file ' + item.id,
      mimeType:
        item.file?.mimeType || 'application/octet-stream',
      deleted: true,
      webUrl: item.webUrl,
      modifiedAt: item.lastModifiedDateTime
        ? Date.parse(item.lastModifiedDateTime)
        : undefined,
    };
  }

  if (!supported(item) || !item.name) return null;

  return {
    provider: 'MICROSOFT_ONEDRIVE',
    connectionId,
    externalId: item.id,
    externalVersion: itemVersion(item),
    resourceKind: 'FILE',
    name: item.name,
    mimeType:
      item.file?.mimeType ||
      (item.name.toLowerCase().endsWith('.csv')
        ? CSV_MIME
        : XLSX_MIME),
    modifiedAt: item.lastModifiedDateTime
      ? Date.parse(item.lastModifiedDateTime)
      : undefined,
    webUrl: item.webUrl,
  };
}

function validateDeltaUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MicrosoftOneDriveConnectorError(
      'ONEDRIVE_CURSOR_INVALID',
      422,
      'Stored OneDrive delta cursor is not a valid URL.'
    );
  }

  if (
    url.origin !== 'https://graph.microsoft.com' ||
    !url.pathname.startsWith(
      '/v1.0/me/drive/root/delta'
    )
  ) {
    throw new MicrosoftOneDriveConnectorError(
      'ONEDRIVE_CURSOR_INVALID',
      422,
      'Stored OneDrive delta cursor points outside the allowed Microsoft Graph delta endpoint.'
    );
  }

  return url.toString();
}

export class MicrosoftOneDriveConnectorError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'ONEDRIVE_CREDENTIAL_MISSING'
    | 'ONEDRIVE_TOKEN_REFRESH_FAILED'
    | 'ONEDRIVE_API_ERROR'
    | 'ONEDRIVE_CURSOR_INVALID'
    | 'ONEDRIVE_ITEM_INVALID';

  constructor(
    code:
      | 'ONEDRIVE_CREDENTIAL_MISSING'
      | 'ONEDRIVE_TOKEN_REFRESH_FAILED'
      | 'ONEDRIVE_API_ERROR'
      | 'ONEDRIVE_CURSOR_INVALID'
      | 'ONEDRIVE_ITEM_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'MicrosoftOneDriveConnectorError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class MicrosoftOneDriveConnector
  implements IntegrationConnector
{
  public readonly provider =
    'MICROSOFT_ONEDRIVE' as const;

  constructor(
    private readonly credentialStore: IntegrationCredentialStore =
      integrationCredentialStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public capabilities(): IntegrationCapabilities {
    return {
      incrementalSync: true,
      deletions: true,
      supportedMimeTypes: [CSV_MIME, XLSX_MIME],
      supportedResourceKinds: ['FILE'],
    };
  }

  public async validateConnection(
    context: IntegrationConnectorContext
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const response = await this.authorizedFetch(
        context,
        MICROSOFT_GRAPH_BASE +
          '/me/drive?$select=id,driveType,webUrl'
      );
      if (!response.ok) {
        const body = await jsonOrText(response);
        return {
          ok: false,
          error:
            body?.error?.message ||
            'Microsoft Graph rejected the OneDrive connection validation request.',
        };
      }
      return { ok: true };
    } catch (error: any) {
      return {
        ok: false,
        error:
          error?.message ||
          'OneDrive connection validation failed.',
      };
    }
  }

  public async healthCheck(
    context: IntegrationConnectorContext
  ): Promise<{ ok: boolean; message?: string }> {
    const result = await this.validateConnection(context);
    return 'error' in result
      ? { ok: false, message: result.error }
      : { ok: true };
  }

  public async listChanges(
    context: IntegrationConnectorContext,
    params: { cursor?: string }
  ): Promise<ExternalChangePage> {
    const url = params.cursor
      ? validateDeltaUrl(params.cursor)
      : MICROSOFT_GRAPH_BASE +
        '/me/drive/root/delta?$select=id,name,eTag,cTag,webUrl,lastModifiedDateTime,file,folder,deleted';

    const response = await this.authorizedFetch(
      context,
      url,
      {
        headers: {
          deltaExcludeParent: 'true',
        },
      }
    );
    const body = await jsonOrText(response);

    if (!response.ok) {
      throw new MicrosoftOneDriveConnectorError(
        'ONEDRIVE_API_ERROR',
        response.status,
        body?.error?.message ||
          'Microsoft Graph OneDrive delta request failed.'
      );
    }

    const records = (
      Array.isArray(body.value) ? body.value : []
    )
      .map((item: GraphDriveItem) =>
        itemRef(context.connection.id, item)
      )
      .filter(
        (
          ref: ExternalSourceRef | null
        ): ref is ExternalSourceRef => Boolean(ref)
      );

    const next =
      typeof body['@odata.nextLink'] === 'string'
        ? body['@odata.nextLink']
        : typeof body['@odata.deltaLink'] === 'string'
          ? body['@odata.deltaLink']
          : null;

    if (!next) {
      throw new MicrosoftOneDriveConnectorError(
        'ONEDRIVE_CURSOR_INVALID',
        502,
        'Microsoft Graph delta response did not include @odata.nextLink or @odata.deltaLink.'
      );
    }

    return {
      records,
      nextCursor: validateDeltaUrl(next),
    };
  }

  public async fetchRecord(
    context: IntegrationConnectorContext,
    ref: ExternalSourceRef
  ): Promise<ExternalRecord> {
    if (
      ref.provider !== 'MICROSOFT_ONEDRIVE' ||
      ref.connectionId !== context.connection.id
    ) {
      throw new MicrosoftOneDriveConnectorError(
        'ONEDRIVE_ITEM_INVALID',
        422,
        'OneDrive record does not belong to this connection.'
      );
    }

    const response = await this.authorizedFetch(
      context,
      MICROSOFT_GRAPH_BASE +
        '/me/drive/items/' +
        encodeURIComponent(ref.externalId) +
        '/content',
      { redirect: 'follow' }
    );

    if (!response.ok) {
      const body = await jsonOrText(response);
      throw new MicrosoftOneDriveConnectorError(
        'ONEDRIVE_API_ERROR',
        response.status,
        body?.error?.message ||
          'OneDrive file download failed.'
      );
    }

    return {
      ref: { ...ref },
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }

  private credential(
    context: IntegrationConnectorContext
  ): MicrosoftOneDriveCredentialSecret {
    const credentialRef =
      context.connection.credentialRef;
    if (!credentialRef) {
      throw new MicrosoftOneDriveConnectorError(
        'ONEDRIVE_CREDENTIAL_MISSING',
        409,
        'OneDrive connection does not have an OAuth credential reference.'
      );
    }

    return this.credentialStore.get<MicrosoftOneDriveCredentialSecret>({
      accountId: context.connection.accountId,
      provider: 'MICROSOFT_ONEDRIVE',
      credentialRef,
    });
  }

  private async authorizedFetch(
    context: IntegrationConnectorContext,
    url: string,
    init: RequestInit = {},
    retried = false
  ): Promise<Response> {
    const token = await this.accessToken(
      context,
      retried
    );
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', 'Bearer ' + token);

    const response = await this.fetchImpl(url, {
      ...init,
      headers,
    });

    if (response.status === 401 && !retried) {
      return this.authorizedFetch(
        context,
        url,
        init,
        true
      );
    }

    return response;
  }

  private async accessToken(
    context: IntegrationConnectorContext,
    forceRefresh = false
  ): Promise<string> {
    const secret = this.credential(context);
    if (
      !forceRefresh &&
      secret.accessToken &&
      secret.expiresAt > Date.now() + 60_000
    ) {
      return secret.accessToken;
    }

    return this.refreshAccessToken(context, secret);
  }

  private async refreshAccessToken(
    context: IntegrationConnectorContext,
    secret: MicrosoftOneDriveCredentialSecret
  ): Promise<string> {
    if (!secret.refreshToken) {
      throw new MicrosoftOneDriveConnectorError(
        'ONEDRIVE_CREDENTIAL_MISSING',
        409,
        'OneDrive background sync requires a refresh token.'
      );
    }

    const config = microsoftOneDriveServerConfig();
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: secret.refreshToken,
      grant_type: 'refresh_token',
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
      throw new MicrosoftOneDriveConnectorError(
        'ONEDRIVE_TOKEN_REFRESH_FAILED',
        response.status || 401,
        payload?.error_description ||
          payload?.error ||
          'Microsoft identity access-token refresh failed.'
      );
    }

    const updated: MicrosoftOneDriveCredentialSecret = {
      ...secret,
      accessToken: payload.access_token,
      refreshToken:
        typeof payload.refresh_token === 'string' &&
        payload.refresh_token
          ? payload.refresh_token
          : secret.refreshToken,
      expiresAt:
        Date.now() +
        Math.max(1, Number(payload.expires_in) || 3600) *
          1000,
      scope:
        typeof payload.scope === 'string'
          ? payload.scope
          : secret.scope,
      tokenType:
        typeof payload.token_type === 'string'
          ? payload.token_type
          : secret.tokenType,
    };

    this.credentialStore.update({
      accountId: context.connection.accountId,
      provider: 'MICROSOFT_ONEDRIVE',
      credentialRef: context.connection.credentialRef!,
      secret: updated,
    });

    return updated.accessToken;
  }
}

export const microsoftOneDriveConnector =
  new MicrosoftOneDriveConnector();
