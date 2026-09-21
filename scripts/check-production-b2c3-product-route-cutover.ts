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
import {
  AUTH_CSRF_COOKIE,
  AUTH_SESSION_COOKIE,
} from '../server/identity/authHttpSecurity.js';
import { apiKeyRuntimeService } from '../server/apiKeyRuntimeService.js';
import { actionPersistence } from '../server/actions/actionPersistence.js';
import { actionRouter } from '../server/actions/actionRouter.js';
import { watchRuntimeService } from '../server/watch/watchRuntimeService.js';
import { watchRouter } from '../server/watch/watchRouter.js';
import { integrationPersistence } from '../server/integrations/integrationPersistence.js';
import { integrationRouter } from '../server/integrations/integrationRouter.js';
import { automationRuntimeService } from '../server/automation/automationRuntimeService.js';
import { automationRouter } from '../server/automation/automationRouter.js';

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
  app.use('/api/actions', actionRouter);
  app.use('/api/watch', watchRouter);
  app.use('/api/integrations', integrationRouter);
  app.use('/api/automation', automationRouter);

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
    throw new Error('B2C3 test server failed to bind.');
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

async function seedAction(
  accountId: string,
  suffix: string
) {
  return actionPersistence.createProposal({
    accountId,
    instruction:
      'B2C3 seeded action ' + suffix,
    intent: 'UPDATE_STATUS',
    status: 'PROPOSED',
    parserSource: 'DETERMINISTIC',
    parsedInput: {
      intent: 'UPDATE_STATUS',
      status: 'PAID',
    },
    targetEntityIds: [],
    mutations: [],
    preconditions: [],
    eventData: {
      fixture: suffix,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
}

async function seedWatch(
  accountId: string,
  suffix: string
) {
  return watchRuntimeService.createRule({
    accountId,
    name: 'B2C3 Watch ' + suffix,
    condition: {
      kind: 'TIME_REACHED',
      triggerAt:
        Date.now() + 24 * 60 * 60 * 1000,
    },
    evaluationMode: 'MANUAL',
  });
}

async function seedIntegration(
  accountId: string,
  suffix: string
) {
  return integrationPersistence.createConnection({
    accountId,
    provider: 'TEST',
    displayName:
      'B2C3 Integration ' + suffix,
    capabilities: {
      incrementalSync: true,
      deletions: true,
      supportedMimeTypes: ['text/csv'],
      supportedResourceKinds: ['FILE'],
    },
    settings: {
      fixture: suffix,
    },
  });
}

async function seedAutomation(
  accountId: string,
  suffix: string,
  source: 'HUMAN_SESSION' | 'API_KEY'
) {
  return automationRuntimeService.upsertPolicy({
    accountId,
    actor: 'b2c3-seed:' + suffix,
    policy: {
      enabled: false,
      mode: 'SUGGEST_ONLY',
      allowedActionIntents: ['UPDATE_STATUS'],
      maxRiskClass: 'LOW',
      allowedIdentitySources: [source],
    },
  });
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2C3 route proof.'
  );

  await runPostgresMigrations();
  await reset();

  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB =
    'true';

  const humanAccount = 'acc_b2c3_human';
  const machineAccount = 'acc_b2c3_machine';

  await postgresAccountRepository.ensureAccount(
    humanAccount
  );
  await postgresAccountRepository.ensureAccount(
    machineAccount
  );

  const human =
    await humanIdentityFoundationService.createUser({
      email: 'b2c3-human@example.com',
      displayName: 'B2C3 Human',
    });

  await humanIdentityFoundationService.upsertMembership({
    accountId: humanAccount,
    userId: human.id,
    role: 'OWNER',
  });

  const session =
    await humanIdentityFoundationService.createSession({
      userId: human.id,
      selectedAccountId: humanAccount,
    });

  const humanAction =
    await seedAction(humanAccount, 'human');
  const machineAction =
    await seedAction(machineAccount, 'machine');

  const humanWatch =
    await seedWatch(humanAccount, 'human');
  const machineWatch =
    await seedWatch(machineAccount, 'machine');

  const humanIntegration =
    await seedIntegration(humanAccount, 'human');
  const machineIntegration =
    await seedIntegration(machineAccount, 'machine');

  const humanPolicy =
    await seedAutomation(
      humanAccount,
      'human',
      'HUMAN_SESSION'
    );
  const machinePolicy =
    await seedAutomation(
      machineAccount,
      'machine',
      'API_KEY'
    );

  const machineKey =
    await apiKeyRuntimeService.createApiKey({
      accountId: machineAccount,
      name: 'B2C3 machine fixture',
      environment: 'test',
      scopes: ['knowledge:read'],
    });

  const { server, baseUrl } =
    await startServer();

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

  const humanHeaders = {
    cookie: humanCookie,
    'x-account-id': machineAccount,
  };

  const humanMutationHeaders = {
    ...humanHeaders,
    origin: baseUrl,
    'x-csrf-token': csrfToken,
    'content-type': 'application/json',
  };

  const machineHeaders = {
    authorization:
      'Bearer ' + machineKey.secret,
  };

  try {
    for (const path of [
      '/api/actions',
      '/api/watch/rules',
      '/api/integrations/connections',
      '/api/automation/policy',
    ]) {
      const response = await fetch(baseUrl + path);
      assert(
        response.status === 401,
        path +
          ' must reject missing production identity.'
      );
    }

    const humanActions = await fetch(
      baseUrl + '/api/actions',
      { headers: humanHeaders }
    );
    assert(
      humanActions.status === 200,
      'HUMAN_SESSION must access Actions.'
    );
    const humanActionsBody =
      await readJson(humanActions);
    assert(
      humanActionsBody.proposals?.some(
        (item: any) =>
          item.id === humanAction.id
      ) &&
        !humanActionsBody.proposals?.some(
          (item: any) =>
            item.id === machineAction.id
        ),
      'Actions must remain bound to HUMAN_SESSION account scope.'
    );

    const humanWatches = await fetch(
      baseUrl + '/api/watch/rules',
      { headers: humanHeaders }
    );
    assert(
      humanWatches.status === 200,
      'HUMAN_SESSION must access Watch.'
    );
    const humanWatchesBody =
      await readJson(humanWatches);
    assert(
      humanWatchesBody.rules?.some(
        (item: any) =>
          item.id === humanWatch.id
      ) &&
        !humanWatchesBody.rules?.some(
          (item: any) =>
            item.id === machineWatch.id
        ),
      'Watch must remain bound to HUMAN_SESSION account scope.'
    );

    const humanIntegrations = await fetch(
      baseUrl + '/api/integrations/connections',
      { headers: humanHeaders }
    );
    assert(
      humanIntegrations.status === 200,
      'HUMAN_SESSION must access Integrations.'
    );
    const humanIntegrationsBody =
      await readJson(humanIntegrations);
    assert(
      humanIntegrationsBody.connections?.some(
        (item: any) =>
          item.id === humanIntegration.id
      ) &&
        !humanIntegrationsBody.connections?.some(
          (item: any) =>
            item.id === machineIntegration.id
        ),
      'Integrations must remain bound to HUMAN_SESSION account scope.'
    );

    const humanAutomation = await fetch(
      baseUrl + '/api/automation/policy',
      { headers: humanHeaders }
    );
    assert(
      humanAutomation.status === 200,
      'HUMAN_SESSION must access Automation.'
    );
    const humanAutomationBody =
      await readJson(humanAutomation);
    assert(
      humanAutomationBody.policy?.id ===
        humanPolicy.id &&
        humanAutomationBody.policy?.id !==
          machinePolicy.id,
      'Automation policy must remain bound to HUMAN_SESSION account scope.'
    );

    const humanContext = await fetch(
      baseUrl + '/api/automation/context',
      { headers: humanHeaders }
    );
    assert(
      humanContext.status === 200,
      'HUMAN_SESSION must resolve Automation context.'
    );
    const humanContextBody =
      await readJson(humanContext);
    assert(
      humanContextBody.source ===
        'HUMAN_SESSION' &&
        humanContextBody.role === 'OWNER' &&
        humanContextBody.actor ===
          'user:' + human.id,
      'Automation must preserve HUMAN_SESSION identity, membership role, and attributable user actor.'
    );

    const actionNoCsrf = await fetch(
      baseUrl +
        '/api/actions/' +
        encodeURIComponent(humanAction.id) +
        '/cancel',
      {
        method: 'POST',
        headers: {
          cookie: humanCookie,
          origin: baseUrl,
        },
      }
    );
    assert(
      actionNoCsrf.status === 403,
      'HUMAN_SESSION Action mutation must require CSRF.'
    );

    const watchNoCsrf = await fetch(
      baseUrl +
        '/api/watch/rules/' +
        encodeURIComponent(humanWatch.id) +
        '/pause',
      {
        method: 'POST',
        headers: {
          cookie: humanCookie,
          origin: baseUrl,
        },
      }
    );
    assert(
      watchNoCsrf.status === 403,
      'HUMAN_SESSION Watch mutation must require CSRF.'
    );

    const integrationNoCsrf = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(
          humanIntegration.id
        ) +
        '/pause',
      {
        method: 'POST',
        headers: {
          cookie: humanCookie,
          origin: baseUrl,
        },
      }
    );
    assert(
      integrationNoCsrf.status === 403,
      'HUMAN_SESSION Integration mutation must require CSRF.'
    );

    const automationNoCsrf = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie: humanCookie,
          origin: baseUrl,
        },
        body: '{}',
      }
    );
    assert(
      automationNoCsrf.status === 403,
      'HUMAN_SESSION Automation mutation must require CSRF.'
    );

    const humanActionCancel = await fetch(
      baseUrl +
        '/api/actions/' +
        encodeURIComponent(humanAction.id) +
        '/cancel',
      {
        method: 'POST',
        headers: humanMutationHeaders,
      }
    );
    assert(
      humanActionCancel.status === 200,
      'Valid HUMAN_SESSION + CSRF must mutate its own Action.'
    );

    const foreignAction = await fetch(
      baseUrl +
        '/api/actions/' +
        encodeURIComponent(machineAction.id),
      {
        headers: humanHeaders,
      }
    );
    assert(
      foreignAction.status === 404,
      'HUMAN_SESSION must not read another account Action by raw ID.'
    );

    const humanWatchPause = await fetch(
      baseUrl +
        '/api/watch/rules/' +
        encodeURIComponent(humanWatch.id) +
        '/pause',
      {
        method: 'POST',
        headers: humanMutationHeaders,
      }
    );
    assert(
      humanWatchPause.status === 200,
      'Valid HUMAN_SESSION + CSRF must mutate its own Watch rule.'
    );

    const foreignWatch = await fetch(
      baseUrl +
        '/api/watch/rules/' +
        encodeURIComponent(machineWatch.id),
      {
        headers: humanHeaders,
      }
    );
    assert(
      foreignWatch.status === 404,
      'HUMAN_SESSION must not read another account Watch rule by raw ID.'
    );

    const humanIntegrationPause = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(
          humanIntegration.id
        ) +
        '/pause',
      {
        method: 'POST',
        headers: humanMutationHeaders,
      }
    );
    assert(
      humanIntegrationPause.status === 200,
      'Valid HUMAN_SESSION + CSRF must mutate its own Integration.'
    );

    const foreignIntegration = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(
          machineIntegration.id
        ),
      {
        headers: humanHeaders,
      }
    );
    assert(
      foreignIntegration.status === 404,
      'HUMAN_SESSION must not read another account Integration by raw ID.'
    );

    const humanAutomationValidation =
      await fetch(
        baseUrl + '/api/automation/policy',
        {
          method: 'PUT',
          headers: humanMutationHeaders,
          body: JSON.stringify({
            enabled: false,
            mode: 'SUGGEST_ONLY',
            allowedActionIntents: [
              'UPDATE_STATUS',
            ],
            maxRiskClass: 'LOW',
            allowedIdentitySources: [
              'HUMAN_SESSION',
            ],
          }),
        }
      );
    assert(
      humanAutomationValidation.status === 200,
      'Valid HUMAN_SESSION + CSRF must reach Automation policy mutation and accept HUMAN_SESSION as an identity source.'
    );

    const machineActions = await fetch(
      baseUrl + '/api/actions',
      {
        headers: machineHeaders,
      }
    );
    const machineActionsBody =
      await readJson(machineActions);
    assert(
      machineActions.status === 200 &&
        machineActionsBody.proposals?.some(
          (item: any) =>
            item.id === machineAction.id
        ) &&
        !machineActionsBody.proposals?.some(
          (item: any) =>
            item.id === humanAction.id
        ),
      'API_KEY Actions scope must remain bound to its machine account.'
    );

    const machineActionCancel = await fetch(
      baseUrl +
        '/api/actions/' +
        encodeURIComponent(machineAction.id) +
        '/cancel',
      {
        method: 'POST',
        headers: machineHeaders,
      }
    );
    assert(
      machineActionCancel.status === 200,
      'API_KEY Action mutation must not require browser CSRF.'
    );

    const machineWatches = await fetch(
      baseUrl + '/api/watch/rules',
      {
        headers: machineHeaders,
      }
    );
    const machineWatchesBody =
      await readJson(machineWatches);
    assert(
      machineWatches.status === 200 &&
        machineWatchesBody.rules?.some(
          (item: any) =>
            item.id === machineWatch.id
        ) &&
        !machineWatchesBody.rules?.some(
          (item: any) =>
            item.id === humanWatch.id
        ),
      'API_KEY Watch scope must remain bound to its machine account.'
    );

    const machineWatchPause = await fetch(
      baseUrl +
        '/api/watch/rules/' +
        encodeURIComponent(machineWatch.id) +
        '/pause',
      {
        method: 'POST',
        headers: machineHeaders,
      }
    );
    assert(
      machineWatchPause.status === 200,
      'API_KEY Watch mutation must not require browser CSRF.'
    );

    const machineIntegrations = await fetch(
      baseUrl + '/api/integrations/connections',
      {
        headers: machineHeaders,
      }
    );
    const machineIntegrationsBody =
      await readJson(machineIntegrations);
    assert(
      machineIntegrations.status === 200 &&
        machineIntegrationsBody.connections?.some(
          (item: any) =>
            item.id === machineIntegration.id
        ) &&
        !machineIntegrationsBody.connections?.some(
          (item: any) =>
            item.id === humanIntegration.id
        ),
      'API_KEY Integration scope must remain bound to its machine account.'
    );

    const machineIntegrationPause = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(
          machineIntegration.id
        ) +
        '/pause',
      {
        method: 'POST',
        headers: machineHeaders,
      }
    );
    const machineIntegrationPauseBody =
      await readJson(machineIntegrationPause);
    assert(
      machineIntegrationPause.status === 403 &&
        machineIntegrationPauseBody?.code ===
          'PRIVILEGED_HUMAN_SESSION_REQUIRED',
      'API_KEY may read Integration state but must not administer connection lifecycle.'
    );

    const machineAutomation = await fetch(
      baseUrl + '/api/automation/policy',
      {
        headers: machineHeaders,
      }
    );
    const machineAutomationBody =
      await readJson(machineAutomation);
    assert(
      machineAutomation.status === 200 &&
        machineAutomationBody.policy?.id ===
          machinePolicy.id &&
        machineAutomationBody.policy?.id !==
          humanPolicy.id,
      'API_KEY Automation scope must remain bound to its machine account.'
    );

    const machineAutomationMutation =
      await fetch(
        baseUrl + '/api/automation/policy',
        {
          method: 'PUT',
          headers: {
            ...machineHeaders,
            'content-type':
              'application/json',
          },
          body: '{}',
        }
      );
    const machineAutomationMutationBody =
      await readJson(machineAutomationMutation);
    assert(
      machineAutomationMutation.status === 403 &&
        machineAutomationMutationBody?.code ===
          'PRIVILEGED_HUMAN_SESSION_REQUIRED',
      'API_KEY must remain able to read Automation state but must not administer Automation policy.'
    );

    await humanIdentityFoundationService.revokeSession(
      session.secret
    );

    for (const path of [
      '/api/actions',
      '/api/watch/rules',
      '/api/integrations/connections',
      '/api/automation/policy',
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
      'PRODUCTION_B2C3_PRODUCT_ROUTE_CUTOVER_CHECK_PASSED'
    );
    console.log(
      'Actions, Watch, Integrations, and Automation accept durable HUMAN_SESSION identity, preserve API-key machine identity, enforce HUMAN_SESSION same-origin/CSRF mutations, retain account/raw-ID isolation, map human automation actors to durable user roles, fail closed without production credentials, and reject revoked sessions.'
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
    'PRODUCTION_B2C3_PRODUCT_ROUTE_CUTOVER_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
