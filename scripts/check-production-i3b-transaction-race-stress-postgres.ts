import {
  actionPersistence,
} from '../server/actions/actionPersistence.js';
import {
  actionRuntimeExecutionService,
} from '../server/actions/actionRuntimeExecutionService.js';
import {
  automationExecutionRuntimeService,
} from '../server/automation/automationExecutionRuntimeService.js';
import {
  automationPersistence,
} from '../server/automation/automationPersistence.js';
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
  if (!condition) {
    throw new Error(message);
  }
}

const accountId =
  'acc_i3_race';

const serviceIdentity:
  RequestIdentity = {
    accountId,
    source: 'API_KEY',
    authenticated: true,
    apiKeyId: 'key_i3_race',
  };

async function seedProduct(input: {
  suffix: string;
  stock: number;
  authority?:
    typeof SOURCE_AUTHORITIES.USER_CONFIRMED;
}) {
  const now = Date.now();
  const sourceRef = {
    sourceType: 'SYSTEM' as const,
    sourceId:
      'i3-race-seed-' +
      input.suffix,
    sourceVersionId:
      'i3-race-v1-' +
      input.suffix,
    sourceName:
      'I3 race stress seed',
  };

  const entity =
    await companyKnowledgePersistence
      .upsertEntity({
        accountId,
        type: 'PRODUCT',
        canonicalName:
          'I3 Product ' +
          input.suffix,
        identityKey:
          'i3-product-' +
          input.suffix,
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
        value: input.stock,
        claimKind: 'FACT',
        authority:
          input.authority
            ? {
                ...input.authority,
              }
            : {
                ...SOURCE_AUTHORITIES
                  .STRUCTURED_SOURCE,
              },
        sourceRef:
          input.authority
            ? {
                sourceType:
                  'USER' as const,
                sourceId:
                  'confirmed-company-state',
                sourceVersionId:
                  'i3-baseline-' +
                  input.suffix,
                sourceVersionLabel:
                  'I3 baseline',
                sourceName:
                  'I3 confirmed baseline',
              }
            : sourceRef,
        observedAt: now,
        validFrom: now,
      });

  return {
    entity,
    claim,
  };
}

async function createProposal(input: {
  suffix: string;
  stock: number;
  quantity: number;
  confirmedBaseline?: boolean;
}) {
  const seeded =
    await seedProduct({
      suffix: input.suffix,
      stock: input.stock,
      authority:
        input.confirmedBaseline
          ? SOURCE_AUTHORITIES
              .USER_CONFIRMED
          : undefined,
    });
  const now = Date.now();

  const proposal =
    await actionPersistence
      .createProposal({
        accountId,
        instruction:
          'Receive ' +
          input.quantity +
          ' units of I3 Product ' +
          input.suffix +
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
            'I3 Product ' +
            input.suffix,
          quantity:
            input.quantity,
        },
        targetEntityIds: [
          seeded.entity.id,
        ],
        mutations: [
          {
            entityId:
              seeded.entity.id,
            entityType: 'PRODUCT',
            entityLabel:
              seeded.entity
                .canonicalName,
            predicate:
              'CURRENT_STOCK',
            operation: 'SET',
            beforeValue:
              input.stock,
            afterValue:
              input.stock +
              input.quantity,
            valueSource:
              'DETERMINISTIC_CALCULATION',
            explanation:
              String(input.stock) +
              ' + ' +
              String(
                input.quantity
              ) +
              ' = ' +
              String(
                input.stock +
                  input.quantity
              ),
          },
        ],
        preconditions: [
          {
            entityId:
              seeded.entity.id,
            predicate:
              'CURRENT_STOCK',
            effectiveClaimId:
              seeded.claim.id,
            effectiveValue:
              input.stock,
            authority:
              seeded.claim.authority,
          },
        ],
        eventType:
          'INVENTORY_RECEIVED',
        eventData: {
          quantity:
            input.quantity,
          previousStock:
            input.stock,
          newStock:
            input.stock +
            input.quantity,
          occurredAt: now,
        },
        calculationSummary:
          String(input.stock) +
          ' + ' +
          String(input.quantity) +
          ' = ' +
          String(
            input.stock +
              input.quantity
          ),
        expiresAt:
          now +
          30 * 60 * 1000,
      });

  return {
    ...seeded,
    proposal,
  };
}

async function effectiveStock(
  entityId: string
): Promise<number> {
  const resolution =
    await effectiveCompanyStateRuntimeService
      .resolve(
        accountId,
        entityId,
        'CURRENT_STOCK'
      );
  assert(
    resolution.status ===
      'RESOLVED',
    'I3 race proof expected resolved company state.'
  );
  return Number(
    resolution.value
  );
}

