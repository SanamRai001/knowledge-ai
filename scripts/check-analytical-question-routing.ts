import express from 'express';
import fs from 'fs';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { queryRouter } from '../server/querying/queryRouter.js';
import { unifiedQueryService } from '../server/querying/unifiedQueryService.js';
import { workspaceAccessService } from '../server/workspaceAccessService.js';
import { KnowledgeDocument } from '../src/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_query_route_a';
  const accountB = 'acc_query_route_b';

  const csv = [
    'order_id,order_date,product,customer,amount,balance_due',
    'O-1,2026-08-02,Chair,Acme,1000,0',
    'O-2,2026-08-10,Chair,Beta,500,200',
    'O-3,2026-08-22,Table,Gamma,700,0',
    'O-4,2026-09-03,Chair,Acme,1200,0',
    'O-5,2026-09-11,Chair,Delta,800,300',
    'O-6,2026-09-15,Table,Echo,400,100',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'orders.csv',
    datasetName: 'Orders',
  });

  const kb = workspaceAccessService.createKB(
    accountA,
    'Company Handbook',
    'Policies and operating rules'
  );
  const handbook: KnowledgeDocument = {
    id: 'doc_query_route_handbook',
    filename: 'handbook.pdf',
    fileType: 'application/pdf',
    fileSize: 1000,
    uploadTimestamp: Date.now(),
    processingStatus: 'processed',
    pageCount: 1,
    summary: 'Employee annual leave policy.',
    pages: [
      {
        pageNumber: 1,
        text: 'Annual Leave Policy: Full-time employees receive 24 paid annual-leave days per calendar year.',
      },
    ],
  };
  workspaceAccessService.addDocument(accountA, kb.id, handbook);

  const analyticsRoute = unifiedQueryService.chooseRoute({
    accountId: accountA,
    question: 'How much revenue did we make in September?',
    datasetId: imported.dataset.id,
    knowledgeBaseId: kb.id,
    now: new Date('2026-09-18T00:00:00Z'),
  });
  assert(
    analyticsRoute === 'DATASET_ANALYTICS',
    'Revenue question must route to structured analytics.'
  );

  const documentRoute = unifiedQueryService.chooseRoute({
    accountId: accountA,
    question: 'What does the handbook policy say about annual leave?',
    datasetId: imported.dataset.id,
    knowledgeBaseId: kb.id,
    now: new Date('2026-09-18T00:00:00Z'),
  });
  assert(
    documentRoute === 'DOCUMENT_KNOWLEDGE',
    'Policy question must route to document knowledge.'
  );

  const revenue = await unifiedQueryService.answer({
    accountId: accountA,
    question: 'How much revenue did we make in September?',
    datasetId: imported.dataset.id,
    knowledgeBaseId: kb.id,
    allowLlmPlanning: false,
    allowLlmExplanation: false,
    now: new Date('2026-09-18T00:00:00Z'),
  });
  assert(revenue.route === 'DATASET_ANALYTICS', 'Revenue answer route is wrong.');
  assert(revenue.planSource === 'DETERMINISTIC', 'Common revenue question should plan deterministically.');
  assert(
    revenue.result &&
      'rows' in revenue.result &&
      revenue.result.rows[0]?.revenue === 2400,
    'September revenue should be calculated as 2400.'
  );
  assert(
    revenue.result.provenance.datasetVersionId === imported.version.id,
    'Analytical answer must expose exact dataset version provenance.'
  );
  assert(
    revenue.result.provenance.sourceSha256 === imported.version.source.sha256,
    'Analytical answer must expose exact source hash provenance.'
  );
  assert(
    revenue.answer.includes('2,400'),
    'Authoritative deterministic answer should include computed revenue.'
  );

  const comparison = await unifiedQueryService.answer({
    accountId: accountA,
    question: 'Compare August and September revenue.',
    datasetId: imported.dataset.id,
    allowLlmPlanning: false,
    allowLlmExplanation: false,
    now: new Date('2026-09-18T00:00:00Z'),
  });
  assert(comparison.route === 'DATASET_ANALYTICS', 'Comparison route is wrong.');
  assert(
    'firstPeriod' in comparison.result &&
      comparison.result.firstPeriod.value === 2200 &&
      comparison.result.secondPeriod.value === 2400,
    'August/September comparison produced incorrect values.'
  );
  assert(
    'firstPeriod' in comparison.result &&
      comparison.result.absoluteChange === 200,
   'Period comparison change should be 200.'
  );

  const topProduct = await unifiedQueryService.answer({
    accountId: accountA,
    question: 'Which product generated the most revenue?',
    datasetId: imported.dataset.id,
    allowLlmPlanning: false,
    allowLlmExplanation: false,
  });
  assert(topProduct.route === 'DATASET_ANALYTICS', 'Top-product route is wrong.');
  assert(
    'rows' in topProduct.result &&
      topProduct.result.rows[0]?.product === 'Chair' &&
      topProduct.result.rows[0]?.revenue === 3500,
    'Top product should be Chair with 3500 in amount.'
  );

  const debtors = await unifiedQueryService.answer({
    accountId: accountA,
    question: 'Which customers still owe money?',
    datasetId: imported.dataset.id,
    allowLlmPlanning: false,
    allowLlmExplanation: false,
  });
  assert(debtors.route === 'DATASET_ANALYTICS', 'Debtor route is wrong.');
  assert(
    'rows' in debtors.result && debtors.result.rows.length === 3,
    'Expected three customers/orders with a positive outstanding balance.'
  );
  assert(
    'rows' in debtors.result &&
      debtors.result.rows[0]?.customer === 'Delta' &&
      debtors.result.rows[0]?.balance_due === 300,
    'Outstanding balances should be sorted highest first.'
  );

  const documentAnswer = await unifiedQueryService.answer({
    accountId: accountA,
    question: 'What does the handbook policy say about annual leave?',
    datasetId: imported.dataset.id,
    knowledgeBaseId: kb.id,
    allowLlmPlanning: false,
    allowLlmExplanation: false,
  });
  assert(
    documentAnswer.route === 'DOCUMENT_KNOWLEDGE',
    'Handbook question did not route to document RAG.'
  );
  assert(
    documentAnswer.answer.includes('24'),
    'Document route did not return the grounded annual-leave fact.'
  );

  let foreignDatasetDenied = false;
  try {
    await unifiedQueryService.answer({
      accountId: accountB,
      question: 'How much revenue did we make in September?',
      datasetId: imported.dataset.id,
      allowLlmPlanning: false,
      allowLlmExplanation: false,
    });
  } catch (error: any) {
    foreignDatasetDenied =
      error?.code === 'DATASET_NOT_FOUND' && error?.statusCode === 404;
  }
  assert(foreignDatasetDenied, 'Foreign dataset question must be denied.');

  let foreignKbDenied = false;
  try {
    await unifiedQueryService.answer({
      accountId: accountB,
      question: 'What does the handbook policy say about annual leave?',
      knowledgeBaseId: kb.id,
    });
  } catch (error: any) {
    foreignKbDenied =
      error?.code === 'KNOWLEDGE_BASE_NOT_FOUND' && error?.statusCode === 404;
  }
  assert(foreignKbDenied, 'Foreign knowledge-base question must be denied.');

  const plannerSource = fs.readFileSync(
    'server/querying/analyticalQuestionPlanner.ts',
    'utf8'
  );
  const serviceSource = fs.readFileSync(
    'server/querying/analyticalQuestionService.ts',
    'utf8'
  );
  assert(
    plannerSource.includes("responseFormat: 'json'") &&
      plannerSource.includes('normalizeEnvelope(parsed)'),
    'LLM planner output must pass through the safe JSON plan normalizer.'
  );
  assert(
    serviceSource.includes('structuredAnalyticsEngine.execute') &&
      serviceSource.includes('structuredAnalyticsEngine.comparePeriods'),
     'Analytical questions must execute through the deterministic analytics engine.'
  );
  assert(
    !plannerSource.toLowerCase().includes('select * from') &&
      !plannerSource.includes('eval('),
    'Analytical planner must not contain raw SQL execution or eval.'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/query', queryRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve unified query HTTP test port.');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Unified Query A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Unified Query B',
      accountId: accountB,
      environment: 'test',
    });

    const httpAnalytics = await fetch(baseUrl + '/api/query/ask', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretA}`,
        'Content-Type': 'application/json',
        'X-Account-ID': accountB,
      },
      body: JSON.stringify({
        question: 'How much revenue did we make in September?',
        datasetId: imported.dataset.id,
        knowledgeBaseId: kb.id,
        allowLlmPlanning: false,
        allowLlmExplanation: false,
      }),
    });
    assert(httpAnalytics.status === 200, 'Unified analytics HTTP route failed.');
    const httpAnalyticsBody = await httpAnalytics.json();
    assert(
      httpAnalyticsBody.route === 'DATASET_ANALYTICS' &&
        httpAnalyticsBody.result?.rows?.[0]?.revenue === 2400,
      'Unified analytics HTTP result is incorrect.'
    );

    const httpDocument = await fetch(baseUrl + '/api/query/ask', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: 'What does the handbook policy say about annual leave?',
        datasetId: imported.dataset.id,
        knowledgeBaseId: kb.id,
        allowLlmPlanning: false,
        allowLlmExplanation: false,
      }),
    });
    assert(httpDocument.status === 200, 'Unified document HTTP route failed.');
    const httpDocumentBody = await httpDocument.json();
    assert(
      httpDocumentBody.route === 'DOCUMENT_KNOWLEDGE' &&
        httpDocumentBody.answer.includes('24'),
      'Unified document HTTP result is not grounded correctly.'
    );

    const foreignHttp = await fetch(baseUrl + '/api/query/ask', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretB}`,
        'Content-Type': 'application/json',
        'X-Account-ID': accountA,
      },
      body: JSON.stringify({
        question: 'How much revenue did we make in September?',
        datasetId: imported.dataset.id,
        allowLlmPlanning: false,
        allowLlmExplanation: false,
      }),
    });
    assert(
      foreignHttp.status === 404,
      `Foreign unified-query dataset access should return 404; got ${foreignHttp.status}.`
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('ANALYTICAL_QUESTION_ROUTING_CHECK_PASSED');
  console.log(
    'Unified routing, deterministic analytical planning, grounded document routing, provenance, and HTTP account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('ANALYTICAL_QUESTION_ROUTING_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
