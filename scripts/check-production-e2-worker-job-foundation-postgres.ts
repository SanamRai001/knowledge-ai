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
  PostgresWorkerJobRepository,
} from '../server/worker/postgresWorkerJobRepository.js';
import {
  WorkerJobHandlerRegistry,
} from '../server/worker/workerJobHandlerRegistry.js';
import {
  WorkerJobRuntime,
} from '../server/worker/workerJobRuntime.js';
import {
  WorkerJobHandlerError,
  WorkerJobLeaseError,
} from '../server/worker/workerJobTypes.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'E2 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for E2 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes('015') ||
      migrations.alreadyApplied.includes(
        '015'
      ),
    'E2 requires migration 015.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const accountA = 'acc_e2_a';
  const accountB = 'acc_e2_b';
  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  const repository =
    new PostgresWorkerJobRepository();

  // Database-enforced enqueue idempotency, including concurrent callers.
  const [idemA, idemB] =
    await Promise.all([
      repository.enqueue({
        accountId: accountA,
        jobType: 'IDEMPOTENT_TEST',
        idempotencyKey:
          'same-request',
        payload: { version: 1 },
      }),
      repository.enqueue({
        accountId: accountA,
        jobType: 'IDEMPOTENT_TEST',
        idempotencyKey:
          'same-request',
        payload: { version: 2 },
      }),
    ]);

  assert(
    idemA.id === idemB.id &&
      idemA.payload.version ===
        idemB.payload.version &&
      [1, 2].includes(
        Number(
          idemA.payload.version
        )
      ),
    'Concurrent enqueue with the same account/type/idempotency key must converge on one durable job without mutating the winning payload.'
  );

  const foreignIdem =
    await repository.enqueue({
      accountId: accountB,
      jobType: 'IDEMPOTENT_TEST',
      idempotencyKey:
        'same-request',
    });
  assert(
    foreignIdem.id !== idemA.id,
    'Idempotency keys must remain account scoped.'
  );

  // Claim is atomic across workers.
  const once =
    await repository.enqueue({
      accountId: accountA,
      jobType: 'CLAIM_ONCE',
    });
  const claimNow = Date.now() + 1_000;
  const [claimA, claimB] =
    await Promise.all([
      repository.claim({
        workerId: 'worker_a',
        leaseMs: 5_000,
        now: claimNow,
        jobTypes: ['CLAIM_ONCE'],
      }),
      repository.claim({
        workerId: 'worker_b',
        leaseMs: 5_000,
        now: claimNow,
        jobTypes: ['CLAIM_ONCE'],
      }),
    ]);
  const claimed =
    [claimA, claimB].filter(
      Boolean
    );

  assert(
    claimed.length === 1 &&
      claimed[0]!.id === once.id,
    'SKIP LOCKED claim must give one queued job to only one concurrent worker.'
  );

  const winner = claimed[0]!;
  const winnerWorker =
    winner.leaseOwner!;

  let wrongTokenBlocked = false;
  try {
    await repository.heartbeat({
      accountId: accountA,
      jobId: winner.id,
      workerId: winnerWorker,
      leaseToken: 'wrong-token',
      leaseMs: 5_000,
      now: claimNow + 1_000,
    });
  } catch (error) {
    wrongTokenBlocked =
      error instanceof
        WorkerJobLeaseError;
  }
  assert(
    wrongTokenBlocked,
    'Heartbeat must be fenced by lease token.'
  );

  const heartbeated =
    await repository.heartbeat({
      accountId: accountA,
      jobId: winner.id,
      workerId: winnerWorker,
      leaseToken:
        winner.leaseToken!,
      leaseMs: 5_000,
      now: claimNow + 1_000,
    });
  assert(
    heartbeated.leaseExpiresAt! >
      winner.leaseExpiresAt!,
    'Heartbeat must extend the owned lease.'
  );

  let wrongOwnerBlocked = false;
  try {
    await repository.complete({
      accountId: accountA,
      jobId: winner.id,
      workerId: 'worker_wrong',
      leaseToken:
        winner.leaseToken!,
      now: claimNow + 2_000,
    });
  } catch (error) {
    wrongOwnerBlocked =
      error instanceof
        WorkerJobLeaseError;
  }
  assert(
    wrongOwnerBlocked,
    'Completion must be fenced by lease owner and token.'
  );

  const completed =
    await repository.complete({
      accountId: accountA,
      jobId: winner.id,
      workerId: winnerWorker,
      leaseToken:
        winner.leaseToken!,
      now: claimNow + 2_000,
    });
  assert(
    completed.status ===
      'SUCCEEDED' &&
      !completed.leaseOwner &&
      Boolean(
        completed.completedAt
      ),
    'Owned completion must atomically settle the job and clear lease state.'
  );

  // Concurrency keys prevent simultaneous ownership of the same logical lane.
  const lane1 =
    await repository.enqueue({
      accountId: accountA,
      jobType: 'LANE_TEST',
      concurrencyKey:
        'connection_1',
    });
  const lane2 =
    await repository.enqueue({
      accountId: accountA,
      jobType: 'LANE_TEST',
      concurrencyKey:
        'connection_1',
    });

  const laneClaim1 =
    await repository.claim({
      workerId: 'lane_worker_1',
      leaseMs: 5_000,
      now: claimNow + 3_000,
      jobTypes: ['LANE_TEST'],
    });
  const laneClaimBlocked =
    await repository.claim({
      workerId: 'lane_worker_2',
      leaseMs: 5_000,
      now: claimNow + 3_000,
      jobTypes: ['LANE_TEST'],
    });

  assert(
    Boolean(laneClaim1) &&
      laneClaimBlocked === null &&
      [lane1.id, lane2.id].includes(
        laneClaim1!.id
      ),
    'A running concurrency key must block a second job in the same account/type/lane.'
  );

  await repository.complete({
    accountId: accountA,
    jobId: laneClaim1!.id,
    workerId:
      laneClaim1!.leaseOwner!,
    leaseToken:
      laneClaim1!.leaseToken!,
    now: claimNow + 3_500,
  });

  const laneClaim2 =
    await repository.claim({
      workerId: 'lane_worker_2',
      leaseMs: 5_000,
      now: claimNow + 4_000,
      jobTypes: ['LANE_TEST'],
    });

  assert(
    Boolean(laneClaim2) &&
      laneClaim2!.id !==
        laneClaim1!.id,
    'The next same-lane job may run only after prior ownership is released.'
  );
  await repository.complete({
    accountId: accountA,
    jobId: laneClaim2!.id,
    workerId:
      laneClaim2!.leaseOwner!,
    leaseToken:
      laneClaim2!.leaseToken!,
    now: claimNow + 4_500,
  });

  // Lease expiry recovery fences stale workers and preserves retry budget.
  const stale =
    await repository.enqueue({
      accountId: accountA,
      jobType: 'STALE_RECOVERY',
      maxAttempts: 2,
    });
  const staleClaim =
    await repository.claim({
      workerId: 'stale_worker',
      leaseMs: 5_000,
      now: claimNow + 5_000,
      jobTypes: [
        'STALE_RECOVERY',
      ],
    });
  assert(
    staleClaim?.id === stale.id,
    'Stale recovery precondition: job must be claimed.'
  );

  const recovered =
    await repository.recoverStale({
      now: claimNow + 10_001,
      jobTypes: [
        'STALE_RECOVERY',
      ],
    });

  assert(
    recovered.length === 1 &&
      recovered[0].id ===
        stale.id &&
      recovered[0].status ===
        'PENDING' &&
      recovered[0].attemptCount ===
        1,
    'Expired RUNNING job with retry budget must return to PENDING.'
  );

  let staleTokenBlocked = false;
  try {
    await repository.complete({
      accountId: accountA,
      jobId: stale.id,
      workerId: 'stale_worker',
      leaseToken:
        staleClaim!.leaseToken!,
      now: claimNow + 10_100,
    });
  } catch (error) {
    staleTokenBlocked =
      error instanceof
        WorkerJobLeaseError;
  }
  assert(
    staleTokenBlocked,
    'Recovered stale job must reject completion from its old lease token.'
  );

  const reclaimed =
    await repository.claim({
      workerId: 'stale_worker_2',
      leaseMs: 5_000,
      now: claimNow + 10_100,
      jobTypes: [
        'STALE_RECOVERY',
      ],
    });
  assert(
    reclaimed?.id === stale.id &&
      reclaimed.attemptCount ===
        2,
    'Recovered job must be reclaimable with incremented attempt count.'
  );

  const exhausted =
    await repository.fail({
      accountId: accountA,
      jobId: stale.id,
      workerId:
        reclaimed!.leaseOwner!,
      leaseToken:
        reclaimed!.leaseToken!,
      error:
        'retry budget exhausted',
      retryable: true,
      now: claimNow + 10_200,
    });
  assert(
    exhausted.status ===
      'DEAD_LETTER' &&
      Boolean(exhausted.completedAt),
    'Retryable failure at max attempts must transition to inspectable DEAD_LETTER.'
  );

  // Retry/backoff is deterministic and cannot be claimed early.
  const retry =
    await repository.enqueue({
      accountId: accountA,
      jobType: 'RETRY_BACKOFF',
      maxAttempts: 2,
    });
  const retryClaim1 =
    await repository.claim({
      workerId: 'retry_worker',
      leaseMs: 5_000,
      now: claimNow + 20_000,
      jobTypes: [
        'RETRY_BACKOFF',
      ],
    });
  const retryPending =
    await repository.fail({
      accountId: accountA,
      jobId: retry.id,
      workerId:
        retryClaim1!.leaseOwner!,
      leaseToken:
        retryClaim1!.leaseToken!,
      error: 'transient',
      retryable: true,
      now: claimNow + 20_100,
    });

  assert(
    retryPending.status ===
      'PENDING' &&
      retryPending.nextAttemptAt ===
        claimNow + 50_100,
    'First retry must use deterministic 30-second backoff.'
  );

  const tooEarly =
    await repository.claim({
      workerId: 'retry_early',
      leaseMs: 5_000,
      now:
        retryPending.nextAttemptAt -
        1,
      jobTypes: [
        'RETRY_BACKOFF',
      ],
    });
  assert(
    tooEarly === null,
    'Retry job must not be claimable before nextAttemptAt.'
  );

  const retryClaim2 =
    await repository.claim({
      workerId: 'retry_worker_2',
      leaseMs: 5_000,
      now:
        retryPending.nextAttemptAt,
      jobTypes: [
        'RETRY_BACKOFF',
      ],
    });
  const retryDead =
    await repository.fail({
      accountId: accountA,
      jobId: retry.id,
      workerId:
        retryClaim2!.leaseOwner!,
      leaseToken:
        retryClaim2!.leaseToken!,
      error: 'still failing',
      retryable: true,
      now:
        retryPending.nextAttemptAt +
        10,
    });

  assert(
    retryDead.status ===
      'DEAD_LETTER',
    'Second retryable failure at max attempts must dead-letter.'
  );

  const nonRetry =
    await repository.enqueue({
      accountId: accountA,
      jobType: 'NON_RETRYABLE',
    });
  const nonRetryClaim =
    await repository.claim({
      workerId: 'nonretry_worker',
      leaseMs: 5_000,
      now: claimNow + 60_000,
      jobTypes: [
        'NON_RETRYABLE',
      ],
    });
  const nonRetryFailed =
    await repository.fail({
      accountId: accountA,
      jobId: nonRetry.id,
      workerId:
        nonRetryClaim!.leaseOwner!,
      leaseToken:
        nonRetryClaim!.leaseToken!,
      error: 'invalid payload',
      retryable: false,
      now: claimNow + 60_100,
    });
  assert(
    nonRetryFailed.status ===
      'FAILED',
    'Non-retryable handler failure must settle as FAILED without consuming future attempts.'
  );

  // Account-scoped inspection.
  assert(
    (
      await repository.get(
        accountB,
        retry.id
      )
    ) === null,
    'Raw worker job ID must not cross account scope.'
  );

  // Provider-neutral handler runtime.
  const registry =
    new WorkerJobHandlerRegistry();
  let handled = 0;
  registry.register(
    'RUNTIME_SUCCESS',
    async ({ heartbeat }) => {
      handled += 1;
      await heartbeat(5_000);
    }
  );
  registry.register(
    'RUNTIME_FAILURE',
    async () => {
      throw new WorkerJobHandlerError(
        'permanent runtime failure',
        false
      );
    }
  );

  const runtimeSuccess =
    await repository.enqueue({
      accountId: accountA,
      jobType:
        'RUNTIME_SUCCESS',
    });
  const runtimeFailure =
    await repository.enqueue({
      accountId: accountA,
      jobType:
        'RUNTIME_FAILURE',
    });
  const unknown =
    await repository.enqueue({
      accountId: accountA,
      jobType:
        'UNREGISTERED_JOB',
    });

  const runtime =
    new WorkerJobRuntime(
      repository,
      registry,
      'runtime_worker'
    );
  const cycle =
    await runtime.runCycle({
      leaseMs: 5_000,
      maxJobs: 10,
    });

  const runtimeSuccessAfter =
    await repository.get(
      accountA,
      runtimeSuccess.id
    );
  const runtimeFailureAfter =
    await repository.get(
      accountA,
      runtimeFailure.id
    );
  const unknownAfter =
    await repository.get(
      accountA,
      unknown.id
    );

  assert(
    handled === 1 &&
      runtimeSuccessAfter?.status ===
        'SUCCEEDED' &&
      runtimeFailureAfter?.status ===
        'FAILED' &&
      unknownAfter?.status ===
        'PENDING' &&
      cycle.succeededJobIds.includes(
        runtimeSuccess.id
      ) &&
      cycle.failedJobIds.includes(
        runtimeFailure.id
      ),
    'Generic runtime must dispatch only registered job types, heartbeat owned work, settle success/failure truthfully, and leave unknown types untouched.'
  );

  console.log(
    'PRODUCTION_E2_WORKER_JOB_FOUNDATION_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Concurrent idempotent enqueue, SKIP LOCKED claim, lease fencing/heartbeat, concurrency lanes, stale recovery, deterministic retry/dead-letter, account isolation, and handler runtime dispatch are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_E2_WORKER_JOB_FOUNDATION_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
