import express from 'express';
import fs from 'fs';
import path from 'path';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgeStore } from '../server/companyKnowledge/companyKnowledgeStore.js';
import { structuredKnowledgeProjectionService } from '../server/companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../server/datasets/datasetService.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';
import { watchPersistence, WatchPersistence } from '../server/watch/watchPersistence.js';
import { watchRouter } from '../server/watch/watchRouter.js';
import { WatchRuntimeScheduler } from '../server/watch/watchRuntimeScheduler.js';
import { WatchRuntimeService } from '../server/watch/watchRuntimeService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson(response: Response) {
  const body = await response.json();
  return { response, body };
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE === 'postgres',
    'A7C Watch runtime proof must run in postgres persistence mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for A7C Watch runtime proof.'
  );

  await runPostgresMigrations();
  await postgresPool().query(
    'TRUNCATE TABLE watch_jobs, watch_alerts, watch_evaluations, watch_drafts, watch_rules CASCADE'
  );

  const accountA = 'acc_a7c_watch_a';
  const accountB = 'acc_a7c_watch_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const watchFile = path.join(
    process.cwd(),
    'data',
    'watch.json'
  );
  const watchFileBefore = fs.existsSync(watchFile)
    ? fs.readFileSync(watchFile, 'utf8')
    : null;

  const inventory = datasetService.importCsv({
    accountId: accountA,
    buffer: Buffer.from(
      [
        'product_id,product_name,current_stock,reorder_level',
        'A7C-P1,A7C Oak,3,5',
      ].join('\n'),
      'utf8'
    ),
    filename: 'a7c-watch-inventory.csv',
    datasetName: 'A7C Watch Inventory',
  });
  structuredKnowledgeProjectionService.projectDataset({
    accountId: accountA,
    datasetId: inventory.dataset.id,
  });

  const product = companyKnowledgeStore
    .listEntities({
      accountId: accountA,
      type: 'PRODUCT',
      search: 'A7C Oak',
      limit: 10,
    })
    .find((entity) => entity.identityKey === 'a7c p1');

  assert(product, 'A7C product projection failed.');

  const keyA = apiKeyStore.createApiKey({
    name: 'A7C Watch A',
    accountId: accountA,
    environment: 'test',
  });
  const keyB = apiKeyStore.createApiKey({
    name: 'A7C Watch B',
    accountId: accountB,
    environment: 'test',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/watch', watchRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve A7C Watch HTTP test port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    // 1. Normal HTTP rule creation is PostgreSQL-backed.
    const created = await readJson(
      await fetch(baseUrl + '/api/watch/rules', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyA.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'A7C low stock manual watch',
          condition: {
            kind: 'ENTITY_NUMERIC_THRESHOLD',
            entityId: product.id,
            predicate: 'CURRENT_STOCK',
            operator: 'LT',
            threshold: 5,
          },
          evaluationMode: 'MANUAL',
        }),
      })
    );

    assert(
      created.response.status === 201 &&
        created.body.rule?.status === 'ACTIVE' &&
        created.body.rule?.accountId === accountA,
      'Normal Watch HTTP rule creation must use PostgreSQL-selected runtime.'
    );
    const manualRuleId = created.body.rule.id;

    const pgRule = await postgresPool().query(
      'SELECT status, current_state, condition FROM watch_rules WHERE account_id = $1 AND id = $2',
      [accountA, manualRuleId]
    );
    assert(
      pgRule.rows[0]?.status === 'ACTIVE' &&
        pgRule.rows[0]?.current_state === 'UNKNOWN' &&
        pgRule.rows[0]?.condition?.kind ===
          'ENTITY_NUMERIC_THRESHOLD',
      'Created WatchRule must exist durably in PostgreSQL.'
    );

    // 2. Normal HTTP evaluation writes evaluation + alert + rule state.
    const evaluated = await readJson(
      await fetch(
        baseUrl +
          '/api/watch/rules/' +
          encodeURIComponent(manualRuleId) +
          '/evaluate',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );

    assert(
      evaluated.response.status === 200 &&
        evaluated.body.evaluation?.status === 'COMPLETED' &&
        evaluated.body.evaluation?.conditionMatched === true &&
        evaluated.body.alert?.status === 'OPEN' &&
        evaluated.body.rule?.currentState === 'TRUE',
      'Normal Watch HTTP evaluation must persist deterministic state and alert episode through PostgreSQL.'
    );
    const evaluationId = evaluated.body.evaluation.id;
    const alertId = evaluated.body.alert.id;

    const pgEvaluation = await postgresPool().query(
      'SELECT status, condition_matched, observed_value FROM watch_evaluations WHERE account_id = $1 AND id = $2',
      [accountA, evaluationId]
    );
    const pgAlert = await postgresPool().query(
      'SELECT status, occurrence_count, last_evaluation_id FROM watch_alerts WHERE account_id = $1 AND id = $2',
      [accountA, alertId]
    );

    assert(
      pgEvaluation.rows[0]?.status === 'COMPLETED' &&
        pgEvaluation.rows[0]?.condition_matched === true &&
        Number(pgEvaluation.rows[0]?.observed_value) === 3 &&
        pgAlert.rows[0]?.status === 'OPEN' &&
        pgAlert.rows[0]?.occurrence_count === 1 &&
        pgAlert.rows[0]?.last_evaluation_id === evaluationId,
      'Watch evaluation and alert episode must be readable directly from PostgreSQL.'
    );

    // 3. Alert lifecycle is PostgreSQL-backed.
    const acknowledged = await readJson(
      await fetch(
        baseUrl +
          '/api/watch/alerts/' +
          encodeURIComponent(alertId) +
          '/acknowledge',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    assert(
      acknowledged.response.status === 200 &&
        acknowledged.body.alert?.status === 'ACKNOWLEDGED',
      'Alert acknowledgement must route through PostgreSQL Watch persistence.'
    );

    // 4. Natural-language draft preview/save is PostgreSQL-backed.
    const proposed = await readJson(
      await fetch(baseUrl + '/api/watch/drafts/propose', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyA.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction:
            'Warn me when A7C Oak stock drops below 5.',
          allowLlmParsing: false,
        }),
      })
    );

    assert(
      proposed.response.status === 201 &&
        proposed.body.draft?.status === 'PROPOSED' &&
        proposed.body.draft?.condition?.kind ===
          'ENTITY_NUMERIC_THRESHOLD',
      'Natural-language Watch preview must persist its draft in PostgreSQL.'
    );
    const draftId = proposed.body.draft.id;

    const saved = await readJson(
      await fetch(
        baseUrl +
          '/api/watch/drafts/' +
          encodeURIComponent(draftId) +
          '/save',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );

    assert(
      saved.response.status === 201 &&
        saved.body.draft?.status === 'SAVED' &&
        saved.body.rule?.origin === 'NATURAL_LANGUAGE' &&
        saved.body.rule?.evaluationMode === 'INTERVAL',
      'Explicit draft save must create the PostgreSQL-backed interval WatchRule.'
    );
    const scheduledRuleId = saved.body.rule.id;

    const pgDraft = await postgresPool().query(
      'SELECT status, saved_rule_id FROM watch_drafts WHERE account_id = $1 AND id = $2',
      [accountA, draftId]
    );
    assert(
      pgDraft.rows[0]?.status === 'SAVED' &&
        pgDraft.rows[0]?.saved_rule_id === scheduledRuleId,
      'Saved WatchDraft → WatchRule linkage must be durable in PostgreSQL.'
    );

    // 5. Account isolation remains authoritative.
    const foreignRule = await fetch(
      baseUrl +
        '/api/watch/rules/' +
        encodeURIComponent(manualRuleId),
      {
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignRule.status === 404,
      'Foreign account must not read PostgreSQL WatchRule by raw ID.'
    );

    const foreignAlert = await fetch(
      baseUrl +
        '/api/watch/alerts/' +
        encodeURIComponent(alertId) +
        '/resolve',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + keyB.secret,
          'X-Account-ID': accountA,
        },
      }
    );
    assert(
      foreignAlert.status === 404,
      'Foreign account must not mutate another account PostgreSQL WatchAlert.'
    );

    // 6. Pool/service reconstruction reads the same durable Watch state.
    await closePostgresPool();
    const reconstructedService = new WatchRuntimeService();
    const reconstructedPersistence = new WatchPersistence();

    const persistedManual = await reconstructedPersistence.requireRule(
      accountA,
      manualRuleId
    );
    const persistedEvaluations =
      await reconstructedPersistence.listEvaluations({
        accountId: accountA,
        watchRuleId: manualRuleId,
        limit: 20,
      });
    const persistedAlerts =
      await reconstructedPersistence.listAlerts({
        accountId: accountA,
        watchRuleId: manualRuleId,
        limit: 20,
      });
    const persistedDraft =
      await reconstructedPersistence.requireDraft(
        accountA,
        draftId
      );

    assert(
      reconstructedService.usesPostgres() &&
        persistedManual.currentState === 'TRUE' &&
        persistedEvaluations.some(
          (item) => item.id === evaluationId
        ) &&
        persistedAlerts.some(
          (item) =>
            item.id === alertId &&
            item.status === 'ACKNOWLEDGED'
        ) &&
        persistedDraft.status === 'SAVED',
      'Rule/evaluation/alert/draft state must survive PostgreSQL pool/service reconstruction.'
    );

    // 7. Production scheduler creates, claims, evaluates, and completes
    // durable WatchJob rows without touching watch.json.
    const scheduleNow = Date.parse('2099-05-01T10:00:00Z');
    await watchPersistence.updateRule(
      accountA,
      scheduledRuleId,
      {
        currentState: 'UNKNOWN',
        nextEvaluationAt: scheduleNow,
      }
    );

    const runtimeScheduler = new WatchRuntimeScheduler();
    const cycle = await runtimeScheduler.runCycle({
      now: scheduleNow,
      leaseMs: 60_000,
      maxJobs: 20,
    });

    assert(
      cycle.enqueuedJobIds.length >= 1 &&
        cycle.completedJobIds.length >= 1,
      'PostgreSQL Watch scheduler must enqueue and execute due interval work.'
    );

    const scheduledJobs = await watchPersistence.listJobs({
      accountId: accountA,
      watchRuleId: scheduledRuleId,
      limit: 20,
    });
    const completedJob = scheduledJobs.find(
      (job) => job.status === 'COMPLETED'
    );

    assert(
      completedJob &&
        completedJob.attemptCount === 1 &&
        Boolean(completedJob.evaluationId),
      'Production scheduler must persist claimed/completed WatchJob state and evaluation linkage.'
    );

    const jobRow = await postgresPool().query(
      'SELECT status, attempt_count, evaluation_id FROM watch_jobs WHERE account_id = $1 AND id = $2',
      [accountA, completedJob.id]
    );
    assert(
      jobRow.rows[0]?.status === 'COMPLETED' &&
        jobRow.rows[0]?.attempt_count === 1 &&
        Boolean(jobRow.rows[0]?.evaluation_id),
      'Completed production WatchJob must be durable in PostgreSQL.'
    );

    // 8. Atomic ready-job claiming prevents two workers from claiming
    // the same pending schedule slot.
    const claimRule = await reconstructedService.createRule({
      accountId: accountA,
      name: 'A7C atomic claim watch',
      condition: {
        kind: 'ENTITY_NUMERIC_THRESHOLD',
        entityId: product.id,
        predicate: 'CURRENT_STOCK',
        operator: 'LT',
        threshold: 5,
      },
      evaluationMode: 'MANUAL',
    });

    const claimAt = scheduleNow + 60_000;
    const pendingJob = await watchPersistence.ensureJob({
      accountId: accountA,
      watchRuleId: claimRule.id,
      ruleVersion: claimRule.version,
      scheduledFor: claimAt,
    });

    const [claimOne, claimTwo] = await Promise.all([
      watchPersistence.claimReadyJob({
        now: claimAt,
        leaseStartedAt: claimAt,
      }),
      watchPersistence.claimReadyJob({
        now: claimAt,
        leaseStartedAt: claimAt,
      }),
    ]);

    const claims = [claimOne, claimTwo].filter(
      (job): job is NonNullable<typeof job> =>
        Boolean(job && job.id === pendingJob.id)
    );

    assert(
      claims.length === 1 &&
        claims[0].status === 'RUNNING' &&
        claims[0].attemptCount === 1,
      'Database claim must allow exactly one worker to claim a ready WatchJob.'
    );

    await watchPersistence.updateJob(
      accountA,
      pendingJob.id,
      {
        status: 'COMPLETED',
        completedAt: claimAt,
      }
    );

    // 9. Stale RUNNING jobs recover after worker loss.
    const staleAt = claimAt + 120_000;
    const staleJob = await watchPersistence.ensureJob({
      accountId: accountA,
      watchRuleId: claimRule.id,
      ruleVersion: claimRule.version,
      scheduledFor: staleAt,
    });
    const claimedStale = await watchPersistence.claimReadyJob({
      now: staleAt,
      leaseStartedAt: staleAt - 120_000,
    });
    assert(
      claimedStale?.id === staleJob.id &&
        claimedStale.status === 'RUNNING',
      'Stale-recovery setup must claim the intended WatchJob.'
    );

    const recovered =
      await watchPersistence.requeueStaleRunningJobs({
        now: staleAt,
        leaseMs: 60_000,
      });

    assert(
      recovered.some(
        (job) =>
          job.id === staleJob.id &&
          job.status === 'PENDING' &&
          job.startedAt === undefined
      ),
      'Production Watch worker must requeue stale RUNNING jobs after lease expiry.'
    );

    const watchFileAfter = fs.existsSync(watchFile)
      ? fs.readFileSync(watchFile, 'utf8')
      : null;
    assert(
      watchFileAfter === watchFileBefore,
      'PostgreSQL Watch runtime and scheduler must not mutate data/watch.json.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    await closePostgresPool();
  }

  console.log('PRODUCTION_A7C_WATCH_RUNTIME_CHECK_PASSED');
  console.log(
    'PostgreSQL-selected Watch HTTP rules/drafts/evaluations/alerts, account isolation, pool/service reconstruction, scheduler execution, atomic ready-job claim, stale-job recovery, and zero watch.json mutation are verified.'
  );
}

main().catch(async (error) => {
  console.error('PRODUCTION_A7C_WATCH_RUNTIME_CHECK_FAILED');
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
