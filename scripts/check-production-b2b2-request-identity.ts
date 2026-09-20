import express from 'express';
import type { Server } from 'http';
import {
  RequestIdentityError,
  resolveAuthenticatedRequestIdentity,
  resolveRequestIdentity,
} from '../server/requestIdentity.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import { humanIdentityFoundationService } from '../server/identity/humanIdentityFoundationService.js';
import { apiKeyRuntimeService } from '../server/apiKeyRuntimeService.js';
import { AUTH_SESSION_COOKIE } from '../server/identity/authHttpSecurity.js';

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

async function createWorkspace(
  accountId: string,
  id: string,
  name: string
) {
  const now = Date.now();
  return postgresWorkspaceMetadataRepository.create({
    id,
    accountId,
    name,
    processingStatus: 'empty',
    currentVersionTag: 'v1.0',
    createdAt: now,
    updatedAt: now,
  });
}

function sendIdentityError(
  res: express.Response,
  error: unknown
): void {
  if (error instanceof RequestIdentityError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    code: 'IDENTITY_TEST_INTERNAL_ERROR',
  });
}

async function startTestServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();

  app.get('/async-identity', async (req, res) => {
    try {
      res.json(
        await resolveAuthenticatedRequestIdentity(req)
      );
    } catch (error) {
      sendIdentityError(res, error);
    }
  });

  app.get('/sync-identity', (req, res) => {
    try {
      res.json(resolveRequestIdentity(req));
    } catch (error) {
      sendIdentityError(res, error);
    }
  });

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
    throw new Error('Test server failed to bind.');
  }

  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
}

