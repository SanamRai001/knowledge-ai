import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import {
  PLATFORM_API_OPERATIONS,
  PLATFORM_SCOPES,
  publicPlatformManifest,
} from '../server/platform/platformApiManifest.js';
import { platformApiRouter } from '../server/platform/platformApiRouter.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  const body = await response.json();
  return { response, body };
}

async function main() {
  const operationIds = PLATFORM_API_OPERATIONS.map(
    (item) => item.operationId
  );
  const methodPaths = PLATFORM_API_OPERATIONS.map(
    (item) => item.method + ' ' + item.path
  );

  assert(
    new Set(operationIds).size === operationIds.length,
    'Stable platform operation IDs must be unique.'
  );
  assert(
    new Set(methodPaths).size === methodPaths.length,
    'Stable platform method/path pairs must be unique.'
  );

  for (const operation of PLATFORM_API_OPERATIONS) {
    assert(
      operation.version === 'v1' &&
        operation.stability === 'STABLE',
      'Every platform operation must declare v1 STABLE metadata.'
    );

    if (operation.mutation) {
      assert(
        operation.requiredScopes.length > 0 &&
          operation.requiredScopes.every(
            (scope) =>
              scope.includes(':propose') ||
              scope.includes(':write')
          ),
        'Every stable mutation must require an explicit proposal/write scope.'
      );
    }
  }

  const serializedManifest = JSON.stringify(
    publicPlatformManifest()
  ).toLowerCase();

  for (const forbidden of [
    '/automation',
    '/integrations',
    '/mediator',
    '/cognitive',
    '/sandbox',
    '/evaluations',
    '/confirm',
    '/execute',
  ]) {
    assert(
      !serializedManifest.includes(forbidden),
      'Stable manifest must exclude experimental/admin/automatic execution route: ' +
        forbidden
    );
  }

  assert(
    PLATFORM_API_OPERATIONS.some(
      (item) =>
        item.operationId === 'actions.propose' &&
        item.mutation &&
        item.requiredScopes.includes(
          PLATFORM_SCOPES.actionsPropose
        )
    ),
    'Action proposal creation must be explicit in the manifest.'
  );

  assert(
    !PLATFORM_API_OPERATIONS.some(
      (item) =>
        item.operationId.includes('confirm') ||
        item.operationId.includes('automation.execute')
    ),
    'Phase 8A stable API must not expose action confirmation or automation execution.'
  );

  const accountA = 'acc_phase8a_platform_a';
  const accountB = 'acc_phase8a_platform_b';

  const inventoryA = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'P-8A,Platform Oak,4,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'platform-a.csv',
    datasetName: 'Platform A Inventory',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: inventoryA.dataset.id,
  });

  const inventoryB = datasetService.importCsv({
    accountId: accountB,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'P-8B,Foreign Pine,9,3',
      ].join('\n'),
      'utf8'
    ),
    filename: 'platform-b.csv',
    datasetName: 'Platform B Inventory',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountB,
    datasetId: inventoryB.dataset.id,
  });

  const entityA = companyKnowledgeStore
    .listEntities({
      accountId: accountA,
      type: 'PRODUCT',
      search: 'Platform Oak',
      limit: 10,
    })[0];
  const entityB = companyKnowledgeStore
    .listEntities({
      accountId: accountB,
      type: 'PRODUCT',
      search: 'Foreign Pine',
      limit: 10,
    })[0];

  assert(entityA && entityB, 'Platform test entities were not projected.');

  const legacyKey = apiKeyStore.createApiKey({
    name: 'Phase 8A legacy scopes',
    accountId: accountA,
    environment: 'test',
    scopes: ['chat:read', 'ai:read', 'knowledge:read'],
  });

  const knowledgeKey = apiKeyStore.createApiKey({
    name: 'Phase 8A knowledge',
    accountId: accountA,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.sourcesRead,
      PLATFORM_SCOPES.knowledgeRead,
      PLATFORM_SCOPES.insightsRead,
      PLATFORM_SCOPES.actionsRead,
      PLATFORM_SCOPES.watchRead,
      PLATFORM_SCOPES.auditRead,
    ],
  });

  const proposalKey = apiKeyStore.createApiKey({
    name: 'Phase 8A action proposer',
    accountId: accountA,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.actionsRead,
      PLATFORM_SCOPES.actionsPropose,
    ],
  });

  const foreignKey = apiKeyStore.createApiKey({
    name: 'Phase 8A foreign',
    accountId: accountB,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.sourcesRead,
      PLATFORM_SCOPES.knowledgeRead,
      PLATFORM_SCOPES.actionsRead,
      PLATFORM_SCOPES.actionsPropose,
      PLATFORM_SCOPES.auditRead,
    ],
  });

  const app = express();
  app.use(express.json());
  app.use('/api/platform/v1', platformApiRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 8A test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const manifestResult = await json(
      await fetch(baseUrl + '/api/platform/v1/manifest')
    );
    assert(
      manifestResult.response.status === 200 &&
        manifestResult.body.version === 'v1' &&
        manifestResult.body.basePath === '/api/platform/v1' &&
        Array.isArray(manifestResult.body.operations) &&
        manifestResult.body.operations.length ===
          PLATFORM_API_OPERATIONS.length,
      'Machine-readable platform manifest endpoint is invalid.'
    );

    const missingAuth = await fetch(
      baseUrl + '/api/platform/v1/knowledge/summary'
    );
    assert(
      missingAuth.status === 401,
      'Stable business-data endpoints must require an API key.'
    );

    const legacyScopeResponse = await json(
      await fetch(
        baseUrl + '/api/platform/v1/knowledge/summary',
        {
          headers: {
            Authorization: 'Bearer ' + legacyKey.secret,
          },
        }
      )
    );
    assert(
      legacyScopeResponse.response.status === 403 &&
        legacyScopeResponse.body.error?.code ===
          'PLATFORM_FORBIDDEN' &&
        legacyScopeResponse.body.error?.message.includes(
          PLATFORM_SCOPES.knowledgeRead
        ),
      'Legacy scopes must not silently authorize the new platform API.'
    );

    const knowledgeResponse = await json(
      await fetch(
        baseUrl + '/api/platform/v1/knowledge/entities',
        {
          headers: {
            Authorization: 'Bearer ' + knowledgeKey.secret,
          },
        }
      )
    );
    assert(
      knowledgeResponse.response.status === 200 &&
        knowledgeResponse.body.entities.some(
          (entity: any) => entity.id === entityA.id
        ) &&
        !knowledgeResponse.body.entities.some(
          (entity: any) => entity.id === entityB.id
        ),
      'Correct scoped key must read only its own account entities.'
    );

    const spoofedHeaderResponse = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/knowledge/entities?accountId=' +
          encodeURIComponent(accountA),
        {
          headers: {
            Authorization: 'Bearer ' + foreignKey.secret,
            'X-Account-ID': accountA,
          },
        }
      )
    );
    assert(
      spoofedHeaderResponse.response.status === 200 &&
        spoofedHeaderResponse.body.entities.some(
          (entity: any) => entity.id === entityB.id
        ) &&
        !spoofedHeaderResponse.body.entities.some(
          (entity: any) => entity.id === entityA.id
        ),
      'Stable API must derive account identity only from the authenticated key.'
    );

    const foreignEntity = await fetch(
      baseUrl +
        '/api/platform/v1/knowledge/entities/' +
        entityA.id,
      {
        headers: {
          Authorization: 'Bearer ' + foreignKey.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignEntity.status === 404,
      'Foreign API key must not read another account entity by raw ID.'
    );

    const sourcesResponse = await json(
      await fetch(baseUrl + '/api/platform/v1/sources', {
        headers: {
          Authorization: 'Bearer ' + knowledgeKey.secret,
        },
      })
    );
    assert(
      sourcesResponse.response.status === 200 &&
        sourcesResponse.body.sources.some(
          (source: any) =>
            source.kind === 'DATASET' &&
            source.id === inventoryA.dataset.id
        ) &&
        !sourcesResponse.body.sources.some(
          (source: any) =>
            source.kind === 'DATASET' &&
            source.id === inventoryB.dataset.id
        ),
      'Stable Sources endpoint must be account scoped.'
    );

    const readOnlyProposal = await fetch(
      baseUrl + '/api/platform/v1/actions/propose',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + knowledgeKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Received 2 Platform Oak.',
          allowLlmParsing: false,
        }),
      }
    );
    assert(
      readOnlyProposal.status === 403,
      'Read scopes must not imply action proposal mutation authority.'
    );

    const proposeResult = await json(
      await fetch(
        baseUrl + '/api/platform/v1/actions/propose',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + proposalKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instruction: 'Received 2 Platform Oak.',
            allowLlmParsing: false,
          }),
        }
      )
    );
    assert(
      proposeResult.response.status === 201 &&
        proposeResult.body.proposal?.intent ===
          'RECEIVE_INVENTORY' &&
        proposeResult.body.proposal?.status === 'PROPOSED',
      'Correct action proposal scope must delegate to the Phase 4 proposal path.'
    );

    const entityAfterProposal =
      companyKnowledgeStore.requireEntity(
        accountA,
        entityA.id
      );
    const stockClaims =
      companyKnowledgeStore.listClaims({
        accountId: accountA,
        entityId: entityAfterProposal.id,
        predicate: 'CURRENT_STOCK',
        currentOnly: true,
        limit: 20,
      });
    const effectiveStockValues = stockClaims.map(
      (claim) => claim.value
    );
    assert(
      effectiveStockValues.includes(4) &&
        !effectiveStockValues.includes(6),
      'Stable action proposal endpoint must not execute the proposed mutation.'
    );

    const stableConfirm = await fetch(
      baseUrl +
        '/api/platform/v1/actions/' +
        proposeResult.body.proposal.id +
        '/confirm',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + proposalKey.secret,
        },
      }
    );
    assert(
      stableConfirm.status === 404,
      'Stable platform API must not expose action confirmation in Phase 8A.'
    );

    const actionsList = await json(
      await fetch(baseUrl + '/api/platform/v1/actions', {
        headers: {
          Authorization: 'Bearer ' + proposalKey.secret,
        },
      })
    );
    assert(
      actionsList.response.status === 200 &&
        actionsList.body.proposals.some(
          (item: any) =>
            item.id === proposeResult.body.proposal.id
        ),
      'Stable Actions read endpoint must expose the created proposal.'
    );

    const watchResponse = await json(
      await fetch(
        baseUrl + '/api/platform/v1/watch/rules',
        {
          headers: {
            Authorization: 'Bearer ' + knowledgeKey.secret,
          },
        }
      )
    );
    assert(
      watchResponse.response.status === 200 &&
        Array.isArray(watchResponse.body.rules),
      'Stable Watch read endpoint failed.'
    );

    const insightsResponse = await json(
      await fetch(baseUrl + '/api/platform/v1/insights', {
        headers: {
          Authorization: 'Bearer ' + knowledgeKey.secret,
        },
      })
    );
    assert(
      insightsResponse.response.status === 200 &&
        Array.isArray(insightsResponse.body.insights),
      'Stable Insights read endpoint failed.'
    );

    const auditResponse = await json(
      await fetch(
        baseUrl + '/api/platform/v1/audit/activity',
        {
          headers: {
            Authorization: 'Bearer ' + knowledgeKey.secret,
          },
        }
      )
    );
    assert(
      auditResponse.response.status === 200 &&
        Array.isArray(auditResponse.body.activity) &&
        auditResponse.body.activity.some(
          (item: any) =>
            item.kind === 'ACTION_AUDIT' &&
            item.resourceId ===
              proposeResult.body.proposal.id
        ),
      'Stable Audit endpoint must expose the authoritative action audit trail.'
    );

    const usage = apiKeyStore.getUsageStats(accountA);
    assert(
      usage.recentLogs.some(
        (item) =>
          item.endpoint ===
            '/api/platform/v1/actions/propose' &&
          item.status === 201
      ) &&
        usage.recentLogs.some(
          (item) =>
            item.endpoint ===
              '/api/platform/v1/knowledge/entities' &&
          item.status === 200
        ),
      'Authorized stable platform requests must be recorded in API usage audit.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_8A_STABLE_PLATFORM_API_CHECK_PASSED');
  console.log(
    'Manifest uniqueness, explicit mutation scopes, legacy-scope isolation, machine-readable versioning, correct-scope access, tenant isolation, account-header spoof resistance, source/knowledge/insight/action/watch/audit wrappers, proposal-without-execution behavior, and stable API usage audit are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_8A_STABLE_PLATFORM_API_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
