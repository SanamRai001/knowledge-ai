export const GOOGLE_DRIVE_FILE_SCOPE =
  'https://www.googleapis.com/auth/drive.file';

export const GOOGLE_OAUTH_AUTHORIZE_URL =
  'https://accounts.google.com/o/oauth2/v2/auth';

export const GOOGLE_OAUTH_TOKEN_URL =
  'https://oauth2.googleapis.com/token';

export const GOOGLE_OAUTH_REVOKE_URL =
  'https://oauth2.googleapis.com/revoke';

export const GOOGLE_DRIVE_API_BASE =
  'https://www.googleapis.com/drive/v3';

export class GoogleDriveConfigError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'GOOGLE_DRIVE_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'GoogleDriveConfigError';
  }
}

export interface GoogleDriveServerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleDriveServerConfig(
  options: { requireRedirectUri?: boolean } = {}
): GoogleDriveServerConfig {
  const clientId =
    process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || '';
  const clientSecret =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || '';
  const redirectUri =
    process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim() || '';

  if (!clientId || !clientSecret) {
    throw new GoogleDriveConfigError(
      'GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET must be configured before Google Drive OAuth can be used.'
    );
  }

  if (options.requireRedirectUri && !redirectUri) {
    throw new GoogleDriveConfigError(
      'GOOGLE_DRIVE_REDIRECT_URI must be configured before starting Google Drive OAuth.'
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}
