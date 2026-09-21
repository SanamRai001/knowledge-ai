import express from 'express';
import fs from 'fs';
import path from 'path';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { datasetStore } from '../server/datasets/datasetStore.js';
import { testIntegrationConnector } from '../server/integrations/connectors/testConnector.js';
import { integrationPersistence } from '../server/integrations/integrationPersistence.js';
import { integrationRouter } from '../server/integrations/integrationRouter.js';
import {
  IntegrationRuntimeService,
  integrationRuntimeService,
} from '../server/integrations/integrationRuntimeService.js';
import { IntegrationStateError } from '../server/integrations/integrationStore.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  const body = await response.json();
  return { response, body };
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE === 'postgres',
    'A7B Integration runtime proof must run in postgres persistence mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for A7B Integration runtime proof.'
  );

  await runPostgresMigrations();

  await postgresPool().query(
    'TRUNCATE TABLE integration_external_imports, integration_sync_runs, integration_connections CASCADE'
  );

  const accountA = 'acc_a7b_integrations_a';
  const accountB = 'acc_a7b_integrations_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const integrationFile = path.join(
    process.cwd(),
    'data',
    'integrations.json'
  );
  const integrationFileBefore = fs.existsSync(integrationFile)
    ? fs.readFileSync(integrationFile, 'utf8')
    : null;

  const connection =
    await integrationRuntimeService.createConnection({
      accountId: accountA,
      provider: 'TEST',
      displayName: 'A7B PostgreSQL Integration',
      settings: {
        purpose: 'runtime-cutover-proof',
      },
    });

  assert(
    integrationRuntimeService.usesPostgres(),
    'Integration runtime must select PostgreSQL in postgres persistence mode.'
  );

  testIntegrationConnector.configureConnection({
    connectionId: connection.id,
    fixtures: [
      {
        externalId: 'a7b-orders',
        externalVersion: 'v1',
        name: 'a7b-orders.csv',
        mimeType: 'text/csv',
        content: [
          'order_id,customer_name,balance_due,status',
          'A7B-1,Acme,12000,OPEN',
        ].join('\n'),
        modifiedAt: 1,
      },
    ],
  });

  const keyA = apiKeyStore.createApiKey({
    name: 'A7B account A',
    accountId: accountA,
    environment: 'test',
  });
  const keyB = apiKeyStore.createApiKey({
    name: 'A7B account B',
    accountId: accountB,
    environment: 'test',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve A7B Integration HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const ownConnection = await json(
      await fetch(
        baseUrl +
          '/api/integrations/connections/' +
          encodeURIComponent(connection.id),
        {
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    assert(
      ownConnection.response.status === 200 &&
        ownConnection.body.connection?.id === connection.id &&
        ownConnection.body.connection?.status === 'ACTIVE',
      'Normal Integration HTTP read must use PostgreSQL-selected connection state.'
    );

    const firstSync = await json(
      await fetch(
        baseUrl +
          '/api/integrations/connections/' +
          encodeURIComponent(connection.id) +
          '/sync',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );

    assert(
      firstSync.response.status === 200 &&
        firstSync.body.run?.status === 'COMPLETED' &&
        firstSync.body.run?.importedCount === 1,
      'Normal Integration HTTP sync must complete through PostgreSQL runtime.'
    );

    const pgConnection = await postgresPool().query(
      'SELECT cursor, status, last_successful_sync_at, sync_lease_id, sync_lease_expires_at FROM integration_connections WHERE account_id = $1 AND id = $2',
      [accountA, connection.id]
    );
    const pgRun = await postgresPool().query(
      'SELECT status, cursor_before, cursor_after, imported_count, failed_count FROM integration_sync_runs WHERE account_id = $1 AND id = $2',
      [accountA, firstSync.body.run.id]
    );
    const pgImport = await postgresPool().query(
      "SELECT status, external_id, external_version, internal_kind, internal_id, internal_version_id, knowledge_projection_run_id FROM integration_external_imports WHERE account_id = $1 AND connection_id = $2 AND external_id = 'a7b-orders' AND external_version = 'v1'",
      [accountA, connection.id]
    );

    assert(
      pgConnection.rows[0]?.cursor === '1' &&
        pgConnection.rows[0]?.status === 'ACTIVE' &&
        pgConnection.rows[0]?.last_successful_sync_at &&
        pgConnection.rows[0]?.sync_lease_id === null &&
        pgConnection.rows[0]?.sync_lease_expires_at === null,
      'Successful runtime sync must durably advance PostgreSQL checkpoint and release its lease.'
    );
    assert(
      pgRun.rows[0]?.status === 'COMPLETED' &&
        pgRun.rows[0]?.cursor_before === null &&
        pgRun.rows[0]?.cursor_after === '1' &&
        pgRun.rows[0]?.imported_count === 1 &&
        pgRun.rows[0]?.failed_count === 0,
      'Successful runtime SyncRun must be durably completed in PostgreSQL.'
    );
    assert(
      pgImport.rows[0]?.status === 'READY' &&
        pgImport.rows[0]?.external_id === 'a7b-orders' &&
        pgImport.rows[0]?.external_version === 'v1' &&
        pgImport.rows[0]?.internal_kind === 'DATASET' &&
        Boolean(pgImport.rows[0]?.internal_id) &&
        Boolean(pgImport.rows[0]?.internal_version_id) &&
        Boolean(pgImport.rows[0]?.knowledge_projection_run_id),
      'External import identity and projection provenance must be durable in PostgreSQL.'
    );

    const datasetId = pgImport.rows[0].internal_id;
    assert(
      datasetStore.requireDataset(accountA, datasetId).versionIds.length === 1,
      'A7B must preserve the existing structured payload path while moving Integration metadata to PostgreSQL.'
    );

    const afterFirstSyncFile = fs.existsSync(integrationFile)
      ? fs.readFileSync(integrationFile, 'utf8')
      : null;
    assert(
      afterFirstSyncFile === integrationFileBefore,
      'PostgreSQL Integration runtime must not mutate data/integrations.json.'
    );

    const foreignRead = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connection.id),
      {
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignRead.status === 404,
      'Foreign account must not read PostgreSQL-backed IntegrationConnection by raw ID.'
    );

    const foreignSync = await fetch(
      baseUrl +
        '/api/integrations/connections/' +
        encodeURIComponent(connection.id) +
        '/sync',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignSync.status === 404,
      'Foreign account must not trigger PostgreSQL-backed Integration sync.'
    );

    await closePostgresPool();
    const reconstructed = new IntegrationRuntimeService();
    const persistedConnection = await reconstructed.getConnection(
      accountA,
      connection.id
    );
    const persistedRuns = await reconstructed.listRuns({
      accountId: accountA,
      connectionId: connection.id,
      limit: 10,
    });
    const persistedImports = await reconstructed.listImports({
      accountId: accountA,
      connectionId: connection.id,
      externalId: 'a7b-orders',
      limit: 10,
    });

    assert(
      persistedConnection.cursor === '1' &&
        persistedConnection.status === 'ACTIVE' &&
        persistedRuns.some(
          (run) =>
            run.id === firstSync.body.run.id &&
            run.status === 'COMPLETED'
        ) &&
        persistedImports.some(
          (item) =>
            item.externalVersion === 'v1' &&
            item.status === 'READY'
        ),
      'Integration connection/run/import state must survive PostgreSQL pool/service reconstruction.'
    );

    testIntegrationConnector.appendFixture({
      connectionId: connection.id,
      externalId: 'a7b-orders',
      externalVersion: 'v2',
      name: 'a7b-orders.csv',
      mimeType: 'text/csv',
      content: [
        'order_id,customer_name,balance_due,status',
        'A7B-1,Acme,7000,OPEN',
        'A7B-2,Beta,3000,OPEN',
      ].join('\n'),
      modifiedAt: 2,
    });

    const secondSync = await json(
      await fetch(
        baseUrl +
          '/api/integrations/connections/' +
          encodeURIComponent(connection.id) +
          '/sync',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    assert(
      secondSync.response.status === 200 &&
        secondSync.body.run?.status === 'COMPLETED' &&
        secondSync.body.run?.cursorBefore === '1' &&
        secondSync.body.run?.cursorAfter === '2',
      'Second runtime sync must resume from the durable PostgreSQL checkpoint.'
    );

    const v2 = await postgresPool().query(
      "SELECT internal_id, internal_version_id, status FROM integration_external_imports WHERE account_id = $1 AND connection_id = $2 AND external_id = 'a7b-orders' AND external_version = 'v2'",
      [accountA, connection.id]
    );
    assert(
      v2.rows[0]?.status === 'READY' &&
        v2.rows[0]?.internal_id === datasetId &&
        datasetStore.requireDataset(accountA, datasetId).versionIds.length ===
          2,
      'Changed external version must keep the existing Dataset identity across the PostgreSQL Integration cutover.'
    );

    const leaseA = await integrationPersistence.acquireSyncLease({
      accountId: accountA,
      connectionId: connection.id,
      leaseId: 'a7b-lease-a',
      leaseMs: 60_000,
    });
    assert(
      leaseA.syncLeaseId === 'a7b-lease-a',
      'First PostgreSQL Integration sync lease must be acquired.'
    );

    let overlappingBlocked = false;
    try {
      await integrationPersistence.acquireSyncLease({
        accountId: accountA,
        connectionId: connection.id,
        leaseId: 'a7b-lease-b',
        leaseMs: 60_000,
      });
    } catch (error) {
      overlappingBlocked =
        error instanceof IntegrationStateError &&
        error.code === 'SYNC_ALREADY_RUNNING';
    }
    assert(
      overlappingBlocked,
      'Concurrent PostgreSQL Integration lease acquisition must fail atomically.'
    );

    const duringLease = await reconstructed.getConnection(
      accountA,
      connection.id
    );
    assert(
      duringLease.syncInProgress === true &&
        !Object.prototype.hasOwnProperty.call(
          duringLease,
          'syncLeaseId'
        ),
      'Public Integration state must expose syncInProgress without leaking lease identity.'
    );

    await integrationPersistence.releaseSyncLease({
      accountId: accountA,
      connectionId: connection.id,
      leaseId: 'a7b-lease-a',
    });

    testIntegrationConnector.appendFixture({
      connectionId: connection.id,
      externalId: 'a7b-failure',
      externalVersion: 'v1',
      name: 'a7b-failure.csv',
      mimeType: 'text/csv',
      content: 'id,value\n1,broken',
      failFetch: true,
      modifiedAt: 3,
    });

    const failedSync = await json(
      await fetch(
        baseUrl +
          '/api/integrations/connections/' +
          encodeURIComponent(connection.id) +
          '/sync',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );

    assert(
      failedSync.response.status === 422 &&
        failedSync.body.run?.status === 'FAILED',
      'Failed normal Integration sync must produce a durable failed SyncRun.'
    );

    const failedState = await reconstructed.getConnection(
      accountA,
      connection.id
    );
    assert(
      failedState.status === 'ERROR' &&
        failedState.attentionReason === 'SYNC_FAILED' &&
        Boolean(failedState.lastError),
      'Integration failure state must be read back from PostgreSQL.'
    );

    const resumed = await reconstructed.resume(
      accountA,
      connection.id
    );
    assert(
      resumed.status === 'ACTIVE' &&
        resumed.attentionReason === undefined,
      'Recoverable SYNC_FAILED connection must resume through PostgreSQL runtime.'
    );

    const finalIntegrationFile = fs.existsSync(integrationFile)
      ? fs.readFileSync(integrationFile, 'utf8')
      : null;
    assert(
      finalIntegrationFile === integrationFileBefore,
      'All A7B production Integration operations must leave integrations.json unchanged.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    await closePostgresPool();
  }

  console.log('PRODUCTION_A7B_INTEGRATION_RUNTIME_CHECK_PASSED');
  console.log(
    'PostgreSQL-selected Integration HTTP reads/syncs, transactional checkpoints, external import provenance, account isolation, pool/service reconstruction, same-Dataset versioning, atomic leases, runtime failure/resume state, and zero integrations.json mutation are verified.'
  );
}

main().catch(async (error) => {
  console.error('PRODUCTION_A7B_INTEGRATION_RUNTIME_CHECK_FAILED');
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
