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
import { workspaceRuntimeService } from '../server/workspaceRuntimeService.js';
import { discoveryPersistence } from '../server/discovery/discoveryPersistence.js';
import { discoveryRouter } from '../server/discovery/discoveryRouter.js';
import { companyKnowledgePersistence } from '../server/companyKnowledge/companyKnowledgePersistence.js';
import { companyKnowledgeRouter } from '../server/companyKnowledge/companyKnowledgeRouter.js';
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
      discovery_analysis_run_insights,
      discovery_insights,
      discovery_analysis_runs,
      business_event_subjects,
      business_events,
      knowledge_claims,
      company_relationships,
      company_entities,
      knowledge_projection_runs,
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
  app.use('/api/insights', discoveryRouter);
  app.use('/api/company-knowledge', companyKnowledgeRouter);

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
    throw new Error('B2C2 test server failed to bind.');
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

async function seedInsight(params: {
  accountId: string;
  workspaceId: string;
  suffix: string;
}) {
  const now = Date.now();
  const runId = 'run_b2c2_' + params.suffix;
  const insightId = 'ins_b2c2_' + params.suffix;

  await discoveryPersistence.saveRun({
    id: runId,
    accountId: params.accountId,
    sourceType: 'DOCUMENT',
    knowledgeBaseId: params.workspaceId,
    knowledgeVersionTag: 'v1.0',
    status: 'COMPLETED',
    startedAt: now - 100,
    completedAt: now,
    referenceTime: now,
    detectorIds: ['b2c2.seed'],
    insightIds: [insightId],
  });

  const [insight] =
    await discoveryPersistence.recordInsightsForRun(
      params.accountId,
      runId,
      [
        {
          id: insightId,
          fingerprint:
            'fp_b2c2_' + params.suffix,
          accountId: params.accountId,
          knowledgeBaseId: params.workspaceId,
          analysisRunId: runId,
          type: 'CHANGE',
          severity: 'MEDIUM',
          status: 'OPEN',
          title:
            'B2C2 ' + params.suffix + ' insight',
          summary:
            'Seed insight for account isolation.',
          confidence: 1,
          detectorId: 'b2c2.seed',
          detectorVersion: '1',
          evidence: {
            sourceType: 'DOCUMENT',
            sourceFilename: 'seed.pdf',
            knowledgeBaseId: params.workspaceId,
            knowledgeVersionTag: 'v1.0',
            detectorId: 'b2c2.seed',
            detectorVersion: '1',
            calculation: 'deterministic seed',
            values: {
              marker: params.suffix,
            },
          },
          priorityScore: 50,
          priorityReasons: ['B2C2 test fixture'],
          firstSeenAt: now,
          lastSeenAt: now,
          occurrenceCount: 1,
          createdAt: now,
        },
      ]
    );

  assert(
    insight?.id === insightId,
    'B2C2 insight seed failed.'
  );
  return insight;
}

