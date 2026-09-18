import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { watchEvaluator } from '../server/watch/watchEvaluator.js';
import { watchService } from '../server/watch/watchService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type CaseResult = {
  name: string;
  expected: boolean;
  actual: boolean;
  alertCreated: boolean;
};

async function main() {
  const accountId = 'acc_watch_phase5_quality';

  const csv = [
    'order_id,customer_name,due_date,balance_due,status,product_id,product_name,current_stock,reorder_level',
    'Q-1,Acme,2099-03-10,200000,OPEN,PQ-1,Quality Boards,8,5',
    'Q-2,Beta,2099-03-20,150000,OPEN,,,,',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'watch-quality.csv',
    datasetName: 'Watch Quality Corpus',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId,
    datasetId: imported.dataset.id,
  });

  const product = companyKnowledgeStore.listEntities({
    accountId,
    type: 'PRODUCT',
    search: 'Quality Boards',
  })[0];
  const order = companyKnowledgeStore.listEntities({
    accountId,
    type: 'ORDER',
    search: 'Q-1',
  })[0];

  assert(product && order, 'Quality corpus projection failed.');

  const tableName = imported.version.tables[0].name;
  const cases: Array<{
    name: string;
    expected: boolean;
    evaluatedAt: number;
    ruleId: string;
  }> = [];

  const stockFalse = watchService.createRule({
    accountId,
    name: 'Stock below five',
    condition: {
      kind: 'ENTITY_NUMERIC_THRESHOLD',
      entityId: product.id,
      predicate: 'CURRENT_STOCK',
      operator: 'LT',
      threshold: 5,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'entity threshold negative',
    expected: false,
    evaluatedAt: Date.parse('2099-03-01T00:00:00Z'),
    ruleId: stockFalse.id,
  });

  const stockTrue = watchService.createRule({
    accountId,
    name: 'Stock below ten',
    condition: {
      kind: 'ENTITY_NUMERIC_THRESHOLD',
      entityId: product.id,
      predicate: 'CURRENT_STOCK',
      operator: 'LT',
      threshold: 10,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'entity threshold positive',
    expected: true,
    evaluatedAt: Date.parse('2099-03-01T00:00:00Z'),
    ruleId: stockTrue.id,
  });

  const aggregateFalse = watchService.createRule({
    accountId,
    name: 'Outstanding above 500k',
    condition: {
      kind: 'DATASET_AGGREGATE_THRESHOLD',
      datasetId: imported.dataset.id,
      tableName,
      aggregate: { operator: 'SUM', column: 'balance_due' },
      operator: 'GT',
      threshold: 500000,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'aggregate threshold negative',
    expected: false,
    evaluatedAt: Date.parse('2099-03-01T00:00:00Z'),
    ruleId: aggregateFalse.id,
  });

  const aggregateTrue = watchService.createRule({
    accountId,
    name: 'Outstanding above 300k',
    condition: {
      kind: 'DATASET_AGGREGATE_THRESHOLD',
      datasetId: imported.dataset.id,
      tableName,
      aggregate: { operator: 'SUM', column: 'balance_due' },
      operator: 'GT',
      threshold: 300000,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'aggregate threshold positive',
    expected: true,
    evaluatedAt: Date.parse('2099-03-01T00:00:00Z'),
    ruleId: aggregateTrue.id,
  });

  const dateFalse = watchService.createRule({
    accountId,
    name: 'Three days before Q-1 due date',
    condition: {
      kind: 'ENTITY_DATE_WINDOW',
      entityId: order.id,
      predicate: 'DUE_DATE',
      daysBefore: 3,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'date window negative',
    expected: false,
    evaluatedAt: Date.parse('2099-03-05T12:00:00Z'),
    ruleId: dateFalse.id,
  });

  const dateTrue = watchService.createRule({
    accountId,
    name: 'Three days before Q-1 due date second',
    condition: {
      kind: 'ENTITY_DATE_WINDOW',
      entityId: order.id,
      predicate: 'DUE_DATE',
      daysBefore: 3,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'date window positive',
    expected: true,
    evaluatedAt: Date.parse('2099-03-08T12:00:00Z'),
    ruleId: dateTrue.id,
  });

  const triggerAt = Date.parse('2099-04-01T10:00:00Z');
  const timeFalse = watchService.createRule({
    accountId,
    name: 'Clock reminder negative',
    condition: {
      kind: 'TIME_REACHED',
      triggerAt,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'time reminder negative',
    expected: false,
    evaluatedAt: triggerAt - 1,
    ruleId: timeFalse.id,
  });

  const timeTrue = watchService.createRule({
    accountId,
    name: 'Clock reminder positive',
    condition: {
      kind: 'TIME_REACHED',
      triggerAt,
    },
    evaluationMode: 'MANUAL',
  });
  cases.push({
    name: 'time reminder positive',
    expected: true,
    evaluatedAt: triggerAt,
    ruleId: timeTrue.id,
  });

  const results: CaseResult[] = cases.map((testCase) => {
    const result = watchEvaluator.evaluate({
      accountId,
      watchRuleId: testCase.ruleId,
      evaluatedAt: testCase.evaluatedAt,
    });

    return {
      name: testCase.name,
      expected: testCase.expected,
      actual: result.evaluation.conditionMatched === true,
      alertCreated: Boolean(result.alert),
    };
  });

  for (const result of results) {
    assert(
      result.actual === result.expected,
      result.name + ' produced the wrong condition classification.'
    );
    assert(
      result.alertCreated === result.expected,
      result.name + ' produced an incorrect alert-creation decision.'
    );
  }

  const tp = results.filter((item) => item.expected && item.actual).length;
  const tn = results.filter((item) => !item.expected && !item.actual).length;
  const fp = results.filter((item) => !item.expected && item.actual).length;
  const fn = results.filter((item) => item.expected && !item.actual).length;
  const falseAlertRate = fp / Math.max(1, fp + tn);
  const missedAlertRate = fn / Math.max(1, fn + tp);

  assert(fp === 0, 'Known-negative Watch cases must produce zero false alerts.');
  assert(fn === 0, 'Known-positive Watch cases must produce zero missed alerts.');

  console.log(
    JSON.stringify(
      {
        cases: results.length,
        truePositive: tp,
        trueNegative: tn,
        falsePositive: fp,
        falseNegative: fn,
        falseAlertRate,
        missedAlertRate,
      },
      null,
      2
    )
  );
  console.log('PHASE_5_WATCH_QUALITY_CHECK_PASSED');
}

main().catch((error) => {
  console.error('PHASE_5_WATCH_QUALITY_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
