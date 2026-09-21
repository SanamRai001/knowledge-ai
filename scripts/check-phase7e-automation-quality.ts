import express from 'express';
import { actionStore } from '../server/actions/actionStore.js';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { automationApprovalStore } from '../server/automation/automationApprovalStore.js';
import { automationControlStore } from '../server/automation/automationControlStore.js';
import { automationPolicyStore } from '../server/automation/automationPolicyStore.js';
import { automationQualityService } from '../server/automation/automationQualityService.js';
import { automationRouter } from '../server/automation/automationRouter.js';
import { automationRunStore } from '../server/automation/automationRunStore.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function proposal(accountId: string, label: string) {
  return actionStore.createProposal({
    accountId,
    instruction: 'Received 1 unit for ' + label + '.',
    intent: 'RECEIVE_INVENTORY',
    status: 'PROPOSED',
    parserSource: 'DETERMINISTIC',
    parsedInput: {
      intent: 'RECEIVE_INVENTORY',
      productReference: label,
      quantity: 1,
    },
    targetEntityIds: ['entity-' + label],
    mutations: [],
    preconditions: [],
    eventType: 'INVENTORY_RECEIVED',
    eventData: {
      label,
      quantity: 1,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
}

async function main() {
  const accountA = 'acc_phase7e_quality_a';
  const accountB = 'acc_phase7e_quality_b';
  const now = Date.now();

  const adminKey = apiKeyStore.createApiKey({
    name: 'Phase 7E Admin',
    accountId: accountA,
    environment: 'test',
    scopes: ['automation:admin', 'role:admin'],
  });
  const foreignKey = apiKeyStore.createApiKey({
    name: 'Phase 7E Foreign',
    accountId: accountB,
    environment: 'test',
    scopes: ['automation:admin', 'role:admin'],
  });

  const policy = automationPolicyStore.upsertPolicy({
    accountId: accountA,
    actor: 'test:phase7e',
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
    },
  });

  automationControlStore.set({
    accountId: accountA,
    emergencyDisabled: false,
    actor: 'test:phase7e',
    reason: 'Phase 7E baseline.',
  });

  const cleanProposal = proposal(accountA, 'clean');
  const falseTriggerProposal = proposal(accountA, 'false-trigger');
  const failedProposal = proposal(accountA, 'technical-failure');
  const blockedProposal = proposal(accountA, 'policy-block');
  const compensatedProposal = proposal(accountA, 'compensated');
  const recoveryProposal = proposal(accountA, 'recovery-required');
  const runningProposal = proposal(accountA, 'still-running');

  const cleanRun = automationRunStore.create({
    accountId: accountA,
    proposalId: cleanProposal.id,
    status: 'SUCCEEDED',
    attemptCount: 1,
    maxAttempts: 2,
    actor: 'api-key:phase7e',
    actorRole: 'SERVICE',
    policyId: policy.id,
    policyVersion: policy.version,
    executionId: 'exec-clean',
    completedAt: now,
  });

  const falseTriggerRun = automationRunStore.create({
    accountId: accountA,
    proposalId: falseTriggerProposal.id,
    status: 'SUCCEEDED',
    attemptCount: 1,
    maxAttempts: 2,
    actor: 'api-key:phase7e',
    actorRole: 'SERVICE',
    policyId: policy.id,
    policyVersion: policy.version,
    executionId: 'exec-false',
    completedAt: now + 1,
  });

  automationRunStore.create({
    accountId: accountA,
    proposalId: failedProposal.id,
    status: 'FAILED',
    attemptCount: 2,
    maxAttempts: 2,
    actor: 'api-key:phase7e',
    actorRole: 'SERVICE',
    policyId: policy.id,
    policyVersion: policy.version,
    failureCategory: 'TECHNICAL',
    retryable: false,
    lastError: 'simulated technical failure',
    completedAt: now + 2,
  });

  automationRunStore.create({
    accountId: accountA,
    proposalId: blockedProposal.id,
    status: 'BLOCKED',
    attemptCount: 0,
    maxAttempts: 0,
    actor: 'api-key:phase7e',
    actorRole: 'SERVICE',
    policyId: policy.id,
    policyVersion: policy.version,
    failureCategory: 'POLICY',
    retryable: false,
    lastError: 'policy denied',
    completedAt: now + 3,
  });

  const compensatedRun = automationRunStore.create({
    accountId: accountA,
    proposalId: compensatedProposal.id,
    status: 'COMPENSATED',
    attemptCount: 1,
    maxAttempts: 2,
    actor: 'api-key:phase7e',
    actorRole: 'SERVICE',
    policyId: policy.id,
    policyVersion: policy.version,
    executionId: 'exec-compensated',
    compensationProposalId: 'comp-proposal',
    compensationExecutionId: 'comp-execution',
    completedAt: now + 4,
  });

  automationRunStore.create({
    accountId: accountA,
    proposalId: recoveryProposal.id,
    status: 'RECOVERY_REQUIRED',
    attemptCount: 1,
    maxAttempts: 2,
    actor: 'api-key:phase7e',
    actorRole: 'SERVICE',
    policyId: policy.id,
    policyVersion: policy.version,
    executionId: 'exec-recovery',
    failureCategory: 'VALIDATION',
    retryable: false,
    lastError: 'newer company state prevents blind compensation',
    completedAt: now + 5,
  });

  const runningRun = automationRunStore.create({
    accountId: accountA,
    proposalId: runningProposal.id,
    status: 'RUNNING',
    attemptCount: 1,
    maxAttempts: 2,
    actor: 'api-key:phase7e',
    actorRole: 'SERVICE',
    policyId: policy.id,
    policyVersion: policy.version,
  });

  automationRunStore.setFeedback({
    accountId: accountA,
    runId: cleanRun.id,
    feedback: 'CORRECT',
    actor: 'test:phase7e',
  });
  automationRunStore.setFeedback({
    accountId: accountA,
    runId: compensatedRun.id,
    feedback: 'NEEDS_CORRECTION',
    actor: 'test:phase7e',
  });

  const approval1Proposal = proposal(accountA, 'approval-pending');
  const approval2Proposal = proposal(accountA, 'approval-approved');
  const approval3Proposal = proposal(accountA, 'approval-rejected');

  const approvalPending = automationApprovalStore.ensureRequest({
    accountId: accountA,
    proposalId: approval1Proposal.id,
    policyId: policy.id,
    policyVersion: policy.version,
    requestedBy: 'api-key:requester',
    requestedByRole: 'SERVICE',
    eligibleRoles: ['ADMIN'],
    decisionReasonCodes: ['POLICY_REQUIRES_APPROVAL'],
    decisionReasons: ['Policy requires approval.'],
    expiresAt: now + 60 * 60 * 1000,
  });

  const approvalApproved = automationApprovalStore.ensureRequest({
    accountId: accountA,
    proposalId: approval2Proposal.id,
    policyId: policy.id,
    policyVersion: policy.version,
    requestedBy: 'api-key:requester',
    requestedByRole: 'SERVICE',
    eligibleRoles: ['ADMIN'],
    decisionReasonCodes: ['POLICY_REQUIRES_APPROVAL'],
    decisionReasons: ['Policy requires approval.'],
    expiresAt: now + 60 * 60 * 1000,
  });
  automationApprovalStore.resolve({
    accountId: accountA,
    approvalId: approvalApproved.id,
    status: 'APPROVED',
    resolvedBy: 'user:phase7e-admin',
    resolvedByRole: 'ADMIN',
    now: now + 10,
  });

  const approvalRejected = automationApprovalStore.ensureRequest({
    accountId: accountA,
    proposalId: approval3Proposal.id,
    policyId: policy.id,
    policyVersion: policy.version,
    requestedBy: 'api-key:requester',
    requestedByRole: 'SERVICE',
    eligibleRoles: ['ADMIN'],
    decisionReasonCodes: ['POLICY_REQUIRES_APPROVAL'],
    decisionReasons: ['Policy requires approval.'],
    expiresAt: now + 60 * 60 * 1000,
  });
  automationApprovalStore.resolve({
    accountId: accountA,
    approvalId: approvalRejected.id,
    status: 'REJECTED',
    resolvedBy: 'user:phase7e-admin',
    resolvedByRole: 'ADMIN',
    now: now + 20,
  });

  assert(
    approvalPending.status === 'PENDING',
    'Expected one pending approval in the quality corpus.'
  );

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
      throw new Error('Could not resolve Phase 7E test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const feedbackResponse = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        falseTriggerRun.id +
        '/feedback',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feedback: 'FALSE_TRIGGER',
          note: 'This automatic action should not have fired.',
        }),
      }
    );
    assert(
      feedbackResponse.status === 200,
      'Terminal run feedback endpoint failed.'
    );

    const runningFeedback = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        runningRun.id +
        '/feedback',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + adminKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feedback: 'CORRECT',
        }),
      }
    );
    assert(
      runningFeedback.status === 409,
      'RUNNING automation must not accept terminal-quality feedback.'
    );

    const qualityResponse = await fetch(
      baseUrl + '/api/automation/quality',
      {
        headers: { Authorization: 'Bearer ' + adminKey.secret },
      }
    );
    assert(
      qualityResponse.status === 200,
      'Automation quality endpoint failed.'
    );
    const qualityBody = await qualityResponse.json();
    const q = qualityBody.quality;

    assert(
      q.population.automationRuns === 7 &&
        q.population.approvalRequests === 3 &&
        q.population.feedbackRatedRuns === 3,
      'Quality population counts are incorrect.'
    );
    assert(
      q.executions.attempted === 5 &&
        q.executions.successful === 2 &&
        q.executions.failed === 1 &&
        q.executions.successRate === 0.4 &&
        q.executions.failureRate === 0.2,
      'Execution quality rates must use the documented execution population.'
    );
    assert(
      q.governance.blockedRuns === 1 &&
        q.governance.policyDenials === 1 &&
        q.governance.approvalEscalations === 3 &&
        q.governance.approvalEscalationRate === 0.3 &&
        q.governance.approvalsGranted === 1 &&
        q.governance.approvalsRejected === 1 &&
        q.governance.approvalsPending === 1,
      'Governance analytics are incorrect.'
    );
    assert(
      q.recovery.compensatedRuns === 1 &&
        q.recovery.compensationRate === 0.2 &&
        q.recovery.recoveryRequiredRuns === 1 &&
        q.recovery.technicalFailures === 1,
      'Recovery analytics are incorrect.'
    );
    assert(
      q.feedback.correct === 1 &&
        q.feedback.falseTriggers === 1 &&
        q.feedback.needsCorrection === 1 &&
        q.feedback.falseTriggerRate === 0.3333 &&
        q.feedback.humanCorrectionSignals === 3,
      'Human-feedback quality analytics are incorrect.'
    );
    assert(
      q.timeSaved.estimatedMinutes === null &&
        q.timeSaved.reason.includes('does not yet have a measured'),
      'Time-saved analytics must remain unavailable without a measured baseline.'
    );

    const dashboardResponse = await fetch(
      baseUrl + '/api/automation/dashboard',
      {
        headers: { Authorization: 'Bearer ' + adminKey.secret },
      }
    );
    assert(
      dashboardResponse.status === 200,
      'Automation dashboard endpoint failed.'
    );
    const dashboard = await dashboardResponse.json();

    assert(
      dashboard.policy?.id === policy.id &&
        dashboard.control?.accountId === accountA &&
        dashboard.runs.some(
          (item: any) =>
            item.run.id === falseTriggerRun.id &&
            item.proposal?.instruction.includes('false-trigger')
        ) &&
        dashboard.approvals.some(
          (item: any) =>
            item.approval.id === approvalPending.id &&
            item.proposal?.instruction.includes('approval-pending')
        ),
      'Automation dashboard must join real policy/control/run/approval state with proposal context.'
    );

    const contextResponse = await fetch(
      baseUrl + '/api/automation/context',
      {
        headers: { Authorization: 'Bearer ' + adminKey.secret },
      }
    );
    const context = await contextResponse.json();
    assert(
      contextResponse.status === 200 &&
        context.source === 'API_KEY' &&
        context.role === 'SERVICE' &&
        context.capabilities.canControlEmergencyStop === false &&
        context.capabilities.canResolveApprovals === false &&
        context.capabilities.canCompensate === false &&
        context.capabilities.canExecuteAutomation === false &&
        context.capabilities.canRecordFeedback === true,
      'API-key role:admin scope must remain SERVICE in Automation capability context while non-privileged quality feedback remains available.'
    );

    const foreignFeedback = await fetch(
      baseUrl +
        '/api/automation/runs/' +
        falseTriggerRun.id +
        '/feedback',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'Content-Type': 'application/json',
          'X-Account-ID': accountA,
        },
        body: JSON.stringify({
          feedback: 'CORRECT',
        }),
      }
    );
    assert(
      foreignFeedback.status === 404,
      'Foreign account must not rate another account automation run.'
    );

    const foreignDashboard = await fetch(
      baseUrl + '/api/automation/dashboard',
      {
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    const foreignBody = await foreignDashboard.json();
    assert(
      foreignDashboard.status === 200 &&
        foreignBody.quality.accountId === accountB &&
        foreignBody.quality.population.automationRuns === 0 &&
        foreignBody.runs.length === 0,
      'Automation analytics must stay scoped to authoritative request identity.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  const direct = automationQualityService.summary(accountA);
  assert(
    direct.feedback.falseTriggers === 1,
    'Direct deterministic quality summary must match the API result.'
  );

  console.log('PHASE_7E_AUTOMATION_QUALITY_CHECK_PASSED');
  console.log(
    'Automation success/failure, policy blocking, approval escalation, compensation/recovery, human feedback, false-trigger rate, honest unavailable time-saved metric, dashboard enrichment, SERVICE machine-role context, API-key role-scope non-escalation, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_7E_AUTOMATION_QUALITY_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