async function d1Stress() {
  const fixture =
    await createProposal({
      suffix: 'd1',
      stock: 10,
      quantity: 7,
      confirmedBaseline: true,
    });

  const results =
    await Promise.all(
      Array.from(
        {
          length:
            I3_STRESS_THRESHOLDS
              .races
              .actionConfirmContenders,
        },
        () =>
          actionRuntimeExecutionService
            .confirm({
              accountId,
              proposalId:
                fixture.proposal.id,
            })
      )
    );

  assert(
    new Set(
      results.map(
        (result) =>
          result.execution.id
      )
    ).size === 1,
    'I3 D1 contention must converge every caller on one Action execution.'
  );

  const counts =
    await postgresPool().query(
      `SELECT
         (SELECT count(*)::int
            FROM action_executions
           WHERE account_id = $1
             AND proposal_id = $2) AS executions,
         (SELECT count(*)::int
            FROM action_audit_entries
           WHERE account_id = $1
             AND proposal_id = $2
             AND action = 'CONFIRMED') AS audits,
         (SELECT count(*)::int
            FROM knowledge_claims
           WHERE account_id = $1
             AND source_ref->>'sourceVersionId' = $2) AS claims,
         (SELECT count(*)::int
            FROM business_events
           WHERE account_id = $1
             AND source_ref->>'sourceVersionId' = $2) AS events`,
      [
        accountId,
        fixture.proposal.id,
      ]
    );

  assert(
    Number(
      counts.rows[0]
        ?.executions
    ) === 1 &&
      Number(
        counts.rows[0]?.audits
      ) === 1 &&
      Number(
        counts.rows[0]?.claims
      ) === 1 &&
      Number(
        counts.rows[0]?.events
      ) === 1 &&
      (await effectiveStock(
        fixture.entity.id
      )) === 17,
    'I3 D1 high-contention confirmation must commit exactly one business mutation set.'
  );
}

