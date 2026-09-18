import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import { watchEvaluator } from '../server/watch/watchEvaluator.js';
import { watchRouter } from '../server/watch/watchRouter.js';
import { watchScheduler } from '../server/watch/watchScheduler.js';
import { watchService } from '../server/watch/watchService.js';
import { WatchStore, watchStore } from '../server/watch/watchStore.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const accountA = 'acc_watch_phase5d_a';
  const accountB = 'acc_watch_phase5d_b';
  const baseTime = Date.parse('2026-09-18T18:00:00Z');

  const inventoryCsv = [
    'product_id,product_name,current_stock,reorder_level',
    'P-51,Walnut Boards,3,5',
    'P-52,Maple Boards,8,4',
    'P-53,Ash Boards,6,3',
  ].join('\n');

  const inventory = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(inventoryCsv, 'utf8'),
    filename: 'watch-scheduler-inventory.csv',
    datasetName: 'Watch Scheduler Inventory',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: inventory.dataset.id,
  });

  const walnut = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Walnut Boards',
  })[0];
  const maple = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Maple Boards',
  })[0];
  const ash = companyKnowledgeStore.listEntities({
    accountId: accountA,
    type: 'PRODUCT',
    search: 'Ash Boards',
  })[0];

  assert(walnut && maple && ash, 'Expected scheduler test products.');

  const dueRule = watchService.createRule({
    accountId: accountA,
    name: 'Walnut low stock scheduled watch',
    condition: {
      kind: 'ENTITY_NUMERIC_THRESHOLD',
      entityId: walnut.id,
      predicate: 'CURRENT_STOCK',
      operator: 'LTE',
      threshold: 5,
    },
    evaluationMode: 'INTERVAL',
    intervalMinutes: 60,
  });

  watchStore.updateRule(accountA, dueRule.id, {
    nextEvaluationAt: baseTime,
  });

  const firstCycle = watchScheduler.runCycle({
    now: baseTime,
    leaseMs: 60_000,
    maxJobs: 20,
  });

  assert(
    firstCycle.enqueuedJobIds.length === 1 &&
      firstCycle.completedJobIds.length === 1,
    'Due interval rule must enqueue and complete one durable job.'
  );

  const firstJob = watchStore.listJobs({
    accountId: accountA,
    watchRuleId: dueRule.id,
    limit: 20,
  })[0];

  assert(
    firstJob?.status === 'COMPLETED' &&
      firstJob.attemptCount === 1 &&
      Boolean(firstJob.evaluationId),
    'Completed WatchJob must record one attempt and the resulting evaluation ID.'
  );

  const firstEvaluation = firstJob.evaluationId
    ? watchStore.getEvaluation(accountA, firstJob.evaluationId)
    : null;

  assert(
    firstEvaluation?.conditionMatched === true &&
      firstEvaluation.observedValue === 3,
    'Scheduled job must execute the deterministic Watch evaluator.'
  );

  const ruleAfterFirstCycle = watchStore.requireRule(
    accountA,
    dueRule.id
  );
  assert(
    typeof ruleAfterFirstCycle.nextEvaluationAt === 'number' &&
      ruleAfterFirstCycle.nextEvaluationAt > baseTime,
    'Successful interval evaluation must advance nextEvaluationAt.'
  );

  const sameJob = watchStore.ensureJob({
    accountId: accountA,
    watchRuleId: dueRule.id,
    ruleVersion: dueRule.version,
    scheduledFor: baseTime,
  });
  assert(
    sameJob.id === firstJob.id,
    'The same rule/version/scheduledFor tuple must resolve to the same idempotent WatchJob.'
  );

  const repeatedCycle = watchScheduler.runCycle({
    now: baseTime,
    leaseMs: 60_000,
    maxJobs: 20,
  });
  assert(
    repeatedCycle.processedJobIds.length === 0 &&
      watchStore.listJobs({
        accountId: accountA,
        watchRuleId: dueRule.id,
        limit: 20,
      }).length === 1,
    'Repeating the scheduler cycle at the same time must not duplicate or re-run the completed slot.'
  );

  const restartRule = watchService.createRule({
    accountId: accountA,
    name: 'Maple restart recovery watch',
    condition: {
      kind: 'ENTITY_NUMERIC_THRESHOLD',
      entityId: maple.id,
      predicate: 'CURRENT_STOCK',
      operator: 'LT',
      threshold: 10,
    },
    evaluationMode: 'INTERVAL',
    intervalMinutes: 60,
  });

  const restartScheduledFor = baseTime + 10_000;
  watchStore.updateRule(accountA, restartRule.id, {
    nextEvaluationAt: restartScheduledFor,
  });

  const restartJob = watchStore.ensureJob({
    accountId: accountA,
    watchRuleId: restartRule.id,
    ruleVersion: restartRule.version,
    scheduledFor: restartScheduledFor,
  });

  watchStore.updateJob(restartJob.id, {
    status: 'RUNNING',
    attemptCount: 1,
    startedAt: restartScheduledFor - 120_000,
    nextAttemptAt: restartScheduledFor - 120_000,
  });

  const reloadedStore = new WatchStore();
  const persistedRestartJob = reloadedStore.getJob(
    accountA,
    restartJob.id
  );
  assert(
    persistedRestartJob?.status === 'RUNNING' &&
      persistedRestartJob.attemptCount === 1,
    'A newly constructed WatchStore must reload persisted RUNNING jobs after a simulated restart.'
  );

  const recoveryCycle = watchScheduler.runCycle({
    now: restartScheduledFor,
    leaseMs: 60_000,
    maxJobs: 20,
  });

  assert(
    recoveryCycle.recoveredJobIds.includes(restartJob.id) &&
      recoveryCycle.completedJobIds.includes(restartJob.id),
    'Lease-expired RUNNING job must be requeued and completed after restart.'
  );

  const recoveredJob = watchStore.getJob(
    accountA,
    restartJob.id
  );
  assert(
    recoveredJob?.status === 'COMPLETED' &&
      recoveredJob.attemptCount === 2 &&
      Boolean(recoveredJob.evaluationId),
    'Recovered job must preserve prior attempts and complete with an evaluation ID.'
  );

  const retryRule = watchService.createRule({
    accountId: accountA,
    name: 'Ash retry metadata watch',
    condition: {
      kind: 'ENTITY_NUMERIC_THRESHOLD',
      entityId: ash.id,
      predicate: 'CURRENT_STOCK',
      operator: 'LT',
      threshold: 10,
    },
    evaluationMode: 'INTERVAL',
    intervalMinutes: 60,
  });

  const retryScheduledFor = baseTime + 20_000;
  watchStore.updateRule(accountA, retryRule.id, {
    nextEvaluationAt: retryScheduledFor,
  });

  const originalEvaluate = watchEvaluator.evaluate.bind(
    watchEvaluator
  );

  let retryJobId = '';
  try {
    (watchEvaluator as any).evaluate = () => {
      throw new Error('simulated worker failure');
    };

    const retryCycle = watchScheduler.runCycle({
      now: retryScheduledFor,
      leaseMs: 60_000,
      maxJobs: 20,
    });

    assert(
      retryCycle.retryingJobIds.length === 1,
      'Unexpected worker failure must schedule a retry rather than losing the job.'
    );
    retryJobId = retryCycle.retryingJobIds[0];

    const retryJob = watchStore.getJob(accountA, retryJobId);
    assert(
      retryJob?.status === 'PENDING' &&
        retryJob.attemptCount === 1 &&
        retryJob.nextAttemptAt > retryScheduledFor &&
        retryJob.lastError?.includes('simulated worker failure'),
      'Retrying job must persist attempt count, next attempt, and error.'
    );

    watchStore.updateJob(retryJobId, {
      maxAttempts: 2,
    });

    const finalFailureCycle = watchScheduler.runCycle({
      now: retryJob!.nextAttemptAt,
      leaseMs: 60_000,
      maxJobs: 20,
    });

    assert(
      finalFailureCycle.failedJobIds.includes(retryJobId),
      'Job must become FAILED after exhausting max attempts.'
    );

    const failedJob = watchStore.getJob(accountA, retryJobId);
    const failedRule = watchStore.requireRule(
      accountA,
      retryRule.id
    );

    assert(
      failedJob?.status === 'FAILED' &&
        failedJob.attemptCount === 2 &&
        failedRule.currentState === 'ERROR' &&
        typeof failedRule.nextEvaluationAt === 'number' &&
        failedRule.nextEvaluationAt > retryJob!.nextAttemptAt,
      'Permanent worker failure must remain observable while scheduling a later fresh interval slot.'
    );
  } finally {
    (watchEvaluator as any).evaluate = originalEvaluate;
  }

  const app = express();
  app.use(express.json());
  app.use('/api/watch', watchRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve Phase 5D HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'Phase 5D Watch A',
      accountId: accountA,
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'Phase 5D Watch B',
      accountId: accountB,
      environment: 'test',
    });

    const ownJobs = await fetch(
      baseUrl +
        '/api/watch/jobs?watchRuleId=' +
        encodeURIComponent(dueRule.id),
      {
        headers: { Authorization: 'Bearer ' + secretA },
      }
    );
    assert(
      ownJobs.status === 200,
      'Owning account could not inspect Watch job history.'
    );
    const ownJobsBody = await ownJobs.json();
    assert(
      ownJobsBody.jobs?.some(
        (job: any) =>
          job.id === firstJob.id &&
          job.status === 'COMPLETED'
      ),
      'Watch job history API must expose completed scheduled work.'
    );

    const foreignJobs = await fetch(
      baseUrl +
        '/api/watch/jobs?watchRuleId=' +
        encodeURIComponent(dueRule.id),
      {
        headers: {
          Authorization: 'Bearer ' + secretB,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignJobs.status === 200,
      'Foreign job list should safely return its own scoped result.'
    );
    const foreignJobsBody = await foreignJobs.json();
    assert(
      Array.isArray(foreignJobsBody.jobs) &&
        foreignJobsBody.jobs.length === 0,
      'Foreign account must not see another account Watch jobs.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
  }

  assert(
    retryJobId.length > 0,
    'Retry test must have produced a durable job ID.'
  );

  console.log('PHASE_5D_WATCH_SCHEDULER_CHECK_PASSED');
  console.log(
    'Due-rule job creation, idempotent schedule slots, persisted restart recovery, leases, retries, max-attempt failure, later-slot recovery, evaluation linkage, and account-scoped job observability are verified.'
  );
}

main().catch((error) => {
  console.error('PHASE_5D_WATCH_SCHEDULER_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
