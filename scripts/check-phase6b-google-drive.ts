import express from 'express';
import fs from 'fs';
import ExcelJS from '@ayocore/exceljs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function xlsxFixture(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventory');
  sheet.addRow([
    'product_id',
    'product_name',
    'current_stock',
    'reorder_level',
  ]);
  sheet.addRow(['GD-P1', 'Google Sheet Oak', 9, 5]);
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

async function main() {
  process.env.INTEGRATION_CREDENTIAL_KEY =
    'phase6b-test-key-0123456789abcdef-0123456789abcdef';
  process.env.GOOGLE_DRIVE_CLIENT_ID =
    'phase6b-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_DRIVE_CLIENT_SECRET =
    'phase6b-client-secret-value';
  process.env.GOOGLE_DRIVE_REDIRECT_URI =
    'http://127.0.0.1/oauth/google-drive/callback';

  const sheetBytes = await xlsxFixture();
  const nativeFetch = globalThis.fetch;

  let authorizationCodeExchanges = 0;
  let refreshExchanges = 0;
  let revokeCalls = 0;
  let csvDownloads = 0;
  let sheetExports = 0;
  const bearerTokens: string[] = [];

  const mockFetch: typeof fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(rawUrl);

    if (
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost'
    ) {
      return nativeFetch(input as any, init);
    }

    const headers = new Headers(init?.headers || {});
    const authorization = headers.get('Authorization');
    if (authorization) bearerTokens.push(authorization);

    if (url.href === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(
        init?.body instanceof URLSearchParams
          ? init.body.toString()
          : String(init?.body || '')
      );
      const grantType = body.get('grant_type');

      if (grantType === 'authorization_code') {
        authorizationCodeExchanges += 1;
        assert(
          body.get('code') === 'phase6b-auth-code',
          'OAuth token exchange must use the callback authorization code.'
        );
        assert(
          body.get('client_id') ===
            process.env.GOOGLE_DRIVE_CLIENT_ID,
          'OAuth token exchange must use the configured client ID.'
        );
        assert(
          body.get('client_secret') ===
            process.env.GOOGLE_DRIVE_CLIENT_SECRET,
          'OAuth token exchange must use the configured client secret.'
        );
        assert(
          body.get('redirect_uri') ===
            process.env.GOOGLE_DRIVE_REDIRECT_URI,
          'OAuth token exchange must preserve the exact redirect URI.'
        );

        return new Response(
          JSON.stringify({
            access_token: 'google-access-initial-phase6b',
            refresh_token: 'google-refresh-phase6b',
            expires_in: 3600,
            token_type: 'Bearer',
            scope:
              'https://www.googleapis.com/auth/drive.file',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (grantType === 'refresh_token') {
        refreshExchanges += 1;
        assert(
          body.get('refresh_token') ===
            'google-refresh-phase6b',
          'Token refresh must use the encrypted refresh token.'
        );
        return new Response(
          JSON.stringify({
            access_token: 'google-access-refreshed-phase6b',
            expires_in: 3600,
            token_type: 'Bearer',
            scope:
              'https://www.googleapis.com/auth/drive.file',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      revokeCalls += 1;
      const body = new URLSearchParams(
        init?.body instanceof URLSearchParams
          ? init.body.toString()
          : String(init?.body || '')
      );
      assert(
        body.get('token') === 'google-refresh-phase6b',
        'Disconnect must prefer revoking the refresh token.'
      );
      return new Response('', { status: 200 });
    }

    if (
      url.pathname === '/drive/v3/about' &&
      url.hostname === 'www.googleapis.com'
    ) {
      return new Response(
        JSON.stringify({
          user: {
            displayName: 'Phase 6B Test User',
            emailAddress: 'phase6b@example.invalid',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (
      url.pathname === '/drive/v3/changes/startPageToken'
    ) {
      return new Response(
        JSON.stringify({ startPageToken: 'g-start-1' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.pathname === '/drive/v3/files') {
      assert(
        url.searchParams.get('q')?.includes('text/csv') &&
          url.searchParams
            .get('q')
            ?.includes('application/vnd.google-apps.spreadsheet'),
        'Initial Drive discovery must be restricted to supported structured file types.'
      );

      return new Response(
        JSON.stringify({
          files: [
            {
              id: 'drive-csv-1',
              name: 'drive-orders.csv',
              mimeType: 'text/csv',
              modifiedTime: '2099-01-01T00:00:00.000Z',
              version: '1',
              md5Checksum: 'csv-v1',
              webViewLink:
                'https://drive.google.com/file/d/drive-csv-1/view',
              trashed: false,
              capabilities: { canDownload: true },
            },
            {
              id: 'drive-sheet-1',
              name: 'Drive Inventory',
              mimeType:
                'application/vnd.google-apps.spreadsheet',
              modifiedTime: '2099-01-02T00:00:00.000Z',
              version: '3',
              webViewLink:
                'https://docs.google.com/spreadsheets/d/drive-sheet-1/edit',
              trashed: false,
              capabilities: { canDownload: true },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.pathname === '/drive/v3/changes') {
      const pageToken = url.searchParams.get('pageToken');
      assert(
        url.searchParams.get('includeRemoved') === 'true',
        'Incremental Drive polling must request removed records.'
      );

      if (pageToken === 'g-start-1') {
        return new Response(
          JSON.stringify({
            changes: [
              {
                fileId: 'drive-csv-1',
                removed: false,
                time: '2099-01-03T00:00:00.000Z',
                file: {
                  id: 'drive-csv-1',
                  name: 'drive-orders.csv',
                  mimeType: 'text/csv',
                  modifiedTime:
                    '2099-01-03T00:00:00.000Z',
                  version: '2',
                  md5Checksum: 'csv-v2',
                  webViewLink:
                    'https://drive.google.com/file/d/drive-csv-1/view',
                  trashed: false,
                  capabilities: { canDownload: true },
                },
              },
              {
                fileId: 'drive-sheet-1',
                removed: true,
                time: '2099-01-03T01:00:00.000Z',
              },
            ],
            newStartPageToken: 'g-start-2',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      if (pageToken === 'g-start-2') {
        return new Response(
          JSON.stringify({
            changes: [],
            newStartPageToken: 'g-start-3',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      throw new Error(
        'Unexpected Google changes page token: ' +
          String(pageToken)
      );
    }

    if (
      url.pathname === '/drive/v3/files/drive-csv-1' &&
      url.searchParams.get('alt') === 'media'
    ) {
      csvDownloads += 1;
      const body =
        csvDownloads === 1
          ? [
              'order_id,customer_name,balance_due,status',
              'GD-1,Acme,12000,OPEN',
            ].join('\n')
          : [
              'order_id,customer_name,balance_due,status',
              'GD-1,Acme,7000,OPEN',
              'GD-2,Beta,4000,OPEN',
            ].join('\n');
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      });
    }

    if (
      url.pathname ===
      '/drive/v3/files/drive-sheet-1/export'
    ) {
      sheetExports += 1;
      assert(
        url.searchParams.get('mimeType') ===
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Google Sheets must be exported as XLSX before ingestion.'
      );
      return new Response(sheetBytes, {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
    }

    throw new Error(
      'Unexpected mocked Google request: ' +
        (init?.method || 'GET') +
        ' ' +
        url.href
    );
  };

  globalThis.fetch = mockFetch;

  const [
    { apiKeyStore },
    { datasetStore },
    { integrationRouter },
    { integrationStore },
    { integrationCredentialStore, IntegrationCredentialError },
    { googleDriveOAuthService },
  ] = await Promise.all([
    import('../server/apiKeyStore.js'),
    import('../server/datasets/datasetStore.js'),
    import('../server/integrations/integrationRouter.js'),
    import('../server/integrations/integrationStore.js'),
    import('../server/integrations/integrationCredentialStore.js'),
    import('../server/integrations/googleDriveOAuthService.js'),
  ]);

  const accountA = 'acc_phase6b_google_a';
  const accountB = 'acc_phase6b_google_b';

  const { secret: apiKeyA } = apiKeyStore.createApiKey({
    name: 'Phase 6B A',
    accountId: accountA,
    environment: 'test',
  });
  const { secret: apiKeyB } = apiKeyStore.createApiKey({
    name: 'Phase 6B B',
    accountId: accountB,
    environment: 'test',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 6B test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const startBody = await googleDriveOAuthService.begin({
      accountId: accountA,
      displayName: 'Company Drive',
    });
    const authorizationUrl = new URL(
      startBody.authorizationUrl
    );

    assert(
      authorizationUrl.origin === 'https://accounts.google.com' &&
        authorizationUrl.searchParams.get('scope') ===
          'https://www.googleapis.com/auth/drive.file' &&
        authorizationUrl.searchParams.get('access_type') ===
          'offline' &&
        authorizationUrl.searchParams.get(
          'include_granted_scopes'
        ) === 'true' &&
        authorizationUrl.searchParams.get('prompt') ===
          'consent' &&
        startBody.accessModel === 'PER_FILE',
      'OAuth start must request bounded per-file Drive access with offline refresh support.'
    );

    const state = authorizationUrl.searchParams.get('state');
    assert(
      state && state.length >= 32,
      'OAuth start must return a high-entropy server-side state token.'
    );

    const callbackBody =
      await googleDriveOAuthService.complete({
        state,
        code: 'phase6b-auth-code',
        expectedAccountId: accountA,
      });
    const connectionId = callbackBody.connection?.id;
    assert(
      typeof connectionId === 'string' &&
        callbackBody.connection.provider === 'GOOGLE_DRIVE' &&
        callbackBody.connection.accountId === accountA &&
        callbackBody.connection.hasCredential === true &&
        callbackBody.connection.credentialRef === undefined &&
        callbackBody.scope ===
          'https://www.googleapis.com/auth/drive.file',
      'OAuth callback must bind the connection to the state account and expose only safe connection metadata.'
    );
    assert(
      authorizationCodeExchanges === 1,
      'OAuth callback must exchange the authorization code exactly once.'
    );

    let replayBlocked = false;
    try {
      await googleDriveOAuthService.complete({
        state,
        code: 'phase6b-auth-code',
        expectedAccountId: accountA,
      });
    } catch {
      replayBlocked = true;
    }
    assert(
      replayBlocked,
      'Consumed OAuth state must not be reusable.'
    );

    const foreignResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connectionId,
      {
        headers: {
          Authorization: 'Bearer ' + apiKeyB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignResponse.status === 404,
      'Foreign account must not inspect a Google Drive connection.'
    );

    const firstSyncResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connectionId +
        '/sync',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKeyA,
        },
      }
    );
    assert(
      firstSyncResponse.status === 200,
      'Initial Google Drive sync must complete.'
    );
    const firstSync = await firstSyncResponse.json();
    assert(
      firstSync.run.status === 'COMPLETED' &&
        firstSync.run.importedCount === 2 &&
        firstSync.run.processedCount === 2 &&
        firstSync.run.cursorBefore === undefined &&
        typeof firstSync.run.cursorAfter === 'string' &&
        csvDownloads === 1 &&
        sheetExports === 1,
      'Initial Drive snapshot must import CSV and Google Sheet records and persist the transition cursor.'
    );

    const csvV1 = integrationStore.findExactImport(
      accountA,
      connectionId,
      'drive-csv-1',
      '1'
    );
    const sheetV1 = integrationStore.findExactImport(
      accountA,
      connectionId,
      'drive-sheet-1',
      '3'
    );

    assert(
      csvV1?.status === 'READY' &&
        csvV1.internalKind === 'DATASET' &&
        Boolean(csvV1.internalId) &&
        csvV1.provenance.provider === 'GOOGLE_DRIVE' &&
        csvV1.provenance.externalId === 'drive-csv-1' &&
        csvV1.provenance.externalVersion === '1' &&
        csvV1.provenance.webUrl?.includes(
          'drive.google.com'
        ),
      'Google CSV import must retain exact Drive provenance.'
    );
    assert(
      sheetV1?.status === 'READY' &&
        sheetV1.internalKind === 'DATASET' &&
        Boolean(sheetV1.internalId) &&
        sheetV1.externalName.endsWith('.xlsx') &&
        sheetV1.provenance.mimeType ===
          'application/vnd.google-apps.spreadsheet',
      'Google Sheet must export to XLSX while provenance retains the native Google Sheets type.'
    );

    const csvDatasetId = csvV1!.internalId!;
    assert(
      datasetStore.requireDataset(accountA, csvDatasetId)
        .versionIds.length === 1,
      'Initial Google CSV import must create one internal dataset version.'
    );

    const internalConnection =
      integrationStore.requireConnection(
        accountA,
        connectionId
      );
    assert(
      Boolean(internalConnection.credentialRef),
      'Internal Google Drive connection must hold only an opaque credential reference.'
    );

    const secret =
      integrationCredentialStore.get<any>({
        accountId: accountA,
        provider: 'GOOGLE_DRIVE',
        credentialRef: internalConnection.credentialRef!,
      });

    integrationCredentialStore.update({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      credentialRef: internalConnection.credentialRef!,
      secret: {
        ...secret,
        accessToken: 'expired-google-access-phase6b',
        expiresAt: Date.now() - 1000,
      },
    });

    const secondSyncResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connectionId +
        '/sync',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKeyA,
        },
      }
    );
    assert(
      secondSyncResponse.status === 200,
      'Incremental Google Drive sync must complete after token refresh.'
    );
    const secondSync = await secondSyncResponse.json();

    assert(
      refreshExchanges >= 1 &&
        bearerTokens.some((token) =>
          token.includes(
            'google-access-refreshed-phase6b'
          )
        ),
      'Expired Google access token must be refreshed from the encrypted refresh token before Drive calls continue.'
    );
    assert(
      secondSync.run.status === 'COMPLETED' &&
        secondSync.run.importedCount === 1 &&
        secondSync.run.tombstoneCount === 1 &&
        secondSync.run.processedCount === 2 &&
        Number(csvDownloads) === 2,
      'Incremental Drive changes must import changed CSV content and tombstone removed files.'
    );

    const csvV2 = integrationStore.findExactImport(
      accountA,
      connectionId,
      'drive-csv-1',
      '2'
    );
    assert(
      csvV2?.status === 'READY' &&
        csvV2.internalId === csvDatasetId &&
        datasetStore.requireDataset(
          accountA,
          csvDatasetId
        ).versionIds.length === 2,
      'Changed Drive file version must append to the same internal Dataset instead of creating a duplicate dataset.'
    );

    const tombstones = integrationStore
      .listImports({
        accountId: accountA,
        connectionId,
        externalId: 'drive-sheet-1',
        limit: 20,
      })
      .filter((item: any) => item.status === 'TOMBSTONE');
    assert(
      tombstones.length === 1,
      'Removed Drive source must create one external tombstone record.'
    );

    const credentialFile = fs.readFileSync(
      'data/integration_credentials.json',
      'utf8'
    );
    assert(
      !credentialFile.includes('google-refresh-phase6b') &&
        !credentialFile.includes(
          'google-access-refreshed-phase6b'
        ) &&
        !credentialFile.includes(
          'phase6b-client-secret-value'
        ),
      'Persisted integration credential file must contain ciphertext rather than OAuth tokens or the Google client secret.'
    );

    let foreignDisconnectBlocked = false;
    try {
      await googleDriveOAuthService.disconnect({
        accountId: accountB,
        connectionId,
      });
    } catch {
      foreignDisconnectBlocked = true;
    }
    assert(
      foreignDisconnectBlocked,
      'Foreign account must not disconnect another account Google Drive connection.'
    );

    const disconnectBody =
      await googleDriveOAuthService.disconnect({
        accountId: accountA,
        connectionId,
      });
    assert(
      disconnectBody.connection.status === 'REVOKED' &&
        disconnectBody.remoteRevoked === true &&
        revokeCalls === 1,
      'Disconnect must revoke locally, attempt Google token revocation, and expose the remote result.'
    );

    let secretDeleted = false;
    try {
      integrationCredentialStore.get({
        accountId: accountA,
        provider: 'GOOGLE_DRIVE',
        credentialRef: internalConnection.credentialRef!,
      });
    } catch (error) {
      secretDeleted =
        error instanceof IntegrationCredentialError &&
        error.code === 'CREDENTIAL_NOT_FOUND';
    }
    assert(
      secretDeleted,
      'Disconnect must delete the locally encrypted Google OAuth credential.'
    );

    const revokedSync = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connectionId +
        '/sync',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKeyA,
        },
      }
    );
    assert(
      revokedSync.status === 409,
      'Disconnected Google Drive connection must fail closed on later sync attempts.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_6B_GOOGLE_DRIVE_CHECK_PASSED');
  console.log(
    'Per-file offline OAuth, single-use state, account-bound callback completion, encrypted credentials, snapshot-safe initial discovery, CSV download, Sheets XLSX export, incremental Drive changes, refresh-token lifecycle, version reuse, deletion tombstones, service-layer disconnect, and tenant isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_6B_GOOGLE_DRIVE_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
