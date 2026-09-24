import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  setSourceByteStorageForTesting,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  integrationRuntimeService,
} from '../server/integrations/integrationRuntimeService.js';
import {
  integrationPersistence,
} from '../server/integrations/integrationPersistence.js';
import {
  testIntegrationConnector,
} from '../server/integrations/connectors/testConnector.js';
import {
  enqueueIntegrationSyncJob,
  getIntegrationSyncJob,
  handleIntegrationSyncJob,
  INTEGRATION_SYNC_JOB_TYPE,
  integrationSyncJobRun,
  listIntegrationSyncJobs,
  registerIntegrationSyncWorkerHandler,
} from '../server/integrations/integrationSyncWorker.js';
import {
  PostgresWorkerJobRepository,
} from '../server/worker/postgresWorkerJobRepository.js';
import {
  WorkerJobHandlerRegistry,
} from '../server/worker/workerJobHandlerRegistry.js';
import {
  WorkerJobRuntime,
} from '../server/worker/workerJobRuntime.js';
import {
  MemorySourceByteStorage,
} from './support/memorySourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function csv(
  version: string,
  value: number
): string {
  return [
    'product_id,product_name,current_stock,reorder_level,version',
    'E4-P1,E4 Widget,' +
      String(value) +
      ',4,' +
      version,
  ].join('\n');
}

