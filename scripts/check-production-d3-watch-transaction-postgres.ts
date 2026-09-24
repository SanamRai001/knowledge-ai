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
  PostgresWatchTransactionError,
} from '../server/persistence/a4PostgresRepositories.js';
import {
  watchPersistence,
} from '../server/watch/watchPersistence.js';
import type {
  WatchEvaluation,
  WatchJob,
  WatchRule,
} from '../server/watch/types.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

const accountA = 'acc_d3_a';
const accountB = 'acc_d3_b';

function entityEvidence(
  value: number
) {
  return {
    sourceType: 'ENTITY' as const,
    entityId: 'ent_d3_product',
    entityLabel: 'D3 Product',
    predicate: 'CURRENT_STOCK',
    effectiveClaimId:
      'clm_d3_' + String(value),
    effectiveValue: value,
    authorityLevel: 'SYSTEM',
    sourceName:
      'D3 transaction proof',
  };
}

async function createRule(
  suffix: string,
  nextEvaluationAt: number
): Promise<WatchRule> {
  return watchPersistence.createRule({
    accountId: accountA,
    name: 'D3 Watch ' + suffix,
    status: 'ACTIVE',
    origin: 'SYSTEM',
    condition: {
      kind:
        'ENTITY_NUMERIC_THRESHOLD',
      entityId: 'ent_d3_product',
      predicate: 'CURRENT_STOCK',
      operator: 'LT',
      threshold: 5,
    },
    evaluationMode: 'INTERVAL',
    intervalMinutes: 60,
    nextEvaluationAt,
  });
}

async function createAndClaim(
  rule: WatchRule,
  scheduledFor: number,
  maxAttempts = 3,
  leaseStartedAt = scheduledFor
): Promise<WatchJob> {
  const job =
    await watchPersistence.ensureJob({
      accountId: accountA,
      watchRuleId: rule.id,
      ruleVersion: rule.version,
      scheduledFor,
      maxAttempts,
    });

  const claimed =
    await watchPersistence.claimReadyJob({
      now: scheduledFor,
      leaseStartedAt,
    });

  assert(
    claimed?.id === job.id &&
      claimed.status === 'RUNNING',
    'D3 proof must claim the intended Watch job.'
  );

  return claimed;
}

