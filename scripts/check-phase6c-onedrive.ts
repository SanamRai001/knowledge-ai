import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import ExcelJS from '@ayocore/exceljs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function xlsxFixture(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow([
    'product_id',
    'product_name',
    'current_stock',
    'reorder_level',
  ]);
  sheet.addRow(['OD-P1', 'OneDrive Walnut', 14, 6]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  process.env.INTEGRATION_CREDENTIAL_KEY =
    'phase6c-test-key-0123456789abcdef-0123456789abcdef';
  process.env.MICROSOFT_ONEDRIVE_CLIENT_ID =
    'phase6c-microsoft-client-id';
  process.env.MICROSOFT_ONEDRIVE_CLIENT_SECRET =
    'phase6c-microsoft-client-secret';
  process.env.MICROSOFT_ONEDRIVE_REDIRECT_URI =
    'http://127.0.0.1/oauth/onedrive/callback';
  process.env.MICROSOFT_ONEDRIVE_TENANT_ID = 'common';

  const nativeFetch = globalThis.fetch;
  const workbookBytes = await xlsxFixture();

  let expectedPkceChallenge = '';
  let authCodeExchanges = 0;
  let refreshExchanges = 0;
  let csvDownloads = 0;
  let xlsxDownloads = 0;
  let unexpectedExternalCalls = 0;
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

    if (
      url.href ===
      'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    ) {
      const body = new URLSearchParams(
        init?.body instanceof URLSearchParams
          ? init.body.toString()
          : String(init?.body || '')
      );

      if (body.get('grant_type') === 'authorization_code') {
        authCodeExchanges += 1;
        const verifier = body.get('code_verifier') || '';
        const challenge = crypto
          .createHash('sha256')
          .update(verifier, 'utf8')
          .digest('base64url');

        assert(
          verifier.length >= 43 &&
            challenge === expectedPkceChallenge,
          'Microsoft token exchange must prove the same S256 PKCE verifier created at OAuth start.'
        );
        assert(
          body.get('scope') === 'offline_access Files.Read',
          'Microsoft token exchange must request only offline_access + Files.Read.'
        );
        assert(
          body.get('client_secret') ===
            process.env.MICROSOFT_ONEDRIVE_CLIENT_SECRET,
          'Microsoft app client secret must be supplied only to the server-side token endpoint.'
        );

        return new Response(
          JSON.stringify({
            access_token: 'ms-access-initial-phase6c',
            refresh_token: 'ms-refresh-initial-phase6c',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'Files.Read offline_access',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (body.get('grant_type') === 'refresh_token') {
        refreshExchanges += 1;
        assert(
          body.get('refresh_token') ===
            'ms-refresh-initial-phase6c',
          'OneDrive refresh must use the encrypted current refresh token.'
        );

        return new Response(
          JSON.stringify({
            access_token: 'ms-access-refreshed-phase6c',
            refresh_token: 'ms-refresh-rotated-phase6c',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'Files.Read offline_access',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    if (
      url.href.startsWith(
        'https://graph.microsoft.com/v1.0/me/drive?'
      )
    ) {
      return new Response(
        JSON.stringify({
          id: 'drive-phase6c',
          driveType: 'business',
          webUrl: 'https://example-my.sharepoint.com/',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (
      url.pathname === '/v1.0/me/drive/root/delta'
    ) {
      const token = url.searchParams.get('token');

      if (!token) {
        assert(
          url.searchParams
            .get('$select')
            ?.includes('lastModifiedDateTime'),
          'Initial OneDrive delta request must ask for stable version/provenance fields.'
        );
        assert(
          headers.get('deltaExcludeParent') === 'true',
          'OneDrive delta sync should exclude unchanged parent noise.'
        );

        return new Response(
          JSON.stringify({
            value: [
              {
                id: 'od-csv-1',
                name: 'onedrive-orders.csv',
                eTag: '"etag-csv-v1"',
                cTag: '"ctag-csv-v1"',
                webUrl:
                  'https://example-my.sharepoint.com/onedrive-orders.csv',
                lastModifiedDateTime:
                  '2099-02-01T00:00:00Z',
                file: { mimeType: 'text/csv' },
              },
              {
                id: 'od-xlsx-1',
                name: 'onedrive-products.xlsx',
                eTag: '"etag-xlsx-v1"',
                webUrl:
                  'https://example-my.sharepoint.com/onedrive-products.xlsx',
                lastModifiedDateTime:
                  '2099-02-01T01:00:00Z',
                file: {
                  mimeType:
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                },
              },
              {
                id: 'folder-ignore',
                name: 'Folder',
                folder: { childCount: 2 },
              },
            ],
            '@odata.deltaLink':
              'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=delta-1',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (token === 'delta-1') {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: 'od-csv-1',
                name: 'onedrive-orders.csv',
                eTag: '"etag-csv-v2"',
                cTag: '"ctag-csv-v2"',
                webUrl:
                  'https://example-my.sharepoint.com/onedrive-orders.csv',
                lastModifiedDateTime:
                  '2099-02-02T00:00:00Z',
                file: { mimeType: 'text/csv' },
              },
              {
                id: 'od-xlsx-1',
                deleted: { state: 'deleted' },
              },
            ],
            '@odata.deltaLink':
              'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=delta-2',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (token === 'delta-2') {
        return new Response(
          JSON.stringify({
            value: [],
            '@odata.deltaLink':
              'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=delta-3',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    if (
      url.pathname ===
      '/v1.0/me/drive/items/od-csv-1/content'
    ) {
      csvDownloads += 1;
      const body =
        csvDownloads === 1
          ? [
              'order_id,customer_name,balance_due,status',
              'OD-1,Acme,9000,OPEN',
            ].join('\n')
          : [
              'order_id,customer_name,balance_due,status',
              'OD-1,Acme,5000,OPEN',
              'OD-2,Beta,2000,OPEN',
            ].join('\n');

      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      });
    }

    if (
      url.pathname ===
      '/v1.0/me/drive/items/od-xlsx-1/content'
    ) {
      xlsxDownloads += 1;
      return new Response(workbookBytes, {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
    }

    unexpectedExternalCalls += 1;
    throw new Error(
      'Unexpected mocked Microsoft request: ' +
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
    { microsoftOneDriveOAuthService },
  ] = await Promise.all([
    import('../server/apiKeyStore.js'),
    import('../server/datasets/datasetStore.js'),
    import('../server/integrations/integrationRouter.js'),
    import('../server/integrations/integrationStore.js'),
    import('../server/integrations/integrationCredentialStore.js'),
    import('../server/integrations/microsoftOneDriveOAuthService.js'),
  ]);

  const accountA = 'acc_phase6c_onedrive_a';
  const accountB = 'acc_phase6c_onedrive_b';
  const { secret: apiKeyA } = apiKeyStore.createApiKey({
    name: 'Phase 6C A',
    accountId: accountA,
    environment: 'test',
  });
  const { secret: apiKeyB } = apiKeyStore.createApiKey({
    name: 'Phase 6C B',
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
      throw new Error('Could not resolve Phase 6C test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const startBody =
      await microsoftOneDriveOAuthService.begin({
        accountId: accountA,
        displayName: 'Finance OneDrive',
      });
    const authorizationUrl = new URL(
      startBody.authorizationUrl
    );

    expectedPkceChallenge =
      authorizationUrl.searchParams.get('code_challenge') || '';

    const scopes = (
      authorizationUrl.searchParams.get('scope') || ''
    )
      .split(/\s+/)
      .filter(Boolean);

    assert(
      authorizationUrl.origin ===
        'https://login.microsoftonline.com' &&
        authorizationUrl.pathname ===
          '/common/oauth2/v2.0/authorize' &&
        scopes.includes('offline_access') &&
        scopes.includes('Files.Read') &&
        scopes.length === 2 &&
        authorizationUrl.searchParams.get(
          'code_challenge_method'
        ) === 'S256' &&
        expectedPkceChallenge.length >= 40 &&
        startBody.pkce === 'S256',
      'OneDrive OAuth start must use offline_access + least-privilege Files.Read with S256 PKCE.'
    );

    const state = authorizationUrl.searchParams.get('state');
    assert(
      state && state.length >= 32,
      'OneDrive OAuth state must be high entropy.'
    );

    const callbackBody =
      await microsoftOneDriveOAuthService.complete({
        state,
        code: 'phase6c-auth-code',
        expectedAccountId: accountA,
      });
    const connectionId = callbackBody.connection?.id;

    assert(
      typeof connectionId === 'string' &&
        callbackBody.connection.provider ===
          'MICROSOFT_ONEDRIVE' &&
        callbackBody.connection.accountId === accountA &&
        callbackBody.connection.hasCredential === true &&
        !Object.prototype.hasOwnProperty.call(
          callbackBody.connection,
          'credentialRef'
        ) &&
        callbackBody.pkce === 'S256' &&
        authCodeExchanges === 1,
      'OneDrive callback must bind state account, exchange PKCE code once, and hide credential references.'
    );

    let replayBlocked = false;
    try {
      await microsoftOneDriveOAuthService.complete({
        state,
        code: 'phase6c-auth-code',
        expectedAccountId: accountA,
      });
    } catch {
      replayBlocked = true;
    }
    assert(
      replayBlocked,
      'OneDrive OAuth state must be single use.'
    );

    const foreignInspect = await fetch(
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
      foreignInspect.status === 404,
      'Foreign account must not inspect OneDrive connection.'
    );

    const firstSyncResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connectionId +
        '/sync',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKeyA },
      }
    );
    assert(
      firstSyncResponse.status === 200,
      'Initial OneDrive delta sync must complete.'
    );
    const firstSync = await firstSyncResponse.json();

    assert(
      firstSync.run.status === 'COMPLETED' &&
        firstSync.run.importedCount === 2 &&
        firstSync.run.processedCount === 2 &&
        typeof firstSync.run.cursorAfter === 'string' &&
        firstSync.run.cursorAfter.includes(
          'graph.microsoft.com/v1.0/me/drive/root/delta'
        ) &&
        csvDownloads === 1 &&
        xlsxDownloads === 1,
      'Initial OneDrive delta enumeration must import supported CSV/XLSX items and ignore folders.'
    );

    const csvV1 = integrationStore
      .listImports({
        accountId: accountA,
        connectionId,
        externalId: 'od-csv-1',
        limit: 20,
      })
      .find(
        (item: any) =>
          item.externalVersion === 'etag:"etag-csv-v1"'
      );
    const xlsxV1 = integrationStore
      .listImports({
        accountId: accountA,
        connectionId,
        externalId: 'od-xlsx-1',
        limit: 20,
      })
      .find(
        (item: any) =>
          item.externalVersion === 'etag:"etag-xlsx-v1"'
      );

    assert(
      csvV1?.status === 'READY' &&
        Boolean(csvV1.internalId) &&
        csvV1.provenance.provider ===
          'MICROSOFT_ONEDRIVE' &&
        csvV1.provenance.externalId === 'od-csv-1',
      'OneDrive CSV must retain Microsoft external identity/version provenance.'
    );
    assert(
      xlsxV1?.status === 'READY' &&
        Boolean(xlsxV1.internalId),
      'OneDrive XLSX must reuse the existing structured dataset ingestion path.'
    );

    const csvDatasetId = csvV1!.internalId!;
    assert(
      datasetStore.requireDataset(accountA, csvDatasetId)
        .versionIds.length === 1,
      'Initial OneDrive CSV must create one internal DatasetVersion.'
    );

    const internal =
      integrationStore.requireConnection(
        accountA,
        connectionId
      );
    const secret =
      integrationCredentialStore.get<any>({
        accountId: accountA,
        provider: 'MICROSOFT_ONEDRIVE',
        credentialRef: internal.credentialRef!,
      });
    integrationCredentialStore.update({
      accountId: accountA,
      provider: 'MICROSOFT_ONEDRIVE',
      credentialRef: internal.credentialRef!,
      secret: {
        ...secret,
        accessToken: 'expired-ms-access-phase6c',
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
        headers: { Authorization: 'Bearer ' + apiKeyA },
      }
    );
    assert(
      secondSyncResponse.status === 200,
      'Incremental OneDrive delta sync must succeed after refresh.'
    );
    const secondSync = await secondSyncResponse.json();

    assert(
      refreshExchanges >= 1 &&
        bearerTokens.some((token) =>
          token.includes('ms-access-refreshed-phase6c')
        ),
      'Expired OneDrive access token must refresh before Graph calls continue.'
    );

    const rotatedSecret =
      integrationCredentialStore.get<any>({
        accountId: accountA,
        provider: 'MICROSOFT_ONEDRIVE',
        credentialRef: internal.credentialRef!,
      });
    assert(
      rotatedSecret.refreshToken ===
        'ms-refresh-rotated-phase6c',
      'Microsoft refresh-token rotation must replace the old stored refresh token.'
    );

    assert(
      secondSync.run.status === 'COMPLETED' &&
        secondSync.run.importedCount === 1 &&
        secondSync.run.tombstoneCount === 1 &&
        secondSync.run.processedCount === 2 &&
        Number(csvDownloads) === 2,
      'Incremental OneDrive delta must version changed CSV and tombstone removed XLSX.'
    );

    const csvV2 = integrationStore
      .listImports({
        accountId: accountA,
        connectionId,
        externalId: 'od-csv-1',
        limit: 20,
      })
      .find(
        (item: any) =>
          item.externalVersion === 'etag:"etag-csv-v2"'
      );
    assert(
      csvV2?.status === 'READY' &&
        csvV2.internalId === csvDatasetId &&
        datasetStore.requireDataset(
          accountA,
          csvDatasetId
        ).versionIds.length === 2,
      'Changed OneDrive version must append to the same internal Dataset.'
    );

    const credentialFile = fs.readFileSync(
      'data/integration_credentials.json',
      'utf8'
    );
    assert(
      !credentialFile.includes(
        'ms-refresh-rotated-phase6c'
      ) &&
        !credentialFile.includes(
          'ms-access-refreshed-phase6c'
        ) &&
        !credentialFile.includes(
          'phase6c-microsoft-client-secret'
        ),
      'OneDrive OAuth tokens and Microsoft client secret must never appear in persisted plaintext credential state.'
    );

    integrationStore.updateConnection(
      accountA,
      connectionId,
      {
        cursor:
          'https://attacker.example/steal?delta=1',
      }
    );
    const externalCallsBeforeMaliciousCursor =
      unexpectedExternalCalls;

    const maliciousCursorResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connectionId +
        '/sync',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKeyA },
      }
    );
    assert(
      maliciousCursorResponse.status === 422 &&
        unexpectedExternalCalls ===
          externalCallsBeforeMaliciousCursor,
      'Stored OneDrive cursor must be rejected before any request can escape the approved Graph delta origin/path.'
    );

    let foreignDisconnectBlocked = false;
    try {
      await microsoftOneDriveOAuthService.disconnect({
        accountId: accountB,
        connectionId,
      });
    } catch {
      foreignDisconnectBlocked = true;
    }
    assert(
      foreignDisconnectBlocked,
      'Foreign account must not disconnect another account OneDrive connection.'
    );

    const disconnectBody =
      await microsoftOneDriveOAuthService.disconnect({
        accountId: accountA,
        connectionId,
      });
    assert(
      disconnectBody.connection.status === 'REVOKED' &&
        disconnectBody.localCredentialDeleted === true,
      'OneDrive disconnect must fail closed locally and delete encrypted OAuth material.'
    );

    let credentialGone = false;
    try {
      integrationCredentialStore.get({
        accountId: accountA,
        provider: 'MICROSOFT_ONEDRIVE',
        credentialRef: internal.credentialRef!,
      });
    } catch (error) {
      credentialGone =
        error instanceof IntegrationCredentialError &&
        error.code === 'CREDENTIAL_NOT_FOUND';
    }
    assert(
      credentialGone,
      'Disconnected OneDrive connection must no longer have locally usable OAuth credentials.'
    );

    const revokedSync = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connectionId +
        '/sync',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKeyA },
      }
    );
    assert(
      revokedSync.status === 409,
      'Disconnected OneDrive connection must fail closed on future sync.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_6C_ONEDRIVE_CHECK_PASSED');
  console.log(
    'Microsoft delegated Files.Read OAuth with S256 PKCE, account-bound callback completion, encrypted/offline token lifecycle, initial and incremental Graph delta sync, CSV/XLSX ingestion, rotated refresh tokens, tombstones, delta-cursor origin validation, service-layer disconnect, and tenant isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_6C_ONEDRIVE_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
