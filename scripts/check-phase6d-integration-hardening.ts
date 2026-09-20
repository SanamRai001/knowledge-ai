import {
  connectorRegistry,
} from '../server/integrations/connectorRegistry.js';
import {
  integrationStore,
  IntegrationStateError,
} from '../server/integrations/integrationStore.js';
import {
  integrationSyncService,
} from '../server/integrations/integrationSyncService.js';
import {
  integrationCredentialStore,
  IntegrationCredentialError,
} from '../server/integrations/integrationCredentialStore.js';
import {
  GoogleDriveConnector,
  GoogleDriveCredentialSecret,
} from '../server/integrations/connectors/googleDriveConnector.js';
import {
  GoogleDriveOAuthService,
} from '../server/integrations/googleDriveOAuthService.js';
import {
  GoogleDriveOAuthStateStore,
} from '../server/integrations/googleDriveOAuthStateStore.js';
import {
  MicrosoftOneDriveConnector,
  MicrosoftOneDriveCredentialSecret,
} from '../server/integrations/connectors/microsoftOneDriveConnector.js';
import {
  MicrosoftOneDriveOAuthService,
} from '../server/integrations/microsoftOneDriveOAuthService.js';
import {
  MicrosoftOneDriveOAuthStateStore,
} from '../server/integrations/microsoftOneDriveOAuthStateStore.js';
import {
  ExternalChangePage,
  ExternalRecord,
  ExternalSourceRef,
  IntegrationCapabilities,
  IntegrationConnector,
  IntegrationConnectorContext,
} from '../server/integrations/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function httpError(
  statusCode: number,
  code: string,
  message: string
): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

class HardeningConnector implements IntegrationConnector {
  public readonly provider = 'GENERIC_REST' as const;

  public mode:
    | 'SUCCESS'
    | 'TRANSIENT_TWICE'
    | 'RATE_LIMIT'
    | 'CURSOR_INVALID'
    | 'BLOCK' = 'SUCCESS';

  public listCalls = 0;
  public seenCursors: Array<string | undefined> = [];

  private blockRelease: (() => void) | null = null;
  private blockEnteredResolve: (() => void) | null = null;
  private blockEntered = Promise.resolve();

  public capabilities(): IntegrationCapabilities {
    return {
      incrementalSync: true,
      deletions: true,
      supportedMimeTypes: ['text/csv'],
      supportedResourceKinds: ['FILE'],
    };
  }

  public async validateConnection(): Promise<{ ok: true }> {
    return { ok: true };
  }

  public async listChanges(
    _context: IntegrationConnectorContext,
    params: { cursor?: string }
  ): Promise<ExternalChangePage> {
    this.listCalls += 1;
    this.seenCursors.push(params.cursor);

    if (
      this.mode === 'TRANSIENT_TWICE' &&
      this.listCalls <= 2
    ) {
      throw httpError(
        503,
        'TEST_PROVIDER_UNAVAILABLE',
        'Temporary provider outage.'
      );
    }

    if (this.mode === 'RATE_LIMIT') {
      throw httpError(
        429,
        'TEST_RATE_LIMIT',
        'Too many requests.'
      );
    }

    if (
      this.mode === 'CURSOR_INVALID' &&
      params.cursor
    ) {
      throw httpError(
        410,
        'TEST_CURSOR_EXPIRED',
        'Provider cursor expired.'
      );
    }

    if (this.mode === 'BLOCK') {
      this.blockEnteredResolve?.();
      await new Promise<void>((resolve) => {
        this.blockRelease = resolve;
      });
    }

    return {
      records: [],
      nextCursor:
        this.mode === 'CURSOR_INVALID'
          ? 'cursor-after-reset'
          : 'cursor-success-' + String(this.listCalls),
    };
  }

  public async fetchRecord(
    _context: IntegrationConnectorContext,
    _ref: ExternalSourceRef
  ): Promise<ExternalRecord> {
    throw new Error('Hardening connector has no file fixtures.');
  }

