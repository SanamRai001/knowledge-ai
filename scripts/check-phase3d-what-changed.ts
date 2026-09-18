import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeChangeService } from '../server/companyKnowledge/companyKnowledgeChangeService.js';
import { companyKnowledgeRouter } from '../server/companyKnowledge/companyKnowledgeRouter.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_company_knowledge_3d_a';
  const accountB = 'acc_company_knowledge_3d_b';

  const v1Csv = [
    'order_id,order_date,customer,product,grand_total,balance_due,status',
    'O-100,2026-09-01,Acme,Chair,36000,16000,OPEN',
    'O-101,2026-09-02,Beta,Table,25000,0,PAID',
  ].join('\n');

  const firstImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(v1Csv, 'utf8'),
    filename: 'what-changed-v1.csv',
    datasetName: 'What Changed Orders',
  });
  const run1 = structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
  });

  const since = Date.now() - 1;

  const v2Csv = [
    'order_id,order_date,customer,product,grand_total,balance_due,status',
    'O-100,2026-09-01,Acme,Chair,36000,6000,PARTIAL',
    'O-102,2026-09-18,Gamma,Wardrobe,50000,20000,OPEN',
  ].join('\n');

  const secondImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(v2Csv, 'utf8'),
    filename: 'what-changed-v2.csv',
    existingDatasetId: firstImport.dataset.id,
  });
  const run2 = structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
    versionId: secondImport.version.id,
  });

  const report = companyKnowledgeChangeService.compareProjectionRuns({
    accountId: accountA,
    fromRunId: run1.id,
    toRunId: run2.id,
  });

  assert(
    report.sourceId === firstImport.dataset.id &&
      report.fromSourceVersionId === firstImport.version.id &&
      report.toSourceVersionId === secondImport.version.id,
    'Change report must preserve exact source/version window.'
  );

  const order100 = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-100',
  })[0];
  const order101 = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-101',
  })[0];
  const order102 = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-102',
  })[0];
  assert(order100 && order101 && order102, 'Expected all historical/current order entities.');

  const balanceChange = report.claimChanges.find(
    (change) =>
      change.subjectEntityId === order100.id &&
      change.predicate === 'BALANCE_DUE'
  );
  assert(
    balanceChange &&
      balanceChange.changeType === 'CHANGED' &&
      balanceChange.previousValues.length === 1 &&
      balanceChange.previousValues[0] === 16000 &&
      balanceChange.currentValues.length === 1 &&
      balanceChange.currentValues[0] === 6000,
    'What changed? must report O-100 balance from 16000 to 6000.'
  );

  const statusChange = report.claimChanges.find(
    (change) =>
      change.subjectEntityId === order100.id &&
      change.predicate === 'STATUS'
  );
  assert(
    statusChange &&
      statusChange.changeType === 'CHANGED' &&
      statusChange.previousValues[0] === 'OPEN' &&
      statusChange.currentValues[0] === 'PARTIAL',
    'What changed? must report O-100 status change.'
  );

  assert(
    report.removedEntityIds.includes(order101.id) &&
      report.addedEntityIds.includes(order102.id),
    'What changed? must report entities that left/entered the source version.'
  );

  assert(
    report.addedRelationshipIds.length > 0 &&
      report.removedRelationshipIds.length > 0,
    'What changed? must report relationship additions/removals.'
  );

  const removedOrderClaim = report.claimChanges.find(
    (change) =>
      change.subjectEntityId === order101.id &&
      change.changeType === 'REMOVED'
  );
  const addedOrderClaim = report.claimChanges.find(
    (change) =>
      change.subjectEntityId === order102.id &&
      change.changeType === 'ADDED'
  );
  assert(
    removedOrderClaim && addedOrderClaim,
    'What changed? must report removed and newly added entity claims.'
  );

  const sinceReport = companyKnowledgeChangeService.changesSince({
    accountId: accountA,
    since,
  });
  assert(
    sinceReport.projectionRunIds.includes(run2.id) &&
      sinceReport.eventIds.some((id) =>
        run2.eventIds.includes(id)
      ) &&
      sinceReport.claimIds.some((id) =>
        run2.claimIds.includes(id)
      ),
    'Changes-since timeline must include the later projection, claims, and events.'
  );

  const otherCsv = [
    'order_id,customer,product,grand_total',
    'X-1,Other,Desk,1000',
  ].join('\n');
  const otherImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(otherCsv, 'utf8'),
    filename: 'other-source.csv',
    datasetName: 'Other Source',
  });
  const otherRun = structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: otherImport.dataset.id,
  });

  let incompatibleRejected = false;
  try {
    companyKnowledgeChangeService.compareProjectionRuns({
      accountId: accountA,
      fromRunId: run1.id,
      toRunId: otherRun.id,
    });
  } catch (error: any) {
    incompatibleRejected =
      error?.code === 'INCOMPATIBLE_PROJECTION_RUNS';
  }
  assert(
    incompatibleRejected,
    'What changed? must reject unrelated projection source scopes.'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/company-knowledge', companyKnowledgeRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 3D HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Company Knowledge 3D A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Company Knowledge 3D B',
      accountId: accountB,
      environment: 'test',
    });

    const compareResponse = await fetch(
      baseUrl +
        '/api/company-knowledge/changes/compare?fromRunId=' +
        encodeURIComponent(run1.id) +
        '&toRunId=' +
        encodeURIComponent(run2.id),
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(compareResponse.status === 200, 'Owning account could not compare knowledge runs.');
    const compareBody = await compareResponse.json();
    assert(
      compareBody.changes?.claimChanges?.some(
        (change: any) =>
          change.subjectEntityId === order100.id &&
          change.predicate === 'BALANCE_DUE'
      ),
      'What changed HTTP API did not return known balance change.'
    );

    const sinceResponse = await fetch(
      baseUrl +
        '/api/company-knowledge/changes/since?since=' +
        String(since),
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(sinceResponse.status === 200, 'Owning account could not query changes since timestamp.');

    const foreignCompare = await fetch(
      baseUrl +
        '/api/company-knowledge/changes/compare?fromRunId=' +
        encodeURIComponent(run1.id) +
        '&toRunId=' +
        encodeURIComponent(run2.id),
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignCompare.status === 404,
      'Foreign account must not compare another account projection runs.'
    );

    const incompatibleResponse = await fetch(
      baseUrl +
        '/api/company-knowledge/changes/compare?fromRunId=' +
        encodeURIComponent(run1.id) +
        '&toRunId=' +
        encodeURIComponent(otherRun.id),
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      incompatibleResponse.status === 400,
      'HTTP What changed? must reject unrelated source scopes with 400.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_3D_WHAT_CHANGED_CHECK_PASSED');
  console.log(
    'Projection-run diffs, changed/added/removed claims, entity/relationship deltas, changes-since timeline, incompatible-source rejection, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_3D_WHAT_CHANGED_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
