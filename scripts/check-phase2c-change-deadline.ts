import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { discoveryRouter } from '../server/discovery/discoveryRouter.js';
import { discoveryService } from '../server/discovery/discoveryService.js';
import { workspaceAccessService } from '../server/workspaceAccessService.js';
import { KnowledgeDocument } from '../src/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_discovery_2c_a';
  const accountB = 'acc_discovery_2c_b';
  const referenceTime = Date.parse('2026-09-18T12:00:00Z');

  const firstCsv = [
    'order_id,order_date,customer,revenue',
    'O-1,2026-08-01,Acme,100',
    'O-2,2026-08-02,Beta,200',
    'O-3,2026-08-03,Gamma,300',
    'O-4,2026-08-04,Delta,400',
  ].join('\n');

  const firstImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(firstCsv, 'utf8'),
    filename: 'version-change.csv',
    datasetName: 'Version Change Orders',
  });

  const secondCsv = [
    'order_id,order_date,customer,revenue,channel',
    'O-1,2026-08-01,Acme,100,web',
    'O-2,2026-08-02,Beta,200,store',
    'O-3,2026-08-03,Gamma,300,web',
    'O-4,2026-08-04,Delta,400,store',
    'O-5,2026-08-05,Echo,500,web',
    'O-6,2026-08-06,Foxtrot,600,store',
  ].join('\n');

  const secondImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(secondCsv, 'utf8'),
    filename: 'version-change-v2.csv',
    existingDatasetId: firstImport.dataset.id,
  });

  const datasetRun = discoveryService.analyzeDataset({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
    versionId: secondImport.version.id,
    referenceTime,
  });

  const rowChange = datasetRun.insights.find(
    (insight) =>
      insight.detectorId === 'version.change' &&
      insight.evidence.values.previousRowCount === 4
  );
  assert(rowChange, 'Expected a deterministic row-count version-change insight.');
  assert(
    rowChange.evidence.sourceType === 'DATASET' &&
      rowChange.evidence.values.currentRowCount === 6 &&
      rowChange.evidence.values.percentChange === 50 &&
      rowChange.evidence.values.previousVersionId === firstImport.version.id &&
      rowChange.evidence.values.currentVersionId === secondImport.version.id,
    'Dataset version row-count evidence is incorrect.'
  );

  const schemaChange = datasetRun.insights.find(
    (insight) =>
      insight.detectorId === 'version.change' &&
      insight.evidence.values.addedColumns === 'channel'
  );
  assert(schemaChange, 'Expected a deterministic schema-change insight.');

  const kb = workspaceAccessService.createKB(
    accountA,
    'Deadline Workspace',
    'Contract and policy deadline proof'
  );
  const document: KnowledgeDocument = {
    id: 'doc_deadline_phase2c',
    filename: 'supplier-contract.pdf',
    fileType: 'application/pdf',
    fileSize: 2048,
    uploadTimestamp: Date.now(),
    processingStatus: 'processed',
    pageCount: 2,
    pages: [
      {
        pageNumber: 1,
        text: 'Commercial terms and supplier responsibilities.',
      },
      {
        pageNumber: 2,
        text:
          'The renewal deadline is October 10, 2026. Submit the signed renewal package no later than October 10, 2026. A historical review occurred on January 5, 2025.',
      },
    ],
    summary: 'Supplier agreement with renewal terms.',
  };
  workspaceAccessService.addDocument(accountA, kb.id, document);

  const documentRun = discoveryService.analyzeKnowledgeBase({
    accountId: accountA,
    knowledgeBaseId: kb.id,
    referenceTime,
  });

  assert(
    documentRun.run.sourceType === 'DOCUMENT' &&
      documentRun.run.knowledgeBaseId === kb.id,
    'Document analysis run did not preserve knowledge-base source scope.'
  );

  const deadline = documentRun.insights.find(
    (insight) => insight.detectorId === 'document.deadline'
  );
  assert(deadline, 'Expected an explicit document deadline insight.');
  assert(
    deadline.evidence.sourceType === 'DOCUMENT' &&
      deadline.evidence.documentId === document.id &&
      deadline.evidence.pageNumber === 2 &&
      deadline.evidence.values.deadlineDate === '2026-10-10' &&
      deadline.evidence.excerpt?.includes('renewal deadline'),
    'Document deadline evidence must preserve exact document/page/date/excerpt.'
  );
  assert(
    deadline.severity === 'MEDIUM',
    'A deadline 22 days away should be MEDIUM under the v1 deadline contract.'
  );
  assert(
    documentRun.insights.every(
      (insight) =>
        insight.evidence.values.deadlineDate !== '2025-01-05'
    ),
    'Historical dates must not be surfaced as approaching deadline insights.'
  );

  const secondDocumentRun = discoveryService.analyzeKnowledgeBase({
    accountId: accountA,
    knowledgeBaseId: kb.id,
    referenceTime,
  });
  const secondDeadline = secondDocumentRun.insights.find(
    (insight) => insight.detectorId === 'document.deadline'
  );
  assert(secondDeadline, 'Expected deadline on repeated document analysis.');
  assert(
    secondDeadline.id === deadline.id &&
      secondDeadline.occurrenceCount === 2,
    'Repeated document deadline must reuse the canonical insight.'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/insights', discoveryRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 2C HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Discovery 2C A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Discovery 2C B',
      accountId: accountB,
      environment: 'test',
    });

    const ownDocs = await fetch(
      baseUrl +
        '/api/insights?knowledgeBaseId=' +
        encodeURIComponent(kb.id),
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(ownDocs.status === 200, 'Owning account could not list document insights.');
    const ownDocsBody = await ownDocs.json();
    assert(
      ownDocsBody.insights?.some(
        (insight: any) =>
          insight.id === secondDeadline.id &&
          insight.evidence?.sourceType === 'DOCUMENT'
      ),
      'Knowledge-base scoped insight listing did not return deadline evidence.'
    );

    const foreignDocs = await fetch(
      baseUrl +
        '/api/insights?knowledgeBaseId=' +
        encodeURIComponent(kb.id),
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignDocs.status === 404,
      'Foreign knowledge-base insight listing must return 404.'
    );

    const ownAnalyze = await fetch(baseUrl + '/api/insights/analyze', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secretA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ knowledgeBaseId: kb.id }),
    });
    assert(
      ownAnalyze.status === 201,
      'Mounted document discovery analysis endpoint failed.'
    );

    const invalidMixed = await fetch(baseUrl + '/api/insights/analyze', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secretA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        datasetId: firstImport.dataset.id,
        knowledgeBaseId: kb.id,
      }),
    });
    assert(
      invalidMixed.status === 400,
      'Discovery analysis must require exactly one source scope.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_2C_CHANGE_DEADLINE_CHECK_PASSED');
  console.log(
    'Dataset version changes, explicit document deadlines, page evidence, canonical repeats, and source-scoped HTTP isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_2C_CHANGE_DEADLINE_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
