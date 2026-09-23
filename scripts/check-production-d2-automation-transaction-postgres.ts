import {
  actionPersistence,
} from '../server/actions/actionPersistence.js';
import {
  preparePostgresConfirmedAction,
} from '../server/actions/actionRuntimeExecutionService.js';
import {
  automationExecutionRuntimeService,
} from '../server/automation/automationExecutionRuntimeService.js';
import {
  AutomationPersistence,
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
  postgresConfirmedActionTransactionRepository,
} from '../server/persistence/a3PostgresRepositories.js';
import {
  postgresAutomationExecutionTransactionRepository,
} from '../server/persistence/a5PostgresRepositories.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import type {
  RequestIdentity,
} from '../server/requestIdentity.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

const accountA = 'acc_d2_a';
const accountB = 'acc_d2_b';

const identityA: RequestIdentity = {
  accountId: accountA,
  source: 'API_KEY',
  authenticated: true,
  apiKeyId: 'key_d2_a',
};

async function seedProduct(input: {
  suffix: string;
  stock?: number;
}) {
  const now = Date.now();
  const stock = input.stock ?? 10;
  const sourceRef = {
    sourceType: 'SYSTEM' as const,
    sourceId:
      'd2-seed-' + input.suffix,
    sourceVersionId:
      'd2-seed-v1-' + input.suffix,
    sourceName:
      'D2 transaction proof seed',
  };

  const entity =
    await companyKnowledgePersistence
      .upsertEntity({
        accountId: accountA,
        type: 'PRODUCT',
        canonicalName:
          'D2 Product ' + input.suffix,
        identityKey:
          'd2-product-' +
          input.suffix,
        sourceRef,
        observedAt: now,
      });

  const claim =
    await companyKnowledgePersistence
      .recordClaim({
        accountId: accountA,
        subjectEntityId: entity.id,
        predicate: 'CURRENT_STOCK',
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

  return {
    entity,
    claim,
    stock,
  };
}

async function createInventoryProposal(input: {
  suffix: string;
  quantity?: number;
  stock?: number;
}) {
  const seeded =
    await seedProduct(input);
  const quantity =
    input.quantity ?? 2;
  const now = Date.now();

  const proposal =
    await actionPersistence
      .createProposal({
        accountId: accountA,
        instruction:
          'Received ' +
          quantity +
          ' units of D2 Product ' +
          input.suffix +
          '.',
        intent: 'RECEIVE_INVENTORY',
        status: 'PROPOSED',
        parserSource: 'DETERMINISTIC',
        parsedInput: {
          intent:
            'RECEIVE_INVENTORY',
          productReference:
            'D2 Product ' +
            input.suffix,
          quantity,
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
              seeded.stock,
            afterValue:
              seeded.stock +
              quantity,
            valueSource:
              'DETERMINISTIC_CALCULATION',
            explanation:
              'Add received inventory quantity to current stock.',
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
              seeded.stock,
            authority:
              seeded.claim.authority,
          },
        ],
        eventType:
          'INVENTORY_RECEIVED',
        eventData: {
          quantity,
          previousStock:
            seeded.stock,
          newStock:
            seeded.stock +
            quantity,
          occurredAt: now,
        },
        calculationSummary:
          String(seeded.stock) +
          ' + ' +
          String(quantity) +
          ' = ' +
          String(
            seeded.stock +
              quantity
          ),
        expiresAt:
          now + 30 * 60 * 1000,
      });

  return {
    ...seeded,
    quantity,
    proposal,
  };
}

async function effectiveStock(
  entityId: string
): Promise<number> {
  const current =
    await effectiveCompanyStateRuntimeService
      .resolve(
        accountA,
        entityId,
        'CURRENT_STOCK'
      );
  assert(
    current.status === 'RESOLVED',
    'Expected effective stock to resolve.'
  );
  return Number(current.value);
}

async function rowCount(
  table: string,
  proposalId: string
): Promise<number> {
  const result =
    await postgresPool().query(
      'SELECT count(*)::int AS count FROM ' +
        table +
        ' WHERE account_id = $1 AND proposal_id = $2',
      [accountA, proposalId]
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
    'D2 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for D2 PostgreSQL proof.'
  );

  await runPostgresMigrations();
  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  const policy =
    await automationPersistence
      .upsertPolicy({
        accountId: accountA,
        actor: 'user:d2-owner',
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

  const control =
    await automationPersistence
      .getControl(accountA);
  assert(
    control.version === 0 &&
      control.emergencyDisabled ===
        false,
    'D2 proof expects the default enabled control state.'
  );

  // 1) Concurrent duplicate policy execution.
  const concurrent =
    await createInventoryProposal({
      suffix: 'concurrent',
    });

  const [first, second] =
    await Promise.all([
      automationExecutionRuntimeService
        .executeEligible({
          accountId: accountA,
          proposalId:
            concurrent.proposal.id,
          identity: identityA,
          maxAttempts: 2,
        }),
      automationExecutionRuntimeService
        .executeEligible({
          accountId: accountA,
          proposalId:
            concurrent.proposal.id,
          identity: identityA,
          maxAttempts: 2,
        }),
    ]);

  assert(
    first.execution.id ===
      second.execution.id &&
      first.run.id ===
        second.run.id &&
      first.run.status ===
        'SUCCEEDED' &&
      second.run.status ===
        'SUCCEEDED',
    'Concurrent duplicate Automation execution must converge on one durable run and one D1 Action execution.'
  );

  assert(
    (await rowCount(
      'action_executions',
      concurrent.proposal.id
    )) === 1 &&
      (await rowCount(
        'automation_runs',
        concurrent.proposal.id
      )) === 1 &&
      (await effectiveStock(
        concurrent.entity.id
      )) === 12,
    'Concurrent D2 execution must apply the company-state mutation exactly once.'
  );

  const concurrentAudit =
    await postgresPool().query(
      `SELECT count(*)::int AS count
       FROM action_audit_entries
       WHERE account_id = $1
         AND proposal_id = $2
         AND action = 'CONFIRMED'`,
      [
        accountA,
        concurrent.proposal.id,
      ]
    );
  assert(
    Number(
      concurrentAudit.rows[0]
        ?.count || 0
    ) === 1,
    'Concurrent D2 execution must create one CONFIRMED Action audit entry.'
  );

  // 2) Crash before Action commit: only RUNNING claim survives.
  const beforeAction =
    await createInventoryProposal({
      suffix: 'before-action',
    });

  const preActionRun =
    await postgresAutomationExecutionTransactionRepository
      .claimPolicyExecution({
        accountId: accountA,
        proposalId:
          beforeAction.proposal.id,
        actor: 'api-key:key_d2_a',
        actorRole: 'SERVICE',
        policyId: policy.id,
        policyVersion:
          policy.version,
        maxAttempts: 2,
        now: Date.now(),
      });

  assert(
    preActionRun.status ===
      'RUNNING' &&
      (await actionPersistence
        .getExecutionByProposal(
          accountA,
          beforeAction.proposal.id
        )) === null,
    'Pre-Action crash state must be a truthful RUNNING claim with no business mutation.'
  );

  const resumedBeforeAction =
    await automationExecutionRuntimeService
      .executeEligible({
        accountId: accountA,
        proposalId:
          beforeAction.proposal.id,
        identity: identityA,
      });

  assert(
    resumedBeforeAction.run.id ===
      preActionRun.id &&
      resumedBeforeAction
        .run.status ===
        'SUCCEEDED' &&
      (await rowCount(
        'automation_runs',
        beforeAction.proposal.id
      )) === 1 &&
      (await effectiveStock(
        beforeAction.entity.id
      )) === 12,
    'Restart after a RUNNING-only crash must reuse the durable claim and execute exactly once.'
  );

  // 3) Legacy/pre-D2 crash: Action committed but run still RUNNING.
  const afterAction =
    await createInventoryProposal({
      suffix: 'after-action',
    });

  const legacyRun =
    await postgresAutomationExecutionTransactionRepository
      .claimPolicyExecution({
        accountId: accountA,
        proposalId:
          afterAction.proposal.id,
        actor: 'api-key:key_d2_a',
        actorRole: 'SERVICE',
        policyId: policy.id,
        policyVersion:
          policy.version,
        maxAttempts: 2,
        now: Date.now(),
      });

  const preparedLegacy =
    await preparePostgresConfirmedAction({
      accountId: accountA,
      proposalId:
        afterAction.proposal.id,
      authorization: {
        mode: 'AUTOMATION_POLICY',
        actor:
          'api-key:key_d2_a',
        actorRole: 'SERVICE',
        automationPolicyId:
          policy.id,
        automationPolicyVersion:
          policy.version,
      },
    });

  const legacyAction =
    await postgresConfirmedActionTransactionRepository
      .commitConfirmedAction(
        preparedLegacy.input
      );

  assert(
    legacyAction.proposal.status ===
      'CONFIRMED' &&
      (
        await automationPersistence
          .requireRun(
            accountA,
            legacyRun.id
          )
      ).status === 'RUNNING',
    'Precondition: simulate the old Action-committed/Automation-RUNNING crash window.'
  );

  const reconciled =
    await automationExecutionRuntimeService
      .executeEligible({
        accountId: accountA,
        proposalId:
          afterAction.proposal.id,
        identity: identityA,
      });

  assert(
    reconciled.replayed === true &&
      reconciled.run.id ===
        legacyRun.id &&
      reconciled.run.status ===
        'SUCCEEDED' &&
      reconciled.execution.id ===
        legacyAction.execution.id &&
      (await rowCount(
        'automation_runs',
        afterAction.proposal.id
      )) === 1 &&
      (await effectiveStock(
        afterAction.entity.id
      )) === 12,
    'D2 restart recovery must reconcile the original RUNNING claim with the already-committed Action without duplicating either.'
  );

  // 4) Failure after D1 writes but before run success must roll back all Action writes.
  const rollback =
    await createInventoryProposal({
      suffix: 'rollback',
    });

  const rollbackRun =
    await postgresAutomationExecutionTransactionRepository
      .claimPolicyExecution({
        accountId: accountA,
        proposalId:
          rollback.proposal.id,
        actor: 'api-key:key_d2_a',
        actorRole: 'SERVICE',
        policyId: policy.id,
        policyVersion:
          policy.version,
        maxAttempts: 2,
        now: Date.now(),
      });

  const preparedRollback =
    await preparePostgresConfirmedAction({
      accountId: accountA,
      proposalId:
        rollback.proposal.id,
      authorization: {
        mode: 'AUTOMATION_POLICY',
        actor:
          'api-key:key_d2_a',
        actorRole: 'SERVICE',
        automationPolicyId:
          policy.id,
        automationPolicyVersion:
          policy.version,
      },
    });

  let completionFailure = false;
  try {
    await postgresAutomationExecutionTransactionRepository
      .commitPolicyExecution({
        accountId: accountA,
        proposalId:
          rollback.proposal.id,
        runId: rollbackRun.id,
        expectedPolicyId:
          policy.id,
        expectedPolicyVersion:
          policy.version,
        expectedControlVersion:
          control.version,
        attemptCount: 1,
        completedAt:
          Number.NaN,
        action:
          preparedRollback.input,
      });
  } catch {
    completionFailure = true;
  }

  const rollbackProposal =
    await actionPersistence
      .requireProposal(
        accountA,
        rollback.proposal.id
      );
  const rollbackRunAfter =
    await automationPersistence
      .requireRun(
        accountA,
        rollbackRun.id
      );

  assert(
    completionFailure &&
      rollbackProposal.status ===
        'PROPOSED' &&
      (
        await actionPersistence
          .getExecutionByProposal(
            accountA,
            rollback.proposal.id
          )
      ) === null &&
      rollbackRunAfter.status ===
        'RUNNING' &&
      (await effectiveStock(
        rollback.entity.id
      )) === 10,
    'Failure while persisting Automation completion must roll back the D1 Action mutation, proposal transition, execution, and audit with the outer transaction.'
  );

  // The surviving RUNNING claim remains resumable.
  const resumedRollback =
    await automationExecutionRuntimeService
      .executeEligible({
        accountId: accountA,
        proposalId:
          rollback.proposal.id,
        identity: identityA,
      });
  assert(
    resumedRollback.run.id ===
      rollbackRun.id &&
      resumedRollback.run.status ===
        'SUCCEEDED' &&
      (await effectiveStock(
        rollback.entity.id
      )) === 12,
    'A transaction failure must leave a resumable claim rather than ambiguous partial success.'
  );

  // 5) Governance race: kill switch changes after preparation.
  const governance =
    await createInventoryProposal({
      suffix: 'governance',
    });

  const governanceRun =
    await postgresAutomationExecutionTransactionRepository
      .claimPolicyExecution({
        accountId: accountA,
        proposalId:
          governance.proposal.id,
        actor: 'api-key:key_d2_a',
        actorRole: 'SERVICE',
        policyId: policy.id,
        policyVersion:
          policy.version,
        maxAttempts: 2,
        now: Date.now(),
      });

  const governancePrepared =
    await preparePostgresConfirmedAction({
      accountId: accountA,
      proposalId:
        governance.proposal.id,
      authorization: {
        mode: 'AUTOMATION_POLICY',
        actor:
          'api-key:key_d2_a',
        actorRole: 'SERVICE',
        automationPolicyId:
          policy.id,
        automationPolicyVersion:
          policy.version,
      },
    });

  const disabled =
    await automationPersistence
      .setControl({
        accountId: accountA,
        emergencyDisabled: true,
        actor: 'user:d2-owner',
        reason:
          'D2 governance race proof',
      });

  let killSwitchBlocked = false;
  try {
    await postgresAutomationExecutionTransactionRepository
      .commitPolicyExecution({
        accountId: accountA,
        proposalId:
          governance.proposal.id,
        runId: governanceRun.id,
        expectedPolicyId:
          policy.id,
        expectedPolicyVersion:
          policy.version,
        expectedControlVersion:
          control.version,
        attemptCount: 1,
        completedAt: Date.now(),
        action:
          governancePrepared.input,
      });
  } catch (error: any) {
    killSwitchBlocked =
      String(
        error?.message || ''
      ).includes(
        'AUTOMATION_KILL_SWITCH_ACTIVE'
      );
  }

  assert(
    killSwitchBlocked &&
      (
        await actionPersistence
          .getExecutionByProposal(
            accountA,
            governance.proposal.id
          )
      ) === null &&
      (await effectiveStock(
        governance.entity.id
      )) === 10 &&
      (
        await automationPersistence
          .requireRun(
            accountA,
            governanceRun.id
          )
      ).status === 'RUNNING',
    'Governance change must block the atomic commit without partially applying the Action or falsely completing the run.'
  );

  let runtimeDenied = false;
  try {
    await automationExecutionRuntimeService
      .executeEligible({
        accountId: accountA,
        proposalId:
          governance.proposal.id,
        identity: identityA,
      });
  } catch (error: any) {
    runtimeDenied =
      error?.code ===
        'AUTOMATION_EXECUTION_NOT_ALLOWED';
  }

  const settledGovernanceRun =
    await automationPersistence
      .requireRun(
        accountA,
        governanceRun.id
      );

  assert(
    runtimeDenied &&
      settledGovernanceRun.status ===
        'BLOCKED' &&
      settledGovernanceRun
        .failureCategory ===
        'KILL_SWITCH' &&
      (await rowCount(
        'automation_runs',
        governance.proposal.id
      )) === 1,
    'Restart under a changed kill switch must settle the original RUNNING claim as BLOCKED without creating duplicate run history.'
  );

  await automationPersistence
    .setControl({
      accountId: accountA,
      emergencyDisabled: false,
      actor: 'user:d2-owner',
      reason:
        'Resume after D2 proof',
    });

  // 6) Cross-account claim/commit cannot target another account proposal.
  let foreignClaimBlocked = false;
  try {
    await postgresAutomationExecutionTransactionRepository
      .claimPolicyExecution({
        accountId: accountB,
        proposalId:
          concurrent.proposal.id,
        actor: 'api-key:key_d2_b',
        actorRole: 'SERVICE',
        policyId: policy.id,
        policyVersion:
          policy.version,
        maxAttempts: 1,
        now: Date.now(),
      });
  } catch {
    foreignClaimBlocked = true;
  }

  const foreignRuns =
    await postgresPool().query(
      `SELECT count(*)::int AS count
       FROM automation_runs
       WHERE account_id = $1
         AND proposal_id = $2`,
      [
        accountB,
        concurrent.proposal.id,
      ]
    );

  assert(
    foreignClaimBlocked &&
      Number(
        foreignRuns.rows[0]
          ?.count || 0
      ) === 0,
    'Cross-account Automation claim must fail at the relational ownership boundary.'
  );

  // 7) Restart reconstruction sees the same durable successful run and Action.
  const restartRunId =
    concurrent.run.id;
  const restartExecutionId =
    concurrent.execution.id;

  await closePostgresPool();

  const reconstructedAutomation =
    new AutomationPersistence();
  const restoredRun =
    await reconstructedAutomation
      .requireRun(
        accountA,
        restartRunId
      );
  const restoredExecution =
    await actionPersistence
      .getExecutionByProposal(
        accountA,
        concurrent.proposal.id
      );

  assert(
    restoredRun.status ===
      'SUCCEEDED' &&
      restoredRun.executionId ===
        restartExecutionId &&
      restoredExecution?.id ===
        restartExecutionId &&
      restoredExecution
        .executionMode ===
        'AUTOMATION_POLICY' &&
      restoredExecution
        .automationPolicyId ===
        policy.id &&
      restoredExecution
        .automationPolicyVersion ===
        policy.version,
    'D2 success must reconstruct from durable Action/Automation state after PostgreSQL pool restart.'
  );

  console.log(
    'PRODUCTION_D2_AUTOMATION_TRANSACTION_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Concurrent duplicate execution, RUNNING-claim restart, pre-D2 partial-success reconciliation, post-D1 rollback, governance-race blocking, cross-account denial, and durable restart reconstruction are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_D2_AUTOMATION_TRANSACTION_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
