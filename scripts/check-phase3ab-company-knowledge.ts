import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeRouter } from '../server/companyKnowledge/companyKnowledgeRouter.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_company_knowledge_a';
  const accountB = 'acc_company_knowledge_b';

  const ordersV1 = [
    'order_id,order_date,customer_id,customer_name,product_id,product_name,supplier,branch,quantity,grand_total,balance_due,status',
    'O-100,2026-09-01,C-1,Acme Stores,P-1,Chair,Timber Co,Kathmandu,2,36000,16000,OPEN',
    'O-101,2026-09-02,C-1,Acme Stores,P-2,Table,Timber Co,Kathmandu,1,25000,0,PAID',
  ].join('\n');

  const firstImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(ordersV1, 'utf8'),
    filename: 'orders-v1.csv',
    datasetName: 'Orders',
  });

  const run1 = structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
  });

  assert(run1.status === 'COMPLETED', 'Initial knowledge projection failed.');
  assert(run1.entityIds.length >= 7, 'Expected customer, products, orders, supplier, and branch entities.');
  assert(run1.relationshipIds.length >= 6, 'Expected row-level business relationships.');
  assert(run1.claimIds.length >= 8, 'Expected order facts to be projected as observations.');
  assert(run1.eventIds.length >= 3, 'Expected order observation and projection events.');

  const customer = companyKnowledgeStore
    .listEntities({ accountId: accountA, type: 'CUSTOMER', search: 'Acme' })
    .find((entity) => entity.identityKey === 'c 1');
  assert(customer, 'Customer entity should be anchored by customer_id.');
  assert(
    customer.canonicalName === 'Acme Stores' &&
      customer.aliases.includes('C-1'),
    'Customer should keep the human name while retaining source identifier as alias.'
  );

  const chair = companyKnowledgeStore
    .listEntities({ accountId: accountA, type: 'PRODUCT', search: 'Chair' })
    .find((entity) => entity.identityKey === 'p 1');
  assert(chair, 'Chair entity should be anchored by product_id.');

  const order = companyKnowledgeStore
    .listEntities({ accountId: accountA, type: 'ORDER', search: 'O-100' })[0];
  assert(order, 'Order O-100 entity was not projected.');

  const orderClaimsV1 = companyKnowledgeStore.listClaims({
    accountId: accountA,
    entityId: order.id,
    currentOnly: true,
    limit: 100,
  });
  const totalV1 = orderClaimsV1.find(
    (claim) => claim.predicate === 'TOTAL_AMOUNT'
  );
  const balanceV1 = orderClaimsV1.find(
    (claim) => claim.predicate === 'BALANCE_DUE'
  );
  assert(
    totalV1?.value === 36000 &&
      balanceV1?.value === 16000 &&
      totalV1.claimKind === 'OBSERVATION' &&
      totalV1.authority.level === 'STRUCTURED_SOURCE' &&
      totalV1.authority.rank === 70,
    'Structured values must be observations with transparent structured-source authority.'
  );

  const relationships = companyKnowledgeStore.listRelationships({
    accountId: accountA,
    entityId: order.id,
    limit: 100,
  });
  assert(
    relationships.some(
      (relationship) =>
        relationship.predicate === 'PLACED' &&
        relationship.objectEntityId === order.id
    ) &&
      relationships.some(
        (relationship) =>
          relationship.predicate === 'CONTAINS' &&
          relationship.subjectEntityId === order.id &&
          relationship.objectEntityId === chair.id
      ),
    'Expected CUSTOMER PLACED ORDER and ORDER CONTAINS PRODUCT relationships.'
  );

  const events = companyKnowledgeStore.listEvents({
    accountId: accountA,
    entityId: order.id,
    limit: 100,
  });
  const observed = events.find((event) => event.type === 'ORDER_OBSERVED');
  assert(
    observed &&
      observed.data.TOTAL_AMOUNT === 36000 &&
      observed.data.BALANCE_DUE === 16000 &&
      observed.occurredAt === Date.parse('2026-09-01T00:00:00Z'),
    'Order observation event must preserve measured values and order date.'
  );

  const inventoryCsv = [
    'product_id,product_name,current_stock,reorder_level,unit_price,unit_cost',
    'P-1,Chair,4,5,18000,9000',
    'P-2,Table,8,3,25000,15000',
  ].join('\n');

  const inventoryImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(inventoryCsv, 'utf8'),
    filename: 'inventory.csv',
    datasetName: 'Inventory',
  });

  const inventoryRun = structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: inventoryImport.dataset.id,
  });
  assert(inventoryRun.status === 'COMPLETED', 'Inventory knowledge projection failed.');

  const chairAfterInventory = companyKnowledgeStore.requireEntity(
    accountA,
    chair.id
  );
  assert(
    chairAfterInventory.sourceRefs.some(
      (source) => source.sourceId === firstImport.dataset.id
    ) &&
      chairAfterInventory.sourceRefs.some(
        (source) => source.sourceId === inventoryImport.dataset.id
      ),
    'Same product identity should merge evidence across datasets.'
  );

  const chairFacts = companyKnowledgeStore.listClaims({
    accountId: accountA,
    entityId: chair.id,
    currentOnly: true,
    limit: 100,
  });
  assert(
    chairFacts.some(
      (claim) =>
        claim.predicate === 'CURRENT_STOCK' && claim.value === 4
    ) &&
      chairFacts.some(
        (claim) =>
          claim.predicate === 'REORDER_LEVEL' && claim.value === 5
      ),
    'Unique product rows should project explicit inventory state observations.'
  );

  const ordersV2 = [
    'order_id,order_date,customer_id,customer_name,product_id,product_name,supplier,branch,quantity,grand_total,balance_due,status',
    'O-100,2026-09-01,C-1,Acme Stores,P-1,Chair,Timber Co,Kathmandu,2,36000,6000,PARTIAL',
    'O-101,2026-09-02,C-1,Acme Stores,P-2,Table,Timber Co,Kathmandu,1,25000,0,PAID',
  ].join('\n');

  const secondImport = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(ordersV2, 'utf8'),
    filename: 'orders-v2.csv',
    existingDatasetId: firstImport.dataset.id,
  });

  const run2 = structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
    versionId: secondImport.version.id,
  });
  assert(run2.status === 'COMPLETED', 'Second knowledge projection failed.');

  const allBalanceClaims = companyKnowledgeStore
    .listClaims({
      accountId: accountA,
      entityId: order.id,
      predicate: 'BALANCE_DUE',
      currentOnly: false,
      limit: 100,
    })
    .sort((left, right) => left.observedAt - right.observedAt);

  assert(
    allBalanceClaims.length === 2 &&
      allBalanceClaims[0].value === 16000 &&
      allBalanceClaims[0].isCurrent === false &&
      allBalanceClaims[1].value === 6000 &&
      allBalanceClaims[1].isCurrent === true &&
      allBalanceClaims[1].supersedesClaimId === allBalanceClaims[0].id,
    'Newer dataset version must preserve old claim history and supersede current state.'
  );

  const countsBeforeReplay = companyKnowledgeStore.snapshotCounts(accountA);
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
    versionId: secondImport.version.id,
  });
  const countsAfterReplay = companyKnowledgeStore.snapshotCounts(accountA);
  assert(
    JSON.stringify(countsBeforeReplay) === JSON.stringify(countsAfterReplay),
    'Re-projecting the same immutable version must not duplicate entities, relationships, claims, or events.'
  );

  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: firstImport.dataset.id,
    versionId: firstImport.version.id,
  });
  const currentBalanceAfterOldReplay = companyKnowledgeStore
    .listClaims({
      accountId: accountA,
      entityId: order.id,
      predicate: 'BALANCE_DUE',
      currentOnly: true,
      limit: 10,
    })[0];
  assert(
    currentBalanceAfterOldReplay?.value === 6000,
    'Replaying an older source version must not roll current company state backward.'
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
      throw new Error('Could not resolve company knowledge HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Company Knowledge A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Company Knowledge B',
      accountId: accountB,
      environment: 'test',
    });

    const summaryResponse = await fetch(
      baseUrl + '/api/company-knowledge/summary',
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(summaryResponse.status === 200, 'Owning account could not read knowledge summary.');
    const summaryBody = await summaryResponse.json();
    assert(
      summaryBody.summary?.entities === countsAfterReplay.entities,
      'Company knowledge summary returned incorrect entity count.'
    );

    const entityResponse = await fetch(
      baseUrl + '/api/company-knowledge/entities/' + order.id,
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(entityResponse.status === 200, 'Owning account could not inspect entity.');
    const entityBody = await entityResponse.json();
    assert(
      entityBody.entity?.id === order.id &&
        entityBody.claims?.some(
          (claim: any) =>
            claim.predicate === 'BALANCE_DUE' && claim.value === 6000
        ),
      'Entity detail API did not return historical/current knowledge.'
    );

    const foreignEntity = await fetch(
      baseUrl + '/api/company-knowledge/entities/' + order.id,
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignEntity.status === 404,
      'Foreign account must not inspect another account entity.'
    );

    const foreignProjection = await fetch(
      baseUrl + '/api/company-knowledge/project/dataset',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretB,
          'Content-Type': 'application/json',
          'X-Account-ID': accountA,
        },
        body: JSON.stringify({ datasetId: firstImport.dataset.id }),
      }
    );
    assert(
      foreignProjection.status === 404,
      'Foreign account must not project another account dataset.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_3AB_COMPANY_KNOWLEDGE_CHECK_PASSED');
  console.log(
    'Entity identity, aliases, relationships, observation claims, authority, events, immutable-version history, replay idempotency, and HTTP account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_3AB_COMPANY_KNOWLEDGE_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
