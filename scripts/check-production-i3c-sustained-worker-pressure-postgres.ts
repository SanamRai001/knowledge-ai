import {
  actionPersistence,
} from '../server/actions/actionPersistence.js';
import {
  enqueueAutomationExecutionJob,
  registerAutomationExecutionWorkerHandler,
  AUTOMATION_EXECUTION_JOB_TYPE,
} from '../server/automation/automationExecutionWorker.js';
import {
  automationPersistence,
} from '../server/automation/automationPersistence.js';
import {
  apiKeyRuntimeService,
} from '../server/apiKeyRuntimeService.js';
import {
  companyKnowledgePersistence,
} from '../server/companyKnowledge/companyKnowledgePersistence.js';
import {
  effectiveCompanyStateRuntimeService,
} from '../server/companyKnowledge/effectiveCompanyStateRuntimeService.js';
import {
  SOURCE_AUTHORITIES,
} from '../server/companyKnowledge/sourceAuthority.js';
import {
  enqueueIntegrationSyncJob,
  registerIntegrationSyncWorkerHandler,
  INTEGRATION_SYNC_JOB_TYPE,
} from '../server/integrations/integrationSyncWorker.js';
import {
  integrationRuntimeService,
} from '../server/integrations/integrationRuntimeService.js';
import {
  testIntegrationConnector,
} from '../server/integrations/connectors/testConnector.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import type {
  RequestIdentity,
} from '../server/requestIdentity.js';
import {
  I3_STRESS_THRESHOLDS,
} from '../server/security/i3StressThresholds.js';
import {
  setSourceByteStorageForTesting,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  WatchRuntimeScheduler,
} from '../server/watch/watchRuntimeScheduler.js';
import {
  watchPersistence,
} from '../server/watch/watchPersistence.js';
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
  if (!condition) {
    throw new Error(message);
  }
}

const accountId =
  'acc_i3_worker_pressure';

function csv(
  suffix: number
): string {
  return [
    'product_id,product_name,current_stock,reorder_level',
    'I3-' +
      String(suffix) +
      ',I3 Integration Product ' +
      String(suffix) +
      ',10,4',
  ].join('\n');
}

async function createAutomationProposal(
  suffix: number
) {
  const now = Date.now();
  const stock = 10;
  const quantity = 2;
  const sourceRef = {
    sourceType: 'SYSTEM' as const,
    sourceId:
      'i3-worker-seed-' +
      String(suffix),
    sourceVersionId:
      'i3-worker-seed-v1-' +
      String(suffix),
    sourceName:
      'I3 worker pressure seed',
  };

  const entity =
    await companyKnowledgePersistence
      .upsertEntity({
        accountId,
        type: 'PRODUCT',
        canonicalName:
          'I3 Automation Product ' +
          String(suffix),
        identityKey:
          'i3-automation-product-' +
          String(suffix),
        sourceRef,
        observedAt: now,
      });

  const claim =
    await companyKnowledgePersistence
      .recordClaim({
        accountId,
        subjectEntityId:
          entity.id,
        predicate:
          'CURRENT_STOCK',
        value: stock,
        claimKind: 'FACT',
        authority: {
          ...SOURCE_AUTHORITIES
            .STRUCTURED_SOURCE,
        },
        sourceRef,
        observedAt: now,
        validFrom: now,
      });

  const proposal =
    await actionPersistence
      .createProposal({
        accountId,
        instruction:
          'Received 2 units of I3 Automation Product ' +
          String(suffix) +
          '.',
        intent:
          'RECEIVE_INVENTORY',
        status: 'PROPOSED',
        parserSource:
          'DETERMINISTIC',
        parsedInput: {
          intent:
            'RECEIVE_INVENTORY',
          productReference:
            entity.canonicalName,
          quantity,
        },
        targetEntityIds: [
          entity.id,
        ],
        mutations: [
          {
            entityId:
              entity.id,
            entityType: 'PRODUCT',
            entityLabel:
              entity.canonicalName,
            predicate:
              'CURRENT_STOCK',
            operation: 'SET',
            beforeValue: stock,
            afterValue:
              stock + quantity,
            valueSource:
              'DETERMINISTIC_CALCULATION',
            explanation:
              'I3 worker pressure stock mutation.',
          },
        ],
        preconditions: [
          {
            entityId:
              entity.id,
            predicate:
              'CURRENT_STOCK',
            effectiveClaimId:
              claim.id,
            effectiveValue:
              stock,
            authority:
              claim.authority,
          },
        ],
        eventType:
          'INVENTORY_RECEIVED',
        eventData: {
          quantity,
          previousStock:
            stock,
          newStock:
            stock + quantity,
          occurredAt: now,
        },
        calculationSummary:
          '10 + 2 = 12',
        expiresAt:
          now +
          30 * 60 * 1000,
      });

  return {
    entity,
    proposal,
  };
}