function evaluation(input: {
  id: string;
  job: WatchJob;
  rule: WatchRule;
  matched: boolean;
  evaluatedAt: number;
  previousState?: WatchEvaluation[
    'previousConditionState'
  ];
}): WatchEvaluation {
  return {
    id: input.id,
    accountId: accountA,
    jobId: input.job.id,
    watchRuleId: input.rule.id,
    ruleVersion:
      input.rule.version,
    status: 'COMPLETED',
    conditionMatched:
      input.matched,
    observedValue:
      input.matched ? 3 : 8,
    comparisonOperator: 'LT',
    threshold: 5,
    previousConditionState:
      input.previousState ??
      input.rule.currentState,
    nextConditionState:
      input.matched
        ? 'TRUE'
        : 'FALSE',
    evidence: entityEvidence(
      input.matched ? 3 : 8
    ),
    evaluatedAt:
      input.evaluatedAt,
  };
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'D3 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for D3 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes('014') ||
      migrations.alreadyApplied.includes(
        '014'
      ),
    'D3 requires migration 014.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  const base =
    Date.parse(
      '2099-06-01T10:00:00Z'
    );

  // 1. Concurrent duplicate completion converges on one evaluation/alert.
  const ruleOne =
    await createRule(
      'concurrent',
      base
    );
  const jobOne =
    await createAndClaim(
      ruleOne,
      base
    );
  const evalOne = evaluation({
    id: 'wev_d3_concurrent',
    job: jobOne,
    rule: ruleOne,
    matched: true,
    evaluatedAt: base,
  });

  const commitInput = {
    accountId: accountA,
    jobId: jobOne.id,
    expectedRuleVersion:
      ruleOne.version,
    completedAt: base,
    evaluation: evalOne,
    newAlert: {
      id: 'wal_d3_concurrent',
      episodeKey:
        'd3:concurrent:' +
        jobOne.id,
      title: 'D3 low stock',
      summary:
        'Stock is below threshold.',
    },
  };

  const [first, second] =
    await Promise.all([
      watchPersistence
        .commitClaimedJobEvaluation(
          commitInput
        ),
      watchPersistence
        .commitClaimedJobEvaluation(
          commitInput
        ),
    ]);

  assert(
    [first, second].filter(
      (item) =>
        item.idempotentReplay
    ).length === 1 &&
      first.evaluation.id ===
        second.evaluation.id &&
      first.job.id === second.job.id,
    'Concurrent duplicate D3 completion must converge on one committed result.'
  );

  const oneState =
    await postgresPool().query(
      `SELECT
         (SELECT count(*)::int
            FROM watch_evaluations
           WHERE account_id = $1
             AND job_id = $2) AS evaluations,
         (SELECT count(*)::int
            FROM watch_alerts
           WHERE account_id = $1
             AND watch_rule_id = $3) AS alerts,
         (SELECT occurrence_count
            FROM watch_alerts
           WHERE account_id = $1
             AND watch_rule_id = $3
           LIMIT 1) AS occurrences,
         (SELECT status
            FROM watch_jobs
           WHERE account_id = $1
             AND id = $2) AS job_status`,
      [
        accountA,
        jobOne.id,
        ruleOne.id,
      ]
    );

  assert(
    Number(
      oneState.rows[0]
        ?.evaluations
    ) === 1 &&
      Number(
        oneState.rows[0]
          ?.alerts
      ) === 1 &&
      Number(
        oneState.rows[0]
          ?.occurrences
      ) === 1 &&
      oneState.rows[0]
        ?.job_status ===
        'COMPLETED',
    'Database idempotency must prevent duplicate evaluation/alert effects for one job.'
  );

  // 2. A later TRUE job updates the same episode once.
  const ruleAfterOne =
    await watchPersistence.requireRule(
      accountA,
      ruleOne.id
    );
  const jobTwo =
    await createAndClaim(
      ruleAfterOne,
      base + 1
    );
  const evalTwo = evaluation({
    id: 'wev_d3_repeat',
    job: jobTwo,
    rule: ruleAfterOne,
    matched: true,
    evaluatedAt: base + 1,
    previousState: 'TRUE',
  });

  const repeated =
    await watchPersistence
      .commitClaimedJobEvaluation({
        accountId: accountA,
        jobId: jobTwo.id,
        expectedRuleVersion:
          ruleAfterOne.version,
        completedAt: base + 1,
        evaluation: evalTwo,
      });

  assert(
    repeated.alert?.id ===
      'wal_d3_concurrent' &&
      repeated.alert
        .occurrenceCount === 2,
    'Repeated TRUE scheduled evaluation must update one alert episode exactly once.'
  );

  // 3. TRUE -> FALSE resolves the same episode atomically.
  const ruleAfterTwo =
    await watchPersistence.requireRule(
      accountA,
      ruleOne.id
    );
  const jobThree =
    await createAndClaim(
      ruleAfterTwo,
      base + 2
    );
  const falseCommit =
    await watchPersistence
      .commitClaimedJobEvaluation({
        accountId: accountA,
        jobId: jobThree.id,
        expectedRuleVersion:
          ruleAfterTwo.version,
        completedAt: base + 2,
        evaluation: evaluation({
          id: 'wev_d3_false',
          job: jobThree,
          rule: ruleAfterTwo,
          matched: false,
          evaluatedAt: base + 2,
          previousState: 'TRUE',
        }),
      });

  assert(
    falseCommit.rule
      .currentState === 'FALSE' &&
      falseCommit.alert?.status ===
        'RESOLVED' &&
      falseCommit.job.status ===
        'COMPLETED',
    'D3 false transition must resolve alert, update rule, and complete job together.'
  );

  // 4. Late failure after evaluation insertion rolls every write back.
  const rollbackRule =
    await createRule(
      'rollback',
      base + 10
    );
  const rollbackJob =
    await createAndClaim(
      rollbackRule,
      base + 10
    );
  let lateRollback = false;
  try {
    await watchPersistence
      .commitClaimedJobEvaluation({
        accountId: accountA,
        jobId: rollbackJob.id,
        expectedRuleVersion:
          rollbackRule.version,
        completedAt: base + 10,
        evaluation: evaluation({
          id: 'wev_d3_rollback',
          job: rollbackJob,
          rule: rollbackRule,
          matched: true,
          evaluatedAt:
            base + 10,
        }),
        // Intentionally omit newAlert:
        // the transaction has already reached evaluation persistence
        // before it discovers this invalid late-stage input.
      });
  } catch (error) {
    lateRollback =
      error instanceof
        PostgresWatchTransactionError &&
      error.code ===
        'WATCH_JOB_EVALUATION_INVALID';
  }

  const rollbackState =
    await postgresPool().query(
      `SELECT
         (SELECT count(*)::int
            FROM watch_evaluations
           WHERE account_id = $1
             AND job_id = $2) AS evaluations,
         (SELECT count(*)::int
            FROM watch_alerts
           WHERE account_id = $1
             AND watch_rule_id = $3) AS alerts,
         (SELECT status
            FROM watch_jobs
           WHERE account_id = $1
             AND id = $2) AS job_status,
         (SELECT current_state
            FROM watch_rules
           WHERE account_id = $1
             AND id = $3) AS rule_state`,
      [
        accountA,
        rollbackJob.id,
        rollbackRule.id,
      ]
    );

  assert(
    lateRollback &&
      Number(
        rollbackState.rows[0]
          ?.evaluations
      ) === 0 &&
      Number(
        rollbackState.rows[0]
          ?.alerts
      ) === 0 &&
      rollbackState.rows[0]
        ?.job_status ===
        'RUNNING' &&
      rollbackState.rows[0]
        ?.rule_state ===
        'UNKNOWN',
    'Late D3 transaction failure must roll back evaluation, alert, rule, and job writes.'
  );

  // Cross-account transaction cannot target the claimed job.
  let foreignBlocked = false;
  try {
    await watchPersistence
      .commitClaimedJobEvaluation({
        accountId: accountB,
        jobId: rollbackJob.id,
        expectedRuleVersion:
          rollbackRule.version,
        completedAt: base + 10,
        evaluation: {
          ...evaluation({
            id: 'wev_d3_foreign',
            job: rollbackJob,
            rule: rollbackRule,
            matched: true,
            evaluatedAt:
              base + 10,
          }),
          accountId: accountB,
        },
        newAlert: {
          id: 'wal_d3_foreign',
          episodeKey:
            'd3:foreign',
          title: 'foreign',
          summary: 'foreign',
        },
      });
  } catch (error) {
    foreignBlocked =
      error instanceof
        PostgresWatchTransactionError &&
      error.code ===
        'WATCH_JOB_NOT_FOUND';
  }
  assert(
    foreignBlocked,
    'Foreign account must not commit another account claimed Watch job.'
  );

  // 5. Prepared state goes stale before commit: no evaluation is written.
  await watchPersistence.updateRule(
    accountA,
    rollbackRule.id,
    {
      currentState: 'FALSE',
    }
  );

  let staleStateBlocked = false;
  try {
    await watchPersistence
      .commitClaimedJobEvaluation({
        accountId: accountA,
        jobId: rollbackJob.id,
        expectedRuleVersion:
          rollbackRule.version,
        completedAt: base + 11,
        evaluation: evaluation({
          id: 'wev_d3_stale',
          job: rollbackJob,
          rule: rollbackRule,
          matched: true,
          evaluatedAt:
            base + 11,
          previousState: 'UNKNOWN',
        }),
        newAlert: {
          id: 'wal_d3_stale',
          episodeKey:
            'd3:stale',
          title: 'stale',
          summary: 'stale',
        },
      });
  } catch (error) {
    staleStateBlocked =
      error instanceof
        PostgresWatchTransactionError &&
      error.code ===
        'WATCH_JOB_RULE_STATE_CHANGED';
  }

  const staleEvaluationCount =
    await postgresPool().query(
      `SELECT count(*)::int AS count
       FROM watch_evaluations
       WHERE account_id = $1
         AND job_id = $2`,
      [
        accountA,
        rollbackJob.id,
      ]
    );
  assert(
    staleStateBlocked &&
      Number(
        staleEvaluationCount.rows[0]
          ?.count
      ) === 0,
    'Stale measured rule state must be rejected before any durable evaluation effect.'
  );

  await watchPersistence.updateJob(
    accountA,
    rollbackJob.id,
    {
      status: 'SKIPPED',
      completedAt: base + 11,
      skipReason:
        'D3 stale-state proof cleanup',
    }
  );

  // 6. Terminal worker failure updates job + rule atomically and replays safely.
  const failureRule =
    await createRule(
      'terminal-failure',
      base + 20
    );
  const failureJob =
    await createAndClaim(
      failureRule,
      base + 20,
      1
    );

  const terminal =
    await watchPersistence
      .commitClaimedJobTerminalFailure({
        accountId: accountA,
        jobId: failureJob.id,
        expectedRuleVersion:
          failureRule.version,
        failedAt: base + 20,
        error:
          'D3 synthetic worker failure',
      });
  const terminalReplay =
    await watchPersistence
      .commitClaimedJobTerminalFailure({
        accountId: accountA,
        jobId: failureJob.id,
        expectedRuleVersion:
          failureRule.version,
        failedAt: base + 20,
        error:
          'D3 synthetic worker failure',
      });

  assert(
    terminal.job.status ===
      'FAILED' &&
      terminal.rule.currentState ===
        'ERROR' &&
      terminalReplay
        .idempotentReplay === true,
    'Terminal Watch worker failure must atomically settle job/rule and be idempotent.'
  );

  // 7. Crash after claim -> stale lease requeue -> reclaim -> one committed result.
  const recoveryRule =
    await createRule(
      'lease-recovery',
      base + 30
    );
  const recoveryJob =
    await createAndClaim(
      recoveryRule,
      base + 30,
      3,
      base + 30
    );

  const recovered =
    await watchPersistence
      .requeueStaleRunningJobs({
        now: base + 120_030,
        leaseMs: 60_000,
      });

  assert(
    recovered.some(
      (job) =>
        job.id ===
          recoveryJob.id &&
        job.status ===
          'PENDING'
    ),
    'Stale claimed Watch job must become retryable after lease expiry.'
  );

  const reclaimed =
    await watchPersistence
      .claimReadyJob({
        now: base + 120_030,
        leaseStartedAt:
          base + 120_030,
      });

  assert(
    reclaimed?.id ===
      recoveryJob.id &&
      reclaimed.attemptCount ===
        2,
    'Recovered Watch job must be reclaimable exactly once with incremented attempt count.'
  );

  await watchPersistence
    .commitClaimedJobEvaluation({
      accountId: accountA,
      jobId: reclaimed!.id,
      expectedRuleVersion:
        recoveryRule.version,
      completedAt:
        base + 120_030,
      evaluation: evaluation({
        id: 'wev_d3_recovered',
        job: reclaimed!,
        rule: recoveryRule,
        matched: true,
        evaluatedAt:
          base + 120_030,
      }),
      newAlert: {
        id: 'wal_d3_recovered',
        episodeKey:
          'd3:recovered:' +
          reclaimed!.id,
        title: 'D3 recovered',
        summary:
          'Recovered lease committed once.',
      },
    });

  const recoveryState =
    await postgresPool().query(
      `SELECT
         (SELECT count(*)::int
            FROM watch_evaluations
           WHERE account_id = $1
             AND job_id = $2) AS evaluations,
         (SELECT count(*)::int
            FROM watch_alerts
           WHERE account_id = $1
             AND watch_rule_id = $3) AS alerts,
         (SELECT status
            FROM watch_jobs
           WHERE account_id = $1
             AND id = $2) AS status`,
      [
        accountA,
        recoveryJob.id,
        recoveryRule.id,
      ]
    );

  assert(
    Number(
      recoveryState.rows[0]
        ?.evaluations
    ) === 1 &&
      Number(
        recoveryState.rows[0]
          ?.alerts
      ) === 1 &&
      recoveryState.rows[0]
        ?.status ===
        'COMPLETED',
    'Lease recovery must converge on one evaluation/alert and one completed job.'
  );

  console.log(
    'PRODUCTION_D3_WATCH_TRANSACTION_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Concurrent idempotency, alert episode transitions, late rollback, stale-state blocking, cross-account denial, terminal failure atomicity, and stale-lease recovery are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_D3_WATCH_TRANSACTION_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
