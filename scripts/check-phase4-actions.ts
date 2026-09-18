import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { actionExecutionService } from '../server/actions/actionExecutionService.js';
import { actionRefinementService } from '../server/actions/actionRefinementService.js';
import { actionRouter } from '../server/actions/actionRouter.js';
import { actionStore } from '../server/actions/actionStore.js';
import { effectiveCompanyStateService } from '../server/companyKnowledge/effectiveCompanyStateService.js';
import {
  ActionInterpretationError,
  hybridActionInterpreter,
} from '../server/actions/hybridActionInterpreter.js';
import { ActionProposalError } from '../server/actions/actionProposalService.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { structuredAnalyticsEngine } from '../server/datasets/structuredAnalyticsEngine.js';
import { discoveryService } from '../server/discovery/discoveryService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resolvedNumber(
  accountId: string,
  entityId: string,
  predicate: string
): { value: number; claimId: string; authority: string; kind: string } {
  const resolution = effectiveCompanyStateService.resolve(
    accountId,
    entityId,
    predicate
  );
  assert(
    resolution.status === 'RESOLVED' &&
      typeof resolution.value === 'number',
    'Expected resolved numeric state for ' + predicate
  );
  return {
    value: resolution.value,
    claimId: resolution.effectiveClaim.id,
    authority: resolution.effectiveClaim.authority.level,
    kind: resolution.effectiveClaim.claimKind,
  };
}

