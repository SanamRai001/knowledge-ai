import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { actionRouter } from '../server/actions/actionRouter.js';
import { actionPersistence } from '../server/actions/actionPersistence.js';
import { automationRouter } from '../server/automation/automationRouter.js';
import {
  AutomationPersistence,
  automationPersistence,
} from '../server/automation/automationPersistence.js';
import { companyKnowledgeRouter } from '../server/companyKnowledge/companyKnowledgeRouter.js';
import { effectiveCompanyStateRuntimeService } from '../server/companyKnowledge/effectiveCompanyStateRuntimeService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { humanIdentityFoundationService } from '../server/identity/humanIdentityFoundationService.js';
import { AUTH_CSRF_COOKIE, AUTH_SESSION_COOKIE } from '../server/identity/authHttpSecurity.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  const body = await response.json();
  return { response, body };
}

function snapshot(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE === 'postgres',
    'A7E proof must run in PostgreSQL persistence mode.'
  );
  assert(Boolean(process.env.DATABASE_URL), 'DATABASE_URL is required.');

  await runPostgresMigrations();
  await postgresPool().query(
    `TRUNCATE TABLE
      automation_control_revisions,
      automation_controls,
      automation_approvals,
      automation_policy_revisions,
      automation_policies,
      automation_runs,
      action_audit_entries,
      action_execution_events,
      action_execution_claims,
      action_executions,
      action_proposal_targets,
      action_proposals,
      business_event_subjects,
      business_events,
      knowledge_claims,
      knowledge_projection_runs,
      company_relationships,
      company_entities
     CASCADE`
  );

  const accountA = 'acc_a7e_automation_a';
  const accountB = 'acc_a7e_automation_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const adminUser = await humanIdentityFoundationService.createUser({
    email: 'a7e-admin@example.com',
    displayName: 'A7E Admin Human',
  });
  await humanIdentityFoundationService.upsertMembership({
    accountId: accountA,
    userId: adminUser.id,
    role: 'ADMIN',
  });
  const adminSession = await humanIdentityFoundationService.createSession({
    userId: adminUser.id,
    selectedAccountId: accountA,
  });
  const adminCsrf = crypto.randomBytes(32).toString('base64url');
  const adminCookie = AUTH_SESSION_COOKIE + '=' + encodeURIComponent(adminSession.secret) + '; ' + AUTH_CSRF_COOKIE + '=' + encodeURIComponent(adminCsrf);

  const legacyFiles = [
    'automation-policies.json',
    'automation-approvals.json',
    'automation-control.json',
    'automation-runs.json',
  ].map((name) => path.join(process.cwd(), 'data', name));
  const legacyBefore = new Map(
    legacyFiles.map((file) => [file, snapshot(file)])
  );

  const dataset = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'A7E-P1,A7E Oak,10,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'a7e-inventory.csv',
    datasetName: 'A7E Inventory',
  });

  const adminKey = apiKeyStore.createApiKey({
    name: 'A7E Admin',
    accountId: accountA,
    environment: 'test',
    scopes: ['automation:admin', 'role:admin'],
  });
  const operatorKey = apiKeyStore.createApiKey({
    name: 'A7E Operator',
    accountId: accountA,
    environment: 'test',
    scopes: ['automation:execute', 'role:operator'],
  });
  const foreignKey = apiKeyStore.createApiKey({
    name: 'A7E Foreign',
    accountId: accountB,
    environment: 'test',
    scopes: ['automation:admin', 'role:admin'],
  });

  const app = express();
  app.use(express.json());
  app.use('/api/company-knowledge', companyKnowledgeRouter);
  app.use('/api/actions', actionRouter);
  app.use('/api/automation', automationRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve A7E HTTP port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const projected = await json(
      await fetch(baseUrl + '/api/company-knowledge/project/dataset', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          datasetId: dataset.dataset.id,
          versionId: dataset.version.id,
        }),
      })
    );
    assert(
      projected.response.status === 201 &&
        projected.body.run?.status === 'COMPLETED',
      'A7E product seed must project into PostgreSQL Living Knowledge.'
    );

    const entityResult = await postgresPool().query(
      "SELECT id FROM company_entities WHERE account_id = $1 AND type = 'PRODUCT' AND identity_key = 'a7e p1'",
      [accountA]
    );
    const productId = entityResult.rows[0]?.id as string;
    assert(productId, 'A7E product entity was not persisted.');

    const requireApprovalPolicy = await json(
      await fetch(baseUrl + '/api/automation/policy', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          mode: 'REQUIRE_APPROVAL',
          allowedActionIntents: ['RECEIVE_INVENTORY'],
          maxRiskClass: 'LOW',
          maxQuantity: 10,
          allowedIdentitySources: ['API_KEY'],
          allowedActorRoles: ['OPERATOR'],
          approvalRoles: ['ADMIN', 'APPROVER'],
          allowedTargetEntityTypes: ['PRODUCT'],
          allowedTargetEntityIds: [productId],
        }),
      })
    );

    assert(
      requireApprovalPolicy.response.status === 201 &&
        requireApprovalPolicy.body.policy?.version === 1,
      'Automation policy v1 must be created through PostgreSQL runtime.'
    );

    const policyRows = await postgresPool().query(
      'SELECT version, mode FROM automation_policies WHERE account_id = $1',
      [accountA]
    );
    const policyRevisions = await postgresPool().query(
      'SELECT count(*)::int AS count FROM automation_policy_revisions WHERE account_id = $1',
      [accountA]
    );
    assert(
      policyRows.rows[0]?.version === 1 &&
        policyRows.rows[0]?.mode === 'REQUIRE_APPROVAL' &&
        Number(policyRevisions.rows[0]?.count) === 1,
      'Policy and revision must commit transactionally in PostgreSQL.'
    );

    const approvalProposal = await json(
      await fetch(baseUrl + '/api/actions/propose', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Received 2 units of A7E Oak.',
          allowLlmParsing: false,
        }),
      })
    );
    assert(
      approvalProposal.response.status === 201 &&
        approvalProposal.body.proposal?.status === 'PROPOSED',
      'A7E approval proposal must be created through selected Action runtime.'
    );

    const approvalRequest = await json(
      await fetch(
        baseUrl +
          '/api/automation/approvals/' +
          approvalProposal.body.proposal.id +
          '/request',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + operatorKey.secret,
          },
        }
      )
    );
    assert(
      approvalRequest.response.status === 201 &&
        approvalRequest.body.approval?.status === 'PENDING',
      'REQUIRE_APPROVAL policy must create a PostgreSQL approval request.'
    );

    const approvalId = approvalRequest.body.approval.id as string;
    const approved = await json(
      await fetch(
        baseUrl +
          '/api/automation/approvals/' +
          approvalId +
          '/approve',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + approverKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ note: 'A7E approved.' }),
        }
      )
    );
    assert(
      approved.response.status === 200 &&
        approved.body.approval?.status === 'APPROVED' &&
        approved.body.approval?.resolvedByRole === 'APPROVER',
      'Eligible approver must resolve PostgreSQL approval state.'
    );

    const autoPolicy = await json(
      await fetch(baseUrl + '/api/automation/policy', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          mode: 'AUTO_EXECUTE_LOW_RISK',
          allowedActionIntents: ['RECEIVE_INVENTORY'],
          maxRiskClass: 'LOW',
          maxQuantity: 5,
          allowedIdentitySources: ['API_KEY'],
          allowedActorRoles: ['OPERATOR'],
          approvalRoles: ['ADMIN', 'APPROVER'],
          allowedTargetEntityTypes: ['PRODUCT'],
          allowedTargetEntityIds: [productId],
        }),
      })
    );
    assert(
      autoPolicy.response.status === 200 &&
        autoPolicy.body.policy?.version === 2,
      'Automation policy v2 must preserve relational version history.'
    );

    const disabled = await json(
      await fetch(baseUrl + '/api/automation/control/disable', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'A7E emergency-stop verification.',
        }),
      })
    );
    assert(
      disabled.response.status === 200 &&
        disabled.body.control?.emergencyDisabled === true &&
        disabled.body.control?.version === 1,
      'Emergency stop must persist through selected Automation runtime.'
    );

    const blockedProposal = await json(
      await fetch(baseUrl + '/api/actions/propose', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Received 1 unit of A7E Oak.',
          allowLlmParsing: false,
        }),
      })
    );
    const blockedExecution = await json(
      await fetch(
        baseUrl +
          '/api/automation/execute/' +
          blockedProposal.body.proposal.id,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + operatorKey.secret },
        }
      )
    );
    assert(
      blockedExecution.response.status === 409 &&
        blockedExecution.body.code ===
          'AUTOMATION_EXECUTION_NOT_ALLOWED' &&
        blockedExecution.body.evaluation?.reasonCodes?.includes(
          'AUTOMATION_KILL_SWITCH_ACTIVE'
        ),
      'PostgreSQL emergency stop must block automatic execution.'
    );

    const blockedRun = await postgresPool().query(
      `SELECT status, failure_category
       FROM automation_runs
       WHERE account_id = $1 AND proposal_id = $2`,
      [accountA, blockedProposal.body.proposal.id]
    );
    assert(
      blockedRun.rows[0]?.status === 'BLOCKED' &&
        blockedRun.rows[0]?.failure_category === 'KILL_SWITCH',
      'Kill-switch denial must leave a durable PostgreSQL AutomationRun.'
    );

    const enabled = await json(
      await fetch(baseUrl + '/api/automation/control/enable', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'A7E resume verification.' }),
      })
    );
    assert(
      enabled.response.status === 200 &&
        enabled.body.control?.emergencyDisabled === false &&
        enabled.body.control?.version === 2,
      'Emergency stop clear must create a second relational control revision.'
    );

    const autoProposal = await json(
      await fetch(baseUrl + '/api/actions/propose', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Received 3 units of A7E Oak.',
          allowLlmParsing: false,
        }),
      })
    );
    assert(
      autoProposal.response.status === 201 &&
        autoProposal.body.proposal?.mutations?.[0]?.beforeValue === 10 &&
        autoProposal.body.proposal?.mutations?.[0]?.afterValue === 13,
      'Auto-execution proposal must read PostgreSQL effective stock.'
    );

    const executed = await json(
      await fetch(
        baseUrl +
          '/api/automation/execute/' +
          autoProposal.body.proposal.id,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + operatorKey.secret },
        }
      )
    );
    assert(
      executed.response.status === 200 &&
        executed.body.replayed === false &&
        executed.body.run?.status === 'SUCCEEDED' &&
        executed.body.execution?.executionMode ===
          'AUTOMATION_POLICY' &&
        executed.body.execution?.automationPolicyVersion === 2,
      'Eligible low-risk automation must execute through A7D relational Action transaction.'
    );

    const runId = executed.body.run.id as string;
    const stockAfter = await effectiveCompanyStateRuntimeService.resolve(
      accountA,
      productId,
      'CURRENT_STOCK'
    );
    assert(
      stockAfter.status === 'RESOLVED' &&
        stockAfter.value === 13 &&
        stockAfter.effectiveClaim.sourceRef.sourceVersionId ===
          autoProposal.body.proposal.id,
      'Automatic execution must commit authoritative PostgreSQL company state.'
    );

    const replay = await json(
      await fetch(
        baseUrl +
          '/api/automation/execute/' +
          autoProposal.body.proposal.id,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + operatorKey.secret },
        }
      )
    );
    assert(
      replay.response.status === 200 &&
        replay.body.replayed === true &&
        replay.body.execution?.id === executed.body.execution.id &&
        replay.body.run?.id === runId,
      'Automation replay must be idempotent across relational Action and run state.'
    );

    const feedback = await json(
      await fetch(
        baseUrl + '/api/automation/runs/' + runId + '/feedback',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + adminKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            feedback: 'CORRECT',
            note: 'A7E PostgreSQL runtime verified.',
          }),
        }
      )
    );
    assert(
      feedback.response.status === 200 &&
        feedback.body.run?.feedback === 'CORRECT',
      'Automation feedback must persist in PostgreSQL.'
    );

    const compensated = await json(
      await fetch(
        baseUrl +
          '/api/automation/runs/' +
          runId +
          '/compensate',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + approverKey.secret,
          },
        }
      )
    );
    assert(
      compensated.response.status === 200 &&
        compensated.body.replayed === false &&
        compensated.body.run?.status === 'COMPENSATED' &&
        Boolean(compensated.body.compensationExecution?.id),
      'Authorized compensation must execute through relational Action runtime and persist Automation recovery state.'
    );

    const stockRestored =
      await effectiveCompanyStateRuntimeService.resolve(
        accountA,
        productId,
        'CURRENT_STOCK'
      );
    assert(
      stockRestored.status === 'RESOLVED' &&
        stockRestored.value === 10,
      'Compensation must restore the pre-automation stock value.'
    );

    const quality = await json(
      await fetch(baseUrl + '/api/automation/quality', {
        headers: { Authorization: 'Bearer ' + adminKey.secret },
      })
    );
    assert(
      quality.response.status === 200 &&
        quality.body.quality?.population?.automationRuns >= 2 &&
        quality.body.quality?.population?.approvalRequests === 1 &&
        quality.body.quality?.recovery?.compensatedRuns === 1,
      'Automation quality metrics must read PostgreSQL run/approval state.'
    );

    const foreignRun = await fetch(
      baseUrl + '/api/automation/runs/' + runId,
      {
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignRun.status === 404,
      'Foreign account must not inspect another account PostgreSQL AutomationRun.'
    );

    const foreignPolicy = await json(
      await fetch(baseUrl + '/api/automation/policy', {
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      })
    );
    assert(
      foreignPolicy.response.status === 200 &&
        foreignPolicy.body.policy === null,
      'Spoofed account header must not reveal another account Automation policy.'
    );

    await closePostgresPool();
    const reconstructed = new AutomationPersistence();
    const reconstructedPolicy =
      await reconstructed.getPolicy(accountA);
    const reconstructedRun =
      await reconstructed.requireRun(accountA, runId);
    const reconstructedControl =
      await reconstructed.getControl(accountA);
    const reconstructedApprovals =
      await reconstructed.listAllApprovals(accountA);

    assert(
      reconstructedPolicy?.version === 2 &&
        reconstructedRun.status === 'COMPENSATED' &&
        reconstructedRun.feedback === 'CORRECT' &&
        reconstructedControl.version === 2 &&
        reconstructedControl.emergencyDisabled === false &&
        reconstructedApprovals[0]?.status === 'APPROVED',
      'Automation state must survive PostgreSQL pool/persistence reconstruction.'
    );

    const dbEvidence = await postgresPool().query(
      `SELECT
        (SELECT count(*)::int FROM automation_policy_revisions WHERE account_id = $1) AS policy_revisions,
        (SELECT count(*)::int FROM automation_control_revisions WHERE account_id = $1) AS control_revisions,
        (SELECT count(*)::int FROM automation_approvals WHERE account_id = $1) AS approvals,
        (SELECT count(*)::int FROM automation_runs WHERE account_id = $1) AS runs`,
      [accountA]
    );
    assert(
      Number(dbEvidence.rows[0]?.policy_revisions) === 2 &&
        Number(dbEvidence.rows[0]?.control_revisions) === 2 &&
        Number(dbEvidence.rows[0]?.approvals) === 1 &&
        Number(dbEvidence.rows[0]?.runs) >= 2,
      'A7E PostgreSQL tables must contain policy/control history, approval, and run state.'
    );

    assert(
      actionPersistence.usesPostgres() &&
        automationPersistence.usesPostgres(),
      'A7E selected Action and Automation persistence must report PostgreSQL mode.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    await closePostgresPool();
  }

  for (const file of legacyFiles) {
    assert(
      snapshot(file) === legacyBefore.get(file),
      'PostgreSQL A7E runtime must not mutate legacy Automation JSON file: ' +
        path.basename(file)
    );
  }

  console.log('PRODUCTION_A7E_AUTOMATION_RUNTIME_CHECK_PASSED');
  console.log(
    'PostgreSQL policy/revision, approval, emergency control, AutomationRun, low-risk auto-execution, idempotent replay, feedback, compensation, quality metrics, restart persistence, account isolation, and zero legacy Automation JSON mutation are verified.'
  );
}

main().catch(async (error) => {
  console.error('PRODUCTION_A7E_AUTOMATION_RUNTIME_CHECK_FAILED');
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
