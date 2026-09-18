import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeRouter } from '../server/companyKnowledge/companyKnowledgeRouter.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { documentKnowledgeProjectionService } from '../server/companyKnowledge/documentKnowledgeProjectionService.js';
import { knowledgeConflictService } from '../server/companyKnowledge/knowledgeConflictService.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { workspaceAccessService } from '../server/workspaceAccessService.js';
import { KnowledgeDocument } from '../src/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_company_knowledge_3c_a';
  const accountB = 'acc_company_knowledge_3c_b';

  const csv = [
    'order_id,order_date,customer_id,customer_name,product_id,product_name,supplier,branch,grand_total,balance_due,status',
    'O-100,2026-09-01,C-1,Acme Stores,P-1,Chair,Timber Co,Kathmandu,36000,16000,OPEN',
  ].join('\n');

  const imported = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'cross-source-orders.csv',
    datasetName: 'Cross Source Orders',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: imported.dataset.id,
  });

  const customerBefore = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'CUSTOMER',
    search: 'Acme Stores',
  })[0];
  const productBefore = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Chair',
  })[0];
  const orderBefore = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-100',
  })[0];
  const supplierBefore = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'SUPPLIER',
    search: 'Timber Co',
  })[0];

  assert(
    customerBefore && productBefore && orderBefore && supplierBefore,
    'Structured projection did not create baseline cross-source entities.'
  );

  const kb = workspaceAccessService.createKB(
    accountA,
    'Cross Source Knowledge',
    'Phase 3C document observations'
  );

  const document: KnowledgeDocument = {
    id: 'doc_phase3c_cross_source',
    filename: 'account-update.pdf',
    fileType: 'application/pdf',
    fileSize: 4096,
    uploadTimestamp: Date.now(),
    processingStatus: 'processed',
    pageCount: 2,
    pages: [
      {
        pageNumber: 1,
        text: [
          'Customer: Acme Stores',
          'Product: Chair',
          'Customer Acme Stores placed order O-100.',
          'Order O-100 contains product Chair.',
          'Product Chair is supplied by Timber Co.',
          'Order O-100 belongs to branch Kathmandu.',
        ].join('\n'),
      },
      {
        pageNumber: 2,
        text: [
          'Order O-100 balance due is NPR 5,000.',
          'Order O-100 status is PARTIAL.',
          'Contract SUP-2026-01 covers product Chair.',
        ].join('\n'),
      },
    ],
    summary: 'Account update with explicit order and supplier statements.',
  };

  workspaceAccessService.addDocument(accountA, kb.id, document);

  const documentRun = documentKnowledgeProjectionService.projectKnowledgeBase({
    accountId: accountA,
    knowledgeBaseId: kb.id,
  });
  assert(documentRun.status === 'COMPLETED', 'Document projection did not complete.');

  const customerAfter = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'CUSTOMER',
    search: 'Acme Stores',
  });
  const productAfter = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Chair',
  });
  const orderAfter = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'ORDER',
    search: 'O-100',
  });

  assert(
    customerAfter.length === 1 &&
      customerAfter[0].id === customerBefore.id &&
      productAfter.length === 1 &&
      productAfter[0].id === productBefore.id &&
      orderAfter.length === 1 &&
      orderAfter[0].id === orderBefore.id,
    'Unambiguous document names/identifiers must link to existing structured entities.'
  );

  assert(
    customerAfter[0].sourceRefs.some(
      (source) =>
        source.sourceType === 'DATASET' &&
        source.sourceId === imported.dataset.id
    ) &&
      customerAfter[0].sourceRefs.some(
        (source) =>
          source.sourceType === 'DOCUMENT' &&
          source.documentId === document.id &&
          source.pageNumber === 1
      ),
    'Cross-source entity must retain evidence from both dataset and document.'
  );

  const supplierRelationship = companyKnowledgeStore
    .listRelationships({
      accountId: accountA,
      entityId: productBefore.id,
      predicate: 'SUPPLIED_BY',
      limit: 20,
    })
    .find(
      (relationship) =>
        relationship.subjectEntityId === productBefore.id &&
        relationship.objectEntityId === supplierBefore.id
    );

  assert(
    supplierRelationship &&
      supplierRelationship.sourceRefs.some(
        (source) => source.sourceType === 'DATASET'
      ) &&
      supplierRelationship.sourceRefs.some(
        (source) =>
          source.sourceType === 'DOCUMENT' &&
          source.pageNumber === 1 &&
          source.excerpt?.includes('supplied by')
      ),
    'Same relationship should merge independent dataset/document evidence.'
  );

  const balanceClaims = companyKnowledgeStore.listClaims({
    accountId: accountA,
    entityId: orderBefore.id,
    predicate: 'BALANCE_DUE',
    currentOnly: true,
    limit: 20,
  });

  assert(
    balanceClaims.length === 2 &&
      balanceClaims.some(
        (claim) =>
          claim.value === 16000 &&
          claim.authority.level === 'STRUCTURED_SOURCE' &&
          claim.authority.rank === 70
      ) &&
      balanceClaims.some(
        (claim) =>
          claim.value === 5000 &&
          claim.authority.level === 'DOCUMENT_SOURCE' &&
          claim.authority.rank === 60 &&
          claim.sourceRef.documentId === document.id &&
          claim.sourceRef.pageNumber === 2 &&
          claim.sourceRef.excerpt?.includes('balance due')
      ),
    'Conflicting dataset/document observations must coexist with authority and exact page evidence.'
  );

  const conflicts = knowledgeConflictService.listConflicts({
    accountId: accountA,
    entityId: orderBefore.id,
    limit: 20,
  });
  const balanceConflict = conflicts.find(
    (conflict) => conflict.predicate === 'BALANCE_DUE'
  );

  assert(
    balanceConflict &&
      balanceConflict.distinctValues.includes(16000) &&
      balanceConflict.distinctValues.includes(5000) &&
      balanceConflict.highestAuthorityRank === 70 &&
      balanceConflict.resolution === 'HIGHER_AUTHORITY_AVAILABLE',
    'Cross-source disagreement must be represented explicitly as a conflict.'
  );

  const preferredClaim = balanceClaims.find(
    (claim) => claim.id === balanceConflict.preferredClaimId
  );
  assert(
    preferredClaim?.value === 16000 &&
      preferredClaim.authority.level === 'STRUCTURED_SOURCE',
    'Conflict service may identify the unique higher-authority observation without hiding disagreement.'
  );

  const contract = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'CONTRACT',
    search: 'SUP-2026-01',
  })[0];
  assert(contract, 'Explicit document contract entity was not projected.');

  const contractRelations = companyKnowledgeStore.listRelationships({
    accountId: accountA,
    entityId: contract.id,
    limit: 20,
  });
  assert(
    contractRelations.some(
      (relationship) =>
        relationship.predicate === 'COVERS' &&
        relationship.objectEntityId === productBefore.id &&
        relationship.authority.level === 'DOCUMENT_SOURCE'
    ),
    'Explicit document CONTRACT COVERS PRODUCT relationship was not preserved.'
  );

  const countsBeforeReplay = companyKnowledgeStore.snapshotCounts(accountA);
  documentKnowledgeProjectionService.projectKnowledgeBase({
    accountId: accountA,
    knowledgeBaseId: kb.id,
  });
  const countsAfterReplay = companyKnowledgeStore.snapshotCounts(accountA);
  assert(
    JSON.stringify(countsBeforeReplay) === JSON.stringify(countsAfterReplay),
    'Replaying the same document version must not duplicate living knowledge objects.'
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
      throw new Error('Could not resolve Phase 3C HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Company Knowledge 3C A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Company Knowledge 3C B',
      accountId: accountB,
      environment: 'test',
    });

    const conflictResponse = await fetch(
      baseUrl +
        '/api/company-knowledge/conflicts?entityId=' +
        encodeURIComponent(orderBefore.id),
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(conflictResponse.status === 200, 'Owning account could not inspect conflicts.');
    const conflictBody = await conflictResponse.json();
    assert(
      conflictBody.conflicts?.some(
        (conflict: any) => conflict.predicate === 'BALANCE_DUE'
      ),
      'Conflict API did not expose the known cross-source disagreement.'
    );

    const foreignConflict = await fetch(
      baseUrl +
        '/api/company-knowledge/conflicts?entityId=' +
        encodeURIComponent(orderBefore.id),
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignConflict.status === 404,
      'Foreign account must not inspect another account entity conflicts.'
    );

    const foreignDocumentProjection = await fetch(
      baseUrl + '/api/company-knowledge/project/documents',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretB,
          'Content-Type': 'application/json',
          'X-Account-ID': accountA,
        },
        body: JSON.stringify({ knowledgeBaseId: kb.id }),
      }
    );
    assert(
      foreignDocumentProjection.status === 404,
      'Foreign account must not project another account document workspace.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('PHASE_3C_CROSS_SOURCE_CHECK_PASSED');
  console.log(
    'Conservative document observations, unambiguous cross-source entity linking, merged relationship evidence, explicit conflicts, authority preference, replay idempotency, and workspace isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_3C_CROSS_SOURCE_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
