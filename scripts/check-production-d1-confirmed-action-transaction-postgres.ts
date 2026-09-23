import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { postgresAccountRepository } from '../server/persistence/postgresRepositories.js';
import { companyKnowledgePersistence } from '../server/companyKnowledge/companyKnowledgePersistence.js';
import { effectiveCompanyStateRuntimeService } from '../server/companyKnowledge/effectiveCompanyStateRuntimeService.js';
import { SOURCE_AUTHORITIES } from '../server/companyKnowledge/sourceAuthority.js';
import { actionPersistence } from '../server/actions/actionPersistence.js';
import { actionRuntimeExecutionService } from '../server/actions/actionRuntimeExecutionService.js';
import type {
  ActionAuditEntry,
  ActionExecution,
} from '../server/actions/types.js';
import type {
  BusinessEvent,
  KnowledgeClaim,
  KnowledgeSourceRef,
} from '../server/companyKnowledge/types.js';
import {
  PostgresActionTransactionError,
  postgresConfirmedActionTransactionRepository,
} from '../server/persistence/a3PostgresRepositories.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function confirmedSource(
  proposalId: string
): KnowledgeSourceRef {
  return {
    sourceType: 'USER',
    sourceId: 'confirmed-company-state',
    sourceVersionId: proposalId,
    sourceVersionLabel: 'action ' + proposalId,
    sourceName: 'D1 confirmed action',
  };
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE === 'postgres',
    'D1 proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for D1 proof.'
  );

  await runPostgresMigrations();
  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const accountA = 'acc_d1_a';
  const accountB = 'acc_d1_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  try {
    const entity =
      await companyKnowledgePersistence.upsertEntity({
        accountId: accountA,
        type: 'PRODUCT',
        canonicalName: 'D1 Widget',
        identityKey: 'd1-widget',
        sourceRef: {
          sourceType: 'USER',
          sourceId: 'd1-seed',
          sourceVersionId: 'v1',
          sourceVersionLabel: 'v1',
          sourceName: 'D1 seed',
        },
        observedAt: Date.now(),
      });

    const baseline =
      await companyKnowledgePersistence.recordClaim({
        accountId: accountA,
        subjectEntityId: entity.id,
        predicate: 'CURRENT_STOCK',
        value: 10,
        claimKind: 'FACT',
        authority: {
          ...SOURCE_AUTHORITIES.USER_CONFIRMED,
        },
        sourceRef: {
          sourceType: 'USER',
          sourceId: 'confirmed-company-state',
          sourceVersionId: 'd1-baseline',
          sourceVersionLabel: 'D1 baseline',
          sourceName: 'D1 baseline',
        },
        observedAt: Date.now(),
        validFrom: Date.now(),
      });

    const proposal =
      await actionPersistence.createProposal({
        accountId: accountA,
        instruction: 'Receive 10 units of D1 Widget.',
        intent: 'RECEIVE_INVENTORY',
        status: 'PROPOSED',
        parserSource: 'DETERMINISTIC',
        parsedInput: {
          intent: 'RECEIVE_INVENTORY',
          productReference: 'D1 Widget',
          quantity: 10,
        },
        targetEntityIds: [entity.id],
        mutations: [
          {
            entityId: entity.id,
            entityType: entity.type,
            entityLabel: entity.canonicalName,
            predicate: 'CURRENT_STOCK',
            operation: 'SET',
            beforeValue: 10,
            afterValue: 20,
            valueSource: 'DETERMINISTIC_CALCULATION',
            explanation: '10 + 10 = 20',
          },
        ],
        preconditions: [
          {
            entityId: entity.id,
            predicate: 'CURRENT_STOCK',
            effectiveClaimId: baseline.id,
            effectiveValue: 10,
            authority: baseline.authority,
          },
        ],
        eventType: 'INVENTORY_RECEIVED',
        eventData: { quantity: 10 },
        calculationSummary: '10 + 10 = 20',
        expiresAt: Date.now() + 60_000,
      });

    const [first, second] = await Promise.all([
      actionRuntimeExecutionService.confirm({
        accountId: accountA,
        proposalId: proposal.id,
      }),
      actionRuntimeExecutionService.confirm({
        accountId: accountA,
        proposalId: proposal.id,
      }),
    ]);

    assert(
      first.execution.id === second.execution.id,
      'Concurrent confirmations must converge on one execution.'
    );

    const counts = await postgresPool().query(
      `SELECT
         (SELECT count(*)::int FROM action_executions
           WHERE account_id = $1 AND proposal_id = $2) AS executions,
         (SELECT count(*)::int FROM action_audit_entries
           WHERE account_id = $1 AND proposal_id = $2
             AND action = 'CONFIRMED') AS audits,
         (SELECT count(*)::int FROM knowledge_claims
           WHERE account_id = $1
             AND source_ref->>'sourceVersionId' = $2) AS claims,
         (SELECT count(*)::int FROM business_events
           WHERE account_id = $1
             AND source_ref->>'sourceVersionId' = $2) AS events`,
      [accountA, proposal.id]
    );

    assert(
      Number(counts.rows[0]?.executions) === 1 &&
        Number(counts.rows[0]?.audits) === 1 &&
        Number(counts.rows[0]?.claims) === 1 &&
        Number(counts.rows[0]?.events) === 1,
      'Concurrent confirmation must create exactly one relational mutation set.'
    );

    const effective =
      await effectiveCompanyStateRuntimeService.resolve(
        accountA,
        entity.id,
        'CURRENT_STOCK'
      );
    assert(
      effective.status === 'RESOLVED' &&
        effective.value === 20,
      'Confirmed action must apply company state exactly once.'
    );
    if (effective.status !== 'RESOLVED') {
      throw new Error('Expected resolved company state.');
    }

    const rollbackProposal =
      await actionPersistence.createProposal({
        accountId: accountA,
        instruction: 'Set D1 Widget stock to 30.',
        intent: 'UPDATE_STATUS',
        status: 'PROPOSED',
        parserSource: 'DETERMINISTIC',
        parsedInput: {
          intent: 'UPDATE_STATUS',
          productReference: 'D1 Widget',
          status: '30',
        },
        targetEntityIds: [entity.id],
        mutations: [
          {
            entityId: entity.id,
            entityType: entity.type,
            entityLabel: entity.canonicalName,
            predicate: 'CURRENT_STOCK',
            operation: 'SET',
            beforeValue: 20,
            afterValue: 30,
            valueSource: 'USER_PROVIDED',
            explanation: 'D1 rollback proof',
          },
        ],
        preconditions: [
          {
            entityId: entity.id,
            predicate: 'CURRENT_STOCK',
            effectiveClaimId: effective.effectiveClaim.id,
            effectiveValue: 20,
            authority: effective.effectiveClaim.authority,
          },
        ],
        eventType: 'D1_ROLLBACK_PROOF',
        eventData: {},
        expiresAt: Date.now() + 60_000,
      });

    const now = Date.now();
    const ref = confirmedSource(rollbackProposal.id);

    const claim: KnowledgeClaim = {
      id: 'clm_d1_rollback',
      fingerprint: 'd1-rollback-claim',
      accountId: accountA,
      subjectEntityId: entity.id,
      predicate: 'CURRENT_STOCK',
      value: 30,
      valueType: 'NUMBER',
      claimKind: 'FACT',
      authority: {
        ...SOURCE_AUTHORITIES.USER_CONFIRMED,
      },
      sourceRef: ref,
      observedAt: now,
      validFrom: now,
      isCurrent: true,
      supersedesClaimId: effective.effectiveClaim.id,
      createdAt: now,
    };

    const event: BusinessEvent = {
      id: 'evt_d1_rollback',
      fingerprint: 'd1-rollback-event',
      accountId: accountA,
      type: 'D1_ROLLBACK_PROOF',
      subjectEntityIds: [entity.id],
      data: { proposalId: rollbackProposal.id },
      sourceRef: ref,
      occurredAt: now,
      recordedAt: now,
    };

    const execution: ActionExecution = {
      id: 'exe_d1_rollback',
      accountId: accountA,
      proposalId: rollbackProposal.id,
      intent: rollbackProposal.intent,
      executionMode: 'MANUAL_CONFIRMATION',
      authorizedBy: 'user:d1-proof',
      claimIds: [claim.id],
      eventIds: [event.id],
      downstreamAnalysisRunIds: [],
      downstreamWarnings: [],
      executedAt: now,
    };

    const audit: ActionAuditEntry = {
      id: 'aud_d1_rollback',
      accountId: accountA,
      proposalId: rollbackProposal.id,
      action: 'CONFIRMED',
      timestamp: now,
      detail: 'D1 rollback proof',
      executionId: 'exe_d1_mismatch',
    };

    let rolledBack = false;
    try {
      await postgresConfirmedActionTransactionRepository
        .commitConfirmedAction({
          accountId: accountA,
          proposalId: rollbackProposal.id,
          expectedProposalStatus: 'PROPOSED',
          claimsToClose: [
            {
              claimId: effective.effectiveClaim.id,
              validTo: now,
            },
          ],
          claimsToInsert: [claim],
          eventToInsert: event,
          execution,
          auditEntry: audit,
          confirmedAt: now,
        });
    } catch (error: any) {
      rolledBack = String(error?.message || '').includes(
        'audit identity does not match'
      );
    }
    assert(
      rolledBack,
      'D1 proof must trigger a late transaction rollback.'
    );

    const rollbackState = await postgresPool().query(
      `SELECT
         (SELECT status FROM action_proposals
           WHERE account_id = $1 AND id = $2) AS proposal_status,
         (SELECT count(*)::int FROM knowledge_claims
           WHERE account_id = $1 AND id = $3) AS claims,
         (SELECT count(*)::int FROM business_events
           WHERE account_id = $1 AND id = $4) AS events,
         (SELECT count(*)::int FROM action_executions
           WHERE account_id = $1 AND id = $5) AS executions,
         (SELECT count(*)::int FROM action_audit_entries
           WHERE account_id = $1 AND id = $6) AS audits,
         (SELECT is_current FROM knowledge_claims
           WHERE account_id = $1 AND id = $7) AS prior_current`,
      [
        accountA,
        rollbackProposal.id,
        claim.id,
        event.id,
        execution.id,
        audit.id,
        effective.effectiveClaim.id,
      ]
    );

    assert(
      rollbackState.rows[0]?.proposal_status === 'PROPOSED' &&
        Number(rollbackState.rows[0]?.claims) === 0 &&
        Number(rollbackState.rows[0]?.events) === 0 &&
        Number(rollbackState.rows[0]?.executions) === 0 &&
        Number(rollbackState.rows[0]?.audits) === 0 &&
        rollbackState.rows[0]?.prior_current === true,
      'Late failure must roll back all earlier relational writes.'
    );

    let foreignBlocked = false;
    try {
      await postgresConfirmedActionTransactionRepository
        .commitConfirmedAction({
          accountId: accountB,
          proposalId: rollbackProposal.id,
          expectedProposalStatus: 'PROPOSED',
          claimsToClose: [],
          claimsToInsert: [],
          eventToInsert: { ...event, accountId: accountB },
          execution: { ...execution, accountId: accountB },
          auditEntry: {
            ...audit,
            accountId: accountB,
            executionId: execution.id,
          },
          confirmedAt: Date.now(),
        });
    } catch (error) {
      foreignBlocked =
        error instanceof PostgresActionTransactionError &&
        error.code === 'ACTION_PROPOSAL_NOT_FOUND';
    }

    assert(
      foreignBlocked,
      'D1 transaction must reject cross-account raw proposal IDs.'
    );

    console.log(
      'PRODUCTION_D1_CONFIRMED_ACTION_TRANSACTION_POSTGRES_CHECK_PASSED'
    );
  } finally {
    await closePostgresPool();
  }
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_D1_CONFIRMED_ACTION_TRANSACTION_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  });