  public async healthCheck(): Promise<{ ok: true }> {
    return { ok: true };
  }

  public prepareBlock(): Promise<void> {
    this.mode = 'BLOCK';
    this.blockEntered = new Promise<void>((resolve) => {
      this.blockEnteredResolve = resolve;
    });
    return this.blockEntered;
  }

  public releaseBlock(): void {
    this.blockRelease?.();
    this.blockRelease = null;
    this.blockEnteredResolve = null;
  }

  public reset(mode: HardeningConnector['mode'] = 'SUCCESS'): void {
    this.mode = mode;
    this.listCalls = 0;
    this.seenCursors = [];
    this.blockRelease = null;
    this.blockEnteredResolve = null;
  }
}

async function main() {
  process.env.INTEGRATION_SYNC_RETRY_BASE_MS = '0';
  process.env.INTEGRATION_CREDENTIAL_KEY =
    'phase6d-test-key-0123456789abcdef-0123456789abcdef';
  process.env.GOOGLE_DRIVE_CLIENT_ID =
    'phase6d-google-client.apps.googleusercontent.com';
  process.env.GOOGLE_DRIVE_CLIENT_SECRET =
    'phase6d-google-secret';
  process.env.GOOGLE_DRIVE_REDIRECT_URI =
    'http://localhost/phase6d/google/callback';
  process.env.MICROSOFT_ONEDRIVE_CLIENT_ID =
    'phase6d-microsoft-client';
  process.env.MICROSOFT_ONEDRIVE_CLIENT_SECRET =
    'phase6d-microsoft-secret';
  process.env.MICROSOFT_ONEDRIVE_REDIRECT_URI =
    'http://localhost/phase6d/onedrive/callback';
  process.env.MICROSOFT_ONEDRIVE_TENANT_ID = 'common';

  const hardeningConnector = new HardeningConnector();
  connectorRegistry.register(hardeningConnector);

  // 1. Retryable provider failures retry with the same checkpoint and
  // only advance the cursor after a successful attempt.
  const retryAccount = 'acc_phase6d_retry';
  const retryConnection = integrationSyncService.createConnection({
    accountId: retryAccount,
    provider: 'GENERIC_REST',
    displayName: 'Retry connector',
  });

  hardeningConnector.reset('TRANSIENT_TWICE');
  const retryRun = await integrationSyncService.sync({
    accountId: retryAccount,
    connectionId: retryConnection.id,
  });

  assert(
    retryRun.status === 'COMPLETED' &&
      retryRun.attemptCount === 3 &&
      retryRun.maxAttempts === 3 &&
      hardeningConnector.listCalls === 3 &&
      hardeningConnector.seenCursors.every(
        (cursor) => cursor === undefined
      ) &&
      integrationStore.requireConnection(
        retryAccount,
        retryConnection.id
      ).cursor === 'cursor-success-3',
    'Transient failures must retry with a frozen checkpoint and advance only after success.'
  );

  // 2. Exhausted retryable failures become observable ERROR/SYNC_FAILED.
  const rateAccount = 'acc_phase6d_rate';
  const rateConnection = integrationSyncService.createConnection({
    accountId: rateAccount,
    provider: 'GENERIC_REST',
    displayName: 'Rate limited connector',
  });

  hardeningConnector.reset('RATE_LIMIT');
  const rateRun = await integrationSyncService.sync({
    accountId: rateAccount,
    connectionId: rateConnection.id,
  });
  const rateState = integrationStore.requireConnection(
    rateAccount,
    rateConnection.id
  );

  assert(
    rateRun.status === 'FAILED' &&
      rateRun.attemptCount === 3 &&
      rateRun.failureCategory === 'RATE_LIMIT' &&
      rateRun.retryable === true &&
      rateState.status === 'ERROR' &&
      rateState.attentionReason === 'SYNC_FAILED' &&
      rateState.lastFailureCategory === 'RATE_LIMIT' &&
      rateState.cursor === undefined,
    'Exhausted rate-limit retries must remain observable without advancing the cursor.'
  );

  const rateHistory = integrationSyncService.listRuns({
    accountId: rateAccount,
    connectionId: rateConnection.id,
    limit: 10,
  });
  assert(
    rateHistory.some(
      (run) =>
        run.id === rateRun.id &&
        run.failureCategory === 'RATE_LIMIT' &&
        run.attemptCount === 3
    ),
    'Sync history must retain retry/failure classification for observability.'
  );

  // Generic SYNC_FAILED can be explicitly resumed.
  const resumedRate = integrationSyncService.resume(
    rateAccount,
    rateConnection.id
  );
  assert(
    resumedRate.status === 'ACTIVE' &&
      resumedRate.attentionReason === undefined,
    'Generic exhausted sync failures must require and support explicit resume.'
  );

  // 3. Invalid cursor fails immediately and requires explicit reset.
  const cursorAccount = 'acc_phase6d_cursor';
  const cursorConnection = integrationSyncService.createConnection({
    accountId: cursorAccount,
    provider: 'GENERIC_REST',
    displayName: 'Cursor connector',
  });
  integrationStore.updateConnection(
    cursorAccount,
    cursorConnection.id,
    { cursor: 'expired-provider-cursor' }
  );

  hardeningConnector.reset('CURSOR_INVALID');
  const cursorRun = await integrationSyncService.sync({
    accountId: cursorAccount,
    connectionId: cursorConnection.id,
  });
  const cursorFailed = integrationStore.requireConnection(
    cursorAccount,
    cursorConnection.id
  );

  assert(
    cursorRun.status === 'FAILED' &&
      cursorRun.attemptCount === 1 &&
      cursorRun.failureCategory === 'CURSOR_INVALID' &&
      cursorRun.retryable === false &&
      cursorFailed.status === 'ERROR' &&
      cursorFailed.attentionReason ===
        'CURSOR_RESET_REQUIRED' &&
      cursorFailed.cursor === 'expired-provider-cursor',
    'Expired provider cursors must fail explicitly without silent full resync.'
  );

  let resumeCursorBlocked = false;
  try {
    integrationSyncService.resume(
      cursorAccount,
      cursorConnection.id
    );
  } catch (error) {
    resumeCursorBlocked =
      error instanceof IntegrationStateError &&
      error.code === 'CONNECTION_NOT_ACTIVE';
  }
  assert(
    resumeCursorBlocked,
    'Cursor failure must not be bypassed by generic resume.'
  );

  const resetCursor = integrationSyncService.resetCursor(
    cursorAccount,
    cursorConnection.id
  );
  assert(
    resetCursor.status === 'ACTIVE' &&
      resetCursor.cursor === undefined &&
      resetCursor.attentionReason === undefined,
    'Explicit cursor reset must clear only the broken checkpoint/recovery state.'
  );

  hardeningConnector.reset('CURSOR_INVALID');
  const recoveredCursorRun = await integrationSyncService.sync({
    accountId: cursorAccount,
    connectionId: cursorConnection.id,
  });
  assert(
    recoveredCursorRun.status === 'COMPLETED' &&
      integrationStore.requireConnection(
        cursorAccount,
        cursorConnection.id
      ).cursor === 'cursor-after-reset',
    'Cursor reset must allow a fresh provider snapshot to establish a new checkpoint.'
  );

  // 4. Persisted lease plus in-process store prevents overlapping syncs.
  const concurrencyAccount = 'acc_phase6d_concurrency';
  const concurrencyConnection =
    integrationSyncService.createConnection({
      accountId: concurrencyAccount,
      provider: 'GENERIC_REST',
      displayName: 'Concurrency connector',
    });

  hardeningConnector.reset();
  const entered = hardeningConnector.prepareBlock();
  const firstSyncPromise = integrationSyncService.sync({
    accountId: concurrencyAccount,
    connectionId: concurrencyConnection.id,
  });
  await entered;

  const publicDuringSync = integrationSyncService.getConnection(
    concurrencyAccount,
    concurrencyConnection.id
  );
  assert(
    publicDuringSync.syncInProgress === true &&
      !Object.prototype.hasOwnProperty.call(
        publicDuringSync,
        'syncLeaseId'
      ),
    'Public connection state must expose busy status without leaking the lease identifier.'
  );

  let overlappingBlocked = false;
  try {
    await integrationSyncService.sync({
      accountId: concurrencyAccount,
      connectionId: concurrencyConnection.id,
    });
  } catch (error) {
    overlappingBlocked =
      error instanceof IntegrationStateError &&
      error.code === 'SYNC_ALREADY_RUNNING';
  }
  assert(
    overlappingBlocked,
    'A second worker/request must not process the same connection while its sync lease is active.'
  );

  hardeningConnector.releaseBlock();
  const firstSync = await firstSyncPromise;
  assert(
    firstSync.status === 'COMPLETED' &&
      integrationSyncService.getConnection(
        concurrencyAccount,
        concurrencyConnection.id
      ).syncInProgress === false,
    'Sync lease must be released after completion.'
  );

  // Stale lease can be reclaimed after expiry.
  integrationStore.acquireSyncLease({
    accountId: concurrencyAccount,
    connectionId: concurrencyConnection.id,
    leaseId: 'stale-lease',
    leaseMs: 1_000,
    now: 1_000,
  });
  const reclaimed = integrationStore.acquireSyncLease({
    accountId: concurrencyAccount,
    connectionId: concurrencyConnection.id,
    leaseId: 'fresh-lease',
    leaseMs: 5_000,
    now: 3_000,
  });
  assert(
    reclaimed.syncLeaseId === 'fresh-lease',
    'Expired persisted sync leases must be recoverable after process/worker loss.'
  );
  integrationStore.releaseSyncLease({
    accountId: concurrencyAccount,
    connectionId: concurrencyConnection.id,
    leaseId: 'fresh-lease',
  });

  // 5. Google permission loss -> explicit PERMISSION_LOST -> reauthorize
  // the same connection ID while preserving its checkpoint/history.
  const googleAccount = 'acc_phase6d_google';
  const googleOldCredential =
    integrationCredentialStore.create<GoogleDriveCredentialSecret>({
      accountId: googleAccount,
      provider: 'GOOGLE_DRIVE',
      secret: {
        accessToken: 'g-old-access',
        refreshToken: 'g-old-refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
        scope:
          'https://www.googleapis.com/auth/drive.file',
        tokenType: 'Bearer',
      },
    });

  const googlePermissionFetch: typeof fetch = async (
    input
  ) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    if (
      url.pathname === '/drive/v3/changes/startPageToken' ||
      url.pathname === '/drive/v3/changes'
    ) {
      return new Response(
        JSON.stringify({
          error: { message: 'File permission removed.' },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    throw new Error('Unexpected Google permission test URL: ' + url.href);
  };
  connectorRegistry.register(
    new GoogleDriveConnector(
      integrationCredentialStore,
      googlePermissionFetch
    )
  );

  const googleConnection =
    integrationSyncService.createConnection({
      accountId: googleAccount,
      provider: 'GOOGLE_DRIVE',
      displayName: 'Google hardening',
      credentialRef: googleOldCredential,
    });
  const preservedGoogleCursor = Buffer.from(
    JSON.stringify({
      v: 1,
      mode: 'CHANGES',
      pageToken: 'preserve-google-cursor',
    }),
    'utf8'
  ).toString('base64url');
  integrationStore.updateConnection(
    googleAccount,
    googleConnection.id,
    { cursor: preservedGoogleCursor }
  );

  const googlePermissionRun =
    await integrationSyncService.sync({
      accountId: googleAccount,
      connectionId: googleConnection.id,
    });
  const googleFailed = integrationStore.requireConnection(
    googleAccount,
    googleConnection.id
  );

  assert(
    googlePermissionRun.status === 'FAILED' &&
      googlePermissionRun.failureCategory === 'PERMISSION' &&
      googlePermissionRun.attemptCount === 1 &&
      googleFailed.status === 'ERROR' &&
      googleFailed.attentionReason === 'PERMISSION_LOST',
    'Google 403 permission loss must fail immediately into explicit recovery state.'
  );

  let googleResumeBlocked = false;
  try {
    integrationSyncService.resume(
      googleAccount,
      googleConnection.id
    );
  } catch (error) {
    googleResumeBlocked =
      error instanceof IntegrationStateError;
  }
  assert(
    googleResumeBlocked,
    'Google permission loss must require reauthorization rather than generic resume.'
  );

  const googleOAuthFetch: typeof fetch = async (
    input,
    init
  ) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(
        init?.body instanceof URLSearchParams
          ? init.body.toString()
          : String(init?.body || '')
      );
      assert(
        body.get('code') === 'phase6d-google-code',
        'Google reauthorization must exchange the new authorization code.'
      );
      return new Response(
        JSON.stringify({
          access_token: 'g-new-access',
          refresh_token: 'g-new-refresh',
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
    throw new Error('Unexpected Google reauth URL: ' + url.href);
  };

  const googleOAuth = new GoogleDriveOAuthService(
    new GoogleDriveOAuthStateStore(),
    integrationCredentialStore,
    googleOAuthFetch
  );
  const googleStart = await googleOAuth.begin({
    accountId: googleAccount,
    connectionId: googleConnection.id,
  });
  const googleState = new URL(
    googleStart.authorizationUrl
  ).searchParams.get('state');
  assert(googleState, 'Google reauthorization must issue state.');

  const googleReauthorized = await googleOAuth.complete({
    state: googleState,
    code: 'phase6d-google-code',
  });

  assert(
    googleReauthorized.connection.id ===
      googleConnection.id &&
      googleReauthorized.connection.status === 'ACTIVE' &&
      googleReauthorized.connection.attentionReason === undefined &&
      integrationStore.requireConnection(
        googleAccount,
        googleConnection.id
      ).cursor === preservedGoogleCursor,
    'Google reauthorization must repair the existing connection without losing its checkpoint.'
  );

  let googleOldCredentialDeleted = false;
  try {
    integrationCredentialStore.get({
      accountId: googleAccount,
      provider: 'GOOGLE_DRIVE',
      credentialRef: googleOldCredential,
    });
  } catch (error) {
    googleOldCredentialDeleted =
      error instanceof IntegrationCredentialError &&
      error.code === 'CREDENTIAL_NOT_FOUND';
  }
  assert(
    googleOldCredentialDeleted,
    'Google in-place reauthorization must delete the superseded OAuth credential.'
  );

  // 6. OneDrive permission loss and in-place PKCE reauthorization.
  const microsoftAccount = 'acc_phase6d_microsoft';
  const microsoftOldCredential =
    integrationCredentialStore.create<MicrosoftOneDriveCredentialSecret>({
      accountId: microsoftAccount,
      provider: 'MICROSOFT_ONEDRIVE',
      secret: {
        accessToken: 'm-old-access',
        refreshToken: 'm-old-refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
        scope: 'Files.Read offline_access',
        tokenType: 'Bearer',
      },
    });

  const microsoftPermissionFetch: typeof fetch = async (
    input
  ) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    if (
      url.pathname === '/v1.0/me/drive/root/delta'
    ) {
      return new Response(
        JSON.stringify({
          error: { message: 'Access to OneDrive revoked.' },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    throw new Error(
      'Unexpected OneDrive permission test URL: ' +
        url.href
    );
  };
  connectorRegistry.register(
    new MicrosoftOneDriveConnector(
      integrationCredentialStore,
      microsoftPermissionFetch
    )
  );

  const microsoftConnection =
    integrationSyncService.createConnection({
      accountId: microsoftAccount,
      provider: 'MICROSOFT_ONEDRIVE',
      displayName: 'OneDrive hardening',
      credentialRef: microsoftOldCredential,
    });
  integrationStore.updateConnection(
    microsoftAccount,
    microsoftConnection.id,
    {
      cursor:
        'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=preserve-ms',
    }
  );

  const microsoftPermissionRun =
    await integrationSyncService.sync({
      accountId: microsoftAccount,
      connectionId: microsoftConnection.id,
    });
  const microsoftFailed =
    integrationStore.requireConnection(
      microsoftAccount,
      microsoftConnection.id
    );

  assert(
    microsoftPermissionRun.status === 'FAILED' &&
      microsoftPermissionRun.failureCategory === 'PERMISSION' &&
      microsoftPermissionRun.attemptCount === 1 &&
      microsoftFailed.status === 'ERROR' &&
      microsoftFailed.attentionReason === 'PERMISSION_LOST',
    'OneDrive 403 permission loss must fail immediately into explicit recovery state.'
  );

  let microsoftPkceChallenge = '';
  const microsoftOAuthFetch: typeof fetch = async (
    input,
    init
  ) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    if (
      url.href ===
      'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    ) {
      const body = new URLSearchParams(
        init?.body instanceof URLSearchParams
          ? init.body.toString()
          : String(init?.body || '')
      );
      const verifier = body.get('code_verifier') || '';
      const challenge = (
        await import('crypto')
      ).default
        .createHash('sha256')
        .update(verifier, 'utf8')
        .digest('base64url');
      assert(
        challenge === microsoftPkceChallenge,
        'OneDrive reauthorization must preserve S256 PKCE verification.'
      );
      return new Response(
        JSON.stringify({
          access_token: 'm-new-access',
          refresh_token: 'm-new-refresh',
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
    throw new Error(
      'Unexpected OneDrive reauth URL: ' + url.href
    );
  };

  const microsoftOAuth =
    new MicrosoftOneDriveOAuthService(
      new MicrosoftOneDriveOAuthStateStore(),
      integrationCredentialStore,
      microsoftOAuthFetch
    );
  const microsoftStart = await microsoftOAuth.begin({
    accountId: microsoftAccount,
    connectionId: microsoftConnection.id,
  });
  const microsoftUrl = new URL(
    microsoftStart.authorizationUrl
  );
  microsoftPkceChallenge =
    microsoftUrl.searchParams.get('code_challenge') || '';
  const microsoftState =
    microsoftUrl.searchParams.get('state');
  assert(
    microsoftState &&
      microsoftPkceChallenge.length >= 40,
    'OneDrive reauthorization must issue state and PKCE challenge.'
  );

  const microsoftReauthorized =
    await microsoftOAuth.complete({
      state: microsoftState,
      code: 'phase6d-microsoft-code',
    });

  assert(
    microsoftReauthorized.connection.id ===
      microsoftConnection.id &&
      microsoftReauthorized.connection.status === 'ACTIVE' &&
      microsoftReauthorized.connection.attentionReason === undefined &&
      integrationStore.requireConnection(
        microsoftAccount,
        microsoftConnection.id
      ).cursor.includes('token=preserve-ms'),
    'OneDrive reauthorization must repair the existing connection without losing its delta checkpoint.'
  );

  let microsoftOldCredentialDeleted = false;
  try {
    integrationCredentialStore.get({
      accountId: microsoftAccount,
      provider: 'MICROSOFT_ONEDRIVE',
      credentialRef: microsoftOldCredential,
    });
  } catch (error) {
    microsoftOldCredentialDeleted =
      error instanceof IntegrationCredentialError &&
      error.code === 'CREDENTIAL_NOT_FOUND';
  }
  assert(
    microsoftOldCredentialDeleted,
    'OneDrive in-place reauthorization must delete the superseded OAuth credential.'
  );

  console.log('PHASE_6D_INTEGRATION_HARDENING_CHECK_PASSED');
  console.log(
    'Retry classification/backoff, frozen checkpoints, exhausted retry observability, explicit cursor reset, persisted sync leases, overlap prevention, stale-lease recovery, Google/OneDrive permission-loss states, and in-place reauthorization are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_6D_INTEGRATION_HARDENING_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
