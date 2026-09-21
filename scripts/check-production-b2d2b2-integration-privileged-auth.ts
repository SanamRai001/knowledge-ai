import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import type { Server } from 'http';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import { humanIdentityFoundationService } from '../server/identity/humanIdentityFoundationService.js';
import type {
  AccountMembershipRole,
  HumanUser,
} from '../server/identity/types.js';
import {
  AUTH_CSRF_COOKIE,
  AUTH_SESSION_COOKIE,
} from '../server/identity/authHttpSecurity.js';
import { apiKeyRuntimeService } from '../server/apiKeyRuntimeService.js';
import { integrationPersistence } from '../server/integrations/integrationPersistence.js';
import { integrationRouter } from '../server/integrations/integrationRouter.js';
import {
  GoogleDriveOAuthError,
  GoogleDriveOAuthService,
} from '../server/integrations/googleDriveOAuthService.js';
import {
  GoogleDriveOAuthStateStore,
} from '../server/integrations/googleDriveOAuthStateStore.js';
import {
  MicrosoftOneDriveOAuthError,
  MicrosoftOneDriveOAuthService,
} from '../server/integrations/microsoftOneDriveOAuthService.js';
import {
  MicrosoftOneDriveOAuthStateStore,
} from '../server/integrations/microsoftOneDriveOAuthStateStore.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

type HumanFixture = {
  user: HumanUser;
  secret: string;
  csrf: string;
  cookie: string;
};

async function reset(): Promise<void> {
  await postgresPool().query(
    'TRUNCATE TABLE users, accounts CASCADE'
  );
  await apiKeyRuntimeService.bootstrap();
}

async function createHuman(params: {
  accountId: string;
  email: string;
  role: AccountMembershipRole;
}): Promise<HumanFixture> {
  const user =
    await humanIdentityFoundationService.createUser({
      email: params.email,
      displayName: params.role + ' fixture',
    });

  await humanIdentityFoundationService.upsertMembership({
    accountId: params.accountId,
    userId: user.id,
    role: params.role,
  });

  const session =
    await humanIdentityFoundationService.createSession({
      userId: user.id,
      selectedAccountId: params.accountId,
    });

  const csrf =
    crypto.randomBytes(32).toString('base64url');

  return {
    user,
    secret: session.secret,
    csrf,
    cookie:
      AUTH_SESSION_COOKIE +
      '=' +
      encodeURIComponent(session.secret) +
      '; ' +
      AUTH_CSRF_COOKIE +
      '=' +
      encodeURIComponent(csrf),
  };
}

function mutationHeaders(
  fixture: HumanFixture,
  origin: string,
  spoofAccountId?: string
): Record<string, string> {
  return {
    cookie: fixture.cookie,
    origin,
    'x-csrf-token': fixture.csrf,
    ...(spoofAccountId
      ? { 'x-account-id': spoofAccountId }
      : {}),
  };
}

async function startServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationRouter);

  const server = await new Promise<Server>(
    (resolve) => {
      const listener = app.listen(
        0,
        '127.0.0.1',
        () => resolve(listener)
      );
    }
  );

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('B2D2B2 test server failed to bind.');
  }

  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
}

