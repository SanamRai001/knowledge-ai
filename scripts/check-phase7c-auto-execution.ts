import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { actionProposalService } from '../server/actions/actionProposalService.js';
import { actionStore } from '../server/actions/actionStore.js';
import type { ActionIntent } from '../server/actions/types.js';
import { automationRouter } from '../server/automation/automationRouter.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { effectiveCompanyStateService } from '../server/companyKnowledge/effectiveCompanyStateService.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sourceRef(version: string, sourceName = 'Phase 7C seed') {
  return {
    sourceType: 'DATASET' as const,
    sourceId: 'ds_phase7c',
    sourceVersionId: version,
    sourceVersionLabel: version,
    sourceName,
    excerpt: sourceName,
  };
}

function directProposal(params: {
  accountId: string;
  intent: ActionIntent;
}) {
  return actionStore.createProposal({
    accountId: params.accountId,
    instruction: 'Phase 7C unsupported auto-execution probe.',
    intent: params.intent,
    status: 'PROPOSED',
    parserSource: 'DETERMINISTIC',
    parsedInput: { intent: params.intent },
    targetEntityIds: [],
    mutations: [],
    preconditions: [],
    eventData: {},
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
}

async function main() {
  const accountA = 'acc_phase7c_a';
  const accountB = 'acc_phase7c_b';
  const now = Date.now();

  const product = companyKnowledgeStore.upsertEntity({
    accountId: accountA,
    type: 'PRODUCT',
    canonicalName: 'Phase 7C Oak Boards',
    identityKey: 'phase7c-oak',
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

  const adminKey = apiKeyStore.createApiKey({
    name: 'Phase 7C Admin',
    accountId: accountA,
    environment: 'test',
    scopes: ['automation:admin', 'role:admin'],
  });
  const operatorKey = apiKeyStore.createApiKey({
    name: 'Phase 7C Operator',
    accountId: accountA,
    environment: 'test',
    scopes: ['automation:execute', 'role:operator'],
  });
  const foreignKey = apiKeyStore.createApiKey({
    name: 'Phase 7C Foreign',
    accountId: accountB,
    environment: 'test',
    scopes: ['automation:execute', 'role:operator'],
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
      throw new Error('Could not resolve Phase 7C HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const writePolicy = async (params: {
      enabled: boolean;
      maxQuantity: number;
    }) => {
      const response = await fetch(
        baseUrl + '/api/automation/policy',
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer ' + adminKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            enabled: params.enabled,
            mode: 'AUTO_EXECUTE_LOW_RISK',
            allowedActionIntents: ['RECEIVE_INVENTORY'],
            maxRiskClass: 'LOW',
            maxQuantity: params.maxQuantity,
            allowedIdentitySources: ['API_KEY'],
            allowedActorRoles: ['OPERATOR'],
            approvalRoles: ['ADMIN'],
            allowedTargetEntityTypes: ['PRODUCT'],
            allowedTargetEntityIds: [product.id],
          }),
        }
      );
      const body = await response.json();
      assert(
        response.ok,
        'Phase 7C policy update failed: ' +
          JSON.stringify(body)
      );
      return body.policy;
    };

    const policyV1 = await writePolicy({
      enabled: true,
      maxQuantity: 5,
    });

    const proposal = actionProposalService.createFromParsed({
      accountId: accountA,
      instruction: 'Received 3 Phase 7C Oak Boards.',
      parsed: {
        intent: 'RECEIVE_INVENTORY',
        productReference: 'phase7c-oak',
        quantity: 3,
      },
      parserSource: 'DETERMINISTIC',
      now: now + 1000,
    });

    assert(
      proposal.status === 'PROPOSED' &&
        proposal.intent === 'RECEIVE_INVENTORY' &&
        proposal.mutations[0]?.beforeValue === 10 &&
        proposal.mutations[0]?.afterValue === 13,
      'Inventory proposal must be fully deterministic before automation evaluation.'
    );

    const executionResponse = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        proposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const executionBody = await executionResponse.json();

    assert(
      executionResponse.status === 200 &&
        executionBody.replayed === false &&
        executionBody.evaluation?.decision ===
          'ALLOW_AUTO_EXECUTE' &&
        executionBody.execution?.executionMode ===
          'AUTOMATION_POLICY' &&
        executionBody.execution?.authorizedByRole === 'OPERATOR' &&
        executionBody.execution?.automationPolicyId === policyV1.id &&
        executionBody.execution?.automationPolicyVersion ===
          policyV1.version &&
        String(executionBody.execution?.authorizedBy).startsWith(
          'api-key:'
        ),
      'Eligible inventory receipt must execute through the policy-authorized Phase 4 path with explicit audit metadata.'
    );

    const stockAfterExecution =
      effectiveCompanyStateService.resolve(
        accountA,
        product.id,
        'CURRENT_STOCK'
      );

    assert(
      stockAfterExecution.status === 'RESOLVED' &&
        stockAfterExecution.value === 13 &&
        stockAfterExecution.effectiveClaim.sourceRef.sourceName ===
          'Policy-authorized business action',
      'Automatic inventory receipt must create the same authoritative confirmed company-state claim as the audited action engine.'
    );

    const audit = actionStore.listAudit({
      accountId: accountA,
      proposalId: proposal.id,
      limit: 20,
    });
    assert(
      audit.some(
        (entry) =>
          entry.action === 'CONFIRMED' &&
          entry.detail.includes(
            'Automation policy authorized this proposal'
          ) &&
          entry.detail.includes(
            'policy version: ' + String(policyV1.version)
          )
      ),
      'Action audit must state that deterministic policy—not a manual confirm click—authorized the write.'
    );

    const replayResponse = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        proposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const replayBody = await replayResponse.json();

    assert(
      replayResponse.status === 200 &&
        replayBody.replayed === true &&
        replayBody.execution?.id === executionBody.execution.id,
      'Repeated automation execution request must return the existing execution idempotently.'
    );

    const proposalClaims = companyKnowledgeStore
      .listClaims({
        accountId: accountA,
        entityId: product.id,
        predicate: 'CURRENT_STOCK',
        currentOnly: false,
        limit: 100,
      })
      .filter(
        (claim) =>
          claim.sourceRef.sourceVersionId === proposal.id
      );

    assert(
      proposalClaims.length === 1,
      'Idempotent replay must not duplicate the confirmed stock claim.'
    );

    const policyChangeProposal =
      actionProposalService.createFromParsed({
        accountId: accountA,
        instruction: 'Received 2 Phase 7C Oak Boards.',
        parsed: {
          intent: 'RECEIVE_INVENTORY',
          productReference: 'phase7c-oak',
          quantity: 2,
        },
        parserSource: 'DETERMINISTIC',
        now: now + 2000,
      });

    const preChangeEval = await fetch(
      baseUrl +
        '/api/automation/evaluate/' +
        policyChangeProposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const preChangeBody = await preChangeEval.json();
    assert(
      preChangeBody.evaluation?.decision ===
        'ALLOW_AUTO_EXECUTE',
      'Proposal must initially be eligible before testing last-moment policy re-evaluation.'
    );

    await writePolicy({
      enabled: false,
      maxQuantity: 5,
    });

    const disabledExecute = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        policyChangeProposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const disabledBody = await disabledExecute.json();

    assert(
      disabledExecute.status === 409 &&
        disabledBody.code ===
          'AUTOMATION_EXECUTION_NOT_ALLOWED' &&
        disabledBody.evaluation?.decision === 'DENY' &&
        disabledBody.evaluation?.reasonCodes?.includes(
          'POLICY_DISABLED'
        ) &&
        actionStore.getExecutionByProposal(
          accountA,
          policyChangeProposal.id
        ) === null,
      'A proposal that was eligible earlier must be blocked if automation is disabled before execution.'
    );

    await writePolicy({
      enabled: true,
      maxQuantity: 1,
    });

    const thresholdExecute = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        policyChangeProposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + operatorKey.secret,
        },
      }
    );
    const thresholdBody = await thresholdExecute.json();

    assert(
      thresholdExecute.status === 409 &&
        thresholdBody.evaluation?.decision ===
          'REQUIRE_APPROVAL' &&
        thresholdBody.evaluation?.reasonCodes?.includes(
          'QUANTITY_EXCEEDS_POLICY'
        ),
      'Tightened policy threshold must be honored at execution time rather than trusting a stale earlier ALLOW decision.'
    );

    await writePolicy({
      enabled: true,
      maxQuantity: 5,
    });

    const staleProposal =
      actionProposalService.createFromParsed({
        accountId: accountA,
        instruction: 'Received 2 Phase 7C Oak Boards.',
        parsed: {
          intent: 'RECEIVE_INVENTORY',
          productReference: 'phase7c-oak',
          quantity: 2,
        },
        parserSource: 'DETERMINISTIC',
        now: now + 3000,
      });

    companyKnowledgeStore.recordClaim({
      accountId: accountA,
      subjectEntityId: product.id,
      predicate: 'CURRENT_STOCK',
      value: 20,
      claimKind: 'FACT',
      authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
      sourceRef: {
        sourceType: 'USER',
        sourceId: 'confirmed-company-state',
        sourceVersionId: 'phase7c-external-stock-change',
        sourceVersionLabel: 'phase7c-external-stock-change',
        sourceName: 'Separate confirmed stock update',
        excerpt: 'Stock was independently corrected to 20.',
      },
      observedAt: now + 4000,
      validFrom: now + 4000,
    });

    const staleExecute = await fetch(
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
    const staleBody = await staleExecute.json();

    assert(
      staleExecute.status === 409 &&
        staleBody.code === 'ACTION_STALE' &&
        actionStore.requireProposal(
          accountA,
          staleProposal.id
        ).status === 'STALE' &&
        actionStore.getExecutionByProposal(
          accountA,
          staleProposal.id
        ) === null,
      'Automation must preserve the existing Phase 4 stale-precondition guard.'
    );

    const currentStock =
      effectiveCompanyStateService.resolve(
        accountA,
        product.id,
        'CURRENT_STOCK'
      );
    assert(
      currentStock.status === 'RESOLVED' &&
        currentStock.value === 20,
      'Failed stale automation must not overwrite newer confirmed company state.'
    );

    for (const intent of [
      'RECORD_PAYMENT',
      'UPDATE_STATUS',
      'CREATE_ORDER',
    ] as const) {
      const blockedProposal = directProposal({
        accountId: accountA,
        intent,
      });
      const blockedResponse = await fetch(
        baseUrl +
          '/api/automation/execute/' +
          blockedProposal.id,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + operatorKey.secret,
          },
        }
      );
      const blockedBody = await blockedResponse.json();

      assert(
        blockedResponse.status === 409 &&
          blockedBody.code ===
            'AUTOMATION_INTENT_NOT_SUPPORTED' &&
          actionStore.getExecutionByProposal(
            accountA,
            blockedProposal.id
          ) === null,
        intent +
          ' must remain impossible to execute through the Phase 7C automatic path.'
      );
    }

    const foreignProposal =
      actionProposalService.createFromParsed({
        accountId: accountA,
        instruction: 'Received 1 Phase 7C Oak Boards.',
        parsed: {
          intent: 'RECEIVE_INVENTORY',
          productReference: 'phase7c-oak',
          quantity: 1,
        },
        parserSource: 'DETERMINISTIC',
        now: now + 5000,
      });

    const foreignExecute = await fetch(
      baseUrl +
        '/api/automation/execute/' +
        foreignProposal.id,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      }
    );

    assert(
      foreignExecute.status === 404 &&
        actionStore.getExecutionByProposal(
          accountA,
          foreignProposal.id
        ) === null,
      'Foreign accounts must not auto-execute another account action even with a spoofed account header.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_7C_AUTO_EXECUTION_CHECK_PASSED');
  console.log(
    'RECEIVE_INVENTORY-only automatic execution, last-moment policy re-evaluation, Phase 4 write-path reuse, execution authorization metadata, stale-state protection, idempotent replay, unsupported-intent denial, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_7C_AUTO_EXECUTION_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
