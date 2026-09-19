export const MICROSOFT_GRAPH_FILES_READ_SCOPE =
  'Files.Read';
export const MICROSOFT_OFFLINE_SCOPE =
  'offline_access';
export const MICROSOFT_GRAPH_BASE =
  'https://graph.microsoft.com/v1.0';

export class MicrosoftOneDriveConfigError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'MICROSOFT_ONEDRIVE_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'MicrosoftOneDriveConfigError';
  }
}

export interface MicrosoftOneDriveServerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
  authorizeUrl: string;
  tokenUrl: string;
}

export function microsoftOneDriveServerConfig(
  options: { requireRedirectUri?: boolean } = {}
): MicrosoftOneDriveServerConfig {
  const clientId =
    process.env.MICROSOFT_ONEDRIVE_CLIENT_ID?.trim() || '';
  const clientSecret =
    process.env.MICROSOFT_ONEDRIVE_CLIENT_SECRET?.trim() || '';
  const redirectUri =
    process.env.MICROSOFT_ONEDRIVE_REDIRECT_URI?.trim() || '';
  const tenant =
    process.env.MICROSOFT_ONEDRIVE_TENANT_ID?.trim() ||
    'common';

  if (!clientId || !clientSecret) {
    throw new MicrosoftOneDriveConfigError(
      'MICROSOFT_ONEDRIVE_CLIENT_ID and MICROSOFT_ONEDRIVE_CLIENT_SECRET must be configured before OneDrive OAuth can be used.'
    );
  }
  if (options.requireRedirectUri && !redirectUri) {
    throw new MicrosoftOneDriveConfigError(
      'MICROSOFT_ONEDRIVE_REDIRECT_URI must be configured before starting OneDrive OAuth.'
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(tenant)) {
    throw new MicrosoftOneDriveConfigError(
      'MICROSOFT_ONEDRIVE_TENANT_ID contains invalid characters.'
    );
  }

  const base =
    'https://login.microsoftonline.com/' +
    encodeURIComponent(tenant) +
    '/oauth2/v2.0';

  return {
    clientId,
    clientSecret,
    redirectUri,
    tenant,
    authorizeUrl: base + '/authorize',
    tokenUrl: base + '/token',
  };
}
