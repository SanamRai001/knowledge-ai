import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { discoveryRouter } from '../server/discovery/discoveryRouter.js';
import { discoveryService } from '../server/discovery/discoveryService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_discovery_a';
  const accountB = 'acc_discovery_b';
  const referenceTime = Date.parse('2026-09-18T12:00:00Z');

  const ordersCsv = [
    'order_date,customer,product,revenue,balance_due,due_date,notes',
    '2026-07-05,Acme,Chair,1000,0,2026-07-20,ok',
    '2026-07-12,Beta,Table,1000,0,2026-07-25,',
    '2026-08-02,Acme,Chair,1000,0,2026-08-20,ok',
    '2026-08-10,Beta,Chair,1000,200,2026-08-15,',
    '2026-08-20,Gamma,Table,1000,0,2026-08-25,',
    '2026-09-10,Delta,Chair,400,300,2026-09-12,',
    '2026-09-15,Echo,Table,300,100,2026-09-16,',
  ].join('\n');

  const ordersImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(ordersCsv, 'utf8'),
    filename: 'orders-discovery.csv',
    datasetName: 'Discovery Orders',
  });

  const firstRun = discoveryService.analyzeDataset({
    accountId: accountA,
    datasetId: ordersImport.dataset.id,
    referenceTime,
  });

  assert(firstRun.run.status === 'COMPLETED', 'Orders discovery run did not complete.');
  assert(
    firstRun.run.datasetVersionId === ordersImport.version.id,
    'Analysis run must pin the exact immutable dataset version.'
  );

  const trend = firstRun.insights.find(
    (insight) => insight.detectorId === 'trend.change'
  );
  assert(trend, 'Expected a deterministic trend insight.');
  assert(
    trend.evidence.values.previousValue === 2000 &&
      trend.evidence.values.currentValue === 3000 &&
      trend.evidence.values.percentChange === 50,
    'Trend detector returned incorrect July/August revenue change.'
  );

  const balance = firstRun.insights.find(
    (insight) => insight.detectorId === 'balance.outstanding'
  );
  assert(balance, 'Expected an outstanding/overdue balance insight.');
  assert(
    balance.evidence.values.affectedRecords === 3 &&
      balance.evidence.values.totalOutstanding === 600,
    'Balance detector returned incorrect overdue records or total.'
  );
  assert(
    balance.severity === 'HIGH',
    'Three overdue balances should be classified HIGH by the v1 detector contract.'
  );

  const quality = firstRun.insights.find(
    (insight) =>
      insight.detectorId === 'data-quality' &&
      insight.evidence.values.column === 'notes'
  );
  assert(quality, 'Expected a missing-value data quality insight.');

  for (const insight of firstRun.insights) {
    assert(
      insight.accountId === accountA &&
        insight.datasetVersionId === ordersImport.version.id &&
        insight.evidence.sourceSha256 === ordersImport.version.source.sha256 &&
        insight.evidence.datasetVersionNumber === 1 &&
        insight.analysisRunId === firstRun.run.id,
      'Every insight must retain account, run, immutable version, and source-hash provenance.'
    );
  }

  const secondRun = discoveryService.analyzeDataset({
    accountId: accountA,
    datasetId: ordersImport.dataset.id,
    referenceTime,
  });
  const firstFingerprints = firstRun.insights
    .map((insight) => insight.fingerprint)
    .sort();
  const secondFingerprints = secondRun.insights
    .map((insight) => insight.fingerprint)
    .sort();
  assert(
    JSON.stringify(firstFingerprints) === JSON.stringify(secondFingerprints),
    'Same immutable dataset version and reference time must produce stable insight fingerprints.'
  );

  const inventoryCsv = [
    'product,current_stock,reorder_level',
    'Chair,2,5',
    'Table,0,3',
    'Wardrobe,8,4',
    'Sofa,1,1',
  ].join('\n');

  const inventoryImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(inventoryCsv, 'utf8'),
    filename: 'inventory-discovery.csv',
    datasetName: 'Discovery Inventory',
  });

  const inventoryRun = discoveryService.analyzeDataset({
    accountId: accountA,
    datasetId: inventoryImport.dataset.id,
    referenceTime,
  });
  const inventory = inventoryRun.insights.find(
    (insight) => insight.detectorId === 'inventory.threshold'
  );
  assert(inventory, 'Expected an inventory threshold insight.');
  assert(
    inventory.evidence.values.affectedRecords === 3 &&
      inventory.evidence.values.stockoutRecords === 1 &&
      inventory.severity === 'HIGH',
    'Inventory threshold detector returned incorrect risk evidence.'
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
      throw new Error('Could not resolve discovery HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Discovery Account A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Discovery Account B',
      accountId: accountB,
      environment: 'test',
    });

    const ownList = await fetch(
      baseUrl + '/api/insights?datasetId=' + encodeURIComponent(ordersImport.dataset.id),
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(ownList.status === 200, 'Owning account could not list discovery insights.');
    const ownBody = await ownList.json();
    assert(
      ownBody.insights?.length === secondRun.insights.length,
      'Latest-run insight listing returned an unexpected number of findings.'
    );

    const ownInsight = await fetch(
      baseUrl + '/api/insights/' + secondRun.insights[0].id,
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(ownInsight.status === 200, 'Owning account could not read its insight.');

    const foreignList = await fetch(
      baseUrl + '/api/insights?datasetId=' + encodeURIComponent(ordersImport.dataset.id),
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignList.status === 404,
      'Foreign dataset-scoped insight listing must return 404.'
    );

    const foreignInsight = await fetch(
      baseUrl + '/api/insights/' + secondRun.insights[0].id,
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignInsight.status === 404,
      'Foreign direct insight read must return 404.'
    );

    const analyzeHttp = await fetch(baseUrl + '/api/insights/analyze', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secretA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        datasetId: inventoryImport.dataset.id,
      }),
    });
    assert(
      analyzeHttp.status === 201,
      'Mounted discovery analysis endpoint failed for the owning account.'
    );
    const analyzeBody = await analyzeHttp.json();
    assert(
      analyzeBody.run?.status === 'COMPLETED' &&
        analyzeBody.insights?.some(
          (insight: any) => insight.detectorId === 'inventory.threshold'
        ),
      'Mounted discovery analysis endpoint did not execute deterministic detectors.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_2A_DISCOVERY_CHECK_PASSED');
  console.log(
    'Analysis runs, deterministic trend/balance/inventory/data-quality detectors, stable fingerprints, provenance, and HTTP account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_2A_DISCOVERY_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
