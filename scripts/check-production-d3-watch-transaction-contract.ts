import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const migration = read(
    'server/persistence/migrations/014_watch_job_transaction_boundary.sql'
  );
  assert(
    migration.includes(
      'ADD COLUMN job_id text'
    ) &&
      migration.includes(
        'watch_evaluation_job_fk'
      ) &&
      migration.includes(
        'watch_evaluations_job_unique_idx'
      ) &&
      migration.includes(
        'REFERENCES watch_jobs(account_id, id)'
      ),
    'D3 must database-enforce one scheduled Watch evaluation per account-owned job.'
  );

  const types = read(
    'server/watch/types.ts'
  );
  assert(
    types.includes(
      'jobId?: string;'
    ),
    'WatchEvaluation must carry opaque scheduled job identity.'
  );

  const evaluator = read(
    'server/watch/watchRuntimeEvaluator.ts'
  );
  assert(
    evaluator.includes(
      'prepareScheduledEvaluation'
    ) &&
      evaluator.includes(
        'PreparedScheduledWatchEvaluation'
      ),
    'D3 must prepare scheduled evaluation state without persisting it first.'
  );

  const scheduler = read(
    'server/watch/watchRuntimeScheduler.ts'
  );
  assert(
    scheduler.includes(
      'prepareScheduledEvaluation'
    ) &&
      scheduler.includes(
        'commitClaimedJobEvaluation'
      ) &&
      scheduler.includes(
        'commitClaimedJobTerminalFailure'
      ) &&
      scheduler.includes(
        'PostgresWatchTransactionError'
      ),
    'PostgreSQL Watch scheduler must use the D3 transaction boundary.'
  );

  const postgresBranch = scheduler.slice(
    scheduler.indexOf(
      'public async runCycle'
    ),
    scheduler.indexOf(
      'public start('
    )
  );
  assert(
    !postgresBranch.includes(
      'watchRuntimeEvaluator.evaluate({'
    ),
    'Scheduled PostgreSQL Watch execution must not persist through the old multi-commit evaluator path.'
  );

  assert(
    scheduler.includes(
      'return watchScheduler.runCycle(params);'
    ),
    'File-mode Watch scheduler behavior must remain unchanged.'
  );

  const repository = read(
    'server/persistence/a4PostgresRepositories.ts'
  );
  for (const required of [
    'commitClaimedJobEvaluation(',
    'commitClaimedJobTerminalFailure(',
    'FOR UPDATE',
    'WATCH_JOB_RULE_STATE_CHANGED',
    'WATCH_JOB_EVALUATION_INVALID',
    'saveEvaluationWith(',
    'saveAlertWith(',
    'saveRuleWith(',
    'saveJobWith(',
    "job.status === 'COMPLETED'",
  ]) {
    assert(
      repository.includes(required),
      'D3 repository is missing transaction invariant: ' +
        required
    );
  }

  const persistence = read(
    'server/watch/watchPersistence.ts'
  );
  assert(
    persistence.includes(
      'commitClaimedJobEvaluation'
    ) &&
      persistence.includes(
        'commitClaimedJobTerminalFailure'
      ),
    'Watch persistence facade must expose D3 transactional commits.'
  );

  const workerCandidates = [
    'bullmq',
    'bee-queue',
    'agenda',
    'pg-boss',
  ];
  const pkg = read('package.json');
  for (const candidate of workerCandidates) {
    assert(
      !pkg.toLowerCase().includes(
        candidate
      ),
      'D3 must stop before Track E worker/queue extraction: ' +
        candidate
    );
  }

  console.log(
    'PRODUCTION_D3_WATCH_TRANSACTION_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Job-linked evaluation idempotency, post-claim transaction routing, row-lock/state guards, atomic terminal failure, file-mode preservation, and Track E scope boundary are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_D3_WATCH_TRANSACTION_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
