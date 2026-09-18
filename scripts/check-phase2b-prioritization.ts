import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { discoveryRouter } from '../server/discovery/discoveryRouter.js';
import { discoveryService } from '../server/discovery/discoveryService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_discovery_priority_a';
  const accountB = 'acc_discovery_priority_b';
  const referenceTime = Date.parse('2026-09-18T12:00:00Z');

  const csv = [
    'product,current_stock,reorder_level,notes',
    'Chair,2,5,priority item',
    'Table,0,3,',
    'Wardrobe,8,4,',
    'Sofa,1,1,',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'inventory-priority.csv',
    datasetName: 'Priority Inventory',
  });

  const first = discoveryService.analyzeDataset({
    accountId: accountA,
    datasetId: imported.dataset.id,
    referenceTime,
  });
  const second = discoveryService.analyzeDataset({
    accountId: accountA,
    datasetId: imported.dataset.id,
    referenceTime,
  });

  const firstInventory = first.insights.find(
    (insight) => insight.detectorId === 'inventory.threshold'
  );
  const secondInventory = second.insights.find(
    (insight) => insight.detectorId === 'inventory.threshold'
  );
  assert(firstInventory && secondInventory, 'Expected inventory insight on both runs.');
  assert(
    firstInventory.id === secondInventory.id,
    'Identical discovery finding must reuse the canonical insight ID.'
  );
  assert(
    secondInventory.occurrenceCount === 2,
    'Repeated identical finding must increment occurrence count.'
  );
  assert(
    secondInventory.firstSeenAt === referenceTime &&
      secondInventory.lastSeenAt === referenceTime,
    'Canonical insight must preserve first/last seen timestamps.'
  );

  const ranked = discoveryService.listInsights({
    accountId: accountA,
    datasetId: imported.dataset.id,
    latestRunOnly: false,
    limit: 20,
  });
  assert(ranked.length >= 2, 'Expected multiple prioritized insights.');
  assert(
    ranked.every((insight, index) =>
      index === 0
        ? true
        : ranked[index - 1].priorityScore >= insight.priorityScore
    ),
    'Insights must be returned in descending deterministic priority order.'
  );
  assert(
    ranked[0].detectorId === 'inventory.threshold' &&
      ranked[0].priorityScore > 0 &&
      ranked[0].priorityReasons.includes('stockout'),
    'Stockout risk should outrank lower-value data-quality findings.'
  );

  const acknowledged = discoveryService.updateInsightStatus(
    accountA,
    secondInventory.id,
    'ACKNOWLEDGED'
  );
  assert(
    acknowledged.status === 'ACKNOWLEDGED' &&
      typeof acknowledged.statusUpdatedAt === 'number',
    'Acknowledging an insight must persist lifecycle metadata.'
  );

  const third = discoveryService.analyzeDataset({
    accountId: accountA,
    datasetId: imported.dataset.id,
    referenceTime,
  });
  const thirdInventory = third.insights.find(
    (insight) => insight.detectorId === 'inventory.threshold'
  );
  assert(thirdInventory, 'Expected canonical inventory insight after third run.');
  assert(
    thirdInventory.id === secondInventory.id &&
      thirdInventory.occurrenceCount === 3 &&
      thirdInventory.status === 'ACKNOWLEDGED',
    'Re-analysis must preserve canonical ID, lifecycle state, and increment occurrence count.'
  );

  const canonical = discoveryService.listInsights({
    accountId: accountA,
    datasetId: imported.dataset.id,
    latestRunOnly: false,
    limit: 100,
  });
  const inventoryCopies = canonical.filter(
    (insight) => insight.fingerprint === thirdInventory.fingerprint
  );
  assert(
    inventoryCopies.length === 1,
    'Canonical insight listing must not expose duplicate copies across runs.'
  );

  const firstRunView = discoveryService.listInsights({
    accountId: accountA,
    datasetId: imported.dataset.id,
    runId: first.run.id,
    limit: 100,
  });
  assert(
    firstRunView.some((insight) => insight.id === thirdInventory.id),
    'Historical analysis runs must still resolve canonical insight IDs.'
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
      throw new Error('Could not resolve Phase 2B HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Discovery Priority A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Discovery Priority B',
      accountId: accountB,
      environment: 'test',
    });

    const resolveResponse = await fetch(
      baseUrl + '/api/insights/' + thirdInventory.id + '/status',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + secretA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'RESOLVED' }),
      }
    );
    assert(resolveResponse.status === 200, 'Owning account could not resolve insight.');
    const resolvedBody = await resolveResponse.json();
    assert(
      resolvedBody.insight?.status === 'RESOLVED',
      'Resolved lifecycle state was not returned by API.'
    );

    const resolvedList = await fetch(
      baseUrl +
        '/api/insights?datasetId=' +
        encodeURIComponent(imported.dataset.id) +
        '&latestRunOnly=false&status=RESOLVED&limit=5',
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(resolvedList.status === 200, 'Resolved insight filter failed.');
    const resolvedListBody = await resolvedList.json();
    assert(
      resolvedListBody.insights?.some(
        (insight: any) => insight.id === thirdInventory.id
      ),
      'Resolved insight was not returned by status filter.'
    );

    const foreignPatch = await fetch(
      baseUrl + '/api/insights/' + thirdInventory.id + '/status',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + secretB,
          'Content-Type': 'application/json',
          'X-Account-ID': accountA,
        },
        body: JSON.stringify({ status: 'OPEN' }),
      }
    );
    assert(
      foreignPatch.status === 404,
      'Foreign account must not change another account insight lifecycle.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_2B_PRIORITIZATION_CHECK_PASSED');
  console.log(
    'Canonical deduplication, deterministic priority ordering, lifecycle persistence, run references, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_2B_PRIORITIZATION_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
