import {
  actionPersistence,
} from '../server/actions/actionPersistence.js';
import {
  enqueueAutomationExecutionJob,
  getAutomationExecutionJob,
  handleAutomationExecutionJob,
  listAutomationExecutionJobs,
  registerAutomationExecutionWorkerHandler,
  AUTOMATION_EXECUTION_JOB_TYPE,
} from '../server/automation/automationExecutionWorker.js';
import {
  automationPersistence,
} from '../server/automation/automationPersistence.js';
import {
  revalidateAutomationWorkerPrincipal,
  snapshotAutomationWorkerPrincipal,
} from '../server/automation/automationWorkerIdentity.js';
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
  postgresIdentityFoundationRepository,
} from '../server/identity/postgresIdentityFoundationRepository.js';
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
import type {
  RequestIdentity,
} from '../server/requestIdentity.js';
import {
  PostgresWorkerJobRepository,
} from '../server/worker/postgresWorkerJobRepository.js';
import {
  WorkerJobHandlerRegistry,
} from '../server/worker/workerJobHandlerRegistry.js';
import {
  WorkerJobRuntime,
} from '../server/worker/workerJobRuntime.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

const accountA = 'acc_e5_a';
const accountB = 'acc_e5_b';

async function seedProduct(input: {
  suffix: string;
  stock?: number;
}) {
  const now = Date.now();
  const stock = input.stock ?? 10;
  const sourceRef = {
    sourceType: 'SYSTEM' as const,
    sourceId:
      'e5-seed-' + input.suffix,
    sourceVersionId:
      'e5-seed-v1-' +
      input.suffix,
    sourceName:
      'E5 worker proof seed',
  };

  const entity =
    await companyKnowledgePersistence
      .upsertEntity({
        accountId: accountA,
        type: 'PRODUCT',
        canonicalName:
          'E5 Product ' +
          input.suffix,
        identityKey:
          'e5-product-' +
          input.suffix,
        sourceRef,
        observedAt: now,
      });

  const claim =
    await companyKnowledgePersistence
      .recordClaim({
        accountId: accountA,
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
          ' units of E5 Product ' +
          input.suffix +
          '.',
        intent: 'RECEIVE_INVENTORY',
        status: 'PROPOSED',
        parserSource:
          'DETERMINISTIC',
        parsedInput: {
          intent:
            'RECEIVE_INVENTORY',
          productReference:
            'E5 Product ' +
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
              'E5 worker proof stock mutation.',
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
          now +
          30 * 60 * 1000,
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
    current.status ===
      'RESOLVED',
    'Expected effective stock to resolve.'
  );
  return Number(current.value);
}

async function proposalExecutionCount(
  proposalId: string
): Promise<number> {
  const result =
    await postgresPool().query(
      `SELECT count(*)::int AS count
       FROM action_executions
       WHERE account_id = $1
         AND proposal_id = $2`,
      [accountA, proposalId]
    );
  return Number(
    result.rows[0]?.count || 0
  );
}

async function proposalRunCount(
  proposalId: string
): Promise<number> {
  const result =
    await postgresPool().query(
      `SELECT count(*)::int AS count
       FROM automation_runs
       WHERE account_id = $1
         AND proposal_id = $2`,
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
    'E5 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for E5 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes(
      '018'
    ) ||
      migrations.alreadyApplied.includes(
        '018'
      ),
    'E5 requires migration 018.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  const key =
    await apiKeyRuntimeService
      .createApiKey({
        name:
          'E5 Automation Worker',
        accountId: accountA,
        environment: 'test',
        scopes: [
          'automation:execute',
        ],
      });

  const identity: RequestIdentity = {
    accountId: accountA,
    source: 'API_KEY',
    authenticated: true,
    apiKeyId: key.apiKey.id,
  };

  await automationPersistence
    .upsertPolicy({
      accountId: accountA,
      actor: 'user:e5-owner',
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

  const repository =
    new PostgresWorkerJobRepository();
  const registry =
    new WorkerJobHandlerRegistry();
  registerAutomationExecutionWorkerHandler(
    registry
  );
  const runtime =
    new WorkerJobRuntime(
      repository,
      registry,
      'worker_e5_proof'
    );

  // 1) Duplicate enqueue converges; worker executes exactly once.
  const primary =
    await createInventoryProposal({
      suffix: 'primary',
    });

  const queuedA =
    await enqueueAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        primary.proposal.id,
      identity,
    });
  const queuedB =
    await enqueueAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        primary.proposal.id,
      identity,
    });

  assert(
    queuedA.id === queuedB.id &&
      queuedA.status === 'PENDING',
    'Repeated E5 enqueue on the same active baseline must converge on one worker job.'
  );

  assert(
    (
      await getAutomationExecutionJob({
        accountId: accountB,
        proposalId:
          primary.proposal.id,
        jobId: queuedA.id,
      })
    ) === null &&
      (
        await listAutomationExecutionJobs({
          accountId: accountB,
          proposalId:
            primary.proposal.id,
        })
      ).length === 0,
    'E5 worker job views must be account scoped.'
  );

  const firstCycle =
    await runtime.runCycle({
      maxJobs: 1,
      leaseMs: 10_000,
    });

  assert(
    firstCycle.succeededJobIds
      .includes(queuedA.id),
    'Eligible E5 Automation work must complete through the generic worker runtime.'
  );

  const completedPrimary =
    await getAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        primary.proposal.id,
      jobId: queuedA.id,
    });

  assert(
    completedPrimary?.status ===
      'SUCCEEDED' &&
      completedPrimary
        .automationRunStatus ===
        'SUCCEEDED' &&
      Boolean(
        completedPrimary
          .automationRunId
      ) &&
      Boolean(
        completedPrimary
          .actionExecutionId
      ) &&
      completedPrimary.outcomeCode ===
        'AUTOMATION_SUCCEEDED' &&
      (await effectiveStock(
        primary.entity.id
      )) === 12 &&
      (await proposalExecutionCount(
        primary.proposal.id
      )) === 1 &&
      (await proposalRunCount(
        primary.proposal.id
      )) === 1,
    'E5 worker success must preserve D2 exactly-once Automation + Action mutation semantics.'
  );

  const replayJob =
    await enqueueAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        primary.proposal.id,
      identity,
    });

  assert(
    replayJob.id === queuedA.id,
    'Enqueue replay after successful Action commit must return the existing successful worker job.'
  );

  // 2) Crash after D2 commit but before generic worker completion.
  const crash =
    await createInventoryProposal({
      suffix: 'crash-after-d2',
    });
  const crashJob =
    await enqueueAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        crash.proposal.id,
      identity,
    });
  const crashNow = Date.now();
  const claimed =
    await repository.claim({
      workerId:
        'worker_e5_crasher',
      leaseMs: 5_000,
      now: crashNow,
      jobTypes: [
        AUTOMATION_EXECUTION_JOB_TYPE,
      ],
    });

  assert(
    claimed?.id === crashJob.id,
    'E5 crash proof must claim the expected Automation job.'
  );

  await handleAutomationExecutionJob(
    claimed!
  );

  assert(
    (
      await repository.get(
        accountA,
        crashJob.id
      )
    )?.status === 'RUNNING' &&
      (await proposalExecutionCount(
        crash.proposal.id
      )) === 1 &&
      (await effectiveStock(
        crash.entity.id
      )) === 12,
    'Crash window precondition must commit D2 business state while generic worker job remains RUNNING.'
  );

  const restartRuntime =
    new WorkerJobRuntime(
      repository,
      registry,
      'worker_e5_restart'
    );
  const recoveredCycle =
    await restartRuntime.runCycle({
      now:
        crashNow + 6_000,
      leaseMs: 5_000,
      maxJobs: 1,
    });

  assert(
    recoveredCycle.recoveredJobIds
      .includes(crashJob.id) &&
      recoveredCycle.succeededJobIds
        .includes(crashJob.id) &&
      (await proposalExecutionCount(
        crash.proposal.id
      )) === 1 &&
      (await proposalRunCount(
        crash.proposal.id
      )) === 1 &&
      (await effectiveStock(
        crash.entity.id
      )) === 12,
    'Worker restart after D2 commit must replay safely without duplicating AutomationRun, Action execution, or company-state mutation.'
  );

  // 3) Policy changes after enqueue are revalidated by D2.
  const blocked =
    await createInventoryProposal({
      suffix: 'policy-change',
    });
  const blockedJob =
    await enqueueAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        blocked.proposal.id,
      identity,
    });

  await automationPersistence
    .upsertPolicy({
      accountId: accountA,
      actor: 'user:e5-owner',
      policy: {
        enabled: false,
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

  const blockedCycle =
    await runtime.runCycle({
      maxJobs: 1,
      leaseMs: 10_000,
    });
  const blockedView =
    await getAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        blocked.proposal.id,
      jobId: blockedJob.id,
    });

  assert(
    blockedCycle.succeededJobIds
      .includes(blockedJob.id) &&
      blockedView?.status ===
        'SUCCEEDED' &&
      blockedView
        .automationRunStatus ===
        'BLOCKED' &&
      blockedView.outcomeCode ===
        'AUTOMATION_EXECUTION_NOT_ALLOWED' &&
      (await proposalExecutionCount(
        blocked.proposal.id
      )) === 0 &&
      (await effectiveStock(
        blocked.entity.id
      )) === 10,
    'A queued request must re-evaluate current policy at worker execution time; deterministic policy denial is a processed business outcome, not a queue transport failure.'
  );

  await automationPersistence
    .upsertPolicy({
      accountId: accountA,
      actor: 'user:e5-owner',
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

  // 4) API key revoked after enqueue cannot execute later.
  const revoked =
    await createInventoryProposal({
      suffix: 'revoked-key',
    });
  const revokedJob =
    await enqueueAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        revoked.proposal.id,
      identity,
    });

  const revokedOk =
    await apiKeyRuntimeService
      .revokeApiKey(
        key.apiKey.id,
        accountA
      );
  assert(
    revokedOk,
    'E5 proof must revoke the queued API-key principal.'
  );

  const revokedCycle =
    await runtime.runCycle({
      maxJobs: 1,
      leaseMs: 10_000,
    });
  const revokedView =
    await getAutomationExecutionJob({
      accountId: accountA,
      proposalId:
        revoked.proposal.id,
      jobId: revokedJob.id,
    });

  assert(
    revokedCycle.failedJobIds
      .includes(revokedJob.id) &&
      revokedView?.status ===
        'FAILED' &&
      revokedView.outcomeCode ===
        'AUTOMATION_WORKER_IDENTITY_INVALID' &&
      (await proposalExecutionCount(
        revoked.proposal.id
      )) === 0 &&
      (await proposalRunCount(
        revoked.proposal.id
      )) === 0 &&
      (await effectiveStock(
        revoked.entity.id
      )) === 10,
    'Revoked queued API-key identity must fail before D2 creates a run or mutates company state.'
  );

  // 5) Human membership is also revalidated.
  const userId = 'usr_e5_a';
  const now = Date.now();
  await postgresIdentityFoundationRepository
    .createUser({
      id: userId,
      email:
        'e5-user@example.test',
      normalizedEmail:
        'e5-user@example.test',
      displayName:
        'E5 User',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
  await postgresIdentityFoundationRepository
    .upsertMembership({
      accountId: accountA,
      userId,
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });

  const humanIdentity:
    RequestIdentity = {
      accountId: accountA,
      source: 'HUMAN_SESSION',
      authenticated: true,
      userId,
      membershipRole: 'ADMIN',
    };

  const snapshot =
    await snapshotAutomationWorkerPrincipal(
      humanIdentity
    );
  assert(
    snapshot.principalId ===
      userId &&
      snapshot.requestedRole ===
        'ADMIN',
    'Human E5 principal snapshot must contain only durable identity/role audit metadata.'
  );

  await postgresIdentityFoundationRepository
    .revokeMembership(
      accountA,
      userId,
      Date.now()
    );

  let humanRevoked = false;
  try {
    await revalidateAutomationWorkerPrincipal({
      accountId: accountA,
      source: 'HUMAN_SESSION',
      principalId: userId,
    });
  } catch {
    humanRevoked = true;
  }
  assert(
    humanRevoked,
    'E5 worker must reject a human principal whose membership was revoked after queueing.'
  );

  console.log(
    'PRODUCTION_E5_AUTOMATION_EXECUTION_WORKER_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Duplicate enqueue, exactly-once D2 execution, post-commit worker crash recovery, policy revalidation, API-key revocation, human membership revocation, account isolation, and safe business-outcome settlement are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_E5_AUTOMATION_EXECUTION_WORKER_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
