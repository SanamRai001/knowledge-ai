import express from 'express';
import fs from 'fs';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetStore } from '../server/datasets/datasetStore.js';
import { integrationRouter } from '../server/integrations/integrationRouter.js';
import { integrationStore } from '../server/integrations/integrationStore.js';
import { integrationSyncService } from '../server/integrations/integrationSyncService.js';
import { testIntegrationConnector } from '../server/integrations/connectors/testConnector.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_integrations_phase6a_a';
  const accountB = 'acc_integrations_phase6a_b';

  const connection = integrationSyncService.createConnection({
    accountId: accountA,
    provider: 'TEST',
    displayName: 'Phase 6A deterministic connector',
    settings: {
      syncMode: 'incremental',
    },
    credentialRef: 'vault-ref-phase6a-test',
  });

  testIntegrationConnector.configureConnection({
    connectionId: connection.id,
    fixtures: [
      {
        externalId: 'ext-orders',
        externalVersion: 'v1',
        name: 'external-orders.csv',
        mimeType: 'text/csv',
        content: [
          'order_id,customer_name,balance_due,status',
          'EXT-1,Acme,12000,OPEN',
        ].join('\n'),
        modifiedAt: 1,
        webUrl: 'https://example.invalid/ext-orders',
      },
    ],
  });

  const first = await integrationSyncService.sync({
    accountId: accountA,
    connectionId: connection.id,
  });

  assert(
    first.status === 'COMPLETED' &&
      first.cursorBefore === undefined &&
      first.cursorAfter === '1' &&
      first.importedCount === 1 &&
      first.failedCount === 0,
    'First incremental sync must import v1 and advance the checkpoint.'
  );

  const firstConnection = integrationStore.requireConnection(
    accountA,
    connection.id
  );
  assert(
    firstConnection.cursor === '1' &&
      Boolean(firstConnection.lastSuccessfulSyncAt),
    'Connection checkpoint and successful-sync timestamp must persist.'
  );

  const v1Import = integrationStore.findExactImport(
    accountA,
    connection.id,
    'ext-orders',
    'v1'
  );
  assert(
    v1Import?.status === 'READY' &&
      v1Import.internalKind === 'DATASET' &&
      Boolean(v1Import.internalId) &&
      Boolean(v1Import.internalVersionId) &&
      v1Import.provenance.provider === 'TEST' &&
      v1Import.provenance.externalId === 'ext-orders' &&
      v1Import.provenance.externalVersion === 'v1' &&
      v1Import.provenance.webUrl ===
        'https://example.invalid/ext-orders',
    'External import must preserve exact provider/resource/version provenance.'
  );

  const datasetId = v1Import.internalId!;
  const datasetAfterV1 = datasetStore.requireDataset(
    accountA,
    datasetId
  );
  assert(
    datasetAfterV1.versionIds.length === 1,
    'First external version must create exactly one internal DatasetVersion.'
  );

  const noChange = await integrationSyncService.sync({
    accountId: accountA,
    connectionId: connection.id,
  });
  assert(
    noChange.status === 'COMPLETED' &&
      noChange.processedCount === 0 &&
      noChange.cursorBefore === '1' &&
      noChange.cursorAfter === '1' &&
      datasetStore.requireDataset(accountA, datasetId).versionIds
        .length === 1,
    'A sync with no external changes must not duplicate the current dataset version.'
  );

  testIntegrationConnector.appendFixture({
    connectionId: connection.id,
    externalId: 'ext-orders',
    externalVersion: 'v2',
    name: 'external-orders.csv',
    mimeType: 'text/csv',
    content: [
      'order_id,customer_name,balance_due,status',
      'EXT-1,Acme,7000,OPEN',
      'EXT-2,Beta,4000,OPEN',
    ].join('\n'),
    modifiedAt: 2,
    webUrl: 'https://example.invalid/ext-orders',
  });

  const second = await integrationSyncService.sync({
    accountId: accountA,
    connectionId: connection.id,
  });

  const v2Import = integrationStore.findExactImport(
    accountA,
    connection.id,
    'ext-orders',
    'v2'
  );
  const datasetAfterV2 = datasetStore.requireDataset(
    accountA,
    datasetId
  );

  assert(
    second.status === 'COMPLETED' &&
      second.cursorBefore === '1' &&
      second.cursorAfter === '2' &&
      second.importedCount === 1 &&
      v2Import?.status === 'READY' &&
      v2Import.internalId === datasetId &&
      datasetAfterV2.versionIds.length === 2 &&
      datasetAfterV2.currentVersionId ===
        v2Import.internalVersionId,
    'A changed external version must append a new version to the same internal Dataset.'
  );

  testIntegrationConnector.appendFixture({
    connectionId: connection.id,
    externalId: 'ext-products',
    externalVersion: 'v1',
    name: 'external-products.csv',
    mimeType: 'text/csv',
    content: [
      'product_id,product_name,current_stock,reorder_level',
      'P-EXT-1,Oak,10,5',
    ].join('\n'),
    modifiedAt: 3,
  });
  testIntegrationConnector.appendFixture({
    connectionId: connection.id,
    externalId: 'ext-suppliers',
    externalVersion: 'v1',
    name: 'external-suppliers.csv',
    mimeType: 'text/csv',
    content: [
      'supplier_id,supplier_name',
      'S-EXT-1,Timber Co',
    ].join('\n'),
    modifiedAt: 4,
    failFetch: true,
  });

  const failed = await integrationSyncService.sync({
    accountId: accountA,
    connectionId: connection.id,
  });

  const afterFailure = integrationStore.requireConnection(
    accountA,
    connection.id
  );
  const productImport = integrationStore.findExactImport(
    accountA,
    connection.id,
    'ext-products',
    'v1'
  );

  assert(
    failed.status === 'FAILED' &&
      failed.cursorBefore === '2' &&
      failed.cursorAfter === undefined &&
      failed.importedCount === 1 &&
      failed.failedCount === 1 &&
      afterFailure.cursor === '2' &&
      afterFailure.status === 'ERROR' &&
      afterFailure.attentionReason === 'SYNC_FAILED' &&
      productImport?.status === 'READY',
    'A partial sync failure must preserve successful idempotent imports, freeze the checkpoint, and expose explicit connection error state.'
  );

  const productDatasetVersionCount =
    datasetStore.requireDataset(
      accountA,
      productImport!.internalId!
    ).versionIds.length;

  testIntegrationConnector.setFetchFailure({
    connectionId: connection.id,
    externalId: 'ext-suppliers',
    externalVersion: 'v1',
    failFetch: false,
  });

  const resumed = integrationSyncService.resume(
    accountA,
    connection.id
  );
  assert(
    resumed.status === 'ACTIVE' &&
      resumed.attentionReason === undefined,
    'A generic failed sync must require explicit resume before retry.'
  );

  const retry = await integrationSyncService.sync({
    accountId: accountA,
    connectionId: connection.id,
  });
  const afterRetry = integrationStore.requireConnection(
    accountA,
    connection.id
  );

  assert(
    retry.status === 'COMPLETED' &&
      retry.cursorBefore === '2' &&
      retry.cursorAfter === '4' &&
      retry.skippedCount === 1 &&
      retry.importedCount === 1 &&
      afterRetry.cursor === '4',
    'Retry must skip the already imported record, finish the failed record, and only then advance the checkpoint.'
  );

  assert(
    datasetStore.requireDataset(
      accountA,
      productImport!.internalId!
    ).versionIds.length === productDatasetVersionCount,
    'Retry must not duplicate the record that succeeded before the prior failed checkpoint.'
  );

  const publicView = integrationSyncService.getConnection(
    accountA,
    connection.id
  );
  assert(
    !Object.prototype.hasOwnProperty.call(
      publicView,
      'credentialRef'
    ) &&
      publicView.hasCredential === true &&
      !JSON.stringify(publicView).includes(
        'vault-ref-phase6a-test'
      ),
    'API-safe connection metadata must not expose the credential reference.'
  );

  const persisted = fs.readFileSync(
    'data/integrations.json',
    'utf8'
  );
  assert(
    !persisted.includes('accessToken') &&
      !persisted.includes('refreshToken') &&
      !persisted.includes('clientSecret'),
    'Integration persistence must not contain raw provider secret fields.'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error(
        'Could not resolve Phase 6A integration test port.'
      );
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Phase 6A A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Phase 6A B',
      accountId: accountB,
      environment: 'test',
    });

    const ownResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connection.id,
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      ownResponse.status === 200,
      'Owning account must be able to inspect its integration connection.'
    );
    const ownBody = await ownResponse.json();
    assert(
      ownBody.connection?.id === connection.id &&
        ownBody.connection?.hasCredential === true &&
        ownBody.connection?.credentialRef === undefined &&
        !JSON.stringify(ownBody).includes(
          'vault-ref-phase6a-test'
        ),
      'Integration HTTP API must expose safe metadata without credential references.'
    );

    const foreignResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connection.id,
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignResponse.status === 404,
      'Foreign account must not inspect another account integration even with a spoofed account header.'
    );

    const foreignSync = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connection.id +
        '/sync',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignSync.status === 404,
      'Foreign account must not trigger another account integration sync.'
    );

    const runsResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connection.id +
        '/runs',
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      runsResponse.status === 200,
      'Owning account must be able to inspect sync history.'
    );
    const runsBody = await runsResponse.json();
    assert(
      Array.isArray(runsBody.runs) &&
        runsBody.runs.some(
          (run: any) =>
            run.status === 'FAILED' &&
            run.cursorBefore === '2'
        ) &&
        runsBody.runs.some(
          (run: any) =>
            run.status === 'COMPLETED' &&
            run.cursorAfter === '4'
        ),
      'Sync history must expose failure and successful retry state.'
    );

    const revokeResponse = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connection.id +
        '/revoke',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      revokeResponse.status === 200,
      'Connection revocation endpoint failed.'
    );

    const revokedSync = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connection.id +
        '/sync',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      revokedSync.status === 409,
      'Revoked connection must fail closed instead of syncing.'
    );

    const resumeRevoked = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        connection.id +
        '/resume',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      resumeRevoked.status === 409,
      'Revoked connection must not be reactivated through normal resume.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  console.log('PHASE_6A_INTEGRATION_FOUNDATION_CHECK_PASSED');
  console.log(
    'Shared connector contracts, incremental cursor sync, external-version idempotency, same-dataset versioning, failed-checkpoint retry, exact provenance, secret-safe API metadata, revocation, and account isolation are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_6A_INTEGRATION_FOUNDATION_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