async function counts(input: {
  accountId: string;
  connectionId: string;
}) {
  const result =
    await postgresPool().query(
      `SELECT
         (SELECT count(*)::int
          FROM integration_sync_runs
          WHERE account_id = $1
            AND connection_id = $2)
            AS run_count,
         (SELECT count(*)::int
          FROM integration_external_imports
          WHERE account_id = $1
            AND connection_id = $2)
            AS import_count,
         (SELECT count(*)::int
          FROM dataset_versions
          WHERE account_id = $1)
            AS version_count`,
      [
        input.accountId,
        input.connectionId,
      ]
    );

  return {
    runs: Number(
      result.rows[0]?.run_count ||
        0
    ),
    imports: Number(
      result.rows[0]?.import_count ||
        0
    ),
    versions: Number(
      result.rows[0]?.version_count ||
        0
    ),
  };
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'E4 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for E4 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes(
      '017'
    ) ||
      migrations.alreadyApplied.includes(
        '017'
      ),
    'E4 requires migration 017.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const storage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    storage
  );

  const accountA = 'acc_e4_a';
  const accountB = 'acc_e4_b';

  try {
    await postgresAccountRepository
      .ensureAccount(accountA);
    await postgresAccountRepository
      .ensureAccount(accountB);

    const connection =
      await integrationRuntimeService
        .createConnection({
          accountId: accountA,
          provider: 'TEST',
          displayName:
            'E4 worker integration',
        });

    testIntegrationConnector
      .configureConnection({
        connectionId:
          connection.id,
        fixtures: [
          {
            externalId:
              'e4-inventory',
            externalVersion: 'v1',
            name:
              'e4-inventory.csv',
            mimeType: 'text/csv',
            content: csv('v1', 10),
            modifiedAt: 1,
          },
        ],
      });

    const [
      queuedA,
      queuedReplay,
    ] = await Promise.all([
      enqueueIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        requestedBy:
          'user:e4-a',
      }),
      enqueueIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        requestedBy:
          'user:e4-a-retry',
      }),
    ]);

    assert(
      queuedA.id ===
        queuedReplay.id &&
        queuedA.status ===
          'PENDING',
      'Concurrent E4 enqueue requests for one unchanged connection baseline must coalesce to one worker job.'
    );

    for (const forbidden of [
      'leaseToken',
      'leaseOwner',
      'payload',
      'idempotencyKey',
      'concurrencyKey',
    ]) {
      assert(
        !Object.prototype
          .hasOwnProperty.call(
            queuedA,
            forbidden
          ),
        'Browser-safe E4 job view leaked worker field: ' +
          forbidden
      );
    }

    const linkedCount =
      await postgresPool().query(
        `SELECT count(*)::int AS count
         FROM integration_sync_worker_jobs
         WHERE account_id = $1
           AND connection_id = $2`,
        [
          accountA,
          connection.id,
        ]
      );
    assert(
      Number(
        linkedCount.rows[0]?.count
      ) === 1,
      'E4 coalesced enqueue must create one durable Integration/worker linkage.'
    );

    assert(
      (
        await getIntegrationSyncJob({
          accountId: accountB,
          connectionId:
            connection.id,
          jobId: queuedA.id,
        })
      ) === null &&
        (
          await listIntegrationSyncJobs({
            accountId: accountB,
            connectionId:
              connection.id,
          })
        ).length === 0,
      'Raw E4 job/connection IDs must remain account scoped.'
    );

    const repository =
      new PostgresWorkerJobRepository();
    const registry =
      new WorkerJobHandlerRegistry();
    registerIntegrationSyncWorkerHandler(
      registry
    );
    const worker =
      new WorkerJobRuntime(
        repository,
        registry,
        'e4_worker'
      );

    const firstCycle =
      await worker.runCycle({
        leaseMs: 90_000,
        maxJobs: 10,
      });

    assert(
      firstCycle.succeededJobIds
        .includes(queuedA.id),
      'E4 worker must claim and complete the queued Integration sync.'
    );

    const firstJob =
      await getIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        jobId: queuedA.id,
      });
    const firstRun =
      await integrationSyncJobRun({
        accountId: accountA,
        syncRunId:
          firstJob?.syncRunId,
      });
    const firstConnection =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );
    const firstCounts =
      await counts({
        accountId: accountA,
        connectionId:
          connection.id,
      });

    assert(
      firstJob?.status ===
        'SUCCEEDED' &&
        firstRun?.status ===
          'COMPLETED' &&
        firstRun.cursorBefore ===
          undefined &&
        firstRun.cursorAfter ===
          '1' &&
        firstConnection.cursor ===
          '1' &&
        firstCounts.runs === 1 &&
        firstCounts.imports === 1 &&
        firstCounts.versions === 1,
      'Successful E4 worker execution must preserve C6 checkpoint semantics and create one Dataset version/import/run.'
    );

    // Crash after C6 checkpoint success but before worker-job settlement/linkage.
    testIntegrationConnector
      .appendFixture({
        connectionId:
          connection.id,
        externalId:
          'e4-inventory',
        externalVersion: 'v2',
        name:
          'e4-inventory.csv',
        mimeType: 'text/csv',
        content: csv('v2', 20),
        modifiedAt: 2,
      });

    const secondJob =
      await enqueueIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        requestedBy:
          'user:e4-crash-after-sync',
      });

    const crashedClaim =
      await repository.claim({
        workerId:
          'e4_crashed_after_sync',
        leaseMs: 90_000,
        jobTypes: [
          INTEGRATION_SYNC_JOB_TYPE,
        ],
      });

    assert(
      crashedClaim?.id ===
        secondJob.id,
      'E4 crash-after-success proof requires the second job to be claimed.'
    );

    const directCompletedRun =
      await integrationRuntimeService
        .sync({
          accountId: accountA,
          connectionId:
            connection.id,
        });

    assert(
      directCompletedRun.status ===
        'COMPLETED' &&
        directCompletedRun.cursorAfter ===
          '2',
      'Simulated crashed worker must first commit the C6 provider checkpoint successfully.'
    );

    const linkBeforeRestart =
      await getIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        jobId: secondJob.id,
      });
    assert(
      linkBeforeRestart?.status ===
        'RUNNING' &&
        !linkBeforeRestart.syncRunId,
      'Crash simulation must leave worker job RUNNING and unlinked after the Integration checkpoint committed.'
    );

    await postgresPool().query(
      `UPDATE worker_jobs
       SET lease_expires_at =
         NOW() - interval '1 second'
       WHERE account_id = $1
         AND id = $2`,
      [
        accountA,
        secondJob.id,
      ]
    );

    const restartedWorker =
      new WorkerJobRuntime(
        repository,
        registry,
        'e4_restarted_after_sync'
      );
    const restartCycle =
      await restartedWorker
        .runCycle({
          leaseMs: 90_000,
          maxJobs: 10,
        });

    const secondAfter =
      await getIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        jobId: secondJob.id,
      });
    const secondCounts =
      await counts({
        accountId: accountA,
        connectionId:
          connection.id,
      });

    assert(
      restartCycle.recoveredJobIds
        .includes(secondJob.id) &&
        restartCycle.succeededJobIds
          .includes(secondJob.id) &&
        secondAfter?.status ===
          'SUCCEEDED' &&
        secondAfter.syncRunId ===
          directCompletedRun.id &&
        secondAfter.attemptCount ===
          2 &&
        secondCounts.runs === 2 &&
        secondCounts.imports === 2 &&
        secondCounts.versions === 2,
      'Recovered E4 job must attach the already-committed SyncRun without repeating provider checkpoint, import, or Dataset version.'
    );

    // Crash before handler work starts: stale generic lease is recovered and sync executes once.
    testIntegrationConnector
      .appendFixture({
        connectionId:
          connection.id,
        externalId:
          'e4-inventory',
        externalVersion: 'v3',
        name:
          'e4-inventory.csv',
        mimeType: 'text/csv',
        content: csv('v3', 30),
        modifiedAt: 3,
      });

    const thirdJob =
      await enqueueIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        requestedBy:
          'user:e4-crash-before-work',
      });

    const preWorkCrash =
      await repository.claim({
        workerId:
          'e4_crashed_before_work',
        leaseMs: 90_000,
        jobTypes: [
          INTEGRATION_SYNC_JOB_TYPE,
        ],
      });
    assert(
      preWorkCrash?.id ===
        thirdJob.id,
      'E4 pre-work crash proof requires the third job to be claimed.'
    );

    await postgresPool().query(
      `UPDATE worker_jobs
       SET lease_expires_at =
         NOW() - interval '1 second'
       WHERE account_id = $1
         AND id = $2`,
      [
        accountA,
        thirdJob.id,
      ]
    );

    const preWorkRestart =
      await restartedWorker
        .runCycle({
          leaseMs: 90_000,
          maxJobs: 10,
        });

    const thirdAfter =
      await getIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        jobId: thirdJob.id,
      });
    const connectionAtThree =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );
    const thirdCounts =
      await counts({
        accountId: accountA,
        connectionId:
          connection.id,
      });

    assert(
      preWorkRestart.recoveredJobIds
        .includes(thirdJob.id) &&
        preWorkRestart.succeededJobIds
          .includes(thirdJob.id) &&
        thirdAfter?.status ===
          'SUCCEEDED' &&
        thirdAfter.attemptCount ===
          2 &&
        connectionAtThree.cursor ===
          '3' &&
        thirdCounts.runs === 3 &&
        thirdCounts.imports === 3 &&
        thirdCounts.versions === 3,
      'Expired E4 worker lease before work must recover and execute one logical C6 sync/checkpoint.'
    );

    // Terminal worker-delivery failure must dead-letter truthfully without checkpoint movement.
    await integrationPersistence
      .acquireSyncLease({
        accountId: accountA,
        connectionId:
          connection.id,
        leaseId:
          'e4-held-sync-lease',
        leaseMs: 60_000,
      });

    const deadLetterJob =
      await enqueueIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        requestedBy:
          'user:e4-dead-letter',
      });

    await postgresPool().query(
      `UPDATE worker_jobs
       SET max_attempts = 1
       WHERE account_id = $1
         AND id = $2`,
      [
        accountA,
        deadLetterJob.id,
      ]
    );

    const deadCycle =
      await restartedWorker
        .runCycle({
          leaseMs: 90_000,
          maxJobs: 10,
        });

    const deadAfter =
      await getIntegrationSyncJob({
        accountId: accountA,
        connectionId:
          connection.id,
        jobId: deadLetterJob.id,
      });
    const afterDeadConnection =
      await integrationPersistence
        .requireConnection(
          accountA,
          connection.id
        );
    const deadCounts =
      await counts({
        accountId: accountA,
        connectionId:
          connection.id,
      });

    assert(
      deadCycle.deadLetterJobIds
        .includes(
          deadLetterJob.id
        ) &&
        deadAfter?.status ===
          'DEAD_LETTER' &&
        Boolean(deadAfter.lastError) &&
        afterDeadConnection.cursor ===
          '3' &&
        afterDeadConnection.status ===
          'ACTIVE' &&
        afterDeadConnection
          .attentionReason ===
          'SYNC_FAILED' &&
        Boolean(
          afterDeadConnection.lastError
        ) &&
        deadCounts.runs === 3 &&
        deadCounts.imports === 3 &&
        deadCounts.versions === 3,
      'Terminal E4 worker-delivery failure must dead-letter and surface Integration health without corrupting the last committed C6 checkpoint.'
    );

    await integrationPersistence
      .releaseSyncLease({
        accountId: accountA,
        connectionId:
          connection.id,
        leaseId:
          'e4-held-sync-lease',
      });

    const listed =
      await listIntegrationSyncJobs({
        accountId: accountA,
        connectionId:
          connection.id,
        limit: 20,
      });

    assert(
      listed.some(
        (job) =>
          job.id ===
            deadLetterJob.id &&
          job.status ===
            'DEAD_LETTER'
      ) &&
        listed.some(
          (job) =>
            job.id ===
              queuedA.id &&
            job.status ===
              'SUCCEEDED'
        ),
      'E4 job history must retain truthful inspectable terminal states.'
    );

    console.log(
      'PRODUCTION_E4_INTEGRATION_SYNC_WORKER_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Coalesced enqueue, account isolation, successful worker sync, crash-after-checkpoint reconciliation, stale-lease recovery, no duplicate Dataset/import/checkpoint work, and dead-letter health metadata are verified.'
    );
  } finally {
    setSourceByteStorageForTesting(
      null
    );
  }
}

main()
  .catch((error) => {
    setSourceByteStorageForTesting(
      null
    );
    console.error(
      'PRODUCTION_E4_INTEGRATION_SYNC_WORKER_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
