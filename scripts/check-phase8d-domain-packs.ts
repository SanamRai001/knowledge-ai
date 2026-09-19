import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { actionStore } from '../server/actions/actionStore.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { watchStore } from '../server/watch/watchStore.js';
import {
  PLATFORM_API_OPERATIONS,
  PLATFORM_SCOPES,
  publicPlatformManifest,
} from '../server/platform/platformApiManifest.js';
import { platformApiRouter } from '../server/platform/platformApiRouter.js';
import { DomainPackRegistry } from '../server/platform/domainPacks/domainPackRegistry.js';
import { domainPackService } from '../server/platform/domainPacks/domainPackService.js';

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
  const accountA = 'acc_phase8d_pack_a';
  const accountB = 'acc_phase8d_pack_b';

  const importedA = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'PACK-1,Pack Oak,3,5',
        'PACK-2,Pack Pine,20,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'phase8d-pack-a.csv',
    datasetName: 'Phase 8D Inventory A',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: importedA.dataset.id,
  });

  const importedB = datasetService.importCsv({
    accountId: accountB,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'PACK-X,Foreign Pack Cedar,2,4',
      ].join('\n'),
      'utf8'
    ),
    filename: 'phase8d-pack-b.csv',
    datasetName: 'Phase 8D Inventory B',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountB,
    datasetId: importedB.dataset.id,
  });

  const pack = domainPackService
    .list()
    .find((item) => item.id === 'inventory.operations');

  assert(
    pack?.version === '1.0.0' &&
      pack.executionMode === 'DECLARATIVE' &&
      pack.detectorTemplates.some(
        (item) =>
          item.detectorId === 'inventory.fixed-low-stock' &&
          item.detectorVersion === '1.0.0'
      ) &&
      pack.watchTemplates.every(
        (item) => item.activation === 'SUGGESTION_ONLY'
      ) &&
      pack.actionTemplates.every(
        (item) => item.mode === 'PROPOSAL_ONLY'
      ) &&
      pack.entityVocabulary.some(
        (item) => item.entityType === 'PRODUCT'
      ),
    'Inventory domain pack must package declarative detector/watch/action/vocabulary metadata.'
  );

  assert(
    !JSON.stringify(pack).match(
      /handler|javascript|shell|eval|sql|webhook/i
    ),
    'Domain pack descriptor must not contain executable/runtime-code surfaces.'
  );

  const isolatedRegistry = new DomainPackRegistry();
  let arbitraryPackBlocked = false;
  try {
    isolatedRegistry.registerBuiltIn({
      ...(pack as any),
      id: 'unsafe.runtime-pack',
      executionMode: 'ARBITRARY_CODE',
    });
  } catch (error: any) {
    arbitraryPackBlocked =
      error?.code === 'DOMAIN_PACK_INVALID';
  }
  assert(
    arbitraryPackBlocked,
    'Domain pack registry must reject non-declarative execution modes.'
  );

  let unknownDetectorBlocked = false;
  try {
    isolatedRegistry.registerBuiltIn({
      ...(pack as any),
      id: 'unsafe.missing-detector',
      detectorTemplates: [
        {
          ...pack!.detectorTemplates[0],
          detectorId: 'arbitrary.runtime.detector',
        },
      ],
    });
  } catch (error: any) {
    unknownDetectorBlocked =
      error?.code === 'DETECTOR_NOT_FOUND' ||
      error?.code === 'DOMAIN_PACK_INVALID';
  }
  assert(
    unknownDetectorBlocked,
    'Domain pack registration must fail closed when a detector reference is not registered.'
  );

  const manifest = publicPlatformManifest();
  assert(
    manifest.scopes.includes(
      PLATFORM_SCOPES.domainPacksRead
    ) &&
      manifest.scopes.includes(
        PLATFORM_SCOPES.domainPacksWrite
      ) &&
      PLATFORM_API_OPERATIONS.some(
        (op) =>
          op.operationId === 'domain-packs.install' &&
          op.mutation === true &&
          op.requiredScopes.includes(
            PLATFORM_SCOPES.domainPacksWrite
          )
      ) &&
      PLATFORM_API_OPERATIONS.some(
        (op) =>
          op.operationId === 'domain-packs.detector.run' &&
          op.path ===
            '/domain-packs/:id/detectors/:templateId/run'
      ),
    'Stable manifest must declare domain-pack inventory/install/template-run capabilities.'
  );

  const readKey = apiKeyStore.createApiKey({
    name: 'Phase 8D pack reader',
    accountId: accountA,
    environment: 'test',
    scopes: [PLATFORM_SCOPES.domainPacksRead],
  });
  const writeKey = apiKeyStore.createApiKey({
    name: 'Phase 8D pack writer',
    accountId: accountA,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.domainPacksRead,
      PLATFORM_SCOPES.domainPacksWrite,
    ],
  });
  const foreignKey = apiKeyStore.createApiKey({
    name: 'Phase 8D foreign pack writer',
    accountId: accountB,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.domainPacksRead,
      PLATFORM_SCOPES.domainPacksWrite,
    ],
  });

  const actionsBefore = actionStore.listProposals({
    accountId: accountA,
    limit: 500,
  }).length;
  const watchesBefore = watchStore.listRules({
    accountId: accountA,
    limit: 500,
  }).length;

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
      throw new Error('Could not resolve Phase 8D HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const listed = await json(
      await fetch(baseUrl + '/api/platform/v1/domain-packs', {
        headers: {
          Authorization: 'Bearer ' + readKey.secret,
        },
      })
    );
    assert(
      listed.response.status === 200 &&
        listed.body.packs.some(
          (item: any) =>
            item.id === 'inventory.operations' &&
            item.executionMode === 'DECLARATIVE'
        ) &&
        !JSON.stringify(listed.body).includes('handler'),
      'Domain-pack inventory must expose data-only descriptors without handlers.'
    );

    const readOnlyInstall = await fetch(
      baseUrl +
        '/api/platform/v1/domain-packs/inventory.operations/install',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + readKey.secret,
        },
      }
    );
    assert(
      readOnlyInstall.status === 403,
      'Domain-pack read scope must not imply installation authority.'
    );

    const install = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/install',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
          },
        }
      )
    );
    assert(
      install.response.status === 201 &&
        install.body.installation?.accountId === accountA &&
        install.body.installation?.packId ===
          'inventory.operations' &&
        install.body.installation?.status === 'ACTIVE',
      'Owning account must be able to install the declarative domain pack.'
    );

    const installAgain = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/install',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
          },
        }
      )
    );
    assert(
      installAgain.response.status === 201 &&
        installAgain.body.installation.id ===
          install.body.installation.id,
      'Installing the same active pack/version must be idempotent.'
    );

    const installations = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/installations',
        {
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
          },
        }
      )
    );
    assert(
      installations.response.status === 200 &&
        installations.body.installations.length === 1 &&
        installations.body.installations[0]
          .installation.accountId === accountA,
      'Domain-pack installation list must be account scoped.'
    );

    const foreignInstallations = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/installations',
        {
          headers: {
            Authorization: 'Bearer ' + foreignKey.secret,
            'X-Account-ID': accountA,
          },
        }
      )
    );
    assert(
      foreignInstallations.response.status === 200 &&
        foreignInstallations.body.installations.length === 0,
      'Caller-supplied account headers must not expose another account domain-pack installations.'
    );

    const invalidOverride = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/detectors/low-stock/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datasetId: importedA.dataset.id,
            configOverrides: {
              threshold: 7,
              code: 'process.exit()',
            },
          }),
        }
      )
    );
    assert(
      invalidOverride.response.status === 400 &&
        invalidOverride.body.error?.code ===
          'DOMAIN_PACK_OVERRIDE_INVALID',
      'Domain pack detector overrides must be allowlisted and reject arbitrary fields.'
    );

    const run = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/detectors/low-stock/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datasetId: importedA.dataset.id,
            datasetVersionId: importedA.version.id,
            referenceTime: Date.parse(
              '2099-06-01T00:00:00Z'
            ),
            configOverrides: {
              threshold: 4,
              severity: 'HIGH',
            },
          }),
        }
      )
    );

    assert(
      run.response.status === 201 &&
        run.body.pack?.id === 'inventory.operations' &&
        run.body.template?.id === 'low-stock' &&
        run.body.effectiveConfig?.threshold === 4 &&
        run.body.effectiveConfig?.severity === 'HIGH' &&
        run.body.detectorRun?.insights?.length === 1 &&
        run.body.detectorRun.insights[0].detectorId ===
          'inventory.fixed-low-stock' &&
        run.body.detectorRun.insights[0].severity === 'HIGH',
      'Installed pack detector template must delegate to the registered deterministic detector with validated overrides.'
    );

    const foreignRawDataset = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/install',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + foreignKey.secret,
          },
        }
      )
    );
    assert(
      foreignRawDataset.response.status === 201,
      'Foreign account should be able to install its own pack independently.'
    );

    const crossTenantRun = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/detectors/low-stock/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + foreignKey.secret,
            'Content-Type': 'application/json',
            'X-Account-ID': accountA,
          },
          body: JSON.stringify({
            datasetId: importedA.dataset.id,
            configOverrides: { threshold: 5 },
          }),
        }
      )
    );
    assert(
      crossTenantRun.response.status === 404,
      'Installed domain pack must not cross account boundaries using a foreign raw Dataset ID.'
    );

    assert(
      actionStore.listProposals({
        accountId: accountA,
        limit: 500,
      }).length === actionsBefore &&
        watchStore.listRules({
          accountId: accountA,
          limit: 500,
        }).length === watchesBefore,
      'Installing/running a domain pack must not create Action proposals or silently activate Watch rules.'
    );

    const installedPack = domainPackService.get(
      'inventory.operations'
    );
    assert(
      installedPack.actionTemplates[0].mode ===
        'PROPOSAL_ONLY' &&
        installedPack.watchTemplates[0].activation ===
          'SUGGESTION_ONLY',
      'Domain pack must preserve proposal-only Actions and suggestion-only Watches after installation.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_8D_DOMAIN_PACK_CHECK_PASSED');
  console.log(
    'Declarative pack registration, registered-detector references, account-scoped idempotent installation, safe template delegation, override allowlists, tenant isolation, proposal-only actions, suggestion-only watches, and no runtime-code/direct-action bypass are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_8D_DOMAIN_PACK_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