async function main() {
  const accountA = 'acc_actions_phase4_a';
  const accountB = 'acc_actions_phase4_b';
  const now = new Date('2026-09-18T12:00:00Z');

  const ordersCsv = [
    'order_id,order_date,customer_id,customer_name,product_id,product_name,grand_total,amount_paid,balance_due,status',
    'O-100,2026-09-01,C-1,Suman,P-1,Chair,72000,30000,42000,OPEN',
    'O-200,2026-09-03,C-2,Priya,P-2,Table,50000,10000,40000,OPEN',
    'O-201,2026-09-04,C-2,Priya,P-3,Wardrobe,30000,5000,25000,OPEN',
  ].join('\n');

  const orders = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(ordersCsv, 'utf8'),
    filename: 'phase4-orders.csv',
    datasetName: 'Phase 4 Orders',
  });

  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: orders.dataset.id,
  });

  const inventoryCsv = [
    'product_id,product_name,current_stock,reorder_level',
    'P-10,Oak Boards,12,5',
  ].join('\n');

  const inventory = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(inventoryCsv, 'utf8'),
    filename: 'phase4-inventory.csv',
    datasetName: 'Phase 4 Inventory',
  });

  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: inventory.dataset.id,
  });

  const order100 = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-100',
  })[0];
  const order200 = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-200',
  })[0];
  const order201 = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-201',
  })[0];
  const oakBoards = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Oak Boards',
  })[0];

  assert(order100 && order200 && order201 && oakBoards, 'Phase 4 source entities were not projected.');

  const beforeProposalBalance = resolvedNumber(
    accountA,
    order100.id,
    'BALANCE_DUE'
  );
  assert(
    beforeProposalBalance.value === 42000 &&
      beforeProposalBalance.authority === 'STRUCTURED_SOURCE',
    'Initial effective balance should come from imported structured evidence.'
  );

  const paymentInterpretation = await hybridActionInterpreter.interpret({
    accountId: accountA,
    instruction: 'Suman paid another 10k today.',
    allowLlmParsing: false,
    now,
  });

  const paymentProposal = paymentInterpretation.proposal;
  assert(
    paymentInterpretation.effectiveParser === 'DETERMINISTIC' &&
      paymentProposal.status === 'PROPOSED' &&
      paymentProposal.intent === 'RECORD_PAYMENT',
    'Common payment wording should produce a deterministic proposal.'
  );

  const balanceMutation = paymentProposal.mutations.find(
    (mutation) => mutation.predicate === 'BALANCE_DUE'
  );
  const paidMutation = paymentProposal.mutations.find(
    (mutation) => mutation.predicate === 'PAID_AMOUNT'
  );
  assert(
    balanceMutation?.beforeValue === 42000 &&
      balanceMutation.afterValue === 32000 &&
      paidMutation?.beforeValue === 30000 &&
      paidMutation.afterValue === 40000,
    'Payment proposal must preview exact deterministic before/after values.'
  );
  assert(
    paymentProposal.preconditions.some(
      (condition) =>
        condition.predicate === 'BALANCE_DUE' &&
        condition.effectiveClaimId === beforeProposalBalance.claimId
    ),
    'Payment proposal must pin the effective source claim as a confirmation precondition.'
  );

  const afterProposalBalance = resolvedNumber(
    accountA,
    order100.id,
    'BALANCE_DUE'
  );
  assert(
    afterProposalBalance.value === 42000,
    'Creating a proposal must not mutate company state.'
  );

  const firstExecution = actionExecutionService.confirm({
    accountId: accountA,
    proposalId: paymentProposal.id,
    now: now.getTime() + 1_000,
  });

  assert(
    firstExecution.proposal.status === 'CONFIRMED' &&
      firstExecution.execution.claimIds.length === 2 &&
      firstExecution.execution.eventIds.length === 1,
    'Explicit confirmation must create the authoritative claims and payment event.'
  );

  const effectiveBalance = resolvedNumber(
    accountA,
    order100.id,
    'BALANCE_DUE'
  );
  const effectivePaid = resolvedNumber(
    accountA,
    order100.id,
    'PAID_AMOUNT'
  );

  assert(
    effectiveBalance.value === 32000 &&
      effectivePaid.value === 40000 &&
      effectiveBalance.authority === 'USER_CONFIRMED' &&
      effectiveBalance.kind === 'FACT',
    'Confirmed payment must become higher-authority USER_CONFIRMED company state.'
  );

  const analyticalView = structuredAnalyticsEngine.execute({
    accountId: accountA,
    datasetId: orders.dataset.id,
    versionId: orders.version.id,
    plan: {
      tableName: orders.version.tables[0].name,
      filters: [
        {
          column: 'order_id',
          operator: 'EQ',
          value: 'O-100',
        },
      ],
      select: ['order_id', 'amount_paid', 'balance_due'],
      limit: 10,
    },
  });
  assert(
    analyticalView.rows.length === 1 &&
      analyticalView.rows[0].balance_due === 32000 &&
      analyticalView.rows[0].amount_paid === 40000 &&
      analyticalView.provenance.companyStateOverlay?.applied === true &&
      analyticalView.provenance.companyStateOverlay.applicationCount >= 2,
    'Structured analytics must read confirmed company-state overlays without modifying the imported dataset.'
  );
  assert(
    orders.version.tables[0].rows[0][8] === 42000 &&
      orders.version.tables[0].rows[0][7] === 30000,
    'Original imported dataset rows must remain immutable after confirmed actions.'
  );

  assert(
    (firstExecution.execution.downstreamAnalysisRunIds?.length || 0) >= 1,
    'Confirmed action should refresh Discovery for affected dataset sources.'
  );
  const refreshedRunId =
    firstExecution.execution.downstreamAnalysisRunIds![0];
  const refreshedInsights = discoveryService.listInsights({
    accountId: accountA,
    datasetId: orders.dataset.id,
    runId: refreshedRunId,
    limit: 100,
  });
  const refreshedBalanceInsight = refreshedInsights.find(
    (insight) => insight.detectorId === 'balance.outstanding'
  );
  assert(
    refreshedBalanceInsight &&
      refreshedBalanceInsight.evidence.values.totalOutstanding === 97000 &&
      refreshedBalanceInsight.evidence.companyStateOverlay?.applicationCount === 1 &&
      refreshedBalanceInsight.evidence.companyStateOverlay.changes[0].predicate ===
        'BALANCE_DUE' &&
      refreshedBalanceInsight.evidence.companyStateOverlay.changes[0].afterValue ===
        32000,
    'Discovery refresh must use the confirmed balance overlay and disclose the exact action claim in evidence.'
  );

  const structuredBalanceStillExists = companyKnowledgeStore
    .listClaims({
      accountId: accountA,
      entityId: order100.id,
      predicate: 'BALANCE_DUE',
      currentOnly: true,
      limit: 20,
    })
    .some(
      (claim) =>
        claim.value === 42000 &&
        claim.authority.level === 'STRUCTURED_SOURCE'
    );
  assert(
    structuredBalanceStillExists,
    'Confirmed state must not delete the original imported observation.'
  );

  const paymentEvent = companyKnowledgeStore
    .listEvents({
      accountId: accountA,
      entityId: order100.id,
      type: 'PAYMENT_RECEIVED',
      limit: 20,
    })
    .find(
      (event) =>
        event.sourceRef.sourceVersionId === paymentProposal.id
    );
  assert(
    paymentEvent &&
      paymentEvent.data.paymentAmount === 10000 &&
      paymentEvent.data.previousBalance === 42000 &&
      paymentEvent.data.newBalance === 32000,
    'PAYMENT_RECEIVED event must preserve the validated financial effect.'
  );

  const repeatExecution = actionExecutionService.confirm({
    accountId: accountA,
    proposalId: paymentProposal.id,
    now: now.getTime() + 2_000,
  });
  assert(
    repeatExecution.execution.id === firstExecution.execution.id,
    'Repeated confirmation must return the original execution idempotently.'
  );

  const repeatedPaymentEvents = companyKnowledgeStore.listEvents({
    accountId: accountA,
    entityId: order100.id,
    type: 'PAYMENT_RECEIVED',
    limit: 100,
  });
  assert(
    repeatedPaymentEvents.filter(
      (event) =>
        event.sourceRef.sourceVersionId === paymentProposal.id
    ).length === 1,
    'Repeated confirmation must not duplicate the business event.'
  );

  let overpaymentBlocked = false;
  try {
    await hybridActionInterpreter.interpret({
      accountId: accountA,
      instruction: 'Record a payment of 40k for order O-100 today.',
      allowLlmParsing: false,
      now,
    });
  } catch (error) {
    overpaymentBlocked =
      error instanceof ActionProposalError &&
      error.code === 'OVERPAYMENT_NOT_SUPPORTED';
  }
  assert(overpaymentBlocked, 'Payment above current balance must be rejected.');

  const ambiguous = await hybridActionInterpreter.interpret({
    accountId: accountA,
    instruction: 'Priya paid 5k today.',
    allowLlmParsing: false,
    now,
  });
  assert(
    ambiguous.proposal.status === 'NEEDS_INPUT' &&
      ambiguous.proposal.targetCandidates?.length === 2,
    'Customer with multiple outstanding orders must not be guessed.'
  );
  const ambiguousIds = new Set(
    ambiguous.proposal.targetCandidates?.map(
      (candidate) => candidate.entityId
    )
  );
  assert(
    ambiguousIds.has(order200.id) && ambiguousIds.has(order201.id),
    'Ambiguity candidates must contain the two actual outstanding Priya orders.'
  );

  const refined = actionRefinementService.selectTarget({
    accountId: accountA,
    proposalId: ambiguous.proposal.id,
    entityId: order200.id,
  });
  assert(
    refined.status === 'PROPOSED' &&
      refined.targetEntityIds.includes(order200.id) &&
      refined.mutations.some(
        (mutation) =>
          mutation.predicate === 'BALANCE_DUE' &&
          mutation.beforeValue === 40000 &&
          mutation.afterValue === 35000
      ),
    'Explicit candidate selection must regenerate a confirmable proposal for that target.'
  );
  assert(
    actionStore.requireProposal(accountA, ambiguous.proposal.id).status ===
      'CANCELLED',
    'Refined proposal must supersede the ambiguous proposal.'
  );

  const inventoryProposal = (
    await hybridActionInterpreter.interpret({
      accountId: accountA,
      instruction: 'Received 20 Oak Boards today.',
      allowLlmParsing: false,
      now,
    })
  ).proposal;

  assert(
    inventoryProposal.status === 'PROPOSED' &&
      inventoryProposal.mutations.length === 1 &&
      inventoryProposal.mutations[0].predicate === 'CURRENT_STOCK' &&
      inventoryProposal.mutations[0].beforeValue === 12 &&
      inventoryProposal.mutations[0].afterValue === 32,
    'Inventory receipt must produce exact stock before/after preview.'
  );

  actionExecutionService.confirm({
    accountId: accountA,
    proposalId: inventoryProposal.id,
    now: now.getTime() + 3_000,
  });
  const effectiveStock = resolvedNumber(
    accountA,
    oakBoards.id,
    'CURRENT_STOCK'
  );
  assert(
    effectiveStock.value === 32 &&
      effectiveStock.authority === 'USER_CONFIRMED',
    'Confirmed inventory receipt must update effective stock.'
  );

  const statusProposal = (
    await hybridActionInterpreter.interpret({
      accountId: accountA,
      instruction: 'Mark order O-200 as delivered.',
      allowLlmParsing: false,
      now,
    })
  ).proposal;
  assert(
    statusProposal.status === 'PROPOSED' &&
      statusProposal.mutations[0].predicate === 'STATUS' &&
      statusProposal.mutations[0].beforeValue === 'OPEN' &&
      statusProposal.mutations[0].afterValue === 'DELIVERED',
    'Order status update must preview the exact explicit change.'
  );
  const cancelled = actionExecutionService.cancel({
    accountId: accountA,
    proposalId: statusProposal.id,
  });
  assert(cancelled.status === 'CANCELLED', 'User must be able to cancel a proposal before execution.');

  let cancelledConfirmBlocked = false;
  try {
    actionExecutionService.confirm({
      accountId: accountA,
      proposalId: statusProposal.id,
    });
  } catch (error: any) {
    cancelledConfirmBlocked =
      error?.code === 'ACTION_NOT_CONFIRMABLE';
  }
  assert(
    cancelledConfirmBlocked,
    'Cancelled proposal must never execute.'
  );

  const staleProposal = (
    await hybridActionInterpreter.interpret({
      accountId: accountA,
      instruction: 'Record a payment of 5k for order O-100 today.',
      allowLlmParsing: false,
      now,
    })
  ).proposal;
  assert(staleProposal.status === 'PROPOSED', 'Expected stale-test proposal.');

  companyKnowledgeStore.recordClaim({
    accountId: accountA,
    subjectEntityId: order100.id,
    predicate: 'BALANCE_DUE',
    value: 31000,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: {
      sourceType: 'USER',
      sourceId: 'confirmed-company-state',
      sourceVersionId: 'external_test_state_change',
      sourceVersionLabel: 'external test state change',
      sourceName: 'Confirmed business action',
      excerpt: 'Another confirmed update changed the balance.',
    },
    observedAt: now.getTime() + 4_000,
    validFrom: now.getTime() + 4_000,
  });

  let staleBlocked = false;
  try {
    actionExecutionService.confirm({
      accountId: accountA,
      proposalId: staleProposal.id,
      now: now.getTime() + 5_000,
    });
  } catch (error: any) {
    staleBlocked = error?.code === 'ACTION_STALE';
  }
  assert(staleBlocked, 'Proposal must fail if effective state changed after preview.');
  assert(
    actionStore.requireProposal(accountA, staleProposal.id).status ===
      'STALE',
    'Stale proposal status must be persisted.'
  );

  let unsupportedBlocked = false;
  const proposalCountBeforeUnsupported = actionStore.listProposals({
    accountId: accountA,
    limit: 500,
  }).length;
  try {
    await hybridActionInterpreter.interpret({
      accountId: accountA,
      instruction: 'Please reorganize everything for next quarter.',
      allowLlmParsing: false,
      now,
    });
  } catch (error) {
    unsupportedBlocked =
      error instanceof ActionInterpretationError &&
      error.code === 'ACTION_UNRECOGNIZED';
  }
  assert(
    unsupportedBlocked &&
      actionStore.listProposals({
        accountId: accountA,
        limit: 500,
      }).length === proposalCountBeforeUnsupported,
    'Unsupported deterministic wording must write nothing.'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/actions', actionRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 4 HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Phase 4 Actions A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Phase 4 Actions B',
      accountId: accountB,
      environment: 'test',
    });

    const ownDetail = await fetch(
      baseUrl + '/api/actions/' + paymentProposal.id,
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      ownDetail.status === 200,
      'Owning account could not inspect its action proposal.'
    );
    const ownDetailBody = await ownDetail.json();
    assert(
      ownDetailBody.proposal?.status === 'CONFIRMED' &&
        ownDetailBody.execution?.id === firstExecution.execution.id &&
        ownDetailBody.audit?.some(
          (entry: any) => entry.action === 'CONFIRMED'
        ),
      'Action detail API must expose proposal, execution, and audit history.'
    );

    const foreignDetail = await fetch(
      baseUrl + '/api/actions/' + paymentProposal.id,
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignDetail.status === 404,
      'Foreign account must not inspect another account action proposal.'
    );

    const foreignConfirm = await fetch(
      baseUrl + '/api/actions/' + refined.id + '/confirm',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignConfirm.status === 404,
      'Foreign account must not confirm another account action.'
    );

    const httpProposalResponse = await fetch(
      baseUrl + '/api/actions/propose',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Record a payment of 1k for order O-100 today.',
          allowLlmParsing: false,
        }),
      }
    );
    assert(
      httpProposalResponse.status === 201,
      'Mounted action proposal endpoint failed.'
    );
    const httpProposalBody = await httpProposalResponse.json();
    assert(
      httpProposalBody.proposal?.status === 'PROPOSED' &&
        httpProposalBody.proposal?.mutations?.some(
          (mutation: any) =>
            mutation.predicate === 'BALANCE_DUE' &&
            mutation.beforeValue === 31000 &&
            mutation.afterValue === 30000
        ),
      'Action proposal endpoint must use current effective confirmed state.'
    );

    const cancelResponse = await fetch(
      baseUrl +
        '/api/actions/' +
        httpProposalBody.proposal.id +
        '/cancel',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(cancelResponse.status === 200, 'Mounted cancel endpoint failed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_4_ACTIONS_CHECK_PASSED');
  console.log(
    'No-write proposals, payment/inventory/status previews, explicit confirmation, USER_CONFIRMED state, audit events, idempotency, ambiguity handling, target refinement, overpayment rejection, stale-state protection, cancellation, unsupported-action refusal, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_4_ACTIONS_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
