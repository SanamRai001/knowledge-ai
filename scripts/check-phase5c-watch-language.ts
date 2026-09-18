import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { watchDraftService, WatchDraftError } from '../server/watch/watchDraftService.js';
import { watchEvaluator } from '../server/watch/watchEvaluator.js';
import { watchRouter } from '../server/watch/watchRouter.js';
import { watchStore } from '../server/watch/watchStore.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_watch_phase5c_a';
  const accountB = 'acc_watch_phase5c_b';

  const inventoryCsv = [
    'product_id,product_name,current_stock,reorder_level',
    'P-1,Oak Boards,4,5',
    'P-2,Oak Boards Premium,9,4',
  ].join('\n');

  const inventory = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(inventoryCsv, 'utf8'),
    filename: 'watch-language-inventory.csv',
    datasetName: 'Watch Language Inventory',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: inventory.dataset.id,
  });

  const oakBoards = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Oak Boards',
  }).find((entity) => entity.identityKey === 'p 1');
  const oakPremium = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Oak Boards Premium',
  }).find((entity) => entity.identityKey === 'p 2');
  assert(oakBoards && oakPremium, 'Expected both projected products.');

  const ruleCountBefore = watchStore.listRules({
    accountId: accountA,
    limit: 500,
  }).length;

  const stockDraft = await watchDraftService.propose({
    accountId: accountA,
    instruction: 'Warn me when Oak Boards stock drops below 5.',
    allowLlmParsing: false,
  });

  assert(
    stockDraft.status === 'PROPOSED' &&
      stockDraft.parserSource === 'DETERMINISTIC' &&
      stockDraft.condition?.kind === 'ENTITY_NUMERIC_THRESHOLD' &&
      stockDraft.condition.entityId === oakBoards.id &&
      stockDraft.condition.predicate === 'CURRENT_STOCK' &&
      stockDraft.condition.operator === 'LT' &&
      stockDraft.condition.threshold === 5,
    'Common stock wording must create an exact deterministic watch preview.'
  );

  assert(
    watchStore.listRules({ accountId: accountA, limit: 500 }).length ===
      ruleCountBefore,
    'Proposing a watch must not create an active WatchRule.'
  );

  const savedStock = watchDraftService.save({
    accountId: accountA,
    draftId: stockDraft.id,
  });
  const stockRule = watchStore.requireRule(
    accountA,
    savedStock.ruleId
  );

  assert(
    savedStock.draft.status === 'SAVED' &&
      stockRule.origin === 'NATURAL_LANGUAGE' &&
      stockRule.status === 'ACTIVE' &&
      stockRule.evaluationMode === 'INTERVAL' &&
      stockRule.intervalMinutes === 60,
    'Explicit save must create the active natural-language watch rule.'
  );

  const stockEvaluation = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: stockRule.id,
  });
  assert(
    stockEvaluation.evaluation.conditionMatched === true &&
      stockEvaluation.evaluation.observedValue === 4,
    'Saved stock watch must execute through the deterministic evaluator.'
  );

  const ambiguous = await watchDraftService.propose({
    accountId: accountA,
    instruction: 'Warn me when Oak stock drops below 5.',
    allowLlmParsing: false,
  });

  assert(
    ambiguous.status === 'NEEDS_INPUT' &&
      (ambiguous.candidates?.length || 0) === 2 &&
      ambiguous.candidates?.some(
        (candidate) => candidate.entityId === oakBoards.id
      ) &&
      ambiguous.candidates?.some(
        (candidate) => candidate.entityId === oakPremium.id
      ),
    'Ambiguous entity wording must return candidates instead of guessing.'
  );

  const refined = watchDraftService.selectTarget({
    accountId: accountA,
    draftId: ambiguous.id,
    candidateKey: oakBoards.id,
  });
  assert(
    refined.status === 'PROPOSED' &&
      refined.condition?.kind === 'ENTITY_NUMERIC_THRESHOLD' &&
      refined.condition.entityId === oakBoards.id,
    'Explicit target selection must turn an ambiguous draft into a validated proposal.'
  );

  const ordersCsv = [
    'order_id,customer,balance_due,status',
    'O-10,Acme,300000,OPEN',
    'O-11,Beta,250000,OPEN',
  ].join('\n');

  const orders = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(ordersCsv, 'utf8'),
    filename: 'watch-language-orders.csv',
    datasetName: 'Watch Language Orders',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: orders.dataset.id,
  });

  const outstandingDraft = await watchDraftService.propose({
    accountId: accountA,
    instruction: 'Tell me if unpaid invoices exceed NPR 500,000.',
    allowLlmParsing: false,
  });

  assert(
    outstandingDraft.status === 'PROPOSED' &&
      outstandingDraft.condition?.kind === 'DATASET_AGGREGATE_THRESHOLD' &&
      outstandingDraft.condition.datasetId === orders.dataset.id &&
      outstandingDraft.condition.aggregate.operator === 'SUM' &&
      outstandingDraft.condition.aggregate.column === 'balance_due' &&
      outstandingDraft.condition.operator === 'GT' &&
      outstandingDraft.condition.threshold === 500000,
    'Unpaid/outstanding language must resolve to one validated aggregate source when unambiguous.'
  );

  const secondOrdersCsv = [
    'invoice_id,client,outstanding_balance,status',
    'I-1,Gamma,90000,OPEN',
  ].join('\n');
  const secondOrders = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(secondOrdersCsv, 'utf8'),
    filename: 'watch-language-invoices.csv',
    datasetName: 'Watch Language Invoices',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: secondOrders.dataset.id,
  });

  const ambiguousSource = await watchDraftService.propose({
    accountId: accountA,
    instruction: 'Tell me if unpaid invoices exceed NPR 500,000.',
    allowLlmParsing: false,
  });

  assert(
    ambiguousSource.status === 'NEEDS_INPUT' &&
      (ambiguousSource.candidates?.length || 0) === 2,
    'Multiple outstanding datasets must require explicit source selection.'
  );

  const ordersCandidate = ambiguousSource.candidates?.find(
    (candidate) => candidate.datasetId === orders.dataset.id
  );
  assert(ordersCandidate, 'Expected original orders source candidate.');

  const sourceRefined = watchDraftService.selectTarget({
    accountId: accountA,
    draftId: ambiguousSource.id,
    candidateKey: ordersCandidate.key,
  });

  assert(
    sourceRefined.status === 'PROPOSED' &&
      sourceRefined.condition?.kind === 'DATASET_AGGREGATE_THRESHOLD' &&
      sourceRefined.condition.datasetId === orders.dataset.id &&
      sourceRefined.condition.aggregate.column === 'balance_due',
    'Explicit source selection must create the intended deterministic aggregate condition.'
  );

  const cancelDraft = await watchDraftService.propose({
    accountId: accountA,
    instruction: 'Warn me when order O-10 balance exceeds 200k.',
    allowLlmParsing: false,
  });
  assert(cancelDraft.status === 'PROPOSED', 'Expected order balance draft.');

  const cancelled = watchDraftService.cancel({
    accountId: accountA,
    draftId: cancelDraft.id,
  });
  assert(cancelled.status === 'CANCELLED', 'Draft cancellation must persist.');

  let cancelledSaveBlocked = false;
  try {
    watchDraftService.save({
      accountId: accountA,
      draftId: cancelDraft.id,
    });
  } catch (error: any) {
    cancelledSaveBlocked =
      error?.code === 'WATCH_DRAFT_NOT_SAVABLE';
  }
  assert(
    cancelledSaveBlocked,
    'Cancelled watch drafts must never become live rules.'
  );

  const draftCountBeforeUnsupported = watchStore.listDrafts({
    accountId: accountA,
    limit: 500,
  }).length;
  let unsupportedBlocked = false;
  try {
    await watchDraftService.propose({
      accountId: accountA,
      instruction: 'Watch everything and tell me if something feels wrong.',
      allowLlmParsing: false,
    });
  } catch (error) {
    unsupportedBlocked =
      error instanceof WatchDraftError &&
      error.code === 'WATCH_LANGUAGE_UNSUPPORTED';
  }
  assert(
    unsupportedBlocked &&
      watchStore.listDrafts({
        accountId: accountA,
        limit: 500,
      }).length === draftCountBeforeUnsupported,
    'Unsupported deterministic language must save no draft or rule.'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/watch', watchRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 5C HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Phase 5C Watch A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Phase 5C Watch B',
      accountId: accountB,
      environment: 'test',
    });

    const httpDraftResponse = await fetch(
      baseUrl + '/api/watch/drafts/propose',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Warn me when order O-10 balance exceeds 200k.',
          allowLlmParsing: false,
        }),
      }
    );
    assert(
      httpDraftResponse.status === 201,
      'Natural-language watch draft endpoint failed.'
    );
    const httpDraftBody = await httpDraftResponse.json();
    assert(
      httpDraftBody.draft?.status === 'PROPOSED' &&
        httpDraftBody.draft?.condition?.kind ===
          'ENTITY_NUMERIC_THRESHOLD',
      'HTTP proposal must return a preview rather than directly creating a rule.'
    );

    const rulesBeforeHttpSave = watchStore.listRules({
      accountId: accountA,
      limit: 500,
    }).length;

    const httpSaveResponse = await fetch(
      baseUrl +
        '/api/watch/drafts/' +
        httpDraftBody.draft.id +
        '/save',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      httpSaveResponse.status === 201,
      'Explicit watch save endpoint failed.'
    );
    const httpSaveBody = await httpSaveResponse.json();
    assert(
      httpSaveBody.draft?.status === 'SAVED' &&
        httpSaveBody.rule?.origin === 'NATURAL_LANGUAGE' &&
        watchStore.listRules({
          accountId: accountA,
          limit: 500,
        }).length ===
          rulesBeforeHttpSave + 1,
      'Only explicit save should create the active rule.'
    );

    const foreignDraft = await fetch(
      baseUrl +
        '/api/watch/drafts/' +
        httpDraftBody.draft.id,
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignDraft.status === 404,
      'Foreign account must not inspect another account watch draft.'
    );

    const foreignSave = await fetch(
      baseUrl +
        '/api/watch/drafts/' +
        refined.id +
        '/save',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignSave.status === 404,
      'Foreign account must not save another account watch draft.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_5C_WATCH_LANGUAGE_CHECK_PASSED');
  console.log(
    'Preview-first natural-language watches, deterministic parsing, conservative entity/source resolution, ambiguity selection, explicit save, cancellation, unsupported-language refusal, rule evaluation reuse, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_5C_WATCH_LANGUAGE_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
