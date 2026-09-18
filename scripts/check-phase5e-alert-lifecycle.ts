import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { watchEvaluator } from '../server/watch/watchEvaluator.js';
import { watchService } from '../server/watch/watchService.js';
import { watchStore } from '../server/watch/watchStore.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function confirmedRef(version: string, text: string) {
  return {
    sourceType: 'USER' as const,
    sourceId: 'confirmed-company-state',
    sourceVersionId: version,
    sourceVersionLabel: version,
    sourceName: 'Confirmed business action',
    excerpt: text,
  };
}

async function main() {
  const accountId = 'acc_watch_phase5e';
  const base = Date.parse('2026-09-18T20:00:00Z');

  const csv = [
    'product_id,product_name,current_stock,reorder_level',
    'P-90,Cedar Boards,3,5',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'watch-alert-lifecycle.csv',
    datasetName: 'Watch Alert Lifecycle',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId,
    datasetId: imported.dataset.id,
  });

  const cedar = companyKnowledgeStore.listEntities({
    accountId,
    type: 'PRODUCT',
    search: 'Cedar Boards',
  })[0];
  assert(cedar, 'Expected Cedar Boards product.');

  const rule = watchService.createRule({
    accountId,
    name: 'Cedar low stock',
    condition: {
      kind: 'ENTITY_NUMERIC_THRESHOLD',
      entityId: cedar.id,
      predicate: 'CURRENT_STOCK',
      operator: 'LT',
      threshold: 5,
    },
    evaluationMode: 'MANUAL',
  });

  const first = watchEvaluator.evaluate({
    accountId,
    watchRuleId: rule.id,
    evaluatedAt: base,
  });
  assert(
    first.alert?.status === 'OPEN' &&
      first.alert.occurrenceCount === 1,
    'Initial TRUE condition should create one OPEN episode.'
  );

  const snoozedUntil = base + 10_000;
  const snoozed = watchStore.updateAlertStatus({
    accountId,
    alertId: first.alert.id,
    status: 'SNOOZED',
    snoozedUntil,
    at: base + 1_000,
  });
  assert(
    snoozed.status === 'SNOOZED' &&
      snoozed.snoozedUntil === snoozedUntil,
    'Snooze should persist until the requested time.'
  );

  const beforeExpiry = watchEvaluator.evaluate({
    accountId,
    watchRuleId: rule.id,
    evaluatedAt: base + 5_000,
  });
  assert(
    beforeExpiry.alert?.id === first.alert.id &&
      beforeExpiry.alert.status === 'SNOOZED' &&
      beforeExpiry.alert.occurrenceCount === 2,
    'A repeated trigger before snooze expiry must stay snoozed in the same episode.'
  );

  const afterExpiry = watchEvaluator.evaluate({
    accountId,
    watchRuleId: rule.id,
    evaluatedAt: base + 11_000,
  });
  assert(
    afterExpiry.alert?.id === first.alert.id &&
      afterExpiry.alert.status === 'OPEN' &&
      afterExpiry.alert.snoozedUntil === undefined &&
      afterExpiry.alert.occurrenceCount === 3,
    'An expired snooze must reopen the same still-true alert episode.'
  );

  const manuallyResolved = watchStore.updateAlertStatus({
    accountId,
    alertId: first.alert.id,
    status: 'RESOLVED',
    resolutionReason: 'USER_RESOLVED',
    at: base + 12_000,
  });
  assert(
    manuallyResolved.status === 'RESOLVED' &&
      manuallyResolved.resolutionReason === 'USER_RESOLVED',
    'Manual resolution reason must be preserved.'
  );

  const stillTrueAfterManualResolution = watchEvaluator.evaluate({
    accountId,
    watchRuleId: rule.id,
    evaluatedAt: base + 13_000,
  });
  assert(
    stillTrueAfterManualResolution.evaluation.conditionMatched === true &&
      stillTrueAfterManualResolution.alert === undefined &&
      watchStore.listAlerts({
        accountId,
        watchRuleId: rule.id,
        limit: 20,
      }).length === 1,
    'Manually resolved alert must stay quiet while the same condition remains continuously TRUE.'
  );

  companyKnowledgeStore.recordClaim({
    accountId,
    subjectEntityId: cedar.id,
    predicate: 'CURRENT_STOCK',
    value: 8,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: confirmedRef(
      'cedar-stock-8',
      'Inventory received; Cedar Boards stock is 8.'
    ),
    observedAt: base + 20_000,
    validFrom: base + 20_000,
  });

  const cleared = watchEvaluator.evaluate({
    accountId,
    watchRuleId: rule.id,
    evaluatedAt: base + 21_000,
  });
  assert(
    cleared.evaluation.conditionMatched === false &&
      cleared.rule.currentState === 'FALSE' &&
      cleared.alert === undefined,
    'A manually resolved episode does not need a second auto-resolution when the condition later clears.'
  );

  companyKnowledgeStore.recordClaim({
    accountId,
    subjectEntityId: cedar.id,
    predicate: 'CURRENT_STOCK',
    value: 2,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: confirmedRef(
      'cedar-stock-2',
      'Stock correction set Cedar Boards to 2.'
    ),
    observedAt: base + 30_000,
    validFrom: base + 30_000,
  });

  const secondEpisode = watchEvaluator.evaluate({
    accountId,
    watchRuleId: rule.id,
    evaluatedAt: base + 31_000,
  });
  assert(
    secondEpisode.alert?.status === 'OPEN' &&
      secondEpisode.alert.id !== first.alert.id &&
      secondEpisode.alert.occurrenceCount === 1,
    'After a real FALSE state, a later TRUE condition must create a new episode.'
  );

  companyKnowledgeStore.recordClaim({
    accountId,
    subjectEntityId: cedar.id,
    predicate: 'CURRENT_STOCK',
    value: 7,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: confirmedRef(
      'cedar-stock-7',
      'Stock adjustment set Cedar Boards to 7.'
    ),
    observedAt: base + 40_000,
    validFrom: base + 40_000,
  });

  const autoResolved = watchEvaluator.evaluate({
    accountId,
    watchRuleId: rule.id,
    evaluatedAt: base + 41_000,
  });
  assert(
    autoResolved.alert?.id === secondEpisode.alert.id &&
      autoResolved.alert.status === 'RESOLVED' &&
      autoResolved.alert.resolutionReason === 'CONDITION_CLEARED',
    'TRUE→FALSE must auto-resolve the active episode with CONDITION_CLEARED reason.'
  );

  const episodes = watchStore.listAlerts({
    accountId,
    watchRuleId: rule.id,
    limit: 20,
  });
  assert(
    episodes.length === 2 &&
      episodes.some(
        (alert) =>
          alert.id === first.alert!.id &&
          alert.resolutionReason === 'USER_RESOLVED'
      ) &&
      episodes.some(
        (alert) =>
          alert.id === secondEpisode.alert!.id &&
          alert.resolutionReason === 'CONDITION_CLEARED'
      ),
    'Alert history must preserve manual and condition-cleared episodes distinctly.'
  );

  console.log('PHASE_5E_ALERT_LIFECYCLE_CHECK_PASSED');
  console.log(
    'Snooze persistence/expiry, same-episode reopening, manual-resolution suppression, false-state reset, new trigger episodes, and condition-cleared resolution reasons are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_5E_ALERT_LIFECYCLE_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
