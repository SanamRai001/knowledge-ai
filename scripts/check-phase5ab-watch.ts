import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { watchEvaluator } from '../server/watch/watchEvaluator.js';
import { watchRouter } from '../server/watch/watchRouter.js';
import { watchService } from '../server/watch/watchService.js';
import { watchStore } from '../server/watch/watchStore.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function userStateRef(version: string, instruction: string) {
  return {
    sourceType: 'USER' as const,
    sourceId: 'confirmed-company-state',
    sourceVersionId: version,
    sourceVersionLabel: version,
    sourceName: 'Confirmed business action',
    excerpt: instruction,
  };
}

async function main() {
  const accountA = 'acc_watch_phase5_a';
  const accountB = 'acc_watch_phase5_b';
  const baseTime = Date.parse('2026-09-18T12:00:00Z');

  const inventoryCsv = [
    'product_id,product_name,current_stock,reorder_level',
    'P-1,Oak Boards,4,5',
  ].join('\n');

  const inventory = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(inventoryCsv, 'utf8'),
    filename: 'watch-inventory.csv',
    datasetName: 'Watch Inventory',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: inventory.dataset.id,
  });

  const oak = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Oak Boards',
  })[0];
  assert(oak, 'Inventory projection did not create the watched product.');

  const stockRule = watchService.createRule({
    accountId: accountA,
    name: 'Oak Boards below safe stock',
    description: 'Warn when current stock is at or below 5.',
    condition: {
      kind: 'ENTITY_NUMERIC_THRESHOLD',
      entityId: oak.id,
      predicate: 'CURRENT_STOCK',
      operator: 'LTE',
      threshold: 5,
    },
    origin: 'MANUAL',
    evaluationMode: 'INTERVAL',
    intervalMinutes: 60,
  });

  assert(
    stockRule.status === 'ACTIVE' &&
      stockRule.currentState === 'UNKNOWN' &&
      stockRule.version === 1,
    'New watch rule should start ACTIVE with UNKNOWN condition state.'
  );

  const first = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: stockRule.id,
    evaluatedAt: baseTime,
  });

  assert(
    first.evaluation.status === 'COMPLETED' &&
      first.evaluation.conditionMatched === true &&
      first.evaluation.observedValue === 4 &&
      first.rule.currentState === 'TRUE' &&
      first.alert?.status === 'OPEN' &&
      first.alert.occurrenceCount === 1,
    'First true evaluation must create one OPEN alert episode.'
  );
  assert(
    first.evaluation.evidence?.sourceType === 'ENTITY' &&
      first.evaluation.evidence.entityId === oak.id &&
      first.evaluation.evidence.effectiveValue === 4 &&
      first.evaluation.evidence.effectiveClaimId.length > 0,
    'Entity watch evidence must point to the effective claim used.'
  );

  const second = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: stockRule.id,
    evaluatedAt: baseTime + 60_000,
  });

  assert(
    second.alert?.id === first.alert?.id &&
      second.alert?.occurrenceCount === 2 &&
      watchStore.listAlerts({
        accountId: accountA,
        watchRuleId: stockRule.id,
        limit: 20,
      }).length === 1,
    'Repeated TRUE evaluations must update one alert episode instead of creating duplicates.'
  );

  const acknowledged = watchStore.updateAlertStatus({
    accountId: accountA,
    alertId: first.alert!.id,
    status: 'ACKNOWLEDGED',
    at: baseTime + 70_000,
  });
  assert(
    acknowledged.status === 'ACKNOWLEDGED' &&
      acknowledged.acknowledgedAt === baseTime + 70_000,
    'Alert acknowledgement must be persisted.'
  );

  const third = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: stockRule.id,
    evaluatedAt: baseTime + 120_000,
  });
  assert(
    third.alert?.id === first.alert?.id &&
      third.alert?.status === 'ACKNOWLEDGED' &&
      third.alert?.occurrenceCount === 3,
    'Repeated triggers must preserve ACKNOWLEDGED lifecycle state.'
  );

  const stockTen = companyKnowledgeStore.recordClaim({
    accountId: accountA,
    subjectEntityId: oak.id,
    predicate: 'CURRENT_STOCK',
    value: 10,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: userStateRef(
      'watch-stock-10',
      'Received inventory; stock is now 10.'
    ),
    observedAt: baseTime + 180_000,
    validFrom: baseTime + 180_000,
  });

  const falseResult = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: stockRule.id,
    evaluatedAt: baseTime + 181_000,
  });

  assert(
    falseResult.evaluation.conditionMatched === false &&
      falseResult.rule.currentState === 'FALSE' &&
      falseResult.alert?.id === first.alert?.id &&
      falseResult.alert?.status === 'RESOLVED',
    'TRUE→FALSE must resolve the active alert episode.'
  );

  const stockThree = companyKnowledgeStore.recordClaim({
    accountId: accountA,
    subjectEntityId: oak.id,
    predicate: 'CURRENT_STOCK',
    value: 3,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: userStateRef(
      'watch-stock-3',
      'Stock adjustment set Oak Boards to 3.'
    ),
    observedAt: baseTime + 240_000,
    validFrom: baseTime + 240_000,
  });

  const newEpisode = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: stockRule.id,
    evaluatedAt: baseTime + 241_000,
  });

  assert(
    newEpisode.evaluation.conditionMatched === true &&
      newEpisode.alert?.status === 'OPEN' &&
      newEpisode.alert.id !== first.alert?.id &&
      newEpisode.alert.occurrenceCount === 1,
    'A later FALSE→TRUE transition must create a new alert episode.'
  );
  assert(
    newEpisode.evaluation.evidence?.sourceType === 'ENTITY' &&
      newEpisode.evaluation.evidence.effectiveClaimId === stockThree.id &&
      newEpisode.evaluation.evidence.authorityLevel === 'USER_CONFIRMED',
    'Watch evaluation must honor higher-authority confirmed company state.'
  );

  const snoozed = watchStore.updateAlertStatus({
    accountId: accountA,
    alertId: newEpisode.alert.id,
    status: 'SNOOZED',
    snoozedUntil: baseTime + 3_600_000,
    at: baseTime + 250_000,
  });
  assert(
    snoozed.status === 'SNOOZED' &&
      snoozed.snoozedUntil === baseTime + 3_600_000,
    'Alert snooze state must persist.'
  );

  const snoozedRepeat = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: stockRule.id,
    evaluatedAt: baseTime + 300_000,
  });
  assert(
    snoozedRepeat.alert?.id === newEpisode.alert.id &&
      snoozedRepeat.alert.status === 'SNOOZED' &&
      snoozedRepeat.alert.occurrenceCount === 2,
    'Repeated trigger while snoozed must update the same episode without unsnoozing it.'
  );

  assert(
    stockTen.id !== stockThree.id,
    'Confirmed state claims used by watch history must remain distinct source versions.'
  );

  const ordersCsv = [
    'order_id,customer,balance_due,status',
    'O-10,Acme,300000,OPEN',
    'O-11,Beta,250000,OPEN',
  ].join('\n');

  const orders = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(ordersCsv, 'utf8'),
    filename: 'watch-orders.csv',
    datasetName: 'Watch Orders',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: orders.dataset.id,
  });

  const ordersTable = orders.version.tables[0];
  const aggregateRule = watchService.createRule({
    accountId: accountA,
    name: 'Outstanding total above NPR 500k',
    condition: {
      kind: 'DATASET_AGGREGATE_THRESHOLD',
      datasetId: orders.dataset.id,
      tableName: ordersTable.name,
      aggregate: {
        operator: 'SUM',
        column: 'balance_due',
      },
      operator: 'GT',
      threshold: 500000,
    },
    origin: 'MANUAL',
    evaluationMode: 'MANUAL',
  });

  const aggregateTrue = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: aggregateRule.id,
    evaluatedAt: baseTime + 400_000,
  });

  assert(
    aggregateTrue.evaluation.conditionMatched === true &&
      aggregateTrue.evaluation.observedValue === 550000 &&
      aggregateTrue.alert?.status === 'OPEN' &&
      aggregateTrue.evaluation.evidence?.sourceType === 'DATASET' &&
      aggregateTrue.evaluation.evidence.sourceSha256 ===
        orders.version.source.sha256,
    'Dataset aggregate watch must trigger from deterministic current-version analytics with source provenance.'
  );

  const order10 = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-10',
  })[0];
  assert(order10, 'Orders projection did not create O-10.');

  const confirmedBalance = companyKnowledgeStore.recordClaim({
    accountId: accountA,
    subjectEntityId: order10.id,
    predicate: 'BALANCE_DUE',
    value: 100000,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: userStateRef(
      'watch-order-payment',
      'Confirmed payment reduced O-10 balance to 100000.'
    ),
    observedAt: baseTime + 450_000,
    validFrom: baseTime + 450_000,
  });

  const aggregateFalse = watchEvaluator.evaluate({
    accountId: accountA,
    watchRuleId: aggregateRule.id,
    evaluatedAt: baseTime + 451_000,
  });

  assert(
    aggregateFalse.evaluation.conditionMatched === false &&
      aggregateFalse.evaluation.observedValue === 350000 &&
      aggregateFalse.alert?.status === 'RESOLVED',
    'Aggregate watch must resolve when confirmed company state makes the condition false.'
  );

  assert(
    aggregateFalse.evaluation.evidence?.sourceType === 'DATASET' &&
      aggregateFalse.evaluation.evidence.companyStateOverlay?.applied === true &&
      aggregateFalse.evaluation.evidence.companyStateOverlay.claimIds.includes(
        confirmedBalance.id
      ),
    'Dataset watch evidence must disclose confirmed-state overlay provenance.'
  );

  assert(
    orders.version.tables[0].rows[0][2] === 300000,
    'Watch evaluation must not mutate the original imported dataset.'
  );

  const paused = watchService.setStatus({
    accountId: accountA,
    watchRuleId: aggregateRule.id,
    status: 'PAUSED',
  });
  assert(paused.status === 'PAUSED', 'Watch pause must persist.');

  let pausedBlocked = false;
  try {
    watchEvaluator.evaluate({
      accountId: accountA,
      watchRuleId: aggregateRule.id,
      evaluatedAt: baseTime + 500_000,
    });
  } catch (error: any) {
    pausedBlocked = error?.code === 'WATCH_NOT_ACTIVE';
  }
  assert(pausedBlocked, 'Paused watches must not evaluate.');

  const resumed = watchService.setStatus({
    accountId: accountA,
    watchRuleId: aggregateRule.id,
    status: 'ACTIVE',
  });
  assert(
    resumed.status === 'ACTIVE' &&
      resumed.version > paused.version,
    'Resume must reactivate the watch and advance its rule version.'
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
      throw new Error('Could not resolve Phase 5 HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Phase 5 Watch A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Phase 5 Watch B',
      accountId: accountB,
      environment: 'test',
    });

    const ownRule = await fetch(
      baseUrl + '/api/watch/rules/' + stockRule.id,
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      ownRule.status === 200,
      'Owning account must be able to inspect its watch rule.'
    );
    const ownRuleBody = await ownRule.json();
    assert(
      ownRuleBody.rule?.id === stockRule.id &&
        ownRuleBody.evaluations?.length >= 5 &&
        ownRuleBody.alerts?.length === 2,
      'Watch detail API must expose rule, evaluation history, and alert episodes.'
    );

    const foreignRule = await fetch(
      baseUrl + '/api/watch/rules/' + stockRule.id,
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignRule.status === 404,
      'Foreign accounts must not inspect another account watch.'
    );

    const foreignEvaluate = await fetch(
      baseUrl + '/api/watch/rules/' + stockRule.id + '/evaluate',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignEvaluate.status === 404,
      'Foreign accounts must not evaluate another account watch.'
    );

    const listAlerts = await fetch(
      baseUrl + '/api/watch/alerts?watchRuleId=' + stockRule.id,
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      listAlerts.status === 200,
      'Watch alerts endpoint failed for owning account.'
    );
    const listAlertsBody = await listAlerts.json();
    assert(
      listAlertsBody.alerts?.length === 2,
      'Alert endpoint must preserve separate trigger episodes.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_5AB_WATCH_CHECK_PASSED');
  console.log(
    'Persistent watch rules, deterministic entity/dataset thresholds, effective-state provenance, alert episode deduplication, acknowledgement/snooze/resolution, false→true re-triggering, pause/resume, immutable source data, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_5AB_WATCH_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
