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
  datasetService,
} from '../server/datasets/datasetService.js';
import {
  companyKnowledgePersistence,
} from '../server/companyKnowledge/companyKnowledgePersistence.js';
import {
  SOURCE_AUTHORITIES,
} from '../server/companyKnowledge/sourceAuthority.js';
import {
  effectiveCompanyStateRuntimeService,
} from '../server/companyKnowledge/effectiveCompanyStateRuntimeService.js';
import {
  actionPersistence,
} from '../server/actions/actionPersistence.js';
import {
  actionRuntimeExecutionService,
} from '../server/actions/actionRuntimeExecutionService.js';
import {
  ACTION_DISCOVERY_REFRESH_JOB_TYPE,
  registerActionDiscoveryWorkerHandler,
} from '../server/actions/actionDiscoveryWorker.js';
import {
  postgresActionRepository,
} from '../server/persistence/a3PostgresRepositories.js';
import {
  discoveryPersistence,
} from '../server/discovery/discoveryPersistence.js';
import type {
  AnalysisRun,
} from '../server/discovery/types.js';
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

async function createAction(input: {
  accountId: string;
  entityId: string;
  entityType: string;
  entityLabel: string;
  afterValue: number;
}) {
  const effective =
    await effectiveCompanyStateRuntimeService
      .resolve(
        input.accountId,
        input.entityId,
        'CURRENT_STOCK'
      );

  assert(
    effective.status === 'RESOLVED',
    'E3 Action precondition requires resolved CURRENT_STOCK.'
  );
  if (
    effective.status !==
    'RESOLVED'
  ) {
    throw new Error(
      'Expected resolved company state.'
    );
  }

  return actionPersistence.createProposal({
    accountId: input.accountId,
    instruction:
      'Set ' +
      input.entityLabel +
      ' stock to ' +
      String(input.afterValue) +
      '.',
    intent: 'UPDATE_STATUS',
    status: 'PROPOSED',
    parserSource: 'DETERMINISTIC',
    parsedInput: {
      intent: 'UPDATE_STATUS',
      productReference:
        input.entityLabel,
      status:
        String(input.afterValue),
    },
    targetEntityIds: [
      input.entityId,
    ],
    mutations: [
      {
        entityId: input.entityId,
        entityType:
          input.entityType,
        entityLabel:
          input.entityLabel,
        predicate:
          'CURRENT_STOCK',
        operation: 'SET',
        beforeValue:
          effective.value,
        afterValue:
          input.afterValue,
        valueSource:
          'USER_PROVIDED',
        explanation:
          'E3 worker migration proof',
      },
    ],
    preconditions: [
      {
        entityId: input.entityId,
        predicate:
          'CURRENT_STOCK',
        effectiveClaimId:
          effective.effectiveClaim.id,
        effectiveValue:
          effective.value,
        authority:
          effective.effectiveClaim
            .authority,
      },
    ],
    eventType:
      'E3_STOCK_UPDATED',
    eventData: {
      stock: input.afterValue,
    },
    expiresAt:
      Date.now() + 120_000,
  });
}

