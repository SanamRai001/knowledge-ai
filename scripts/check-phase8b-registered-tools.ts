import express from 'express';
import fs from 'fs';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { actionStore } from '../server/actions/actionStore.js';
import { effectiveCompanyStateService } from '../server/companyKnowledge/effectiveCompanyStateService.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { datasetService } from '../server/datasets/datasetService.js';
import {
  PLATFORM_API_OPERATIONS,
  PLATFORM_SCOPES,
  publicPlatformManifest,
} from '../server/platform/platformApiManifest.js';
import { platformApiRouter } from '../server/platform/platformApiRouter.js';
import { toolInvocationAuditStore } from '../server/platform/tools/toolInvocationAuditStore.js';
import { toolInvocationService } from '../server/platform/tools/toolInvocationService.js';
import { ToolRegistry } from '../server/platform/tools/toolRegistry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  let body: any = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { response, body };
}

async function main() {
  const accountA = 'acc_phase8b_tools_a';
  const accountB = 'acc_phase8b_tools_b';

  const inventoryA = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'TP-1,Oak Boards,12,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'phase8b-tools-a.csv',
    datasetName: 'Phase 8B Tool Inventory A',
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
        'TP-2,Foreign Pine,7,3',
      ].join('\n'),
      'utf8'
    ),
    filename: 'phase8b-tools-b.csv',
    datasetName: 'Phase 8B Tool Inventory B',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountB,
    datasetId: inventoryB.dataset.id,
  });

  const oak = companyKnowledgeStore
    .listEntities({
      accountId: accountA,
      type: 'PRODUCT',
      search: 'Oak Boards',
      limit: 20,
    })
    .find((item) => item.identityKey === 'tp 1');

  const foreignPine = companyKnowledgeStore
    .listEntities({
      accountId: accountB,
      type: 'PRODUCT',
      search: 'Foreign Pine',
      limit: 20,
    })
    .find((item) => item.identityKey === 'tp 2');

  assert(oak && foreignPine, 'Tool test entities were not projected.');

  const descriptors = toolInvocationService.list({
    scopes: [
      PLATFORM_SCOPES.toolsInvoke,
      PLATFORM_SCOPES.knowledgeRead,
      PLATFORM_SCOPES.askQuery,
      PLATFORM_SCOPES.insightsRead,
      PLATFORM_SCOPES.watchRead,
      PLATFORM_SCOPES.actionsPropose,
    ],
  });

  const ids = descriptors.map((item) => item.id);
  assert(
    new Set(ids).size === ids.length &&
      ids.includes('knowledge.entity.get') &&
      ids.includes('ask.query') &&
      ids.includes('insights.list') &&
      ids.includes('watch.rules.list') &&
      ids.includes('actions.propose'),
    'Trusted built-in catalog must expose the bounded Phase 8B tools with unique IDs.'
  );

  assert(
    descriptors.every(
      (item) =>
        item.executionMode === 'TRUSTED_BUILT_IN' &&
        item.stability === 'STABLE' &&
        item.inputSchema.additionalProperties === false
    ),
    'All Phase 8B tools must use trusted built-in handlers and closed schemas.'
  );

  const forbiddenToolPattern =
    /(execute|confirm|automation|shell|command|code|eval|http|fetch|webhook|sql)/i;
  assert(
    ids.every((id) => !forbiddenToolPattern.test(id)),
    'Phase 8B must not register direct execution, arbitrary code, HTTP, SQL, or automation tools.'
  );

  const proposalDescriptor = descriptors.find(
    (item) => item.id === 'actions.propose'
  );
  assert(
    proposalDescriptor?.mutation === true &&
      proposalDescriptor.riskClass === 'PROPOSAL_WRITE' &&
      proposalDescriptor.requiredScopes.includes(
        PLATFORM_SCOPES.actionsPropose
      ),
    'The only mutation tool must remain proposal-only with explicit proposal scope.'
  );

  const isolatedRegistry = new ToolRegistry();
  let arbitraryHandlerBlocked = false;
  try {
    isolatedRegistry.registerBuiltIn({
      descriptor: {
        id: 'unsafe.runtime.exec',
        version: '1.0.0',
        name: 'Unsafe runtime',
        description: 'Should never register.',
        family: 'ACTIONS',
        requiredScopes: [PLATFORM_SCOPES.actionsPropose],
        mutation: true,
        riskClass: 'PROPOSAL_WRITE',
        rateLimitClass: 'WRITE',
        auditBehavior: 'INVOCATION_AND_DOMAIN_AUDIT',
        executionMode: 'ARBITRARY_CODE' as any,
        stability: 'STABLE',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
      handler: () => ({ unsafe: true }),
    });
  } catch (error: any) {
    arbitraryHandlerBlocked =
      error?.code === 'TOOL_DESCRIPTOR_INVALID';
  }
  assert(
    arbitraryHandlerBlocked,
    'Registry must reject non-built-in/arbitrary execution modes.'
  );

  let directInvokeBlocked = false;
  try {
    await toolInvocationService.invoke({
      toolId: 'knowledge.entity.get',
      rawInput: { entityId: oak.id },
      context: {
        accountId: accountA,
        requestId: 'direct-no-generic-scope',
        apiKeyId: 'direct-test-key',
        scopes: [PLATFORM_SCOPES.knowledgeRead],
      },
    });
  } catch (error: any) {
    directInvokeBlocked =
      error?.code === 'TOOL_INVOKE_FORBIDDEN';
  }
  assert(
    directInvokeBlocked,
    'Tool service itself must enforce generic invoke permission even outside HTTP routing.'
  );

  const { secret: listSecret } = apiKeyStore.createApiKey({
    name: 'Phase 8B list only',
    accountId: accountA,
    environment: 'test',
    scopes: [PLATFORM_SCOPES.toolsRead],
  });
  const { secret: capOnlySecret } = apiKeyStore.createApiKey({
    name: 'Phase 8B capability only',
    accountId: accountA,
    environment: 'test',
    scopes: [PLATFORM_SCOPES.knowledgeRead],
  });
  const { secret: genericOnlySecret } = apiKeyStore.createApiKey({
    name: 'Phase 8B generic invoke only',
    accountId: accountA,
    environment: 'test',
    scopes: [PLATFORM_SCOPES.toolsInvoke],
  });
  const { secret: knowledgeSecret } = apiKeyStore.createApiKey({
    name: 'Phase 8B knowledge tool',
    accountId: accountA,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.toolsRead,
      PLATFORM_SCOPES.toolsInvoke,
      PLATFORM_SCOPES.knowledgeRead,
    ],
  });
  const { apiKey: actionApiKey, secret: actionSecret } =
    apiKeyStore.createApiKey({
      name: 'Phase 8B action proposal tool',
      accountId: accountA,
      environment: 'test',
      scopes: [
        PLATFORM_SCOPES.toolsRead,
        PLATFORM_SCOPES.toolsInvoke,
        PLATFORM_SCOPES.actionsPropose,
      ],
    });

  const app = express();
  app.use(express.json());
  app.use('/api/platform/v1', platformApiRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 8B HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const manifest = publicPlatformManifest();
    assert(
      manifest.scopes.includes(PLATFORM_SCOPES.toolsRead) &&
        manifest.scopes.includes(PLATFORM_SCOPES.toolsInvoke) &&
        PLATFORM_API_OPERATIONS.some(
          (op) =>
            op.operationId === 'tools.list' &&
            op.path === '/tools'
        ) &&
        PLATFORM_API_OPERATIONS.some(
          (op) =>
            op.operationId === 'tools.invoke' &&
            op.path === '/tools/:id/invoke' &&
            op.mutation === true &&
            op.requiredScopes.includes(
              PLATFORM_SCOPES.toolsInvoke
            )
        ),
      'Stable manifest must declare tool inventory/invoke operations and generic tool scopes.'
    );

    const listResult = await json(
      await fetch(baseUrl + '/api/platform/v1/tools', {
        headers: { Authorization: 'Bearer ' + listSecret },
      })
    );
    assert(
      listResult.response.status === 200 &&
        Array.isArray(listResult.body.tools) &&
        listResult.body.tools.length === descriptors.length &&
        listResult.body.tools.every(
          (tool: any) => tool.invokable === false
        ),
      'Tool-read scope may inspect descriptors but must not imply invoke authority.'
    );
    assert(
      !JSON.stringify(listResult.body).includes('handler'),
      'Tool inventory must never expose executable handler functions.'
    );

    const capabilityWithoutInvoke = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/knowledge.entity.get/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + capOnlySecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: { entityId: oak.id },
          }),
        }
      )
    );
    assert(
      capabilityWithoutInvoke.response.status === 403 &&
        capabilityWithoutInvoke.body.error?.code ===
          'PLATFORM_FORBIDDEN',
      'Tool capability scope alone must not imply generic invocation authority.'
    );

    const invokeWithoutCapability = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/knowledge.entity.get/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + genericOnlySecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: { entityId: oak.id },
          }),
        }
      )
    );
    assert(
      invokeWithoutCapability.response.status === 403 &&
        invokeWithoutCapability.body.error?.code ===
          'TOOL_CAPABILITY_FORBIDDEN',
      'Generic invoke scope must not bypass the tool-specific capability scope.'
    );

    const ownEntity = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/knowledge.entity.get/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + knowledgeSecret,
            'Content-Type': 'application/json',
            'X-Account-ID': accountB,
          },
          body: JSON.stringify({
            input: { entityId: oak.id },
          }),
        }
      )
    );
    assert(
      ownEntity.response.status === 200 &&
        ownEntity.body.result?.entity?.id === oak.id &&
        ownEntity.body.result?.entity?.accountId === accountA &&
        typeof ownEntity.body.invocation_id === 'string',
      'Scoped knowledge tool must use API-key account identity and ignore spoofed account headers.'
    );

    const foreignEntity = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/knowledge.entity.get/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + knowledgeSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: { entityId: foreignPine.id },
          }),
        }
      )
    );
    assert(
      foreignEntity.response.status === 404,
      'Registered tool must not cross account boundaries using a foreign raw resource ID.'
    );

    const invalidInput = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/knowledge.entity.get/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + knowledgeSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: {
              entityId: oak.id,
              accountId: accountB,
            },
          }),
        }
      )
    );
    assert(
      invalidInput.response.status === 400 &&
        invalidInput.body.error?.code === 'TOOL_INPUT_INVALID',
      'Closed tool schema must reject unknown fields such as caller-supplied accountId.'
    );

    const unknownTool = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/arbitrary.shell.exec/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + knowledgeSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ input: {} }),
        }
      )
    );
    assert(
      unknownTool.response.status === 404 &&
        unknownTool.body.error?.code === 'TOOL_NOT_FOUND',
      'Unknown arbitrary tools must fail closed.'
    );

    const stockBefore = effectiveCompanyStateService.requireNumber(
      accountA,
      oak.id,
      'CURRENT_STOCK'
    ).value;

    const actionResult = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/actions.propose/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + actionSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: {
              instruction: 'Received 20 Oak Boards today.',
              allowLlmParsing: false,
            },
          }),
        }
      )
    );

    const proposal = actionResult.body.result?.proposal;
    assert(
      actionResult.response.status === 200 &&
        proposal?.status === 'PROPOSED' &&
        proposal?.intent === 'RECEIVE_INVENTORY',
      'Proposal tool must delegate to the existing safe Phase 4 proposal path.'
    );

    const stockAfter = effectiveCompanyStateService.requireNumber(
      accountA,
      oak.id,
      'CURRENT_STOCK'
    ).value;
    assert(
      stockBefore === 12 &&
        stockAfter === stockBefore &&
        actionStore.getExecutionByProposal(
          accountA,
          proposal.id
        ) === null,
      'actions.propose tool must not confirm, execute, or mutate company state.'
    );

    const actionAudits = toolInvocationAuditStore.list({
      accountId: accountA,
      toolId: 'actions.propose',
      limit: 20,
    });
    assert(
      actionAudits.some(
        (item) =>
          item.status === 'SUCCEEDED' &&
          item.apiKeyId === actionApiKey.id &&
          /^[a-f0-9]{64}$/.test(item.inputHash)
      ),
      'Successful tool invocation must create a privacy-safe hashed audit record.'
    );

    const auditFile = fs.readFileSync(
      'data/platform_tool_invocations.json',
      'utf8'
    );
    assert(
      !auditFile.includes('Received 20 Oak Boards today.') &&
        !auditFile.includes('"entityId":"' + oak.id + '"'),
      'Tool invocation audit persistence must not store raw tool input.'
    );

    const auditHttp = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/invocations?toolId=actions.propose',
        {
          headers: {
            Authorization: 'Bearer ' + actionSecret,
          },
        }
      )
    );
    assert(
      auditHttp.response.status === 200 &&
        Array.isArray(auditHttp.body.invocations) &&
        auditHttp.body.invocations.some(
          (item: any) => item.toolId === 'actions.propose'
        ),
      'Account-scoped invocation audit must be available through the declared stable API.'
    );

    const forbiddenOperationIdPatterns = [
      /(^|\.)confirm($|\.)/i,
      /(^|\.)execute($|\.)/i,
      /(^|\.)automation($|\.)/i,
      /(^|\.)shell($|\.)/i,
      /(^|\.)eval($|\.)/i,
      /(^|\.)arbitrary($|\.)/i,
      /(^|\.)code($|\.)/i,
    ];
    const forbiddenPathSegments = [
      '/confirm',
      '/execute',
      '/automation',
      '/shell',
      '/eval',
      '/arbitrary',
      '/code',
    ];

    for (const operation of manifest.operations) {
      assert(
        forbiddenOperationIdPatterns.every(
          (pattern) => !pattern.test(operation.operationId)
        ),
        'Stable platform operation ID exposes a forbidden execution surface: ' +
          operation.operationId
      );

      const normalizedPath = String(operation.path).toLowerCase();
      assert(
        forbiddenPathSegments.every(
          (segment) => !normalizedPath.includes(segment)
        ),
        'Stable platform path exposes a forbidden execution surface: ' +
          operation.path
      );
    }

    for (const tool of descriptors) {
      assert(
        forbiddenOperationIdPatterns.every(
          (pattern) => !pattern.test(tool.id)
        ),
        'Registered tool ID exposes a forbidden execution surface: ' +
          tool.id
      );
      assert(
        tool.executionMode === 'TRUSTED_BUILT_IN',
        'Registered tool must not expose an arbitrary execution mode: ' +
          tool.id
      );
    }
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_8B_REGISTERED_TOOLS_CHECK_PASSED');
  console.log(
    'Trusted tool registration, generic + capability scope enforcement, closed-schema validation, account isolation, proposal-only mutation, privacy-safe invocation audit, stable inventory/invoke contracts, and arbitrary-code/direct-write denial are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_8B_REGISTERED_TOOLS_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