async function d2Stress() {
  await automationPersistence
    .upsertPolicy({
      accountId,
      actor:
        'user:i3-owner',
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

  const fixture =
    await createProposal({
      suffix: 'd2',
      stock: 20,
      quantity: 3,
    });

  const results =
    await Promise.all(
      Array.from(
        {
          length:
            I3_STRESS_THRESHOLDS
              .races
              .automationExecutionContenders,
        },
        () =>
          automationExecutionRuntimeService
            .executeEligible({
              accountId,
              proposalId:
                fixture.proposal.id,
              identity:
                serviceIdentity,
              maxAttempts: 2,
            })
      )
    );

  assert(
    new Set(
      results.map(
        (result) =>
          result.execution.id
      )
    ).size === 1 &&
      new Set(
        results.map(
          (result) =>
            result.run.id
        )
      ).size === 1 &&
      results.every(
        (result) =>
          result.run.status ===
          'SUCCEEDED'
      ),
    'I3 D2 contention must converge on one Automation run and one Action execution.'
  );

  const counts =
    await postgresPool().query(
      `SELECT
         (SELECT count(*)::int
            FROM action_executions
           WHERE account_id = $1
             AND proposal_id = $2) AS executions,
         (SELECT count(*)::int
            FROM automation_runs
           WHERE account_id = $1
             AND proposal_id = $2) AS runs,
         (SELECT count(*)::int
            FROM action_audit_entries
           WHERE account_id = $1
             AND proposal_id = $2
             AND action = 'CONFIRMED') AS audits`,
      [
        accountId,
        fixture.proposal.id,
      ]
    );

  assert(
    Number(
      counts.rows[0]
        ?.executions
    ) === 1 &&
      Number(
        counts.rows[0]?.runs
      ) === 1 &&
      Number(
        counts.rows[0]?.audits
      ) === 1 &&
      (await effectiveStock(
        fixture.entity.id
      )) === 23,
    'I3 D2 high-contention policy execution must apply company state exactly once.'
  );
}

function watchEvaluation(input: {
  job: WatchJob;
  rule: WatchRule;
  evaluatedAt: number;
}): WatchEvaluation {
  return {
    id:
      'wev_i3_race_' +
      input.job.id,
    accountId,
    jobId: input.job.id,
    watchRuleId:
      input.rule.id,
    ruleVersion:
      input.rule.version,
    status: 'COMPLETED',
    conditionMatched: true,
    observedValue: 3,
    comparisonOperator: 'LT',
    threshold: 5,
    previousConditionState:
      input.rule.currentState,
    nextConditionState: 'TRUE',
    evidence: {
      sourceType:
        'ENTITY',
      entityId:
        'ent_i3_watch',
      entityLabel:
        'I3 Watch Product',
      predicate:
        'CURRENT_STOCK',
      effectiveClaimId:
        'clm_i3_watch',
      effectiveValue: 3,
      authorityLevel:
        'SYSTEM',
      sourceName:
        'I3 race stress',
    },
    evaluatedAt:
      input.evaluatedAt,
  };
}

async function d3Stress() {
  const scheduledFor =
    Date.parse(
      '2099-07-01T10:00:00Z'
    );

  const rule =
    await watchPersistence
      .createRule({
        accountId,
        name:
          'I3 Watch contention',
        status: 'ACTIVE',
        origin: 'SYSTEM',
        condition: {
          kind:
            'ENTITY_NUMERIC_THRESHOLD',
          entityId:
            'ent_i3_watch',
          predicate:
            'CURRENT_STOCK',
          operator: 'LT',
          threshold: 5,
        },
        evaluationMode:
          'INTERVAL',
        intervalMinutes: 60,
        nextEvaluationAt:
          scheduledFor,
      });

  const job =
    await watchPersistence
      .ensureJob({
        accountId,
        watchRuleId: rule.id,
        ruleVersion:
          rule.version,
        scheduledFor,
        maxAttempts: 3,
      });

  const claimed =
    await watchPersistence
      .claimReadyJob({
        now: scheduledFor,
        leaseStartedAt:
          scheduledFor,
      });

  assert(
    claimed?.id === job.id &&
      claimed.status ===
        'RUNNING',
    'I3 D3 stress must claim the intended Watch job.'
  );

  const evaluation =
    watchEvaluation({
      job: claimed,
      rule,
      evaluatedAt:
        scheduledFor,
    });

  const input = {
    accountId,
    jobId: claimed.id,
    expectedRuleVersion:
      rule.version,
    completedAt:
      scheduledFor,
    evaluation,
    newAlert: {
      id:
        'wal_i3_race_' +
        claimed.id,
      episodeKey:
        'i3:race:' +
        claimed.id,
      title:
        'I3 low stock',
      summary:
        'Stock is below threshold.',
    },
  };

  const results =
    await Promise.all(
      Array.from(
        {
          length:
            I3_STRESS_THRESHOLDS
              .races
              .watchCompletionContenders,
        },
        () =>
          watchPersistence
            .commitClaimedJobEvaluation(
              input
            )
      )
    );

  assert(
    new Set(
      results.map(
        (result) =>
          result.evaluation.id
      )
    ).size === 1 &&
      results.filter(
        (result) =>
          result.idempotentReplay
      ).length ===
        I3_STRESS_THRESHOLDS
          .races
          .watchCompletionContenders -
          1,
    'I3 D3 contention must produce one evaluation with every losing caller replaying the committed result.'
  );

  const state =
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
        accountId,
        claimed.id,
        rule.id,
      ]
    );

  assert(
    Number(
      state.rows[0]
        ?.evaluations
    ) === 1 &&
      Number(
        state.rows[0]?.alerts
      ) === 1 &&
      Number(
        state.rows[0]
          ?.occurrences
      ) === 1 &&
      state.rows[0]
        ?.job_status ===
        'COMPLETED',
    'I3 D3 high-contention completion must create one evaluation, one alert occurrence, and one completed job.'
  );
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'I3B race proof must run in postgres mode.'
  );
  assert(
    Boolean(
      process.env.DATABASE_URL
    ),
    'DATABASE_URL is required for I3B race proof.'
  );

  await runPostgresMigrations();
  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
  await postgresAccountRepository
    .ensureAccount(accountId);

  const startedAt = Date.now();

  await d1Stress();
  await d2Stress();
  await d3Stress();

  const durationMs =
    Date.now() - startedAt;

  console.log(
    'PRODUCTION_I3B_TRANSACTION_RACE_STRESS_CHECK_PASSED'
  );
  console.log(
    JSON.stringify({
      actionContenders:
        I3_STRESS_THRESHOLDS
          .races
          .actionConfirmContenders,
      automationContenders:
        I3_STRESS_THRESHOLDS
          .races
          .automationExecutionContenders,
      watchContenders:
        I3_STRESS_THRESHOLDS
          .races
          .watchCompletionContenders,
      unexpectedErrors: 0,
      durationMs,
    })
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_I3B_TRANSACTION_RACE_STRESS_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