async function actionMutationCount(
  accountId: string,
  proposalId: string
): Promise<number> {
  const result =
    await postgresPool().query(
      `SELECT count(*)::int AS count
       FROM knowledge_claims
       WHERE account_id = $1
         AND source_ref->>'sourceVersionId' = $2`,
      [accountId, proposalId]
    );
  return Number(
    result.rows[0]?.count || 0
  );
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'E3 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for E3 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes(
      '016'
    ) ||
      migrations.alreadyApplied.includes(
        '016'
      ),
    'E3 requires migration 016.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const storage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    storage
  );

  const accountA = 'acc_e3_a';
  const accountB = 'acc_e3_b';

  try {
    await postgresAccountRepository
      .ensureAccount(accountA);
    await postgresAccountRepository
      .ensureAccount(accountB);

    const imported =
      await datasetService.importFile({
        accountId: accountA,
        buffer: Buffer.from(
          [
            'product_id,product_name,current_stock,reorder_level',
            'E3-1,E3 Widget,10,4',
          ].join('\n'),
          'utf8'
        ),
        filename:
          'e3-inventory.csv',
        mimeType: 'text/csv',
        datasetName:
          'E3 Inventory',
      });

    const sourceRef = {
      sourceType:
        'DATASET' as const,
      sourceId:
        imported.dataset.id,
      sourceVersionId:
        imported.version.id,
      sourceVersionLabel:
        'Dataset version ' +
        String(
          imported.version
            .versionNumber
        ),
      sourceName:
        'E3 Inventory',
    };

    const entity =
      await companyKnowledgePersistence
        .upsertEntity({
          accountId: accountA,
          type: 'PRODUCT',
          canonicalName:
            'E3 Widget',
          identityKey:
            'e3-widget',
          sourceRef,
          observedAt: Date.now(),
        });

    await companyKnowledgePersistence
      .recordClaim({
        accountId: accountA,
        subjectEntityId:
          entity.id,
        predicate:
          'CURRENT_STOCK',
        value: 10,
        claimKind: 'FACT',
        authority: {
          ...SOURCE_AUTHORITIES
            .STRUCTURED_SOURCE,
        },
        sourceRef,
        observedAt: Date.now(),
        validFrom: Date.now(),
      });

    const firstProposal =
      await createAction({
        accountId: accountA,
        entityId: entity.id,
        entityType: entity.type,
        entityLabel:
          entity.canonicalName,
        afterValue: 20,
      });

    const [firstConfirm, replayConfirm] =
      await Promise.all([
        actionRuntimeExecutionService
          .confirm({
            accountId: accountA,
            proposalId:
              firstProposal.id,
          }),
        actionRuntimeExecutionService
          .confirm({
            accountId: accountA,
            proposalId:
              firstProposal.id,
          }),
      ]);

    assert(
      firstConfirm.execution.id ===
        replayConfirm.execution.id,
      'Concurrent E3 confirmations must converge on the same D1 execution.'
    );

    const firstExecution =
      await postgresActionRepository
        .getExecution(
          accountA,
          firstConfirm.execution.id
        );

    assert(
      firstExecution?.downstreamDiscoveryJobIds
        ?.length === 1 &&
        (
          firstExecution
            .downstreamAnalysisRunIds ||
          []
        ).length === 0,
      'Confirmed Action must persist one queued E3 job and return before Discovery analysis runs.'
    );

    const firstJobId =
      firstExecution!
        .downstreamDiscoveryJobIds![0];
    const repository =
      new PostgresWorkerJobRepository();
    const firstJob =
      await repository.get(
        accountA,
        firstJobId
      );

    assert(
      firstJob?.status ===
        'PENDING' &&
        firstJob.jobType ===
          ACTION_DISCOVERY_REFRESH_JOB_TYPE &&
        firstJob.idempotencyKey ===
          'action-discovery:' +
            firstExecution!.id +
            ':' +
            imported.dataset.id,
      'E3 must enqueue one durable deterministic job per Action execution/Dataset.'
    );

    const firstPayload =
      firstJob!.payload as {
        analysisRunId: string;
      };

    assert(
      (
        await discoveryPersistence
          .getRun(
            accountA,
            firstPayload.analysisRunId
          )
      ) === null,
      'Discovery analysis must not run on the Action request path.'
    );

    const effectiveAfterConfirm =
      await effectiveCompanyStateRuntimeService
        .resolve(
          accountA,
          entity.id,
          'CURRENT_STOCK'
        );
    assert(
      effectiveAfterConfirm.status ===
        'RESOLVED' &&
        effectiveAfterConfirm.value ===
          20 &&
        (await actionMutationCount(
          accountA,
          firstProposal.id
        )) === 1,
      'D1 company-state mutation must already be committed exactly once before the E3 worker runs.'
    );

    assert(
      (
        await postgresActionRepository
          .getExecution(
            accountB,
            firstExecution!.id
          )
      ) === null,
      'Raw Action execution IDs must remain account scoped.'
    );

    const registry =
      new WorkerJobHandlerRegistry();
    registerActionDiscoveryWorkerHandler(
      registry
    );
    const worker =
      new WorkerJobRuntime(
        repository,
        registry,
        'e3_worker'
      );

    const firstCycle =
      await worker.runCycle({
        leaseMs: 5_000,
        maxJobs: 10,
      });

    assert(
      firstCycle.succeededJobIds
        .includes(firstJobId),
      'E3 worker must complete the queued Discovery refresh.'
    );

    const firstAfter =
      await repository.get(
        accountA,
        firstJobId
      );
    const firstExecutionAfter =
      await postgresActionRepository
        .getExecution(
          accountA,
          firstExecution!.id
        );
    const firstRun =
      await discoveryPersistence
        .getRun(
          accountA,
          firstPayload.analysisRunId
        );

    assert(
      firstAfter?.status ===
        'SUCCEEDED' &&
        firstRun?.status ===
          'COMPLETED' &&
        firstExecutionAfter
          ?.downstreamAnalysisRunIds
          ?.includes(
            firstPayload.analysisRunId
          ),
      'Successful E3 worker completion must persist the deterministic Discovery run ID on the Action execution.'
    );

    // Crash/restart: claim a second job, lose its lease, then recover it.
    const secondProposal =
      await createAction({
        accountId: accountA,
        entityId: entity.id,
        entityType: entity.type,
        entityLabel:
          entity.canonicalName,
        afterValue: 30,
      });
    const secondConfirm =
      await actionRuntimeExecutionService
        .confirm({
          accountId: accountA,
          proposalId:
            secondProposal.id,
        });
    const secondExecution =
      await postgresActionRepository
        .getExecution(
          accountA,
          secondConfirm.execution.id
        );
    const secondJobId =
      secondExecution!
        .downstreamDiscoveryJobIds![0];

    const crashNow =
      Date.now() + 1_000;
    const crashedClaim =
      await repository.claim({
        workerId:
          'e3_crashed_worker',
        leaseMs: 5_000,
        now: crashNow,
        jobTypes: [
          ACTION_DISCOVERY_REFRESH_JOB_TYPE,
        ],
      });

    assert(
      crashedClaim?.id ===
        secondJobId,
      'E3 restart proof requires the second Action job to be claimed by the simulated crashed worker.'
    );

    const restartedWorker =
      new WorkerJobRuntime(
        repository,
        registry,
        'e3_restarted_worker'
      );
    const restartCycle =
      await restartedWorker
        .runCycle({
          now:
            crashNow + 5_001,
          leaseMs: 5_000,
          maxJobs: 10,
        });

    const secondAfter =
      await repository.get(
        accountA,
        secondJobId
      );

    assert(
      restartCycle.recoveredJobIds
        .includes(secondJobId) &&
        restartCycle.succeededJobIds
          .includes(secondJobId) &&
        secondAfter?.status ===
          'SUCCEEDED' &&
        secondAfter.attemptCount ===
          2 &&
        (await actionMutationCount(
          accountA,
          secondProposal.id
        )) === 1,
      'Expired E3 lease must recover/retry the downstream job without replaying the committed Action mutation.'
    );

    // Terminal downstream failure must never rewrite Action success.
    const thirdProposal =
      await createAction({
        accountId: accountA,
        entityId: entity.id,
        entityType: entity.type,
        entityLabel:
          entity.canonicalName,
        afterValue: 40,
      });
    const thirdConfirm =
      await actionRuntimeExecutionService
        .confirm({
          accountId: accountA,
          proposalId:
            thirdProposal.id,
        });
    const thirdExecution =
      await postgresActionRepository
        .getExecution(
          accountA,
          thirdConfirm.execution.id
        );
    const thirdJobId =
      thirdExecution!
        .downstreamDiscoveryJobIds![0];
    const thirdJob =
      await repository.get(
        accountA,
        thirdJobId
      );
    const thirdPayload =
      thirdJob!.payload as {
        datasetId: string;
        analysisRunId: string;
        referenceTime: number;
      };

    const conflictingRun:
      AnalysisRun = {
      id:
        thirdPayload.analysisRunId,
      accountId: accountA,
      sourceType: 'DATASET',
      datasetId:
        thirdPayload.datasetId,
      datasetVersionId:
        imported.version.id,
      status: 'RUNNING',
      startedAt:
        thirdPayload.referenceTime +
        1,
      referenceTime:
        thirdPayload.referenceTime +
        1,
      detectorIds: [],
      insightIds: [],
    };
    await discoveryPersistence
      .saveRun(conflictingRun);

    let terminal =
      await repository.get(
        accountA,
        thirdJobId
      );

    for (
      let attempt = 0;
      attempt < 4 &&
      terminal &&
      terminal.status !==
        'DEAD_LETTER';
      attempt += 1
    ) {
      await restartedWorker
        .runCycle({
          now:
            terminal.nextAttemptAt,
          leaseMs: 5_000,
          maxJobs: 1,
        });
      terminal =
        await repository.get(
          accountA,
          thirdJobId
        );
    }

    const thirdExecutionAfter =
      await postgresActionRepository
        .getExecution(
          accountA,
          thirdExecution!.id
        );
    const thirdProposalAfter =
      await actionPersistence
        .requireProposal(
          accountA,
          thirdProposal.id
        );

    assert(
      terminal?.status ===
        'DEAD_LETTER' &&
        thirdProposalAfter.status ===
          'CONFIRMED' &&
        (await actionMutationCount(
          accountA,
          thirdProposal.id
        )) === 1 &&
        Boolean(
          thirdExecutionAfter
            ?.downstreamWarnings
            ?.some((warning) =>
              warning.includes(
                'Discovery refresh failed for dataset ' +
                  imported.dataset.id
              )
            )
        ),
      'Terminal E3 Discovery failure must dead-letter truthfully, append downstream warning metadata, and leave the committed Action successful exactly once.'
    );

    const jobCount =
      await postgresPool().query(
        `SELECT count(*)::int AS count
         FROM worker_jobs
         WHERE account_id = $1
           AND job_type = $2
           AND idempotency_key = $3`,
        [
          accountA,
          ACTION_DISCOVERY_REFRESH_JOB_TYPE,
          'action-discovery:' +
            firstExecution!.id +
            ':' +
            imported.dataset.id,
        ]
      );

    assert(
      Number(
        jobCount.rows[0]?.count
      ) === 1,
      'E3 database idempotency must retain exactly one logical job across concurrent/replayed Action finalization.'
    );

    console.log(
      'PRODUCTION_E3_ACTION_DISCOVERY_WORKER_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'Post-commit enqueue, concurrent idempotency, Action-success independence, worker completion metadata, stale-lease restart recovery, deterministic analysis identity, dead-letter warnings, no Action replay, and account isolation are verified.'
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
      'PRODUCTION_E3_ACTION_DISCOVERY_WORKER_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
