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
import { actionPersistence } from '../server/actions/actionPersistence.js';
import { automationRouter } from '../server/automation/automationRouter.js';

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
    'content-type': 'application/json',
    ...(spoofAccountId
      ? { 'x-account-id': spoofAccountId }
      : {}),
  };
}

function policyBody() {
  return {
    enabled: true,
    mode: 'AUTO_EXECUTE_LOW_RISK',
    allowedActionIntents: ['RECEIVE_INVENTORY'],
    maxRiskClass: 'LOW',
    maxQuantity: 5,
    allowedIdentitySources: ['API_KEY'],
    allowedActorRoles: ['SERVICE'],
    approvalRoles: ['OWNER', 'ADMIN'],
  };
}

async function startServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
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
    throw new Error('B2D2B1 test server failed to bind.');
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
    'DATABASE_URL is required for the B2D2B1 proof.'
  );

  await runPostgresMigrations();
  await reset();

  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_AI_ALLOW_DEFAULT_WEB =
    'true';

  const accountA = 'acc_b2d2b1_a';
  const accountB = 'acc_b2d2b1_b';

  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const ownerA = await createHuman({
    accountId: accountA,
    email: 'b2d2b1-owner-a@example.com',
    role: 'OWNER',
  });
  const adminA = await createHuman({
    accountId: accountA,
    email: 'b2d2b1-admin-a@example.com',
    role: 'ADMIN',
  });
  const memberA = await createHuman({
    accountId: accountA,
    email: 'b2d2b1-member-a@example.com',
    role: 'MEMBER',
  });
  const ownerB = await createHuman({
    accountId: accountB,
    email: 'b2d2b1-owner-b@example.com',
    role: 'OWNER',
  });

  const dangerousMachine =
    await apiKeyRuntimeService.createApiKey({
      accountId: accountA,
      name: 'B2D2B1 role-escalation fixture',
      environment: 'test',
      scopes: [
        'role:owner',
        'role:admin',
        'role:approver',
        'role:operator',
      ],
    });

  const { server, baseUrl } = await startServer();
  process.env.KNOWLEDGE_AI_PUBLIC_ORIGIN =
    baseUrl;

  try {
    const missing = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(policyBody()),
      }
    );
    assert(
      missing.status === 401,
      'Automation policy administration must reject missing production identity.'
    );

    const ownerNoCsrf = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: {
          cookie: ownerA.cookie,
          origin: baseUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify(policyBody()),
      }
    );
    assert(
      ownerNoCsrf.status === 403,
      'OWNER policy administration must still require CSRF.'
    );

    const machinePolicyWrite = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: {
          authorization:
            'Bearer ' + dangerousMachine.secret,
          'content-type': 'application/json',
        },
        body: JSON.stringify(policyBody()),
      }
    );
    const machinePolicyWriteBody =
      await readJson(machinePolicyWrite);
    assert(
      machinePolicyWrite.status === 403 &&
        machinePolicyWriteBody?.code ===
          'PRIVILEGED_HUMAN_SESSION_REQUIRED',
      'API keys must not administer Automation policy even when carrying role:owner/admin/approver scopes.'
    );

    const memberPolicyWrite = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: mutationHeaders(
          memberA,
          baseUrl
        ),
        body: JSON.stringify(policyBody()),
      }
    );
    const memberPolicyWriteBody =
      await readJson(memberPolicyWrite);
    assert(
      memberPolicyWrite.status === 403 &&
        memberPolicyWriteBody?.code ===
          'PRIVILEGED_ROLE_REQUIRED',
      'MEMBER must not administer Automation policy.'
    );

    const ownerPolicyWrite = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: mutationHeaders(
          ownerA,
          baseUrl,
          accountB
        ),
        body: JSON.stringify(policyBody()),
      }
    );
    const ownerPolicyWriteBody =
      await readJson(ownerPolicyWrite);
    assert(
      ownerPolicyWrite.status === 201 &&
        ownerPolicyWriteBody.policy?.accountId ===
          accountA &&
        ownerPolicyWriteBody.policy?.version === 1 &&
        ownerPolicyWriteBody.policy?.createdBy ===
          'user:' + ownerA.user.id,
      'OWNER policy administration must use durable HUMAN_SESSION account and actor identity rather than spoofed account headers.'
    );

    const adminPolicyWrite = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: mutationHeaders(
          adminA,
          baseUrl
        ),
        body: JSON.stringify({
          ...policyBody(),
          maxQuantity: 4,
        }),
      }
    );
    const adminPolicyWriteBody =
      await readJson(adminPolicyWrite);
    assert(
      adminPolicyWrite.status === 200 &&
        adminPolicyWriteBody.policy?.accountId ===
          accountA &&
        adminPolicyWriteBody.policy?.version === 2 &&
        adminPolicyWriteBody.policy?.updatedBy ===
          'user:' + adminA.user.id &&
        adminPolicyWriteBody.policy?.maxQuantity === 4,
      'ADMIN must be able to update the account Automation policy with attributable human identity.'
    );

    const ownerBPolicyWrite = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: mutationHeaders(
          ownerB,
          baseUrl,
          accountA
        ),
        body: JSON.stringify({
          ...policyBody(),
          maxQuantity: 2,
        }),
      }
    );
    const ownerBPolicyWriteBody =
      await readJson(ownerBPolicyWrite);
    assert(
      ownerBPolicyWrite.status === 201 &&
        ownerBPolicyWriteBody.policy?.accountId ===
          accountB &&
        ownerBPolicyWriteBody.policy?.version === 1,
      'Privileged policy administration must remain tenant scoped despite spoofed account headers.'
    );

    const policyA = await fetch(
      baseUrl + '/api/automation/policy',
      {
        headers: {
          cookie: ownerA.cookie,
        },
      }
    );
    const policyABody = await readJson(policyA);
    assert(
      policyA.status === 200 &&
        policyABody.policy?.accountId ===
          accountA &&
        policyABody.policy?.version === 2 &&
        policyABody.policy?.maxQuantity === 4,
      'Account A policy must remain isolated after Account B administration.'
    );

    const machineContext = await fetch(
      baseUrl + '/api/automation/context',
      {
        headers: {
          authorization:
            'Bearer ' + dangerousMachine.secret,
        },
      }
    );
    const machineContextBody =
      await readJson(machineContext);
    assert(
      machineContext.status === 200 &&
        machineContextBody.source === 'API_KEY' &&
        machineContextBody.role === 'SERVICE' &&
        String(machineContextBody.actor).startsWith(
          'api-key:'
        ) &&
        machineContextBody.capabilities
          ?.canControlEmergencyStop === false &&
        machineContextBody.capabilities
          ?.canResolveApprovals === false &&
        machineContextBody.capabilities
          ?.canCompensate === false &&
        machineContextBody.capabilities
          ?.canExecuteAutomation === false,
      'API-key role:* scopes must not synthesize OWNER, ADMIN, APPROVER, or OPERATOR Automation roles.'
    );

    const machineControl = await fetch(
      baseUrl + '/api/automation/control/disable',
      {
        method: 'POST',
        headers: {
          authorization:
            'Bearer ' + dangerousMachine.secret,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reason:
            'Attempted role-scope emergency control escalation.',
        }),
      }
    );
    const machineControlBody =
      await readJson(machineControl);
    assert(
      machineControl.status === 403 &&
        machineControlBody?.code ===
          'AUTOMATION_CONTROL_FORBIDDEN',
      'API-key role:* scopes must not gain OWNER/ADMIN emergency-control authority.'
    );

    const proposal =
      await actionPersistence.createProposal({
        accountId: accountA,
        instruction:
          'Received 2 B2D2B1 test units.',
        intent: 'RECEIVE_INVENTORY',
        status: 'PROPOSED',
        parserSource: 'DETERMINISTIC',
        parsedInput: {
          intent: 'RECEIVE_INVENTORY',
          quantity: 2,
        },
        targetEntityIds: [],
        mutations: [],
        preconditions: [],
        eventData: {
          fixture: 'b2d2b1',
        },
        expiresAt:
          Date.now() + 60 * 60 * 1000,
      });

    const machineEvaluation = await fetch(
      baseUrl +
        '/api/automation/evaluate/' +
        encodeURIComponent(proposal.id),
      {
        method: 'POST',
        headers: {
          authorization:
            'Bearer ' + dangerousMachine.secret,
        },
      }
    );
    const machineEvaluationBody =
      await readJson(machineEvaluation);
    assert(
      machineEvaluation.status === 200 &&
        machineEvaluationBody.evaluation
          ?.decision === 'ALLOW_AUTO_EXECUTE' &&
        machineEvaluationBody.evaluation
          ?.actorRole === 'SERVICE',
      'Legitimate API-key Automation evaluation must continue to work as SERVICE when the human-authored policy explicitly allows SERVICE.'
    );

    await humanIdentityFoundationService.revokeSession(
      ownerA.secret
    );

    const revokedOwnerWrite = await fetch(
      baseUrl + '/api/automation/policy',
      {
        method: 'PUT',
        headers: mutationHeaders(
          ownerA,
          baseUrl
        ),
        body: JSON.stringify(policyBody()),
      }
    );
    assert(
      revokedOwnerWrite.status === 401,
      'Revoked privileged HUMAN_SESSION must fail closed for policy administration.'
    );

    console.log(
      'PRODUCTION_B2D2B1_AUTOMATION_PRIVILEGED_AUTH_CHECK_PASSED'
    );
    console.log(
      'Automation policy administration is HUMAN_SESSION OWNER/ADMIN-only, MEMBER and API_KEY writes are denied, API-key role:* scopes remain SERVICE rather than human roles, emergency control cannot be escalated by machine scopes, tenant isolation remains intact, and explicitly allowed machine Automation evaluation continues as SERVICE.'
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
    'PRODUCTION_B2D2B1_AUTOMATION_PRIVILEGED_AUTH_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