async function seedEntity(params: {
  accountId: string;
  suffix: string;
}) {
  return companyKnowledgePersistence.upsertEntity({
    accountId: params.accountId,
    type: 'CUSTOMER',
    canonicalName:
      'B2C2 Customer ' + params.suffix,
    identityKey:
      'b2c2-customer-' + params.suffix,
    sourceRef: {
      sourceType: 'SYSTEM',
      sourceId:
        'b2c2-company-seed-' + params.suffix,
      sourceName: 'B2C2 test fixture',
    },
    observedAt: Date.now(),
  });
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2C2 route proof.'
  );

  await runPostgresMigrations();
  await reset();

  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB =
    'true';

  const accountA = 'acc_b2c2_human';
  const accountB = 'acc_b2c2_machine';

  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const human =
    await humanIdentityFoundationService.createUser({
      email: 'b2c2-human@example.com',
      displayName: 'B2C2 Human',
    });

  await humanIdentityFoundationService.upsertMembership({
    accountId: accountA,
    userId: human.id,
    role: 'OWNER',
  });

  const workspaceA =
    await workspaceRuntimeService.createKB(
      accountA,
      'B2C2 Human Workspace'
    );
  const workspaceB =
    await workspaceRuntimeService.createKB(
      accountB,
      'B2C2 Machine Workspace'
    );

  const session =
    await humanIdentityFoundationService.createSession({
      userId: human.id,
      selectedAccountId: accountA,
      selectedWorkspaceId: workspaceA.id,
    });

  const insightA = await seedInsight({
    accountId: accountA,
    workspaceId: workspaceA.id,
    suffix: 'a',
  });
  const insightB = await seedInsight({
    accountId: accountB,
    workspaceId: workspaceB.id,
    suffix: 'b',
  });

  const entityA = await seedEntity({
    accountId: accountA,
    suffix: 'a',
  });
  const entityB = await seedEntity({
    accountId: accountB,
    suffix: 'b',
  });

  const machineKey =
    await apiKeyRuntimeService.createApiKey({
      accountId: accountB,
      name: 'B2C2 machine fixture',
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
      '/api/insights?latestRunOnly=false',
      '/api/company-knowledge/entities',
    ]) {
      const response = await fetch(baseUrl + path);
      assert(
        response.status === 401,
        path +
          ' must reject missing production identity.'
      );
    }

    const humanInsights = await fetch(
      baseUrl +
        '/api/insights?latestRunOnly=false',
      {
        headers: {
          cookie: humanCookie,
          'x-account-id': accountB,
        },
      }
    );
    assert(
      humanInsights.status === 200,
      'HUMAN_SESSION must access /api/insights.'
    );
    const humanInsightsBody =
      await readJson(humanInsights);
    assert(
      humanInsightsBody.insights?.some(
        (item: any) => item.id === insightA.id
      ) &&
        !humanInsightsBody.insights?.some(
          (item: any) => item.id === insightB.id
        ),
      'Insights must remain bound to the HUMAN_SESSION account despite spoofed account headers.'
    );

    const humanEntities = await fetch(
      baseUrl + '/api/company-knowledge/entities',
      {
        headers: {
          cookie: humanCookie,
          'x-account-id': accountB,
        },
      }
    );
    assert(
      humanEntities.status === 200,
      'HUMAN_SESSION must access Company Knowledge.'
    );
    const humanEntitiesBody =
      await readJson(humanEntities);
    assert(
      humanEntitiesBody.entities?.some(
        (item: any) => item.id === entityA.id
      ) &&
        !humanEntitiesBody.entities?.some(
          (item: any) => item.id === entityB.id
        ),
      'Company Knowledge must remain bound to the HUMAN_SESSION account despite spoofed account headers.'
    );

    const insightMutationWithoutCsrf =
      await fetch(
        baseUrl +
          '/api/insights/' +
          encodeURIComponent(insightA.id) +
          '/status',
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            origin: baseUrl,
            cookie:
              AUTH_SESSION_COOKIE +
              '=' +
              encodeURIComponent(session.secret),
          },
          body: JSON.stringify({
            status: 'ACKNOWLEDGED',
          }),
        }
      );
    assert(
      insightMutationWithoutCsrf.status === 403,
      'HUMAN_SESSION Insight mutation must require CSRF.'
    );

    const hostileCompanyMutation = await fetch(
      baseUrl +
        '/api/company-knowledge/project/dataset',
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
      hostileCompanyMutation.status === 403,
      'HUMAN_SESSION Company Knowledge mutation must reject a hostile Origin.'
    );

    const humanInsightMutation = await fetch(
      baseUrl +
        '/api/insights/' +
        encodeURIComponent(insightA.id) +
        '/status',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          cookie: humanCookie,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          status: 'ACKNOWLEDGED',
        }),
      }
    );
    assert(
      humanInsightMutation.status === 200,
      'Valid HUMAN_SESSION + CSRF must mutate its own Insight.'
    );
    const humanInsightMutationBody =
      await readJson(humanInsightMutation);
    assert(
      humanInsightMutationBody.insight?.status ===
        'ACKNOWLEDGED',
      'Human Insight status mutation did not persist.'
    );

    const foreignInsightMutation = await fetch(
      baseUrl +
        '/api/insights/' +
        encodeURIComponent(insightB.id) +
        '/status',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          cookie: humanCookie,
          'x-csrf-token': csrfToken,
          'x-account-id': accountB,
        },
        body: JSON.stringify({
          status: 'RESOLVED',
        }),
      }
    );
    assert(
      foreignInsightMutation.status === 404,
      'HUMAN_SESSION must not mutate another account Insight by raw ID.'
    );

    const humanCompanyMutation = await fetch(
      baseUrl +
        '/api/company-knowledge/project/dataset',
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
      humanCompanyMutation.status === 400,
      'Valid HUMAN_SESSION + CSRF must pass Company Knowledge identity middleware and reach request validation.'
    );
    const humanCompanyBody =
      await readJson(humanCompanyMutation);
    assert(
      humanCompanyBody?.code ===
        'DATASET_ID_REQUIRED',
      'Company Knowledge request should fail at application validation, not authentication.'
    );

    const machineHeaders = {
      authorization:
        'Bearer ' + machineKey.secret,
    };

    const machineInsights = await fetch(
      baseUrl +
        '/api/insights?latestRunOnly=false',
      {
        headers: machineHeaders,
      }
    );
    assert(
      machineInsights.status === 200,
      'API_KEY behavior must remain supported on Insights.'
    );
    const machineInsightsBody =
      await readJson(machineInsights);
    assert(
      machineInsightsBody.insights?.some(
        (item: any) => item.id === insightB.id
      ) &&
        !machineInsightsBody.insights?.some(
          (item: any) => item.id === insightA.id
        ),
      'API_KEY Insights scope must remain bound to its machine account.'
    );

    const machineInsightMutation = await fetch(
      baseUrl +
        '/api/insights/' +
        encodeURIComponent(insightB.id) +
        '/status',
      {
        method: 'PATCH',
        headers: {
          ...machineHeaders,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'ACKNOWLEDGED',
        }),
      }
    );
    assert(
      machineInsightMutation.status === 200,
      'API_KEY Insight mutation must not require browser CSRF.'
    );

    const machineEntities = await fetch(
      baseUrl + '/api/company-knowledge/entities',
      {
        headers: machineHeaders,
      }
    );
    assert(
      machineEntities.status === 200,
      'API_KEY behavior must remain supported on Company Knowledge.'
    );
    const machineEntitiesBody =
      await readJson(machineEntities);
    assert(
      machineEntitiesBody.entities?.some(
        (item: any) => item.id === entityB.id
      ) &&
        !machineEntitiesBody.entities?.some(
          (item: any) => item.id === entityA.id
        ),
      'API_KEY Company Knowledge scope must remain bound to its machine account.'
    );

    const machineCompanyMutation = await fetch(
      baseUrl +
        '/api/company-knowledge/project/dataset',
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
      machineCompanyMutation.status === 400,
      'API_KEY Company Knowledge mutation must reach application validation without browser CSRF.'
    );

    const foreignEntityRead = await fetch(
      baseUrl +
        '/api/company-knowledge/entities/' +
        encodeURIComponent(entityB.id),
      {
        headers: {
          cookie: humanCookie,
          'x-account-id': accountB,
        },
      }
    );
    assert(
      foreignEntityRead.status === 404,
      'HUMAN_SESSION must not read another account Company Knowledge entity by raw ID.'
    );

    await humanIdentityFoundationService.revokeSession(
      session.secret
    );

    for (const path of [
      '/api/insights?latestRunOnly=false',
      '/api/company-knowledge/entities',
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
      'PRODUCTION_B2C2_INSIGHTS_COMPANY_KNOWLEDGE_CHECK_PASSED'
    );
    console.log(
      'Insights and Company Knowledge accept durable HUMAN_SESSION identity, preserve API-key machine identity, fail closed without production credentials, enforce human-session same-origin/CSRF on mutations, preserve tenant isolation against spoofed headers/raw IDs, and reject revoked sessions.'
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
    'PRODUCTION_B2C2_INSIGHTS_COMPANY_KNOWLEDGE_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
