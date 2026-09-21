import crypto from 'crypto';
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
import { platformManagementRouter } from '../server/platform/platformManagementRouter.js';
import { platformApiRouter } from '../server/platform/platformApiRouter.js';
import {
  PLATFORM_SCOPES,
} from '../server/platform/platformApiManifest.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function reset(): Promise<void> {
  await postgresPool().query(
    'TRUNCATE TABLE users, accounts CASCADE'
  );
  await apiKeyRuntimeService.bootstrap();
}

async function startServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/platform-management',
    platformManagementRouter
  );
  app.use('/api/platform/v1', platformApiRouter);

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
    throw new Error('B2D1 test server failed to bind.');
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

type HumanFixture = {
  user: HumanUser;
  secret: string;
  csrf: string;
  cookie: string;
};

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
  origin: string
): Record<string, string> {
  return {
    cookie: fixture.cookie,
    origin,
    'x-csrf-token': fixture.csrf,
    'content-type': 'application/json',
  };
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2D1 proof.'
  );

  await runPostgresMigrations();
  await reset();

  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB =
    'true';

  const accountA = 'acc_b2d1_a';
  const accountB = 'acc_b2d1_b';

  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const ownerA = await createHuman({
    accountId: accountA,
    email: 'b2d1-owner-a@example.com',
    role: 'OWNER',
  });
  const adminA = await createHuman({
    accountId: accountA,
    email: 'b2d1-admin-a@example.com',
    role: 'ADMIN',
  });
  const memberA = await createHuman({
    accountId: accountA,
    email: 'b2d1-member-a@example.com',
    role: 'MEMBER',
  });
  const ownerB = await createHuman({
    accountId: accountB,
    email: 'b2d1-owner-b@example.com',
    role: 'OWNER',
  });

  const internalMachine =
    await apiKeyRuntimeService.createApiKey({
      accountId: accountA,
      name: 'Legacy internal developer machine key',
      environment: 'test',
      scopes: [
        'platform-internal:developer:manage',
      ],
    });

  const stableA =
    await apiKeyRuntimeService.createApiKey({
      accountId: accountA,
      name: 'Stable A',
      environment: 'test',
      scopes: [PLATFORM_SCOPES.sourcesRead],
    });

  const stableB =
    await apiKeyRuntimeService.createApiKey({
      accountId: accountB,
      name: 'Stable B',
      environment: 'test',
      scopes: [PLATFORM_SCOPES.sourcesRead],
    });

  await apiKeyRuntimeService.recordUsage({
    requestId: 'b2d1_usage_a',
    apiKeyId: stableA.apiKey.id,
    accountId: accountA,
    aiId: 'platform',
    endpoint: '/api/platform/v1/sources',
    timestamp: Date.now(),
    status: 200,
    latencyMs: 10,
    refused: false,
    grounded: true,
  });

  await apiKeyRuntimeService.recordUsage({
    requestId: 'b2d1_usage_b',
    apiKeyId: stableB.apiKey.id,
    accountId: accountB,
    aiId: 'platform',
    endpoint: '/api/platform/v1/sources',
    timestamp: Date.now(),
    status: 200,
    latencyMs: 11,
    refused: false,
    grounded: true,
  });

  const { server, baseUrl } = await startServer();
  process.env.KNOWLEDGE_AI_PUBLIC_ORIGIN =
    baseUrl;

  try {
    const missing = await fetch(
      baseUrl + '/api/platform-management/keys'
    );
    assert(
      missing.status === 401,
      'Platform Management must reject missing production identity.'
    );

    const machineManagement = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        headers: {
          authorization:
            'Bearer ' + internalMachine.secret,
        },
      }
    );
    const machineManagementBody =
      await readJson(machineManagement);
    assert(
      machineManagement.status === 403 &&
        machineManagementBody?.code ===
          'PRIVILEGED_HUMAN_SESSION_REQUIRED',
      'Even an internal developer-management API key must not become browser admin authority.'
    );

    const memberRead = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        headers: {
          cookie: memberA.cookie,
        },
      }
    );
    const memberReadBody = await readJson(memberRead);
    assert(
      memberRead.status === 403 &&
        memberReadBody?.code ===
          'PRIVILEGED_ROLE_REQUIRED',
      'MEMBER must not access Platform Management.'
    );

    for (const fixture of [ownerA, adminA]) {
      const response = await fetch(
        baseUrl + '/api/platform-management/keys',
        {
          headers: {
            cookie: fixture.cookie,
            'x-account-id': accountB,
          },
        }
      );
      assert(
        response.status === 200,
        'OWNER and ADMIN must be able to read Platform Management.'
      );
      const body = await readJson(response);
      assert(
        Array.isArray(body.keys) &&
          body.keys.every(
            (key: any) =>
              key.accountId === accountA &&
              key.keyHash === undefined
          ),
        'Privileged human key listing must derive account scope from the session and never expose key hashes.'
      );
    }

    const noCsrf = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        method: 'POST',
        headers: {
          cookie: ownerA.cookie,
          origin: baseUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Must fail CSRF',
          scopes: [PLATFORM_SCOPES.sourcesRead],
        }),
      }
    );
    assert(
      noCsrf.status === 403,
      'Privileged human key creation must require CSRF.'
    );

    const memberMutation = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        method: 'POST',
        headers: mutationHeaders(
          memberA,
          baseUrl
        ),
        body: JSON.stringify({
          name: 'Member forbidden',
          scopes: [PLATFORM_SCOPES.sourcesRead],
        }),
      }
    );
    assert(
      memberMutation.status === 403,
      'MEMBER must remain forbidden even with valid CSRF.'
    );

    const invalidScope = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        method: 'POST',
        headers: mutationHeaders(
          ownerA,
          baseUrl
        ),
        body: JSON.stringify({
          name: 'Unsafe arbitrary scope',
          scopes: [
            PLATFORM_SCOPES.sourcesRead,
            'platform:automation:execute',
          ],
        }),
      }
    );
    assert(
      invalidScope.status === 400,
      'Platform Management must keep the stable-scope allowlist.'
    );

    const ownerCreate = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        method: 'POST',
        headers: mutationHeaders(
          ownerA,
          baseUrl
        ),
        body: JSON.stringify({
          name: 'Owner-created stable key',
          environment: 'test',
          scopes: [PLATFORM_SCOPES.sourcesRead],
        }),
      }
    );
    assert(
      ownerCreate.status === 201,
      'OWNER must be able to create a scoped Platform API key.'
    );
    const ownerCreateBody =
      await readJson(ownerCreate);
    assert(
      typeof ownerCreateBody.secret === 'string' &&
        ownerCreateBody.secret.startsWith('kn_test_') &&
        ownerCreateBody.apiKey?.accountId === accountA &&
        ownerCreateBody.apiKey?.keyHash === undefined &&
        !JSON.stringify(ownerCreateBody).includes(
          'keyHash'
        ),
      'Created Platform key must be account scoped, one-time-secret based, and hash safe.'
    );
    const ownerCreatedKeyId =
      ownerCreateBody.apiKey.id as string;
    const ownerCreatedSecret =
      ownerCreateBody.secret as string;

    const adminCreate = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        method: 'POST',
        headers: mutationHeaders(
          adminA,
          baseUrl
        ),
        body: JSON.stringify({
          name: 'Admin-created stable key',
          environment: 'test',
          scopes: [PLATFORM_SCOPES.sourcesRead],
        }),
      }
    );
    assert(
      adminCreate.status === 201,
      'ADMIN must be able to create a scoped Platform API key.'
    );

    const ownerBList = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        headers: {
          cookie: ownerB.cookie,
          'x-account-id': accountA,
        },
      }
    );
    const ownerBListBody =
      await readJson(ownerBList);
    assert(
      ownerBList.status === 200 &&
        ownerBListBody.keys.every(
          (key: any) =>
            key.accountId === accountB
        ) &&
        !ownerBListBody.keys.some(
          (key: any) =>
            key.id === ownerCreatedKeyId
        ),
      'Platform Management key inventory must remain tenant isolated.'
    );

    const foreignRevoke = await fetch(
      baseUrl +
        '/api/platform-management/keys/' +
        encodeURIComponent(ownerCreatedKeyId),
      {
        method: 'DELETE',
        headers: mutationHeaders(
          ownerB,
          baseUrl
        ),
      }
    );
    assert(
      foreignRevoke.status === 404,
      'A privileged user in another account must not revoke a foreign API key.'
    );

    const usageA = await fetch(
      baseUrl + '/api/platform-management/usage',
      {
        headers: {
          cookie: ownerA.cookie,
          'x-account-id': accountB,
        },
      }
    );
    const usageABody = await readJson(usageA);
    assert(
      usageA.status === 200 &&
        usageABody.recentLogs?.some(
          (item: any) =>
            item.requestId === 'b2d1_usage_a'
        ) &&
        !usageABody.recentLogs?.some(
          (item: any) =>
            item.requestId === 'b2d1_usage_b'
        ),
      'Platform usage must remain session-account scoped.'
    );

    const stableMachineCall = await fetch(
      baseUrl + '/api/platform/v1/sources',
      {
        headers: {
          authorization:
            'Bearer ' + stableA.secret,
        },
      }
    );
    assert(
      stableMachineCall.status === 200,
      'Stable /api/platform/v1 must remain usable by properly scoped API keys.'
    );

    const humanStableCall = await fetch(
      baseUrl + '/api/platform/v1/sources',
      {
        headers: {
          cookie: ownerA.cookie,
        },
      }
    );
    const humanStableBody =
      await readJson(humanStableCall);
    assert(
      humanStableCall.status === 401 &&
        humanStableBody?.error?.code ===
          'PLATFORM_UNAUTHORIZED',
      'Stable /api/platform/v1 must remain API-key-only and must not accept HUMAN_SESSION as machine authentication.'
    );

    const revoke = await fetch(
      baseUrl +
        '/api/platform-management/keys/' +
        encodeURIComponent(ownerCreatedKeyId),
      {
        method: 'DELETE',
        headers: mutationHeaders(
          ownerA,
          baseUrl
        ),
      }
    );
    const revokeBody = await readJson(revoke);
    assert(
      revoke.status === 200 &&
        revokeBody.keys?.some(
          (key: any) =>
            key.id === ownerCreatedKeyId &&
            key.status === 'revoked'
        ),
      'OWNER must be able to durably revoke its own Platform API key.'
    );

    const revokedStableCall = await fetch(
      baseUrl + '/api/platform/v1/sources',
      {
        headers: {
          authorization:
            'Bearer ' + ownerCreatedSecret,
        },
      }
    );
    assert(
      revokedStableCall.status === 403,
      'Revocation through Platform Management must update the stable API validation boundary.'
    );

    await humanIdentityFoundationService.revokeSession(
      ownerA.secret
    );

    const revokedOwner = await fetch(
      baseUrl + '/api/platform-management/keys',
      {
        headers: {
          cookie: ownerA.cookie,
        },
      }
    );
    assert(
      revokedOwner.status === 401,
      'Revoked privileged HUMAN_SESSION must fail closed.'
    );

    console.log(
      'PRODUCTION_B2D1_PRIVILEGED_PLATFORM_MANAGEMENT_CHECK_PASSED'
    );
    console.log(
      'Platform Management is HUMAN_SESSION-only, OWNER/ADMIN-gated, CSRF protected, PostgreSQL-authoritative for key metadata/usage, tenant isolated, and cleanly separated from the API-key-only stable Platform API.'
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });
    await closePostgresPool();
  }
}

main().catch(async (error) => {
  console.error(
    'PRODUCTION_B2D1_PRIVILEGED_PLATFORM_MANAGEMENT_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