async function readJson(
  response: Response
): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function proveOAuthAccountBinding(): Promise<void> {
  const googleStateStore =
    new GoogleDriveOAuthStateStore();
  const googleAttempt = googleStateStore.create({
    accountId: 'acc_oauth_google_a',
    displayName: 'Google fixture',
    redirectUri:
      'https://example.test/api/integrations/google-drive/oauth/callback',
  });
  const googleService =
    new GoogleDriveOAuthService(googleStateStore);

  let googleBlocked = false;
  try {
    await googleService.complete({
      state: googleAttempt.state,
      code: 'not-exchanged',
      expectedAccountId: 'acc_oauth_google_b',
    });
  } catch (error) {
    googleBlocked =
      error instanceof GoogleDriveOAuthError &&
      error.code === 'OAUTH_ACCOUNT_MISMATCH' &&
      error.statusCode === 403;
  }
  assert(
    googleBlocked,
    'Google OAuth completion must reject a privileged session account that differs from the account bound into OAuth state.'
  );

  const microsoftStateStore =
    new MicrosoftOneDriveOAuthStateStore();
  const microsoftAttempt =
    microsoftStateStore.create({
      accountId: 'acc_oauth_ms_a',
      displayName: 'OneDrive fixture',
      redirectUri:
        'https://example.test/api/integrations/onedrive/oauth/callback',
      tenant: 'common',
    });
  const microsoftService =
    new MicrosoftOneDriveOAuthService(
      microsoftStateStore
    );

  let microsoftBlocked = false;
  try {
    await microsoftService.complete({
      state: microsoftAttempt.state,
      code: 'not-exchanged',
      expectedAccountId: 'acc_oauth_ms_b',
    });
  } catch (error) {
    microsoftBlocked =
      error instanceof MicrosoftOneDriveOAuthError &&
      error.code ===
        'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH' &&
      error.statusCode === 403;
  }
  assert(
    microsoftBlocked,
    'OneDrive OAuth completion must reject a privileged session account that differs from the account bound into OAuth state.'
  );
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2D2B2 proof.'
  );

  await runPostgresMigrations();
  await reset();
  await proveOAuthAccountBinding();

  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB =
    'true';

  const accountA = 'acc_b2d2b2_a';
  const accountB = 'acc_b2d2b2_b';
  const machineAccount = 'acc_b2d2b2_machine';

  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);
  await postgresAccountRepository.ensureAccount(
    machineAccount
  );

  const ownerA = await createHuman({
    accountId: accountA,
    email: 'b2d2b2-owner-a@example.com',
    role: 'OWNER',
  });
  const adminA = await createHuman({
    accountId: accountA,
    email: 'b2d2b2-admin-a@example.com',
    role: 'ADMIN',
  });
  const memberA = await createHuman({
    accountId: accountA,
    email: 'b2d2b2-member-a@example.com',
    role: 'MEMBER',
  });
  const ownerB = await createHuman({
    accountId: accountB,
    email: 'b2d2b2-owner-b@example.com',
    role: 'OWNER',
  });

  const connectionA =
    await integrationPersistence.createConnection({
      accountId: accountA,
      provider: 'TEST',
      displayName: 'B2D2B2 Account A',
      capabilities: {
        incrementalSync: true,
        deletions: true,
        supportedMimeTypes: ['text/csv'],
        supportedResourceKinds: ['FILE'],
      },
    });

  const connectionB =
    await integrationPersistence.createConnection({
      accountId: accountB,
      provider: 'TEST',
      displayName: 'B2D2B2 Account B',
      capabilities: {
        incrementalSync: true,
        deletions: true,
        supportedMimeTypes: ['text/csv'],
        supportedResourceKinds: ['FILE'],
      },
    });

  const machineConnection =
    await integrationPersistence.createConnection({
      accountId: machineAccount,
      provider: 'TEST',
      displayName: 'B2D2B2 Machine',
      capabilities: {
        incrementalSync: true,
        deletions: true,
        supportedMimeTypes: ['text/csv'],
        supportedResourceKinds: ['FILE'],
      },
    });

  await integrationPersistence.setConnectionStatus(
    machineAccount,
    machineConnection.id,
    'PAUSED'
  );

  const machineKey =
    await apiKeyRuntimeService.createApiKey({
      accountId: machineAccount,
      name: 'B2D2B2 machine fixture',
      environment: 'test',
      scopes: [
        'role:owner',
        'role:admin',
        'integrations:manage',
      ],
    });

  const { server, baseUrl } =
    await startServer();
  process.env.KNOWLEDGE_AI_PUBLIC_ORIGIN =
    baseUrl;

  const machineHeaders = {
    authorization:
      'Bearer ' + machineKey.secret,
  };

  try {
    const missingManagement = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connectionA.id) +
        '/pause',
      { method: 'POST' }
    );
    assert(
      missingManagement.status === 401,
      'Integration administration must reject missing production identity.'
    );

    const memberManagement = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connectionA.id) +
        '/pause',
      {
        method: 'POST',
        headers: mutationHeaders(
          memberA,
          baseUrl
        ),
      }
    );
    const memberManagementBody =
      await readJson(memberManagement);
    assert(
      memberManagement.status === 403 &&
        memberManagementBody?.code ===
          'PRIVILEGED_ROLE_REQUIRED',
      'MEMBER must not administer Integration connection lifecycle.'
    );

    const ownerNoCsrf = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connectionA.id) +
        '/pause',
      {
        method: 'POST',
        headers: {
          cookie: ownerA.cookie,
          origin: baseUrl,
        },
      }
    );
    assert(
      ownerNoCsrf.status === 403,
      'OWNER Integration administration must retain browser CSRF protection.'
    );

    const ownerPause = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connectionA.id) +
        '/pause',
      {
        method: 'POST',
        headers: mutationHeaders(
          ownerA,
          baseUrl,
          accountB
        ),
      }
    );
    const ownerPauseBody =
      await readJson(ownerPause);
    assert(
      ownerPause.status === 200 &&
        ownerPauseBody.connection?.id ===
          connectionA.id &&
        ownerPauseBody.connection?.status ===
          'PAUSED' &&
        ownerPauseBody.connection?.accountId ===
          accountA,
      'OWNER must administer only the durable session account despite spoofed account headers.'
    );

    const adminResume = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connectionA.id) +
        '/resume',
      {
        method: 'POST',
        headers: mutationHeaders(
          adminA,
          baseUrl
        ),
      }
    );
    const adminResumeBody =
      await readJson(adminResume);
    assert(
      adminResume.status === 200 &&
        adminResumeBody.connection?.status ===
          'ACTIVE',
      'ADMIN must be able to resume an Integration connection.'
    );

    const foreignPause = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connectionA.id) +
        '/pause',
      {
        method: 'POST',
        headers: mutationHeaders(
          ownerB,
          baseUrl,
          accountA
        ),
      }
    );
    assert(
      foreignPause.status === 404,
      'A privileged user from another account must not administer a foreign Integration connection by raw ID.'
    );

    const machineRead = await fetch(
      baseUrl + '/api/integrations/connections',
      {
        headers: machineHeaders,
      }
    );
    const machineReadBody =
      await readJson(machineRead);
    assert(
      machineRead.status === 200 &&
        machineReadBody.connections?.some(
          (item: any) =>
            item.id === machineConnection.id
        ) &&
        !machineReadBody.connections?.some(
          (item: any) =>
            item.id === connectionA.id ||
            item.id === connectionB.id
        ),
      'API_KEY Integration reads must remain available and machine-account scoped.'
    );

    const machinePause = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(
          machineConnection.id
        ) +
        '/pause',
      {
        method: 'POST',
        headers: machineHeaders,
      }
    );
    const machinePauseBody =
      await readJson(machinePause);
    assert(
      machinePause.status === 403 &&
        machinePauseBody?.code ===
          'PRIVILEGED_HUMAN_SESSION_REQUIRED',
      'API keys must not become browser Integration administrators even with human-looking or integrations:manage scopes.'
    );

    const machineSync = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(
          machineConnection.id
        ) +
        '/sync',
      {
        method: 'POST',
        headers: machineHeaders,
      }
    );
    const machineSyncBody =
      await readJson(machineSync);
    assert(
      machineSync.status === 409 &&
        machineSyncBody?.code ===
          'CONNECTION_NOT_ACTIVE',
      'API-key machine sync must remain an operational runtime path and reach Integration state validation rather than privileged-human authorization.'
    );

    const apiKeyOAuthStart = await fetch(
      baseUrl +
        '/api/integrations/google-drive/oauth/start',
      {
        method: 'POST',
        headers: {
          ...machineHeaders,
          'content-type': 'application/json',
        },
        body: '{}',
      }
    );
    const apiKeyOAuthStartBody =
      await readJson(apiKeyOAuthStart);
    assert(
      apiKeyOAuthStart.status === 403 &&
        apiKeyOAuthStartBody?.code ===
          'PRIVILEGED_HUMAN_SESSION_REQUIRED',
      'API keys must not initiate browser OAuth connection administration.'
    );

    const memberCallback = await fetch(
      baseUrl +
        '/api/integrations/google-drive/oauth/callback?state=invalid&code=dummy',
      {
        headers: {
          cookie: memberA.cookie,
        },
      }
    );
    const memberCallbackBody =
      await readJson(memberCallback);
    assert(
      memberCallback.status === 403 &&
        memberCallbackBody?.code ===
          'PRIVILEGED_ROLE_REQUIRED',
      'MEMBER must not complete privileged OAuth connection administration.'
    );

    const ownerInvalidCallback = await fetch(
      baseUrl +
        '/api/integrations/google-drive/oauth/callback?state=invalid&code=dummy',
      {
        headers: {
          cookie: ownerA.cookie,
        },
      }
    );
    const ownerInvalidCallbackBody =
      await readJson(ownerInvalidCallback);
    assert(
      ownerInvalidCallback.status === 400 &&
        ownerInvalidCallbackBody?.code ===
          'OAUTH_STATE_INVALID',
      'Privileged OWNER OAuth callback must pass role authorization and remain protected by state validation.'
    );

    await humanIdentityFoundationService.revokeSession(
      adminA.secret
    );

    const revokedAdmin = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connectionA.id) +
        '/pause',
      {
        method: 'POST',
        headers: mutationHeaders(
          adminA,
          baseUrl
        ),
      }
    );
    assert(
      revokedAdmin.status === 401,
      'Revoked ADMIN HUMAN_SESSION must fail closed for Integration administration.'
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });
  }

  const routerSource = fs.readFileSync(
    'server/integrations/integrationRouter.ts',
    'utf8'
  );
  const workspaceSource = fs.readFileSync(
    'src/components/IntegrationsWorkspace.tsx',
    'utf8'
  );

  for (const path of [
    "'/onedrive/oauth/start'",
    "'/onedrive/oauth/callback'",
    "'/onedrive/connections/:id/disconnect'",
    "'/google-drive/oauth/start'",
    "'/google-drive/oauth/callback'",
    "'/google-drive/connections/:id/disconnect'",
    "'/connections/:id/reset-cursor'",
    "'/connections/:id/pause'",
    "'/connections/:id/resume'",
    "'/connections/:id/revoke'",
  ]) {
    const index = routerSource.indexOf(path);
    assert(
      index >= 0 &&
        routerSource
          .slice(index, index + 180)
          .includes('requireOwnerOrAdmin'),
      'Privileged Integration route must use OWNER/ADMIN guard: ' +
        path
    );
  }

  const syncIndex = routerSource.indexOf(
    "'/connections/:id/sync'"
  );
  assert(
    syncIndex >= 0 &&
      !routerSource
        .slice(syncIndex, syncIndex + 180)
        .includes('requireOwnerOrAdmin'),
    'Operational Integration sync must remain separate from browser-admin lifecycle authorization.'
  );

  assert(
    routerSource.includes(
      'expectedAccountId: identity(res).accountId'
    ),
    'OAuth callbacks must bind completion to the authenticated privileged session account.'
  );

  assert(
    workspaceSource.includes('ka_csrf=') &&
      workspaceSource.includes(
        "'X-CSRF-Token': csrfToken()"
      ),
    'Integration browser mutations must send the HUMAN_SESSION CSRF token.'
  );

  console.log(
    'PRODUCTION_B2D2B2_INTEGRATION_PRIVILEGED_AUTH_CHECK_PASSED'
  );
  console.log(
    'Integration lifecycle/OAuth administration is HUMAN_SESSION OWNER/ADMIN-only, MEMBER and API_KEY administration are denied, operational API-key sync remains available, OAuth callback completion is account-bound in addition to random/expiring/single-use state, tenant isolation is preserved, and browser mutations remain CSRF protected.'
  );

  await closePostgresPool();
}

main().catch(async (error) => {
  console.error(
    'PRODUCTION_B2D2B2_INTEGRATION_PRIVILEGED_AUTH_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
