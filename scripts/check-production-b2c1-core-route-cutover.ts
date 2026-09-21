import crypto from 'crypto';
import express from 'express';
import type { Server } from 'http';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';
import { humanIdentityFoundationService } from '../server/identity/humanIdentityFoundationService.js';
import {
  AUTH_CSRF_COOKIE,
  AUTH_SESSION_COOKIE,
} from '../server/identity/authHttpSecurity.js';
import { workspaceRuntimeService } from '../server/workspaceRuntimeService.js';
import { workspaceRouter } from '../server/workspaceRouter.js';
import { datasetRouter } from '../server/datasets/datasetRouter.js';
import { queryRouter } from '../server/querying/queryRouter.js';
import { apiKeyRuntimeService } from '../server/apiKeyRuntimeService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function reset(): Promise<void> {
  await postgresPool().query(`
    TRUNCATE TABLE
      browser_sessions,
      user_password_credentials,
      account_memberships,
      users,
      api_usage,
      api_keys,
      account_workspace_state,
      workspaces,
      accounts
    CASCADE
  `);
  await apiKeyRuntimeService.bootstrap();
}

async function startServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use('/api/kb', workspaceRouter);
  app.use('/api/datasets', datasetRouter);
  app.use('/api/query', queryRouter);

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
    throw new Error('B2C1 test server failed to bind.');
  }

  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2C1 route proof.'
  );

  await runPostgresMigrations();
  await reset();

  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB =
    'true';

  const humanAccount = 'acc_b2c1_human';
  const machineAccount = 'acc_b2c1_machine';

  const human =
    await humanIdentityFoundationService.createUser({
      email: 'b2c1-human@example.com',
      displayName: 'B2C1 Human',
    });

  await postgresAccountRepository.ensureAccount(
    humanAccount
  );

  await humanIdentityFoundationService.upsertMembership({
    accountId: humanAccount,
    userId: human.id,
    role: 'OWNER',
  });

  const humanKb =
    await workspaceRuntimeService.createKB(
      humanAccount,
      'Human KB'
    );

  const session =
    await humanIdentityFoundationService.createSession({
      userId: human.id,
      selectedAccountId: humanAccount,
      selectedWorkspaceId: humanKb.id,
    });

  const machineKb =
    await workspaceRuntimeService.createKB(
      machineAccount,
      'Machine KB'
    );

  const machineKey =
    await apiKeyRuntimeService.createApiKey({
      accountId: machineAccount,
      name: 'B2C1 machine fixture',
      environment: 'test',
      scopes: ['knowledge:read'],
    });

  const { server, baseUrl } = await startServer();
  process.env.KNOWLEDGE_AI_PUBLIC_ORIGIN =
    baseUrl;

  const csrfToken =
    crypto.randomBytes(32).toString('base64url');
  const humanCookie =
    AUTH_SESSION_COOKIE +
    '=' +
    encodeURIComponent(session.secret) +
    '; ' +
    AUTH_CSRF_COOKIE +
    '=' +
    encodeURIComponent(csrfToken);

  try {
    for (const path of [
      '/api/kb',
      '/api/datasets',
    ]) {
      const response = await fetch(baseUrl + path);
      assert(
        response.status === 401,
        path +
          ' must reject missing production identity.'
      );
    }

    const missingQuery = await fetch(
      baseUrl + '/api/query/ask',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{}',
      }
    );
    assert(
      missingQuery.status === 401,
      '/api/query must reject missing production identity before application processing.'
    );

    const humanKbRead = await fetch(
      baseUrl + '/api/kb',
      {
        headers: {
          cookie: humanCookie,
          'x-account-id': machineAccount,
        },
      }
    );
    assert(
      humanKbRead.status === 200,
      'A valid HUMAN_SESSION must access /api/kb.'
    );
    const humanKbBody = await readJson(humanKbRead);
    assert(
      humanKbBody.kb?.id === humanKb.id &&
        Array.isArray(humanKbBody.allKbs) &&
        humanKbBody.allKbs.some(
          (kb: any) => kb.id === humanKb.id
        ) &&
        !humanKbBody.allKbs.some(
          (kb: any) => kb.id === machineKb.id
        ),
      'Human /api/kb scope must come from the session account rather than spoofed account headers.'
    );

    const humanDatasets = await fetch(
      baseUrl + '/api/datasets',
      {
        headers: {
          cookie: humanCookie,
          'x-account-id': machineAccount,
        },
      }
    );
    assert(
      humanDatasets.status === 200,
      'A valid HUMAN_SESSION must access /api/datasets.'
    );

    const kbMutationWithoutCsrf = await fetch(
      baseUrl + '/api/kb/new',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          cookie:
            AUTH_SESSION_COOKIE +
            '=' +
            encodeURIComponent(session.secret),
        },
        body: JSON.stringify({
          name: 'Should Not Exist',
        }),
      }
    );
    assert(
      kbMutationWithoutCsrf.status === 403,
      'Human-session KB mutation must require CSRF.'
    );

    const hostileQuery = await fetch(
      baseUrl + '/api/query/ask',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://attacker.example',
          cookie: humanCookie,
          'x-csrf-token': csrfToken,
        },
        body: '{}',
      }
    );
    assert(
      hostileQuery.status === 403,
      'Human-session Query mutation must reject cross-origin requests even with a matching CSRF token.'
    );

    const humanKbCreate = await fetch(
      baseUrl + '/api/kb/new',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          cookie: humanCookie,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Human Second KB',
        }),
      }
    );
    assert(
      humanKbCreate.status === 200,
      'Same-origin CSRF-protected HUMAN_SESSION must mutate /api/kb.'
    );

    const humanDatasetMutation = await fetch(
      baseUrl + '/api/datasets/preview',
      {
        method: 'POST',
        headers: {
          origin: baseUrl,
          cookie: humanCookie,
          'x-csrf-token': csrfToken,
        },
      }
    );
    assert(
      humanDatasetMutation.status === 400,
      'CSRF-protected HUMAN_SESSION must pass dataset identity middleware and reach dataset validation.'
    );

    const humanQuery = await fetch(
      baseUrl + '/api/query/ask',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          cookie: humanCookie,
          'x-csrf-token': csrfToken,
        },
        body: '{}',
      }
    );
    assert(
      humanQuery.status === 400,
      'CSRF-protected HUMAN_SESSION must pass query identity middleware and reach query validation.'
    );
    const humanQueryBody = await readJson(humanQuery);
    assert(
      humanQueryBody?.code === 'QUESTION_REQUIRED',
      'Human query must fail at application validation, not authentication.'
    );

    const machineHeaders = {
      authorization:
        'Bearer ' + machineKey.secret,
    };

    const machineKbRead = await fetch(
      baseUrl + '/api/kb',
      {
        headers: machineHeaders,
      }
    );
    assert(
      machineKbRead.status === 200,
      'API_KEY behavior must remain supported on /api/kb.'
    );
    const machineKbBody =
      await readJson(machineKbRead);
    assert(
      machineKbBody.kb?.id === machineKb.id,
      'Machine /api/kb scope must remain bound to the API-key account.'
    );

    const machineDatasets = await fetch(
      baseUrl + '/api/datasets',
      {
        headers: machineHeaders,
      }
    );
    assert(
      machineDatasets.status === 200,
      'API_KEY behavior must remain supported on /api/datasets.'
    );

    const machineQuery = await fetch(
      baseUrl + '/api/query/ask',
      {
        method: 'POST',
        headers: {
          ...machineHeaders,
          'content-type': 'application/json',
        },
        body: '{}',
      }
    );
    assert(
      machineQuery.status === 400,
      'Machine API keys must not require browser CSRF on /api/query.'
    );
    const machineQueryBody =
      await readJson(machineQuery);
    assert(
      machineQueryBody?.code === 'QUESTION_REQUIRED',
      'Machine Query request must reach application validation.'
    );

    await humanIdentityFoundationService.revokeSession(
      session.secret
    );

    for (const path of [
      '/api/kb',
      '/api/datasets',
    ]) {
      const response = await fetch(
        baseUrl + path,
        {
          headers: {
            cookie: humanCookie,
          },
        }
      );
      assert(
        response.status === 401,
        'Revoked HUMAN_SESSION must fail closed on ' +
          path +
          '.'
      );
    }

    console.log(
      'PRODUCTION_B2C1_CORE_ROUTE_CUTOVER_CHECK_PASSED'
    );
    console.log(
      'KB, Datasets, and Query accept durable HUMAN_SESSION identity, preserve API-key machine identity, fail closed without production credentials, enforce human-session same-origin/CSRF on mutations, ignore spoofed account headers, and reject revoked sessions.'
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
    'PRODUCTION_B2C1_CORE_ROUTE_CUTOVER_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
