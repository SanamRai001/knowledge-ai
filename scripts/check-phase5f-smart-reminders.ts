import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { watchDraftService, WatchDraftError } from '../server/watch/watchDraftService.js';
import { watchEvaluator } from '../server/watch/watchEvaluator.js';
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
  const accountId = 'acc_watch_phase5f_reminders';

  const ordersCsv = [
    'order_id,customer_name,due_date,balance_due,status',
    'O-200,Acme,2099-01-01,25000,OPEN',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId,
    buffer: Buffer.from(ordersCsv, 'utf8'),
    filename: 'watch-reminders-orders.csv',
    datasetName: 'Watch Reminder Orders',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId,
    datasetId: imported.dataset.id,
  });

  const order = companyKnowledgeStore.listEntities({
    accountId,
    type: 'ORDER',
    search: 'O-200',
  })[0];
  assert(order, 'Expected O-200 to be projected into living knowledge.');

  const dateDraft = await watchDraftService.propose({
    accountId,
    instruction: 'Remind me 3 days before order O-200 is due.',
    allowLlmParsing: false,
  });

  assert(
    dateDraft.status === 'PROPOSED' &&
      dateDraft.parserSource === 'DETERMINISTIC' &&
      dateDraft.condition?.kind === 'ENTITY_DATE_WINDOW' &&
      dateDraft.condition.entityId === order.id &&
      dateDraft.condition.predicate === 'DUE_DATE' &&
      dateDraft.condition.daysBefore === 3,
    'Source-relative due-date wording must produce a deterministic preview.'
  );

  const dateSaved = watchDraftService.save({
    accountId,
    draftId: dateDraft.id,
  });
  const dateRule = watchStore.requireRule(accountId, dateSaved.ruleId);

  assert(
    dateRule.status === 'ACTIVE' &&
      dateRule.origin === 'NATURAL_LANGUAGE' &&
      dateRule.evaluationMode === 'INTERVAL' &&
      dateRule.intervalMinutes === 60,
    'Saved source-relative reminder must become an interval WatchRule.'
  );

  const beforeWindow = watchEvaluator.evaluate({
    accountId,
    watchRuleId: dateRule.id,
    evaluatedAt: Date.parse('2098-12-28T12:00:00Z'),
  });
  assert(
    beforeWindow.evaluation.conditionMatched === false &&
      beforeWindow.evaluation.observedValue === 4 &&
      beforeWindow.alert === undefined,
    'Date reminder must remain quiet before its configured window.'
  );

  const insideWindow = watchEvaluator.evaluate({
    accountId,
    watchRuleId: dateRule.id,
    evaluatedAt: Date.parse('2098-12-29T12:00:00Z'),
  });
  assert(
    insideWindow.evaluation.conditionMatched === true &&
      insideWindow.evaluation.observedValue === 3 &&
      insideWindow.alert?.status === 'OPEN' &&
      insideWindow.evaluation.evidence?.sourceType === 'ENTITY_DATE' &&
      insideWindow.evaluation.evidence.entityId === order.id &&
      insideWindow.evaluation.evidence.dateValue === '2099-01-01',
    'Date reminder must trigger at the threshold with exact claim provenance.'
  );

  const movedDueDate = companyKnowledgeStore.recordClaim({
    accountId,
    subjectEntityId: order.id,
    predicate: 'DUE_DATE',
    value: '2099-01-10',
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: confirmedRef(
      'order-o200-due-2099-01-10',
      'Confirmed delivery date moved to 2099-01-10.'
    ),
    observedAt: Date.parse('2098-12-29T13:00:00Z'),
    validFrom: Date.parse('2098-12-29T13:00:00Z'),
  });

  const movedOutOfWindow = watchEvaluator.evaluate({
    accountId,
    watchRuleId: dateRule.id,
    evaluatedAt: Date.parse('2098-12-29T14:00:00Z'),
  });

  assert(
    movedOutOfWindow.evaluation.conditionMatched === false &&
      movedOutOfWindow.evaluation.observedValue === 12 &&
      movedOutOfWindow.alert?.status === 'RESOLVED' &&
      movedOutOfWindow.alert.resolutionReason === 'CONDITION_CLEARED' &&
      movedOutOfWindow.evaluation.evidence?.sourceType === 'ENTITY_DATE' &&
      movedOutOfWindow.evaluation.evidence.effectiveClaimId === movedDueDate.id &&
      movedOutOfWindow.evaluation.evidence.authorityLevel === 'USER_CONFIRMED',
    'Source-relative reminder must follow effective confirmed due-date changes and resolve stale alert episodes.'
  );

  assert(
    imported.version.tables[0].rows[0][2] === '2099-01-01',
    'Reminder evaluation must never rewrite the imported source date.'
  );

  const timestampText = '2099-02-03T10:15:00+05:45';
  const timeDraft = await watchDraftService.propose({
    accountId,
    instruction: 'Remind me at ' + timestampText + '.',
    allowLlmParsing: false,
  });

  assert(
    timeDraft.status === 'PROPOSED' &&
      timeDraft.condition?.kind === 'TIME_REACHED' &&
      timeDraft.condition.triggerAt === Date.parse(timestampText),
    'Explicit ISO timestamp reminder must create an exact deterministic preview.'
  );

  const timeSaved = watchDraftService.save({
    accountId,
    draftId: timeDraft.id,
  });
  const timeRule = watchStore.requireRule(accountId, timeSaved.ruleId);

  assert(
    timeRule.status === 'ACTIVE' &&
      timeRule.intervalMinutes === 5,
    'One-shot clock reminder must use the bounded five-minute evaluation cadence.'
  );

  const beforeTime = watchEvaluator.evaluate({
    accountId,
    watchRuleId: timeRule.id,
    evaluatedAt: Date.parse('2099-02-03T04:29:00Z'),
  });
  assert(
    beforeTime.evaluation.conditionMatched === false &&
      beforeTime.alert === undefined &&
      beforeTime.rule.status === 'ACTIVE',
    'Clock reminder must remain active and quiet before the trigger timestamp.'
  );

  const atTime = watchEvaluator.evaluate({
    accountId,
    watchRuleId: timeRule.id,
    evaluatedAt: Date.parse('2099-02-03T04:30:00Z'),
  });
  assert(
    atTime.evaluation.conditionMatched === true &&
      atTime.alert?.status === 'OPEN' &&
      atTime.evaluation.evidence?.sourceType === 'TIME' &&
      atTime.evaluation.evidence.triggerAt === Date.parse(timestampText) &&
      atTime.rule.status === 'PAUSED' &&
      atTime.rule.nextEvaluationAt === undefined,
    'One-shot clock reminder must trigger once and stop scheduling itself.'
  );

  let secondClockEvaluationBlocked = false;
  try {
    watchEvaluator.evaluate({
      accountId,
      watchRuleId: timeRule.id,
      evaluatedAt: Date.parse('2099-02-03T05:00:00Z'),
    });
  } catch (error: any) {
    secondClockEvaluationBlocked = error?.code === 'WATCH_NOT_ACTIVE';
  }
  assert(
    secondClockEvaluationBlocked,
    'Triggered one-shot reminder must not continue evaluating after it pauses itself.'
  );

  let vagueTimeRejected = false;
  try {
    await watchDraftService.propose({
      accountId,
      instruction: 'Remind me tomorrow morning.',
      allowLlmParsing: false,
    });
  } catch (error) {
    vagueTimeRejected =
      error instanceof WatchDraftError &&
      error.code === 'WATCH_LANGUAGE_UNSUPPORTED';
  }
  assert(
    vagueTimeRejected,
    'Vague clock language must not be converted into an invented timestamp by deterministic parsing.'
  );

  console.log('PHASE_5F_SMART_REMINDER_CHECK_PASSED');
  console.log(
    'Source-relative due-date reminders, authority-aware date changes, exact provenance, immutable source history, explicit timestamp reminders, one-shot completion, and vague-time refusal are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_5F_SMART_REMINDER_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
