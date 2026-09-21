import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import {
  actionExecutionService,
} from '../server/actions/actionExecutionService.js';
import { actionProposalService } from '../server/actions/actionProposalService.js';
import { actionStore } from '../server/actions/actionStore.js';
import { automationControlStore } from '../server/automation/automationControlStore.js';
import { automationControlService } from '../server/automation/automationControlService.js';
import { automationPolicyStore } from '../server/automation/automationPolicyStore.js';
import { automationRouter } from '../server/automation/automationRouter.js';
import { automationRunStore } from '../server/automation/automationRunStore.js';
import type { RequestIdentity } from '../server/requestIdentity.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { effectiveCompanyStateService } from '../server/companyKnowledge/effectiveCompanyStateService.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sourceRef(version: string, name = 'Phase 7D seed') {
  return {
    sourceType: 'DATASET' as const,
    sourceId: 'ds_phase7d',
    sourceVersionId: version,
    sourceVersionLabel: version,
    sourceName: name,
    excerpt: name,
  };
}

async function main() {
  const accountA = 'acc_phase7d_a';
  const accountB = 'acc_phase7d_b';
  const now = Date.now();

  const product = companyKnowledgeStore.upsertEntity({
    accountId: accountA,
    type: 'PRODUCT',
    canonicalName: 'Phase 7D Walnut Boards',
    identityKey: 'phase7d-walnut',
    sourceRef: sourceRef('seed-v1'),
    observedAt: now,
  });

  companyKnowledgeStore.recordClaim({
    accountId: accountA,
    subjectEntityId: product.id,
    predicate: 'CURRENT_STOCK',
    value: 10,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.STRUCTURED_SOURCE },
    sourceRef: sourceRef('seed-v1'),
    observedAt: now,
    validFrom: now,
  });

  const operatorKey = apiKeyStore.createApiKey({
    name: 'Phase 7D Operator',
    accountId: accountA,
    environment: 'test',
    scopes: ['automation:execute', 'role:operator'],
  });
  const foreignKey = apiKeyStore.createApiKey({
    name: 'Phase 7D Foreign Admin',
    accountId: accountB,
    environment: 'test',
    scopes: ['automation:admin', 'role:admin'],
  });

  const adminHumanIdentity: RequestIdentity = {
    accountId: accountA,
    source: 'HUMAN_SESSION',
    authenticated: true,
    userId: 'usr_phase7d_admin',
    membershipRole: 'ADMIN',
    sessionId: 'sess_phase7d_admin',
  };

  automationPolicyStore.upsertPolicy({
    accountId: accountA,
    actor: 'test:phase7d',
    policy: {
      enabled: true,
      mode: 'AUTO_EXECUTE_LOW_RISK',
      allowedActionIntents: ['RECEIVE_INVENTORY'],
      maxRiskClass: 'LOW',
      maxQuantity: 5,
      allowedIdentitySources: ['API_KEY'],
      allowedActorRoles: ['SERVICE'],
      approvalRoles: ['ADMIN'],
      allowedTargetEntityTypes: ['PRODUCT'],
      allowedTargetEntityIds: [product.id],
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/automation', automationRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 7D HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const makeProposal = (
      quantity: number,
      at: number,
      label: string
    ) =>
      actionProposalService.createFromParsed({
        accountId: accountA,
        instruction:
          'Received ' +
          quantity +
          ' Phase 7D Walnut Boards for ' +
          label +
          '.',
        parsed: {
          intent: 'RECEIVE_INVENTORY',
          productReference: 'phase7d-walnut',
          quantity,
        },
        parserSource: 'DETERMINISTIC',
        now: at,
      });

    // Emergency stop is independent of normal policy and role-gated.
    const operatorDisable = await fetch(
      baseUrl + '/api/automation/control/disable',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Operator should not control this.' }),
      }
    );
    assert(
      operatorDisable.status === 403,
      'Operator must not be able to toggle the workspace emergency automation stop.'
    );

    const disableResponse = await fetch(
      baseUrl + '/api/automation/control/disable',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Emergency stop for Phase 7D proof.',
        }),
      }
    );
    const disableBody = await disableResponse.json();
    assert(
      disableResponse.status === 200 &&
        disableBody.control?.emergencyDisabled === true &&
        disableBody.control?.version === 1,
      'Admin must be able to activate the independent emergency stop.'
    );

    const killedProposal = makeProposal(1, now + 1000, 'kill-switch');
    const killedExecute = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        killedProposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const killedBody = await killedExecute.json();
    const killedRunId = killedBody.runId;

    assert(
      killedExecute.status === 409 &&
        killedBody.code === 'AUTOMATION_EXECUTION_NOT_ALLOWED' &&
        killedBody.evaluation?.reasonCodes?.includes(
          'AUTOMATION_KILL_SWITCH_ACTIVE'
        ) &&
        typeof killedRunId === 'string',
      'Emergency stop must block execution with an attributable AutomationRun.'
    );

    const killedRun = automationRunStore.require(
      accountA,
      killedRunId
    );
    assert(
      killedRun.status === 'BLOCKED' &&
        killedRun.failureCategory === 'KILL_SWITCH' &&
        killedRun.retryable === false &&
        actionStore.getExecutionByProposal(
          accountA,
          killedProposal.id
        ) === null,
      'Kill-switch denial must be non-retryable and write nothing.'
    );

    const stockStillTen = effectiveCompanyStateService.resolve(
      accountA,
      product.id,
      'CURRENT_STOCK'
    );
    assert(
      stockStillTen.status === 'RESOLVED' &&
        stockStillTen.value === 10,
      'Emergency-stop block must leave company state unchanged.'
    );

    const enableResponse = await fetch(
      baseUrl + '/api/automation/control/enable',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Phase 7D emergency condition cleared.',
        }),
      }
    );
    const enableBody = await enableResponse.json();
    assert(
      enableResponse.status === 200 &&
        enableBody.control?.emergencyDisabled === false &&
        enableBody.control?.version === 2,
      'Admin must be able to explicitly clear the emergency stop.'
    );

    const controlHistory = automationControlStore.listHistory({
      accountId: accountA,
      limit: 10,
    });
    assert(
      controlHistory.length === 2 &&
        controlHistory.some(
          (item) =>
            item.version === 1 &&
            item.snapshot.emergencyDisabled === true
        ) &&
        controlHistory.some(
          (item) =>
            item.version === 2 &&
            item.snapshot.emergencyDisabled === false
        ),
      'Emergency control changes must retain immutable version history.'
    );

    // Successful automation + safe compensation.
    const compensationSource = makeProposal(
      3,
      now + 2000,
      'safe-compensation'
    );
    const autoResponse = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        compensationSource.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const autoBody = await autoResponse.json();

    assert(
      autoResponse.status === 200 &&
        autoBody.run?.status === 'SUCCEEDED' &&
        autoBody.run?.attemptCount === 1 &&
        autoBody.execution?.executionMode ===
          'AUTOMATION_POLICY',
      'Eligible inventory automation must produce a successful AutomationRun.'
    );

    const stockThirteen = effectiveCompanyStateService.resolve(
      accountA,
      product.id,
      'CURRENT_STOCK'
    );
    assert(
      stockThirteen.status === 'RESOLVED' &&
        stockThirteen.value === 13,
      'Automatic receipt must update stock before compensation.'
    );

    const compensateResponse = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        autoBody.run.id +
        '/compensate',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + approverKey.secret,
        },
      }
    );
    const compensateBody = await compensateResponse.json();

    assert(
      compensateResponse.status === 200 &&
        compensateBody.replayed === false &&
        compensateBody.run?.status === 'COMPENSATED' &&
        compensateBody.compensationExecution?.executionMode ===
          'AUTOMATION_COMPENSATION' &&
        compensateBody.compensationExecution?.authorizedByRole ===
          'APPROVER',
      'Eligible approver must be able to run the explicit audited compensation path.'
    );

    const restored = effectiveCompanyStateService.resolve(
      accountA,
      product.id,
      'CURRENT_STOCK'
    );
    assert(
      restored.status === 'RESOLVED' &&
        restored.value === 10 &&
        restored.effectiveClaim.sourceRef.sourceName ===
          'Automation compensating action',
      'Compensation must restore prior stock through explicit compensating provenance.'
    );

    const compensationReplay = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        autoBody.run.id +
        '/compensate',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
        },
      }
    );
    const compensationReplayBody =
      await compensationReplay.json();
    assert(
      compensationReplay.status === 200 &&
        compensationReplayBody.replayed === true &&
        compensationReplayBody.compensationExecution?.id ===
          compensateBody.compensationExecution.id,
      'Repeated compensation request must replay idempotently.'
    );

    // Compensation refuses to erase later company state.
    const changedStateProposal = makeProposal(
      2,
      now + 3000,
      'changed-state'
    );
    const changedStateExecute = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        changedStateProposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const changedStateBody = await changedStateExecute.json();
    assert(
      changedStateExecute.status === 200 &&
        changedStateBody.run?.status === 'SUCCEEDED',
      'Second inventory automation must succeed before changed-state recovery test.'
    );

    companyKnowledgeStore.recordClaim({
      accountId: accountA,
      subjectEntityId: product.id,
      predicate: 'CURRENT_STOCK',
      value: 25,
      claimKind: 'FACT',
      authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
      sourceRef: {
        sourceType: 'USER',
        sourceId: 'confirmed-company-state',
        sourceVersionId: 'phase7d-later-stock-change',
        sourceVersionLabel: 'phase7d-later-stock-change',
        sourceName: 'Later confirmed stock update',
        excerpt: 'A later operator correction set stock to 25.',
      },
      observedAt: now + 4000,
      validFrom: now + 4000,
    });

    const changedCompensate = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        changedStateBody.run.id +
        '/compensate',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
        },
      }
    );
    const changedCompensateBody =
      await changedCompensate.json();

    assert(
      changedCompensate.status === 409 &&
        changedCompensateBody.code ===
          'AUTOMATION_COMPENSATION_STATE_CHANGED' &&
        changedCompensateBody.runId ===
          changedStateBody.run.id,
      'Compensation must refuse to blindly overwrite state changed after the automatic action.'
    );

    const recoveryRequired = automationRunStore.require(
      accountA,
      changedStateBody.run.id
    );
    const stillTwentyFive =
      effectiveCompanyStateService.resolve(
        accountA,
        product.id,
        'CURRENT_STOCK'
      );
    assert(
      recoveryRequired.status === 'RECOVERY_REQUIRED' &&
        recoveryRequired.retryable === false &&
        stillTwentyFive.status === 'RESOLVED' &&
        stillTwentyFive.value === 25,
      'Unsafe compensation must mark operator recovery required and preserve newer state.'
    );

    // Technical failure retries once and can recover.
    const originalConfirm =
      actionExecutionService.confirm.bind(
        actionExecutionService
      );
    const retryProposal = makeProposal(
      1,
      now + 5000,
      'technical-retry'
    );
    let confirmCalls = 0;

    try {
      (actionExecutionService as any).confirm = (params: any) => {
        confirmCalls += 1;
        if (confirmCalls === 1) {
          throw new Error('simulated transient execution failure');
        }
        return originalConfirm(params);
      };

      const retryResponse = await fetch(
        baseUrl +
          '/api/automation/execute/' +
          retryProposal.id,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + operatorKey.secret,
          },
        }
      );
      const retryBody = await retryResponse.json();

      assert(
        retryResponse.status === 200 &&
          retryBody.run?.status === 'SUCCEEDED' &&
          retryBody.run?.attemptCount === 2 &&
          confirmCalls === 2,
        'Unexpected technical failure must receive only the bounded retry and recover through the same action path.'
      );
    } finally {
      (actionExecutionService as any).confirm = originalConfirm;
    }

    // Technical retry exhaustion remains observable and does not mutate state.
    const stockBeforeFailedTechnical =
      effectiveCompanyStateService.resolve(
        accountA,
        product.id,
        'CURRENT_STOCK'
      );
    assert(
      stockBeforeFailedTechnical.status === 'RESOLVED',
      'Expected effective stock before failed technical test.'
    );

    const failedTechnicalProposal = makeProposal(
      1,
      now + 6000,
      'technical-exhaustion'
    );
    try {
      (actionExecutionService as any).confirm = () => {
        throw new Error('simulated persistent execution failure');
      };

      const failedTechnicalResponse = await fetch(
        baseUrl +
          '/api/automation/execute/' +
          failedTechnicalProposal.id,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + operatorKey.secret,
          },
        }
      );
      const failedTechnicalBody =
        await failedTechnicalResponse.json();

      assert(
        failedTechnicalResponse.status === 500 &&
          failedTechnicalBody.code ===
            'AUTOMATION_TECHNICAL_FAILURE' &&
          typeof failedTechnicalBody.runId === 'string',
        'Persistent technical failure must return an attributable failed AutomationRun.'
      );

      const failedRun = automationRunStore.require(
        accountA,
        failedTechnicalBody.runId
      );
      const stockAfterFailedTechnical =
        effectiveCompanyStateService.resolve(
          accountA,
          product.id,
          'CURRENT_STOCK'
        );

      assert(
        failedRun.status === 'FAILED' &&
          failedRun.failureCategory === 'TECHNICAL' &&
          failedRun.attemptCount === 2 &&
          failedRun.retryable === false &&
          stockAfterFailedTechnical.status === 'RESOLVED' &&
          stockAfterFailedTechnical.value ===
            stockBeforeFailedTechnical.value,
        'Technical retry exhaustion must be bounded and leave company state unchanged.'
      );
    } finally {
      (actionExecutionService as any).confirm = originalConfirm;
    }

    // Deterministic stale-state failure is never retried.
    const staleProposal = makeProposal(
      1,
      now + 7000,
      'stale-non-retry'
    );

    companyKnowledgeStore.recordClaim({
      accountId: accountA,
      subjectEntityId: product.id,
      predicate: 'CURRENT_STOCK',
      value: 30,
      claimKind: 'FACT',
      authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
      sourceRef: {
        sourceType: 'USER',
        sourceId: 'confirmed-company-state',
        sourceVersionId: 'phase7d-stale-change',
        sourceVersionLabel: 'phase7d-stale-change',
        sourceName: 'Later stale-state update',
        excerpt: 'Stock changed before automation execution.',
      },
      observedAt: now + 8000,
      validFrom: now + 8000,
    });

    const staleResponse = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        staleProposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const staleBody = await staleResponse.json();

    assert(
      staleResponse.status === 409 &&
        staleBody.code === 'ACTION_STALE',
      'Deterministic stale-state failure must preserve the Phase 4 error.'
    );

    const staleRun = automationRunStore
      .list({
        accountId: accountA,
        proposalId: staleProposal.id,
        limit: 10,
      })[0];

    assert(
      staleRun?.status === 'FAILED' &&
        staleRun.failureCategory === 'STALE_STATE' &&
        staleRun.attemptCount === 1 &&
        staleRun.retryable === false,
      'Stale-state failure must not be retried.'
    );

    // Foreign account sees its own control default and cannot inspect/compensate A runs.
    const foreignControl = await fetch(
      baseUrl + '/api/automation/control',
      {
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    const foreignControlBody = await foreignControl.json();
    assert(
      foreignControl.status === 200 &&
        foreignControlBody.control?.accountId === accountB &&
        foreignControlBody.control?.version === 0,
      'Spoofed account header must not reveal another account automation control state.'
    );

    const foreignRun = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        autoBody.run.id,
      {
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignRun.status === 404,
      'Foreign account must not inspect another account AutomationRun.'
    );

    const foreignCompensate = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        autoBody.run.id +
        '/compensate',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignCompensate.status === 404,
      'Foreign account must not compensate another account automation run.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_7D_AUTOMATION_RECOVERY_CHECK_PASSED');
  console.log(
    'Emergency kill switch, control history, durable AutomationRun outcomes, bounded technical retry, non-retryable stale failures, audited compensation, changed-state compensation refusal, idempotent recovery, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_7D_AUTOMATION_RECOVERY_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