async function genericQueueState() {
  const result =
    await postgresPool().query(
      `SELECT
         count(*) FILTER (
           WHERE status = 'PENDING'
         )::int AS pending,
         count(*) FILTER (
           WHERE status = 'RUNNING'
         )::int AS running,
         count(*) FILTER (
           WHERE status = 'SUCCEEDED'
         )::int AS succeeded,
         count(*) FILTER (
           WHERE status = 'FAILED'
         )::int AS failed,
         count(*) FILTER (
           WHERE status = 'DEAD_LETTER'
         )::int AS dead_letters,
         COALESCE(
           max(attempt_count),
           0
         )::int AS max_attempts
       FROM worker_jobs
       WHERE account_id = $1
         AND job_type = ANY($2::text[])`,
      [
        accountId,
        [
          INTEGRATION_SYNC_JOB_TYPE,
          AUTOMATION_EXECUTION_JOB_TYPE,
        ],
      ]
    );

  return {
    pending: Number(
      result.rows[0]?.pending || 0
    ),
    running: Number(
      result.rows[0]?.running || 0
    ),
    succeeded: Number(
      result.rows[0]?.succeeded || 0
    ),
    failed: Number(
      result.rows[0]?.failed || 0
    ),
    deadLetters: Number(
      result.rows[0]
        ?.dead_letters || 0
    ),
    maxAttempts: Number(
      result.rows[0]
        ?.max_attempts || 0
    ),
  };
}

async function watchPressure() {
  const base =
    Date.parse(
      '2099-08-01T10:00:00Z'
    );
  const ruleIds: string[] = [];

  for (
    let index = 0;
    index <
    I3_STRESS_THRESHOLDS
      .workers.watchJobs;
    index += 1
  ) {
    const rule =
      await watchPersistence
        .createRule({
          accountId,
          name:
            'I3 pressure reminder ' +
            String(index),
          status: 'ACTIVE',
          origin: 'SYSTEM',
          condition: {
            kind: 'TIME_REACHED',
            triggerAt: base - 1,
            timezone: 'UTC',
          },
          evaluationMode:
            'INTERVAL',
          intervalMinutes: 60,
          nextEvaluationAt: base,
        });
    ruleIds.push(rule.id);
  }

  const workerA =
    new WatchRuntimeScheduler();
  const workerB =
    new WatchRuntimeScheduler();
  const completed = new Set<string>();
  const retrying = new Set<string>();
  const failed = new Set<string>();

  for (
    let wave = 0;
    wave < 2;
    wave += 1
  ) {
    const results =
      await Promise.all([
        workerA.runCycle({
          now: base,
          leaseMs: 60_000,
          maxJobs:
            I3_STRESS_THRESHOLDS
              .workers
              .watchMaxJobsPerWorkerCycle,
        }),
        workerB.runCycle({
          now: base,
          leaseMs: 60_000,
          maxJobs:
            I3_STRESS_THRESHOLDS
              .workers
              .watchMaxJobsPerWorkerCycle,
        }),
      ]);

    for (const result of results) {
      for (
        const id of
        result.completedJobIds
      ) {
        completed.add(id);
      }
      for (
        const id of
        result.retryingJobIds
      ) {
        retrying.add(id);
      }
      for (
        const id of
        result.failedJobIds
      ) {
        failed.add(id);
      }
    }

    if (wave === 0) {
      const backlog =
        await postgresPool().query(
          `SELECT
             count(*) FILTER (
               WHERE status = 'PENDING'
             )::int AS pending,
             count(*) FILTER (
               WHERE status = 'COMPLETED'
             )::int AS completed
           FROM watch_jobs
           WHERE account_id = $1
             AND watch_rule_id =
               ANY($2::text[])`,
          [
            accountId,
            ruleIds,
          ]
        );

      assert(
        Number(
          backlog.rows[0]
            ?.pending || 0
        ) > 0 &&
          Number(
            backlog.rows[0]
              ?.completed || 0
          ) > 0,
        'I3C Watch pressure must leave and then drain a real intermediate backlog rather than completing everything in one cycle.'
      );
    }
  }

  const state =
    await postgresPool().query(
      `SELECT
         (SELECT count(*)::int
            FROM watch_jobs
           WHERE account_id = $1
             AND watch_rule_id =
               ANY($2::text[])
             AND status = 'COMPLETED')
           AS completed_jobs,
         (SELECT count(*)::int
            FROM watch_evaluations
           WHERE account_id = $1
             AND watch_rule_id =
               ANY($2::text[])
             AND status = 'COMPLETED')
           AS evaluations,
         (SELECT count(*)::int
            FROM watch_alerts
           WHERE account_id = $1
             AND watch_rule_id =
               ANY($2::text[]))
           AS alerts,
         (SELECT count(*)::int
            FROM watch_rules
           WHERE account_id = $1
             AND id =
               ANY($2::text[])
             AND status = 'PAUSED')
           AS paused_rules`,
      [
        accountId,
        ruleIds,
      ]
    );

  assert(
    completed.size ===
      I3_STRESS_THRESHOLDS
        .workers.watchJobs &&
      retrying.size ===
        I3_STRESS_THRESHOLDS
          .workers.maxRetries &&
      failed.size ===
        I3_STRESS_THRESHOLDS
          .workers.maxDeadLetters &&
      Number(
        state.rows[0]
          ?.completed_jobs || 0
      ) ===
        I3_STRESS_THRESHOLDS
          .workers.watchJobs &&
      Number(
        state.rows[0]
          ?.evaluations || 0
      ) ===
        I3_STRESS_THRESHOLDS
          .workers.watchJobs &&
      Number(
        state.rows[0]
          ?.alerts || 0
      ) ===
        I3_STRESS_THRESHOLDS
          .workers.watchJobs &&
      Number(
        state.rows[0]
          ?.paused_rules || 0
      ) ===
        I3_STRESS_THRESHOLDS
          .workers.watchJobs,
    'I3C Watch workers must drain every due job exactly once with no retry/dead-letter outcome.'
  );

  return {
    completed:
      completed.size,
    retries:
      retrying.size,
    failures:
      failed.size,
  };
}

