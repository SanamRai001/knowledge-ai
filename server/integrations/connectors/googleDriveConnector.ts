import {
  GOOGLE_DRIVE_API_BASE,
  GOOGLE_OAUTH_TOKEN_URL,
  googleDriveServerConfig,
} from '../googleDriveConfig.js';
import {
  integrationOAuthSecretRuntime,
  type IntegrationCredentialAccess,
} from '../integrationOAuthSecretRuntime.js';
import {
  ExternalChangePage,
  ExternalRecord,
  ExternalSourceRef,
  IntegrationCapabilities,
  IntegrationConnector,
  IntegrationConnectorContext,
} from '../types.js';

const GOOGLE_SHEETS_MIME =
  'application/vnd.google-apps.spreadsheet';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv';

type FetchLike = typeof fetch;

export interface GoogleDriveCredentialSecret {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType?: string;
}

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  version?: string | number;
  md5Checksum?: string;
  webViewLink?: string;
  trashed?: boolean;
  capabilities?: {
    canDownload?: boolean;
  };
};

type GoogleCursor =
  | {
      v: 1;
      mode: 'INITIAL';
      startPageToken: string;
      pageToken: string;
    }
  | {
      v: 1;
      mode: 'CHANGES';
      pageToken: string;
    };

function encodeCursor(cursor: GoogleCursor): string {
  return Buffer.from(
    JSON.stringify(cursor),
    'utf8'
  ).toString('base64url');
}

function decodeCursor(value: string): GoogleCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8')
    ) as Partial<GoogleCursor>;

    if (
      parsed.v === 1 &&
      parsed.mode === 'INITIAL' &&
      typeof parsed.startPageToken === 'string' &&
      typeof parsed.pageToken === 'string'
    ) {
      return parsed as GoogleCursor;
    }

    if (
      parsed.v === 1 &&
      parsed.mode === 'CHANGES' &&
      typeof parsed.pageToken === 'string'
    ) {
      return parsed as GoogleCursor;
    }
  } catch {
    // Fall through to a structured connector error.
  }

  throw new GoogleDriveConnectorError(
    'GOOGLE_DRIVE_CURSOR_INVALID',
    422,
    'Stored Google Drive cursor is invalid and cannot be resumed safely.'
  );
}

function isSupportedMimeType(mimeType?: string): boolean {
  return (
    mimeType === CSV_MIME ||
    mimeType === XLSX_MIME ||
    mimeType === GOOGLE_SHEETS_MIME
  );
}

function fileVersion(file: DriveFile): string {
  if (file.version !== undefined && file.version !== null) {
    return String(file.version);
  }
  if (file.md5Checksum) return 'md5:' + file.md5Checksum;
  if (file.modifiedTime) return 'modified:' + file.modifiedTime;

  throw new GoogleDriveConnectorError(
    'GOOGLE_DRIVE_FILE_INVALID',
    422,
    'Google Drive file metadata did not include a stable version signal.'
  );
}

function externalRef(
  connectionId: string,
  file: DriveFile
): ExternalSourceRef | null {
  if (
    !file.id ||
    !file.name ||
    !file.mimeType ||
    !isSupportedMimeType(file.mimeType)
  ) {
    return null;
  }
  if (file.capabilities?.canDownload === false) {
    return null;
  }

  const googleSheet = file.mimeType === GOOGLE_SHEETS_MIME;
  return {
    provider: 'GOOGLE_DRIVE',
    connectionId,
    externalId: file.id,
    externalVersion: fileVersion(file),
    resourceKind: googleSheet ? 'SPREADSHEET' : 'FILE',
    name:
      googleSheet && !file.name.toLowerCase().endsWith('.xlsx')
        ? file.name + '.xlsx'
        : file.name,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedTime
      ? Date.parse(file.modifiedTime)
      : undefined,
    deleted: Boolean(file.trashed),
    webUrl: file.webViewLink,
  };
}

