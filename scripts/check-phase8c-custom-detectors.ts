import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { datasetStore } from '../server/datasets/datasetStore.js';
import { discoveryStore } from '../server/discovery/discoveryStore.js';
import {
  PLATFORM_API_OPERATIONS,
  PLATFORM_SCOPES,
  publicPlatformManifest,
} from '../server/platform/platformApiManifest.js';
import { platformApiRouter } from '../server/platform/platformApiRouter.js';
import { DetectorRegistry } from '../server/platform/detectors/detectorRegistry.js';
import { detectorExecutionService } from '../server/platform/detectors/detectorExecutionService.js';

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
  const accountA = 'acc_phase8c_detector_a';
  const accountB = 'acc_phase8c_detector_b';

  const importedA = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'CD-1,Detector Oak,4,5',
        'CD-2,Detector Pine,12,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'phase8c-detector-a.csv',
    datasetName: 'Phase 8C Inventory A',
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
        'CD-X,Foreign Detector Cedar,1,2',
      ].join('\n'),
      'utf8'
    ),
    filename: 'phase8c-detector-b.csv',
    datasetName: 'Phase 8C Inventory B',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountB,
    datasetId: importedB.dataset.id,
  });

  const detector = detectorExecutionService
    .list()
    .find((item) => item.id === 'inventory.fixed-low-stock');

  assert(
    detector?.version === '1.0.0' &&
      detector.executionMode === 'TRUSTED_BUILT_IN' &&
      detector.sourceType === 'DATASET' &&
      detector.configSchema.additionalProperties === false &&
      detector.output.kind === 'INSIGHT' &&
      detector.output.evidenceRequired === true,
    'Registered detector catalog must expose the bounded deterministic detector contract.'
  );

  const isolatedRegistry = new DetectorRegistry();
  let arbitraryBlocked = false;
  try {
    isolatedRegistry.registerBuiltIn({
      descriptor: {
        id: 'unsafe.runtime.detector',
        version: '1.0.0',
        name: 'Unsafe runtime detector',
        description: 'Must be rejected.',
        sourceType: 'DATASET',
        executionMode: 'ARBITRARY_CODE' as any,
        stability: 'STABLE',
        configSchema: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
        output: {
          kind: 'INSIGHT',
          supportedTypes: ['RISK'],
          severityModel: 'DETERMINISTIC',
          evidenceRequired: true,
        },
      },
      handler: () => [],
    });
  } catch (error: any) {
    arbitraryBlocked =
      error?.code === 'DETECTOR_DESCRIPTOR_INVALID';
  }
  assert(
    arbitraryBlocked,
    'Detector registry must reject arbitrary runtime execution modes.'
  );

  const referenceTime = Date.parse('2099-05-01T00:00:00Z');
  const first = detectorExecutionService.run({
    accountId: accountA,
    detectorId: 'inventory.fixed-low-stock',
    datasetId: importedA.dataset.id,
    datasetVersionId: importedA.version.id,
    referenceTime,
    config: {
      stockColumn: 'current_stock',
      entityColumn: 'product_name',
      threshold: 5,
      severity: 'HIGH',
    },
  });

  assert(
    /^[a-f0-9]{64}$/.test(first.configHash) &&
      first.insights.length === 1 &&
      first.insights[0].severity === 'HIGH' &&
      first.insights[0].detectorId ===
        'inventory.fixed-low-stock' &&
      first.insights[0].detectorVersion === '1.0.0' &&
      first.insights[0].evidence.datasetId ===
        importedA.dataset.id &&
      first.insights[0].evidence.datasetVersionId ===
        importedA.version.id &&
      first.insights[0].evidence.sourceSha256 ===
        importedA.version.source.sha256 &&
      first.insights[0].evidence.detectorConfigHash ===
        first.configHash &&
      first.insights[0].evidence.detectorConfig?.threshold === 5 &&
      first.insights[0].evidence.rowReferences?.[0]?.values
        .product_name === 'Detector Oak',
    'Detector result must preserve source/version/hash, detector version, config hash, severity, and row evidence.'
  );

  const storedRun = discoveryStore.requireRun(
    accountA,
    first.runId
  );
  assert(
    storedRun.status === 'COMPLETED' &&
      storedRun.detectorRegistrations?.[0]?.detectorId ===
        'inventory.fixed-low-stock' &&
      storedRun.detectorRegistrations?.[0]?.detectorVersion ===
        '1.0.0' &&
      storedRun.detectorRegistrations?.[0]?.configHash ===
        first.configHash &&
      storedRun.detectorRegistrations?.[0]?.config.threshold === 5,
    'AnalysisRun must preserve exact detector/version/config replay metadata.'
  );

  const replay = detectorExecutionService.run({
    accountId: accountA,
    detectorId: 'inventory.fixed-low-stock',
    datasetId: importedA.dataset.id,
    datasetVersionId: importedA.version.id,
    referenceTime,
    config: {
      severity: 'HIGH',
      threshold: 5,
      entityColumn: 'product_name',
      stockColumn: 'current_stock',
    },
  });

  assert(
    replay.configHash === first.configHash &&
      replay.insights.length === 1 &&
      replay.insights[0].fingerprint ===
        first.insights[0].fingerprint &&
      replay.insights[0].id === first.insights[0].id &&
      replay.insights[0].occurrenceCount >= 2,
    'Equivalent normalized config must replay to the same detector fingerprint and deduplicated Insight episode.'
  );

  const oak = companyKnowledgeStore
    .listEntities({
      accountId: accountA,
      type: 'PRODUCT',
      search: 'Detector Oak',
      limit: 20,
    })
    .find((item) => item.identityKey === 'cd 1');
  assert(oak, 'Projected Detector Oak entity was not found.');

  const override = companyKnowledgeStore.recordClaim({
    accountId: accountA,
    subjectEntityId: oak.id,
    predicate: 'CURRENT_STOCK',
    value: 2,
    claimKind: 'FACT',
    authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
    sourceRef: {
      sourceType: 'USER',
      sourceId: 'phase8c-confirmed-state',
      sourceVersionId: 'phase8c-stock-override',
      sourceVersionLabel: 'phase8c-stock-override',
      sourceName: 'Phase 8C confirmed stock',
      excerpt: 'Detector Oak confirmed stock is 2.',
    },
    observedAt: referenceTime + 1000,
    validFrom: referenceTime + 1000,
  });

  const overlayRun = detectorExecutionService.run({
    accountId: accountA,
    detectorId: 'inventory.fixed-low-stock',
    datasetId: importedA.dataset.id,
    datasetVersionId: importedA.version.id,
    referenceTime: referenceTime + 2000,
    config: {
      stockColumn: 'current_stock',
      entityColumn: 'product_name',
      threshold: 5,
      severity: 'HIGH',
    },
  });

  assert(
    overlayRun.insights.length === 1 &&
      overlayRun.insights[0].evidence.companyStateOverlay
        ?.claimIds.includes(override.id) === true &&
      overlayRun.insights[0].evidence.companyStateOverlay
        ?.authorityLevels.includes('USER_CONFIRMED') === true &&
      overlayRun.insights[0].evidence.rowReferences?.[0]?.values
        .current_stock === 2,
    'Registered detector must run over effective confirmed company state and preserve overlay provenance.'
  );

  const immutableVersion = datasetStore.getVersion(
    accountA,
    importedA.dataset.id,
    importedA.version.id
  );
  assert(
    immutableVersion?.tables[0].rows[0][2] === 4,
    'Registered detector execution must not mutate historical imported DatasetVersion bytes/state.'
  );

  const changedConfig = detectorExecutionService.run({
    accountId: accountA,
    detectorId: 'inventory.fixed-low-stock',
    datasetId: importedA.dataset.id,
    datasetVersionId: importedA.version.id,
    referenceTime: referenceTime + 3000,
    config: {
      stockColumn: 'current_stock',
      entityColumn: 'product_name',
      threshold: 10,
      severity: 'HIGH',
    },
  });
  assert(
    changedConfig.configHash !== first.configHash &&
      changedConfig.insights[0].fingerprint !==
        first.insights[0].fingerprint,
    'Changing detector config must create a distinct reproducibility hash/fingerprint.'
  );

  const manifest = publicPlatformManifest();
  assert(
    manifest.scopes.includes(PLATFORM_SCOPES.detectorsRead) &&
      manifest.scopes.includes(PLATFORM_SCOPES.detectorsWrite) &&
      PLATFORM_API_OPERATIONS.some(
        (op) =>
          op.operationId === 'detectors.list' &&
          op.path === '/detectors'
      ) &&
      PLATFORM_API_OPERATIONS.some(
        (op) =>
          op.operationId === 'detectors.run' &&
          op.path === '/detectors/:id/run' &&
          op.mutation === true &&
          op.requiredScopes.includes(
            PLATFORM_SCOPES.detectorsWrite
          )
      ),
    'Stable manifest must declare registered detector read/run contracts and explicit write authority.'
  );

  const readKey = apiKeyStore.createApiKey({
    name: 'Phase 8C detector reader',
    accountId: accountA,
    environment: 'test',
    scopes: [PLATFORM_SCOPES.detectorsRead],
  });
  const writeKey = apiKeyStore.createApiKey({
    name: 'Phase 8C detector runner',
    accountId: accountA,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.detectorsRead,
      PLATFORM_SCOPES.detectorsWrite,
    ],
  });
  const foreignWriteKey = apiKeyStore.createApiKey({
    name: 'Phase 8C foreign detector runner',
    accountId: accountB,
    environment: 'test',
    scopes: [
      PLATFORM_SCOPES.detectorsRead,
      PLATFORM_SCOPES.detectorsWrite,
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
      throw new Error('Could not resolve Phase 8C HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const listed = await json(
      await fetch(baseUrl + '/api/platform/v1/detectors', {
        headers: {
          Authorization: 'Bearer ' + readKey.secret,
        },
      })
    );
    assert(
      listed.response.status === 200 &&
        listed.body.detectors.some(
          (item: any) =>
            item.id === 'inventory.fixed-low-stock' &&
            item.executionMode === 'TRUSTED_BUILT_IN'
        ) &&
        !JSON.stringify(listed.body).includes('handler'),
      'Detector inventory must expose descriptors but never executable handlers.'
    );

    const readOnlyRun = await fetch(
      baseUrl +
        '/api/platform/v1/detectors/inventory.fixed-low-stock/run',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + readKey.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          datasetId: importedA.dataset.id,
          config: {
            stockColumn: 'current_stock',
            threshold: 5,
          },
        }),
      }
    );
    assert(
      readOnlyRun.status === 403,
      'Detector read scope must not imply persisted analysis-run authority.'
    );

    const invalidConfig = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/detectors/inventory.fixed-low-stock/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datasetId: importedA.dataset.id,
            config: {
              stockColumn: 'current_stock',
              threshold: 5,
              code: 'return process.env',
            },
          }),
        }
      )
    );
    assert(
      invalidConfig.response.status === 400 &&
        invalidConfig.body.error?.code ===
          'DETECTOR_CONFIG_INVALID',
      'Closed detector config must reject arbitrary code/unknown fields.'
    );

    const unknownDetector = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/detectors/arbitrary.shell.eval/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datasetId: importedA.dataset.id,
            config: {},
          }),
        }
      )
    );
    assert(
      unknownDetector.response.status === 404 &&
        unknownDetector.body.error?.code ===
          'DETECTOR_NOT_FOUND',
      'Unknown arbitrary detector IDs must fail closed.'
    );

    const foreignDataset = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/detectors/inventory.fixed-low-stock/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + writeKey.secret,
            'Content-Type': 'application/json',
            'X-Account-ID': accountB,
          },
          body: JSON.stringify({
            datasetId: importedB.dataset.id,
            config: {
              stockColumn: 'current_stock',
              threshold: 5,
            },
          }),
        }
      )
    );
    assert(
      foreignDataset.response.status === 404,
      'Registered detector must not cross accounts using a foreign raw Dataset ID.'
    );

    const foreignKeyOwnDataset = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/detectors/inventory.fixed-low-stock/run',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + foreignWriteKey.secret,
            'Content-Type': 'application/json',
            'X-Account-ID': accountA,
          },
          body: JSON.stringify({
            datasetId: importedB.dataset.id,
            config: {
              stockColumn: 'current_stock',
              threshold: 5,
              severity: 'LOW',
            },
          }),
        }
      )
    );
    assert(
      foreignKeyOwnDataset.response.status === 201 &&
        foreignKeyOwnDataset.body.datasetId ===
          importedB.dataset.id &&
        foreignKeyOwnDataset.body.insights.every(
          (item: any) => item.accountId === accountB
        ),
      'Detector run must derive account identity from the API key and ignore spoofed account headers.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_8C_CUSTOM_DETECTOR_CHECK_PASSED');
  console.log(
    'Trusted detector registration, closed config schemas, deterministic replay hashes, existing DiscoveryStore persistence, source/version/hash + overlay evidence, immutable historical datasets, stable detector scopes, and tenant/arbitrary-code isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_8C_CUSTOM_DETECTOR_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