async function json(
  response: Response
): Promise<any> {
  return response.json();
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2B2 identity proof.'
  );

  await runPostgresMigrations();
  await reset();

  const accountA = 'acc_b2b2_human';
  const accountB = 'acc_b2b2_machine';

  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);
  await createWorkspace(
    accountA,
    'kb_b2b2_human',
    'Human Workspace'
  );

  const human =
    await humanIdentityFoundationService.createUser({
      email: 'human-b2b2@example.com',
      displayName: 'B2B2 Human',
    });

  await humanIdentityFoundationService.upsertMembership({
    accountId: accountA,
    userId: human.id,
    role: 'OWNER',
  });

  const humanSession =
    await humanIdentityFoundationService.createSession({
      userId: human.id,
      selectedAccountId: accountA,
      selectedWorkspaceId: 'kb_b2b2_human',
    });

  const noSelectionSession =
    await humanIdentityFoundationService.createSession({
      userId: human.id,
    });

  const machine =
    await apiKeyRuntimeService.createApiKey({
      accountId: accountB,
      name: 'B2B2 machine fixture',
      environment: 'test',
      scopes: ['knowledge:read'],
    });

  const { server, baseUrl } =
    await startTestServer();

  try {
    process.env.NODE_ENV = 'development';
    delete process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB;

    const devDefaultOff = await fetch(
      baseUrl + '/async-identity'
    );
    assert(
      devDefaultOff.status === 401,
      'DEFAULT_WEB must not activate merely because the server is non-production.'
    );

    process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB =
      'true';

    const devDefaultOn = await fetch(
      baseUrl + '/async-identity'
    );
    assert(
      devDefaultOn.status === 200,
      'Explicit non-production compatibility must allow DEFAULT_WEB.'
    );
    const devDefaultBody =
      await json(devDefaultOn);
    assert(
      devDefaultBody.source === 'DEFAULT_WEB' &&
        devDefaultBody.accountId === 'acc_default' &&
        devDefaultBody.authenticated === false,
      'Explicit compatibility identity must remain clearly unauthenticated DEFAULT_WEB.'
    );

    process.env.NODE_ENV = 'production';

    const productionDefault = await fetch(
      baseUrl + '/async-identity'
    );
    assert(
      productionDefault.status === 401,
      'Production must reject missing credentials even when the compatibility switch is set.'
    );

    const humanCookie =
      AUTH_SESSION_COOKIE +
      '=' +
      encodeURIComponent(humanSession.secret);

    const humanResponse = await fetch(
      baseUrl + '/async-identity',
      {
        headers: {
          cookie: humanCookie,
          'x-account-id': accountB,
        },
      }
    );
    assert(
      humanResponse.status === 200,
      'A valid human browser session must resolve through the async identity boundary.'
    );
    const humanBody =
      await json(humanResponse);
    assert(
      humanBody.source === 'HUMAN_SESSION' &&
        humanBody.authenticated === true &&
        humanBody.userId === human.id &&
        humanBody.membershipRole === 'OWNER' &&
        humanBody.accountId === accountA &&
        humanBody.workspaceId === 'kb_b2b2_human' &&
        humanBody.sessionId ===
          humanSession.session.id &&
        !humanBody.apiKeyId,
      'HUMAN_SESSION must carry the durable human, role, selected account/workspace, and session without machine credential fields.'
    );
    assert(
      humanBody.accountId !== accountB,
      'Caller-supplied account headers must not override human session account scope.'
    );

    const syncHuman = await fetch(
      baseUrl + '/sync-identity',
      {
        headers: {
          cookie: humanCookie,
        },
      }
    );
    assert(
      syncHuman.status === 401,
      'Pre-B2C synchronous product identity must reject rather than silently downgrade a human session.'
    );

    const noSelectionCookie =
      AUTH_SESSION_COOKIE +
      '=' +
      encodeURIComponent(
        noSelectionSession.secret
      );
    const noSelection = await fetch(
      baseUrl + '/async-identity',
      {
        headers: {
          cookie: noSelectionCookie,
        },
      }
    );
    assert(
      noSelection.status === 409,
      'An authenticated human without a selected account must fail account-scoped identity resolution.'
    );
    const noSelectionBody =
      await json(noSelection);
    assert(
      noSelectionBody.code ===
        'ACCOUNT_SELECTION_REQUIRED',
      'Missing human account selection must be explicit rather than defaulting to acc_default.'
    );

    const invalidHuman = await fetch(
      baseUrl + '/async-identity',
      {
        headers: {
          cookie:
            AUTH_SESSION_COOKIE +
            '=kaisess_invalid_b2b2',
        },
      }
    );
    assert(
      invalidHuman.status === 401,
      'Invalid human sessions must fail closed.'
    );

    const machineResponse = await fetch(
      baseUrl + '/async-identity',
      {
        headers: {
          authorization:
            'Bearer ' + machine.secret,
        },
      }
    );
    assert(
      machineResponse.status === 200,
      'A valid API key must remain a supported machine credential.'
    );
    const machineBody =
      await json(machineResponse);
    assert(
      machineBody.source === 'API_KEY' &&
        machineBody.authenticated === true &&
        machineBody.accountId === accountB &&
        machineBody.apiKeyId === machine.apiKey.id &&
        !machineBody.userId &&
        !machineBody.sessionId &&
        !machineBody.membershipRole,
      'API_KEY identity must remain separate from human user/session/role authority.'
    );

    const syncMachine = await fetch(
      baseUrl + '/sync-identity',
      {
        headers: {
          authorization:
            'Bearer ' + machine.secret,
        },
      }
    );
    assert(
      syncMachine.status === 200 &&
        (await json(syncMachine)).source ===
          'API_KEY',
      'The existing synchronous machine API-key path must keep working before B2C.'
    );

    const ambiguous = await fetch(
      baseUrl + '/async-identity',
      {
        headers: {
          authorization:
            'Bearer ' + machine.secret,
          cookie: humanCookie,
        },
      }
    );
    assert(
      ambiguous.status === 400,
      'A request must not combine machine and human credential classes.'
    );
    const ambiguousBody = await json(ambiguous);
    assert(
      ambiguousBody.code ===
        'AMBIGUOUS_CREDENTIALS',
      'Mixed credentials must fail with an explicit boundary error.'
    );

    await humanIdentityFoundationService.revokeSession(
      humanSession.secret
    );

    const revokedHuman = await fetch(
      baseUrl + '/async-identity',
      {
        headers: {
          cookie: humanCookie,
        },
      }
    );
    assert(
      revokedHuman.status === 401,
      'Revoked human sessions must fail closed at request identity.'
    );

    console.log(
      'PRODUCTION_B2B2_REQUEST_IDENTITY_CHECK_PASSED'
    );
    console.log(
      'HUMAN_SESSION identity, machine API-key separation, explicit non-production DEFAULT_WEB compatibility, production fail-closed behavior, selected-account enforcement, caller-account rejection, mixed-credential rejection, and revoked-session handling are verified.'
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
    'PRODUCTION_B2B2_REQUEST_IDENTITY_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