async function jsonOrText(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class GoogleDriveConnectorError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'GOOGLE_DRIVE_CREDENTIAL_MISSING'
    | 'GOOGLE_DRIVE_TOKEN_REFRESH_FAILED'
    | 'GOOGLE_DRIVE_API_ERROR'
    | 'GOOGLE_DRIVE_CURSOR_INVALID'
    | 'GOOGLE_DRIVE_FILE_INVALID'
    | 'GOOGLE_DRIVE_DOWNLOAD_FORBIDDEN';

  constructor(
    code:
      | 'GOOGLE_DRIVE_CREDENTIAL_MISSING'
      | 'GOOGLE_DRIVE_TOKEN_REFRESH_FAILED'
      | 'GOOGLE_DRIVE_API_ERROR'
      | 'GOOGLE_DRIVE_CURSOR_INVALID'
      | 'GOOGLE_DRIVE_FILE_INVALID'
      | 'GOOGLE_DRIVE_DOWNLOAD_FORBIDDEN',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'GoogleDriveConnectorError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class GoogleDriveConnector
  implements IntegrationConnector
{
  public readonly provider = 'GOOGLE_DRIVE' as const;

  constructor(
    private readonly credentialStore: IntegrationCredentialAccess =
      integrationOAuthSecretRuntime,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public capabilities(): IntegrationCapabilities {
    return {
      incrementalSync: true,
      deletions: true,
      supportedMimeTypes: [
        CSV_MIME,
        XLSX_MIME,
        GOOGLE_SHEETS_MIME,
      ],
      supportedResourceKinds: ['FILE', 'SPREADSHEET'],
    };
  }

  public async validateConnection(
    context: IntegrationConnectorContext
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const response = await this.authorizedFetch(
        context,
        GOOGLE_DRIVE_API_BASE +
          '/about?fields=user(displayName%2CemailAddress)'
      );
      if (!response.ok) {
        const body = await jsonOrText(response);
        return {
          ok: false,
          error:
            body?.error?.message ||
            'Google Drive rejected the connection validation request.',
        };
      }
      return { ok: true };
    } catch (error: any) {
      return {
        ok: false,
        error:
          error?.message ||
          'Google Drive connection validation failed.',
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
    if (!params.cursor) {
      return this.initialPage(context);
    }

    const cursor = decodeCursor(params.cursor);
    if (cursor.mode === 'INITIAL') {
      return this.initialPage(
        context,
        cursor.startPageToken,
        cursor.pageToken
      );
    }

    return this.changePage(context, cursor.pageToken);
  }

  public async fetchRecord(
    context: IntegrationConnectorContext,
    ref: ExternalSourceRef
  ): Promise<ExternalRecord> {
    if (
      ref.provider !== 'GOOGLE_DRIVE' ||
      ref.connectionId !== context.connection.id
    ) {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_FILE_INVALID',
        422,
        'Google Drive record does not belong to this connection.'
      );
    }

    let url: string;
    if (ref.mimeType === GOOGLE_SHEETS_MIME) {
      const query = new URLSearchParams({
        mimeType: XLSX_MIME,
      });
      url =
        GOOGLE_DRIVE_API_BASE +
        '/files/' +
        encodeURIComponent(ref.externalId) +
        '/export?' +
        query.toString();
    } else if (
      ref.mimeType === CSV_MIME ||
      ref.mimeType === XLSX_MIME
    ) {
      const query = new URLSearchParams({
        alt: 'media',
        supportsAllDrives: 'true',
      });
      url =
        GOOGLE_DRIVE_API_BASE +
        '/files/' +
        encodeURIComponent(ref.externalId) +
        '?' +
        query.toString();
    } else {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_FILE_INVALID',
        415,
        'Google Drive record type is not supported by the structured-data connector.'
      );
    }

    const response = await this.authorizedFetch(context, url);
    if (!response.ok) {
      const body = await jsonOrText(response);
      if (response.status === 403) {
        throw new GoogleDriveConnectorError(
          'GOOGLE_DRIVE_DOWNLOAD_FORBIDDEN',
          403,
          body?.error?.message ||
            'Google Drive does not permit downloading this file.'
        );
      }
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_API_ERROR',
        response.status,
        body?.error?.message ||
          'Google Drive file download failed.'
      );
    }

    return {
      ref: { ...ref },
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }

  private async initialPage(
    context: IntegrationConnectorContext,
    existingStartToken?: string,
    pageToken?: string
  ): Promise<ExternalChangePage> {
    const startPageToken =
      existingStartToken ||
      (await this.getStartPageToken(context));

    const query = new URLSearchParams({
      q:
        "trashed = false and (mimeType = '" +
        CSV_MIME +
        "' or mimeType = '" +
        XLSX_MIME +
        "' or mimeType = '" +
        GOOGLE_SHEETS_MIME +
        "')",
      spaces: 'drive',
      pageSize: '100',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      fields:
        'nextPageToken,files(id,name,mimeType,modifiedTime,version,md5Checksum,webViewLink,trashed,capabilities(canDownload))',
    });
    if (pageToken) query.set('pageToken', pageToken);

    const response = await this.authorizedFetch(
      context,
      GOOGLE_DRIVE_API_BASE + '/files?' + query.toString()
    );
    const body = await jsonOrText(response);
    if (!response.ok) {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_API_ERROR',
        response.status,
        body?.error?.message ||
          'Google Drive initial file discovery failed.'
      );
    }

    const records = (
      Array.isArray(body.files) ? body.files : []
    )
      .map((file: DriveFile) =>
        externalRef(context.connection.id, file)
      )
      .filter(
        (
          ref: ExternalSourceRef | null
        ): ref is ExternalSourceRef => Boolean(ref)
      );

    return {
      records,
      nextCursor:
        typeof body.nextPageToken === 'string' &&
        body.nextPageToken
          ? encodeCursor({
              v: 1,
              mode: 'INITIAL',
              startPageToken,
              pageToken: body.nextPageToken,
            })
          : encodeCursor({
              v: 1,
              mode: 'CHANGES',
              pageToken: startPageToken,
            }),
    };
  }

  private async changePage(
    context: IntegrationConnectorContext,
    pageToken: string
  ): Promise<ExternalChangePage> {
    const query = new URLSearchParams({
      pageToken,
      pageSize: '100',
      spaces: 'drive',
      includeRemoved: 'true',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      fields:
        'nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,modifiedTime,version,md5Checksum,webViewLink,trashed,capabilities(canDownload)))',
    });

    const response = await this.authorizedFetch(
      context,
      GOOGLE_DRIVE_API_BASE + '/changes?' + query.toString()
    );
    const body = await jsonOrText(response);
    if (!response.ok) {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_API_ERROR',
        response.status,
        body?.error?.message ||
          'Google Drive incremental change listing failed.'
      );
    }

    const records: ExternalSourceRef[] = [];
    for (const change of Array.isArray(body.changes)
      ? body.changes
      : []) {
      const file = change?.file as DriveFile | undefined;
      const removed =
        Boolean(change?.removed) || Boolean(file?.trashed);

      if (removed && typeof change?.fileId === 'string') {
        records.push({
          provider: 'GOOGLE_DRIVE',
          connectionId: context.connection.id,
          externalId: change.fileId,
          externalVersion:
            'removed:' +
            String(
              change?.time ||
                file?.modifiedTime ||
                Date.now()
            ),
          resourceKind: 'FILE',
          name:
            file?.name ||
            'Removed Drive file ' + change.fileId,
          mimeType:
            file?.mimeType ||
            'application/octet-stream',
          modifiedAt:
            typeof change?.time === 'string'
              ? Date.parse(change.time)
              : undefined,
          deleted: true,
          webUrl: file?.webViewLink,
        });
        continue;
      }

      const ref = file
        ? externalRef(context.connection.id, file)
        : null;
      if (ref) records.push(ref);
    }

    const nextToken =
      typeof body.nextPageToken === 'string' &&
      body.nextPageToken
        ? body.nextPageToken
        : typeof body.newStartPageToken === 'string' &&
            body.newStartPageToken
          ? body.newStartPageToken
          : null;

    if (!nextToken) {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_CURSOR_INVALID',
        502,
        'Google Drive change response did not provide a continuation or new start page token.'
      );
    }

    return {
      records,
      nextCursor: encodeCursor({
        v: 1,
        mode: 'CHANGES',
        pageToken: nextToken,
      }),
    };
  }

  private async getStartPageToken(
    context: IntegrationConnectorContext
  ): Promise<string> {
    const response = await this.authorizedFetch(
      context,
      GOOGLE_DRIVE_API_BASE +
        '/changes/startPageToken?supportsAllDrives=true'
    );
    const body = await jsonOrText(response);
    if (
      !response.ok ||
      typeof body.startPageToken !== 'string' ||
      !body.startPageToken
    ) {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_API_ERROR',
        response.status || 502,
        body?.error?.message ||
          'Google Drive did not return a start page token.'
      );
    }
    return body.startPageToken;
  }

  private async credential(
    context: IntegrationConnectorContext
  ): Promise<GoogleDriveCredentialSecret> {
    const credentialRef =
      context.connection.credentialRef;
    if (!credentialRef) {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_CREDENTIAL_MISSING',
        409,
        'Google Drive connection does not have an OAuth credential reference.'
      );
    }

    return await this.credentialStore.get<GoogleDriveCredentialSecret>({
      accountId: context.connection.accountId,
      provider: 'GOOGLE_DRIVE',
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
    const secret =
      await this.credential(context);
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
    secret: GoogleDriveCredentialSecret
  ): Promise<string> {
    if (!secret.refreshToken) {
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_CREDENTIAL_MISSING',
        409,
        'Google Drive background sync requires a refresh token.'
      );
    }

    const config = googleDriveServerConfig();
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: secret.refreshToken,
      grant_type: 'refresh_token',
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
      throw new GoogleDriveConnectorError(
        'GOOGLE_DRIVE_TOKEN_REFRESH_FAILED',
        response.status || 401,
        payload?.error_description ||
          payload?.error ||
          'Google OAuth access-token refresh failed.'
      );
    }

    const updated: GoogleDriveCredentialSecret = {
      ...secret,
      accessToken: payload.access_token,
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

    await this.credentialStore.update({
      accountId: context.connection.accountId,
      provider: 'GOOGLE_DRIVE',
      credentialRef: context.connection.credentialRef!,
      secret: updated,
    });

    return updated.accessToken;
  }
}

export const googleDriveConnector =
  new GoogleDriveConnector();