async function genericWorkerPressure() {
  const storage =
    new MemorySourceByteStorage();
  setSourceByteStorageForTesting(
    storage
  );

  const integrationConnections:
    string[] = [];
  const automationFixtures:
    Array<{
      proposalId: string;
      entityId: string;
    }> = [];

  const key =
    await apiKeyRuntimeService
      .createApiKey({
        name:
          'I3 Automation Pressure',
        accountId,
        environment: 'test',
        scopes: [
          'automation:execute',
        ],
      });

  const identity:
    RequestIdentity = {
      accountId,
      source: 'API_KEY',
      authenticated: true,
      apiKeyId: key.apiKey.id,
    };

  await automationPersistence
    .upsertPolicy({
      accountId,
      actor:
        'user:i3-pressure-owner',
      policy: {
        enabled: true,
        mode:
          'AUTO_EXECUTE_LOW_RISK',
        allowedActionIntents: [
          'RECEIVE_INVENTORY',
        ],
        maxRiskClass: 'LOW',
        maxQuantity: 5,
        allowedIdentitySources: [
          'API_KEY',
        ],
        allowedActorRoles: [
          'SERVICE',
        ],
        approvalRoles: [
          'OWNER',
          'ADMIN',
        ],
        allowedTargetEntityTypes: [
          'PRODUCT',
        ],
      },
    });

  try {
    for (
      let index = 0;
      index <
      I3_STRESS_THRESHOLDS
        .workers.integrationJobs;
      index += 1
    ) {
      const connection =
        await integrationRuntimeService
          .createConnection({
            accountId,
            provider: 'TEST',
            displayName:
              'I3 Integration Pressure ' +
              String(index),
          });

      integrationConnections.push(
        connection.id
      );

      testIntegrationConnector
        .configureConnection({
          connectionId:
            connection.id,
          fixtures: [
            {
              externalId:
                'i3-pressure-' +
                String(index),
              externalVersion: 'v1',
              name:
                'i3-pressure-' +
                String(index) +
                '.csv',
              mimeType:
                'text/csv',
              content:
                csv(index),
              modifiedAt: 1,
            },
          ],
        });

      await enqueueIntegrationSyncJob({
        accountId,
        connectionId:
          connection.id,
        requestedBy:
          'user:i3-pressure',
      });
    }

    for (
      let index = 0;
      index <
      I3_STRESS_THRESHOLDS
        .workers.automationJobs;
      index += 1
    ) {
      const fixture =
        await createAutomationProposal(
          index
        );
      automationFixtures.push({
        proposalId:
          fixture.proposal.id,
        entityId:
          fixture.entity.id,
      });

      await enqueueAutomationExecutionJob({
        accountId,
        proposalId:
          fixture.proposal.id,
        identity,
      });
    }

    const before =
      await genericQueueState();
    assert(
      before.pending ===
        I3_STRESS_THRESHOLDS
          .workers.integrationJobs +
          I3_STRESS_THRESHOLDS
            .workers.automationJobs &&
        before.succeeded === 0,
      'I3C generic pressure precondition must create the full Integration + Automation backlog.'
    );

    const registryA =
      new WorkerJobHandlerRegistry();
    const registryB =
      new WorkerJobHandlerRegistry();
    registerIntegrationSyncWorkerHandler(
      registryA
    );
    registerAutomationExecutionWorkerHandler(
      registryA
    );
    registerIntegrationSyncWorkerHandler(
      registryB
    );
    registerAutomationExecutionWorkerHandler(
      registryB
    );

    const workerA =
      new WorkerJobRuntime(
        new PostgresWorkerJobRepository(),
        registryA,
        'i3_pressure_worker_a'
      );
    const workerB =
      new WorkerJobRuntime(
        new PostgresWorkerJobRepository(),
        registryB,
        'i3_pressure_worker_b'
      );

    const aggregate = {
      succeeded:
        new Set<string>(),
      retrying:
        new Set<string>(),
      failed:
        new Set<string>(),
      deadLetters:
        new Set<string>(),
      leaseLost:
        new Set<string>(),
    };

    for (
      let wave = 0;
      wave < 4;
      wave += 1
    ) {
      const cycles =
        await Promise.all([
          workerA.runCycle({
            leaseMs: 90_000,
            maxJobs:
              I3_STRESS_THRESHOLDS
                .workers
                .genericMaxJobsPerWorkerCycle,
          }),
          workerB.runCycle({
            leaseMs: 90_000,
            maxJobs:
              I3_STRESS_THRESHOLDS
                .workers
                .genericMaxJobsPerWorkerCycle,
          }),
        ]);

      for (const cycle of cycles) {
        for (
          const id of
          cycle.succeededJobIds
        ) {
          aggregate.succeeded.add(id);
        }
        for (
          const id of
          cycle.retryingJobIds
        ) {
          aggregate.retrying.add(id);
        }
        for (
          const id of
          cycle.failedJobIds
        ) {
          aggregate.failed.add(id);
        }
        for (
          const id of
          cycle.deadLetterJobIds
        ) {
          aggregate.deadLetters.add(
            id
          );
        }
        for (
          const id of
          cycle.leaseLostJobIds
        ) {
          aggregate.leaseLost.add(id);
        }
      }

      if (wave === 0) {
        const backlog =
          await genericQueueState();
        assert(
          backlog.pending > 0 &&
            backlog.succeeded > 0,
          'I3C generic workers must demonstrate a partially drained intermediate backlog after the first pressure wave.'
        );
      }
    }

    const after =
      await genericQueueState();
    const expectedJobs =
      I3_STRESS_THRESHOLDS
        .workers.integrationJobs +
      I3_STRESS_THRESHOLDS
        .workers.automationJobs;

    assert(
      aggregate.succeeded.size ===
        expectedJobs &&
        aggregate.retrying.size ===
          I3_STRESS_THRESHOLDS
            .workers.maxRetries &&
        aggregate.failed.size ===
          I3_STRESS_THRESHOLDS
            .workers.maxUnexpectedErrors &&
        aggregate.deadLetters.size ===
          I3_STRESS_THRESHOLDS
            .workers.maxDeadLetters &&
        aggregate.leaseLost.size ===
          I3_STRESS_THRESHOLDS
            .workers.maxLeaseLosses &&
        after.pending === 0 &&
        after.running === 0 &&
        after.succeeded ===
          expectedJobs &&
        after.failed === 0 &&
        after.deadLetters === 0 &&
        after.maxAttempts === 1,
      'I3C generic workers must drain the bounded backlog with one attempt per job and no retry/dead-letter/lease-loss result.'
    );

    const integrationState =
      await postgresPool().query(
        `SELECT
           (SELECT count(*)::int
              FROM integration_connections
             WHERE account_id = $1
               AND id = ANY($2::text[])
               AND cursor = '1')
             AS cursors,
           (SELECT count(*)::int
              FROM integration_sync_runs
             WHERE account_id = $1
               AND connection_id =
                 ANY($2::text[])
               AND status = 'COMPLETED')
             AS runs,
           (SELECT count(*)::int
              FROM integration_external_imports
             WHERE account_id = $1
               AND connection_id =
                 ANY($2::text[])
               AND status = 'READY'
               AND source_version_id IS NOT NULL)
             AS imports`,
        [
          accountId,
          integrationConnections,
        ]
      );

    assert(
      Number(
        integrationState.rows[0]
          ?.cursors || 0
      ) ===
        I3_STRESS_THRESHOLDS
          .workers.integrationJobs &&
        Number(
          integrationState.rows[0]
            ?.runs || 0
        ) ===
          I3_STRESS_THRESHOLDS
            .workers.integrationJobs &&
        Number(
          integrationState.rows[0]
            ?.imports || 0
        ) ===
          I3_STRESS_THRESHOLDS
            .workers.integrationJobs,
      'I3C Integration pressure must preserve one completed C6 checkpoint and source snapshot per queued connection.'
    );

    const proposalIds =
      automationFixtures.map(
        (item) =>
          item.proposalId
      );
    const automationState =
      await postgresPool().query(
        `SELECT
           (SELECT count(*)::int
              FROM automation_runs
             WHERE account_id = $1
               AND proposal_id =
                 ANY($2::text[])
               AND status = 'SUCCEEDED')
             AS runs,
           (SELECT count(*)::int
              FROM action_executions
             WHERE account_id = $1
               AND proposal_id =
                 ANY($2::text[])
               AND status = 'SUCCEEDED')
             AS executions,
           (SELECT count(*)::int
              FROM knowledge_claims
             WHERE account_id = $1
               AND source_ref->>'sourceVersionId' =
                 ANY($2::text[])
               AND is_current = true)
             AS claims,
           (SELECT count(*)::int
              FROM business_events
             WHERE account_id = $1
               AND source_ref->>'sourceVersionId' =
                 ANY($2::text[]))
             AS events`,
        [
          accountId,
          proposalIds,
        ]
      );

    assert(
      Number(
        automationState.rows[0]
          ?.runs || 0
      ) ===
        I3_STRESS_THRESHOLDS
          .workers.automationJobs &&
        Number(
          automationState.rows[0]
            ?.executions || 0
        ) ===
          I3_STRESS_THRESHOLDS
            .workers.automationJobs &&
        Number(
          automationState.rows[0]
            ?.claims || 0
        ) ===
          I3_STRESS_THRESHOLDS
            .workers.automationJobs &&
        Number(
          automationState.rows[0]
            ?.events || 0
        ) ===
          I3_STRESS_THRESHOLDS
            .workers.automationJobs,
      'I3C Automation pressure must preserve one D2 run, Action execution, current mutation claim, and business event per queued proposal.'
    );

    for (
      const fixture of
      automationFixtures
    ) {
      const state =
        await effectiveCompanyStateRuntimeService
          .resolve(
            accountId,
            fixture.entityId,
            'CURRENT_STOCK'
          );
      assert(
        state.status ===
          'RESOLVED' &&
          Number(state.value) === 12,
        'I3C Automation worker pressure must apply each stock mutation exactly once.'
      );
    }

    return {
      succeeded:
        aggregate.succeeded.size,
      retries:
        aggregate.retrying.size,
      deadLetters:
        aggregate.deadLetters.size,
      leaseLosses:
        aggregate.leaseLost.size,
    };
  } finally {
    setSourceByteStorageForTesting(
      null
    );
  }
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'I3C worker pressure proof must run in postgres mode.'
  );
  assert(
    Boolean(
      process.env.DATABASE_URL
    ),
    'DATABASE_URL is required for I3C worker pressure proof.'
  );

  await runPostgresMigrations();
  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
  await postgresAccountRepository
    .ensureAccount(accountId);

  const startedAt = Date.now();

  const watch =
    await watchPressure();
  const generic =
    await genericWorkerPressure();

  const durationMs =
    Date.now() - startedAt;

  assert(
    durationMs <=
      I3_STRESS_THRESHOLDS
        .workers
        .maxPressureDurationMs,
    'I3C bounded CI pressure run exceeded its explicit maximum duration threshold.'
  );

  console.log(
    'PRODUCTION_I3C_SUSTAINED_WORKER_PRESSURE_POSTGRES_CHECK_PASSED'
  );
  console.log(
    JSON.stringify({
      thresholds:
        I3_STRESS_THRESHOLDS
          .workers,
      watch,
      generic,
      durationMs,
    })
  );
}

main()
  .catch((error) => {
    setSourceByteStorageForTesting(
      null
    );
    console.error(
      'PRODUCTION_I3C_SUSTAINED_WORKER_PRESSURE_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
