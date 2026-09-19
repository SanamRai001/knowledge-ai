import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  PostgresActionTransactionError,
  postgresActionRepository,
  postgresCompanyKnowledgeRepository,
  postgresConfirmedActionTransactionRepository,
} from '../server/persistence/a3PostgresRepositories.js';
import {
  importLegacyA3,
  readLegacyA3Snapshot,
} from '../server/persistence/a3LegacyImporter.js';
import type {
  ActionAuditEntry,
  ActionExecution,
  ActionProposal,
} from '../server/actions/types.js';
import type {
  BusinessEvent,
  CompanyEntity,
  KnowledgeClaim,
  KnowledgeClaimValue,
} from '../server/companyKnowledge/types.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function sourceRef(params: {
  sourceType: 'DATASET' | 'USER';
  sourceId: string;
  sourceVersionId: string;
  sourceName: string;
}) {
  return {
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    sourceVersionId: params.sourceVersionId,
    sourceVersionLabel: params.sourceVersionId,
    sourceName: params.sourceName,
  } as const;
}

async function resetA3(): Promise<void> {
  await postgresPool().query(`
    TRUNCATE TABLE
      action_audit_entries,
      action_execution_events,
      action_execution_claims,
      action_executions,
      action_proposal_targets,
      action_proposals,
      business_event_subjects,
      business_events,
      knowledge_claims,
      knowledge_projection_runs,
      company_relationships,
      company_entities
    CASCADE
  `);
}

function entity(params: {
  id: string;
  accountId: string;
  type: CompanyEntity['type'];
  name: string;
}): CompanyEntity {
  return {
    id: params.id,
    accountId: params.accountId,
    type: params.type,
    canonicalName: params.name,
    normalizedName: params.name.toLowerCase(),
    identityKey: params.id.toLowerCase(),
    aliases: [],
    sourceRefs: [
      sourceRef({
        sourceType: 'DATASET',
        sourceId: 'ds_seed',
        sourceVersionId: 'dsv_seed',
        sourceName: 'Seed dataset',
      }),
    ],
    createdAt: 1000,
    updatedAt: 1000,
    firstObservedAt: 1000,
    lastObservedAt: 1000,
  };
}

function claim(params: {
  id: string;
  fingerprint: string;
  accountId: string;
  entityId: string;
  predicate: string;
  value: KnowledgeClaimValue;
  authorityLevel:
    | 'STRUCTURED_SOURCE'
    | 'USER_CONFIRMED';
  authorityRank: number;
  sourceType: 'DATASET' | 'USER';
  sourceId: string;
  sourceVersionId: string;
  observedAt: number;
  supersedesClaimId?: string;
}): KnowledgeClaim {
  const valueType =
    params.value === null
      ? 'NULL'
      : typeof params.value === 'number'
        ? 'NUMBER'
        : typeof params.value === 'boolean'
          ? 'BOOLEAN'
          : /^\d{4}-\d{2}-\d{2}/.test(params.value)
            ? 'DATE'
            : 'TEXT';

  return {
    id: params.id,
    fingerprint: params.fingerprint,
    accountId: params.accountId,
    subjectEntityId: params.entityId,
    predicate: params.predicate,
    value: params.value,
    valueType,
    claimKind: 'FACT',
    authority: {
      level: params.authorityLevel,
      rank: params.authorityRank,
      reason:
        params.authorityLevel === 'USER_CONFIRMED'
          ? 'Explicitly confirmed business state.'
          : 'Imported structured source.',
    },
    sourceRef: sourceRef({
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      sourceVersionId: params.sourceVersionId,
      sourceName:
        params.sourceType === 'USER'
          ? 'Confirmed business action'
          : 'Seed dataset',
    }),
    observedAt: params.observedAt,
    validFrom: params.observedAt,
    isCurrent: true,
    supersedesClaimId: params.supersedesClaimId,
    createdAt: params.observedAt,
  };
}

function proposal(params: {
  id: string;
  accountId: string;
  entity: CompanyEntity;
  expectedClaim: KnowledgeClaim;
  before: number;
  after: number;
}): ActionProposal {
  return {
    id: params.id,
    accountId: params.accountId,
    instruction:
      'Receive ' +
      String(params.after - params.before) +
      ' units of ' +
      params.entity.canonicalName,
    intent: 'RECEIVE_INVENTORY',
    status: 'PROPOSED',
    parserSource: 'DETERMINISTIC',
    parsedInput: {
      intent: 'RECEIVE_INVENTORY',
      productReference: params.entity.canonicalName,
      quantity: params.after - params.before,
    },
    targetEntityIds: [params.entity.id],
    mutations: [
      {
        entityId: params.entity.id,
        entityType: params.entity.type,
        entityLabel: params.entity.canonicalName,
        predicate: 'CURRENT_STOCK',
        operation: 'SET',
        beforeValue: params.before,
        afterValue: params.after,
        valueSource: 'DETERMINISTIC_CALCULATION',
        explanation: 'Current stock plus received quantity.',
      },
    ],
    preconditions: [
      {
        entityId: params.entity.id,
        predicate: 'CURRENT_STOCK',
        effectiveClaimId: params.expectedClaim.id,
        effectiveValue: params.before,
        authority: params.expectedClaim.authority,
      },
    ],
    eventType: 'INVENTORY_RECEIVED',
    eventData: {
      quantity: params.after - params.before,
    },
    calculationSummary:
      String(params.before) +
      ' + ' +
      String(params.after - params.before) +
      ' = ' +
      String(params.after),
    createdAt: 2000,
    updatedAt: 2000,
    expiresAt: Date.now() + 60_000,
  };
}

function actionArtifacts(params: {
  accountId: string;
  proposal: ActionProposal;
  entity: CompanyEntity;
  after: number;
  now: number;
}): {
  claim: KnowledgeClaim;
  event: BusinessEvent;
  execution: ActionExecution;
  audit: ActionAuditEntry;
} {
  const actionClaim = claim({
    id: 'clm_action_' + params.proposal.id,
    fingerprint: 'fp_action_' + params.proposal.id,
    accountId: params.accountId,
    entityId: params.entity.id,
    predicate: 'CURRENT_STOCK',
    value: params.after,
    authorityLevel: 'USER_CONFIRMED',
    authorityRank: 600,
    sourceType: 'USER',
    sourceId: 'confirmed-company-state',
    sourceVersionId: params.proposal.id,
    observedAt: params.now,
  });

  const event: BusinessEvent = {
    id: 'evt_action_' + params.proposal.id,
    fingerprint: 'fp_evt_' + params.proposal.id,
    accountId: params.accountId,
    type: 'INVENTORY_RECEIVED',
    subjectEntityIds: [params.entity.id],
    data: {
      quantity: params.after,
      proposalId: params.proposal.id,
    },
    sourceRef: actionClaim.sourceRef,
    occurredAt: params.now,
    recordedAt: params.now,
  };

  const execution: ActionExecution = {
    id: 'exe_action_' + params.proposal.id,
    accountId: params.accountId,
    proposalId: params.proposal.id,
    intent: params.proposal.intent,
    executionMode: 'MANUAL_CONFIRMATION',
    authorizedBy: 'user:test',
    claimIds: [actionClaim.id],
    eventIds: [event.id],
    downstreamAnalysisRunIds: [],
    downstreamWarnings: [],
    executedAt: params.now,
  };

  const audit: ActionAuditEntry = {
    id: 'aud_action_' + params.proposal.id,
    accountId: params.accountId,
    proposalId: params.proposal.id,
    action: 'CONFIRMED',
    timestamp: params.now,
    detail: 'Confirmed atomically in PostgreSQL.',
    executionId: execution.id,
  };

  return {
    claim: actionClaim,
    event,
    execution,
    audit,
  };
}

async function effective(
  accountId: string,
  entityId: string,
  predicate: string
): Promise<KnowledgeClaim | null> {
  const claims =
    await postgresCompanyKnowledgeRepository.listClaims({
      accountId,
      entityId,
      predicate,
      currentOnly: true,
      limit: 100,
    });
  if (!claims.length) return null;
  const highestRank = Math.max(
    ...claims.map((item) => item.authority.rank)
  );
  const highest = claims.filter(
    (item) => item.authority.rank === highestRank
  );
  const groups = new Map<string, KnowledgeClaim[]>();
  for (const item of highest) {
    const key = JSON.stringify(item.value);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  if (groups.size !== 1) return null;
  return Array.from(groups.values())[0].sort(
    (a, b) =>
      b.observedAt - a.observedAt ||
      b.createdAt - a.createdAt
  )[0];
}

function writeJson(
  dir: string,
  name: string,
  value: unknown
): void {
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify(value, null, 2),
    'utf8'
  );
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the A3 PostgreSQL proof.'
  );

  const migrations = await runPostgresMigrations();
  assert(
    migrations.applied.includes('002') ||
      migrations.alreadyApplied.includes('002'),
    'Migration 002 must be present in migration history.'
  );

  await resetA3();

  const accountA = 'acc_a3_pg_a';
  const accountB = 'acc_a3_pg_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const productA = entity({
    id: 'ent_a3_product_a',
    accountId: accountA,
    type: 'PRODUCT',
    name: 'A3 Oak Boards',
  });
  const productB = entity({
    id: 'ent_a3_product_b',
    accountId: accountB,
    type: 'PRODUCT',
    name: 'A3 Walnut Boards',
  });
  await postgresCompanyKnowledgeRepository.saveEntity(productA);
  await postgresCompanyKnowledgeRepository.saveEntity(productB);

  const baseA = claim({
    id: 'clm_a3_base_a',
    fingerprint: 'fp_a3_base_a',
    accountId: accountA,
    entityId: productA.id,
    predicate: 'CURRENT_STOCK',
    value: 10,
    authorityLevel: 'STRUCTURED_SOURCE',
    authorityRank: 400,
    sourceType: 'DATASET',
    sourceId: 'ds_a3_a',
    sourceVersionId: 'dsv_a3_a1',
    observedAt: 3000,
  });
  await postgresCompanyKnowledgeRepository.saveClaim(baseA);

  const proposalA = proposal({
    id: 'act_a3_atomic',
    accountId: accountA,
    entity: productA,
    expectedClaim: baseA,
    before: 10,
    after: 15,
  });
  await postgresActionRepository.saveProposal(proposalA);

  const artifactsA = actionArtifacts({
    accountId: accountA,
    proposal: proposalA,
    entity: productA,
    after: 15,
    now: 5000,
  });

  const committed =
    await postgresConfirmedActionTransactionRepository.commitConfirmedAction(
      {
        accountId: accountA,
        proposalId: proposalA.id,
        expectedProposalStatus: 'PROPOSED',
        claimsToClose: [],
        claimsToInsert: [artifactsA.claim],
        eventToInsert: artifactsA.event,
        execution: artifactsA.execution,
        auditEntry: artifactsA.audit,
        confirmedAt: 5000,
      }
    );

  assert(
    committed.idempotentReplay === false &&
      committed.proposal.status === 'CONFIRMED' &&
      committed.proposal.executionId ===
        artifactsA.execution.id,
    'First relational action confirmation must atomically confirm the proposal and execution link.'
  );

  const effectiveAfter = await effective(
    accountA,
    productA.id,
    'CURRENT_STOCK'
  );
  assert(
    effectiveAfter?.id === artifactsA.claim.id &&
      effectiveAfter.value === 15 &&
      effectiveAfter.authority.level === 'USER_CONFIRMED',
    'Higher-authority confirmed action claim must become effective while preserving the structured-source claim.'
  );

  const baseStillCurrent =
    await postgresCompanyKnowledgeRepository.getClaim(
      accountA,
      baseA.id
    );
  assert(
    baseStillCurrent?.isCurrent === true,
    'A confirmed-company-state claim must not erase an imported structured-source claim from a different source identity.'
  );

  const replay =
    await postgresConfirmedActionTransactionRepository.commitConfirmedAction(
      {
        accountId: accountA,
        proposalId: proposalA.id,
        expectedProposalStatus: 'PROPOSED',
        claimsToClose: [],
        claimsToInsert: [artifactsA.claim],
        eventToInsert: artifactsA.event,
        execution: artifactsA.execution,
        auditEntry: artifactsA.audit,
        confirmedAt: 5000,
      }
    );

  assert(
    replay.idempotentReplay === true &&
      replay.execution.id === artifactsA.execution.id,
    'Repeated confirmation must return the database-enforced existing execution instead of duplicating state.'
  );

  const executionCount = await postgresPool().query(
    `SELECT count(*)::int AS count
     FROM action_executions
     WHERE account_id = $1 AND proposal_id = $2`,
    [accountA, proposalA.id]
  );
  assert(
    executionCount.rows[0].count === 1,
    'Database uniqueness must enforce one ActionExecution per account/proposal.'
  );

  const staleBase = claim({
    id: 'clm_a3_stale_base',
    fingerprint: 'fp_a3_stale_base',
    accountId: accountA,
    entityId: productA.id,
    predicate: 'RESERVED_STOCK',
    value: 2,
    authorityLevel: 'STRUCTURED_SOURCE',
    authorityRank: 400,
    sourceType: 'DATASET',
    sourceId: 'ds_a3_reserved',
    sourceVersionId: 'dsv_a3_reserved_1',
    observedAt: 6000,
  });
  await postgresCompanyKnowledgeRepository.saveClaim(staleBase);

  const staleProposal: ActionProposal = {
    ...proposal({
      id: 'act_a3_stale',
      accountId: accountA,
      entity: productA,
      expectedClaim: staleBase,
      before: 2,
      after: 3,
    }),
    mutations: [
      {
        entityId: productA.id,
        entityType: productA.type,
        entityLabel: productA.canonicalName,
        predicate: 'RESERVED_STOCK',
        operation: 'SET',
        beforeValue: 2,
        afterValue: 3,
        valueSource: 'DETERMINISTIC_CALCULATION',
        explanation: 'Fixture stale mutation.',
      },
    ],
    preconditions: [
      {
        entityId: productA.id,
        predicate: 'RESERVED_STOCK',
        effectiveClaimId: staleBase.id,
        effectiveValue: 2,
        authority: staleBase.authority,
      },
    ],
  };
  await postgresActionRepository.saveProposal(staleProposal);

  const newer = claim({
    id: 'clm_a3_newer',
    fingerprint: 'fp_a3_newer',
    accountId: accountA,
    entityId: productA.id,
    predicate: 'RESERVED_STOCK',
    value: 4,
    authorityLevel: 'USER_CONFIRMED',
    authorityRank: 600,
    sourceType: 'USER',
    sourceId: 'confirmed-company-state',
    sourceVersionId: 'outside-change',
    observedAt: 7000,
  });
  await postgresCompanyKnowledgeRepository.saveClaim(newer);

  const staleArtifacts = actionArtifacts({
    accountId: accountA,
    proposal: staleProposal,
    entity: productA,
    after: 3,
    now: 8000,
  });
  staleArtifacts.claim = {
    ...staleArtifacts.claim,
    id: 'clm_a3_should_not_write',
    fingerprint: 'fp_a3_should_not_write',
    predicate: 'RESERVED_STOCK',
    value: 3,
  };

  let staleBlocked = false;
  try {
    await postgresConfirmedActionTransactionRepository.commitConfirmedAction(
      {
        accountId: accountA,
        proposalId: staleProposal.id,
        expectedProposalStatus: 'PROPOSED',
        claimsToClose: [],
        claimsToInsert: [staleArtifacts.claim],
        eventToInsert: staleArtifacts.event,
        execution: {
          ...staleArtifacts.execution,
          claimIds: [staleArtifacts.claim.id],
        },
        auditEntry: staleArtifacts.audit,
        confirmedAt: 8000,
      }
    );
  } catch (error) {
    staleBlocked =
      error instanceof PostgresActionTransactionError &&
      error.code === 'ACTION_STALE';
  }
  assert(
    staleBlocked,
    'Transaction must re-evaluate stale preconditions and reject changed effective state.'
  );
  assert(
    (await postgresCompanyKnowledgeRepository.getClaim(
      accountA,
      staleArtifacts.claim.id
    )) === null &&
      (await postgresActionRepository.getExecutionByProposal(
        accountA,
        staleProposal.id
      )) === null,
    'Stale transaction must leave no partial claim or execution.'
  );

  const rollbackBase = claim({
    id: 'clm_a3_rollback_base',
    fingerprint: 'fp_a3_rollback_base',
    accountId: accountA,
    entityId: productA.id,
    predicate: 'DAMAGED_STOCK',
    value: 1,
    authorityLevel: 'STRUCTURED_SOURCE',
    authorityRank: 400,
    sourceType: 'DATASET',
    sourceId: 'ds_a3_damage',
    sourceVersionId: 'dsv_a3_damage_1',
    observedAt: 9000,
  });
  await postgresCompanyKnowledgeRepository.saveClaim(rollbackBase);

  const rollbackProposal: ActionProposal = {
    ...proposal({
      id: 'act_a3_rollback',
      accountId: accountA,
      entity: productA,
      expectedClaim: rollbackBase,
      before: 1,
      after: 2,
    }),
    mutations: [
      {
        entityId: productA.id,
        entityType: productA.type,
        entityLabel: productA.canonicalName,
        predicate: 'DAMAGED_STOCK',
        operation: 'SET',
        beforeValue: 1,
        afterValue: 2,
        valueSource: 'DETERMINISTIC_CALCULATION',
        explanation: 'Rollback fixture.',
      },
    ],
    preconditions: [
      {
        entityId: productA.id,
        predicate: 'DAMAGED_STOCK',
        effectiveClaimId: rollbackBase.id,
        effectiveValue: 1,
        authority: rollbackBase.authority,
      },
    ],
  };
  await postgresActionRepository.saveProposal(rollbackProposal);

  const rollbackArtifacts = actionArtifacts({
    accountId: accountA,
    proposal: rollbackProposal,
    entity: productA,
    after: 2,
    now: 10000,
  });
  rollbackArtifacts.claim = {
    ...rollbackArtifacts.claim,
    id: 'clm_a3_rollback_new',
    fingerprint: 'fp_a3_rollback_new',
    predicate: 'DAMAGED_STOCK',
    value: 2,
  };
  rollbackArtifacts.event = {
    ...rollbackArtifacts.event,
    id: 'evt_a3_rollback_invalid',
    fingerprint: 'fp_evt_a3_rollback_invalid',
    subjectEntityIds: [productB.id],
  };
  rollbackArtifacts.execution = {
    ...rollbackArtifacts.execution,
    id: 'exe_a3_rollback',
    claimIds: [rollbackArtifacts.claim.id],
    eventIds: [rollbackArtifacts.event.id],
  };
  rollbackArtifacts.audit = {
    ...rollbackArtifacts.audit,
    id: 'aud_a3_rollback',
    executionId: rollbackArtifacts.execution.id,
  };

  let rollbackTriggered = false;
  try {
    await postgresConfirmedActionTransactionRepository.commitConfirmedAction(
      {
        accountId: accountA,
        proposalId: rollbackProposal.id,
        expectedProposalStatus: 'PROPOSED',
        claimsToClose: [],
        claimsToInsert: [rollbackArtifacts.claim],
        eventToInsert: rollbackArtifacts.event,
        execution: rollbackArtifacts.execution,
        auditEntry: rollbackArtifacts.audit,
        confirmedAt: 10000,
      }
    );
  } catch {
    rollbackTriggered = true;
  }
  assert(
    rollbackTriggered,
    'Cross-account event subject must fail the transaction.'
  );
  assert(
    (await postgresCompanyKnowledgeRepository.getClaim(
      accountA,
      rollbackArtifacts.claim.id
    )) === null &&
      (await postgresActionRepository.getExecutionByProposal(
        accountA,
        rollbackProposal.id
      )) === null &&
      (await postgresActionRepository.getProposal(
        accountA,
        rollbackProposal.id
      ))?.status === 'PROPOSED',
    'Mid-transaction failure must roll back claim, execution, and proposal transition together.'
  );

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowledge-ai-a3-')
  );
  const legacyEntity = entity({
    id: 'ent_a3_legacy',
    accountId: accountB,
    type: 'CUSTOMER',
    name: 'Legacy Customer',
  });
  const legacyClaim = claim({
    id: 'clm_a3_legacy',
    fingerprint: 'fp_a3_legacy',
    accountId: accountB,
    entityId: legacyEntity.id,
    predicate: 'BALANCE_DUE',
    value: 2500,
    authorityLevel: 'STRUCTURED_SOURCE',
    authorityRank: 400,
    sourceType: 'DATASET',
    sourceId: 'ds_legacy',
    sourceVersionId: 'dsv_legacy',
    observedAt: 11000,
  });
  const legacyEvent: BusinessEvent = {
    id: 'evt_a3_legacy',
    fingerprint: 'fp_evt_a3_legacy',
    accountId: accountB,
    type: 'BALANCE_OBSERVED',
    subjectEntityIds: [legacyEntity.id],
    data: { balance: 2500 },
    sourceRef: legacyClaim.sourceRef,
    occurredAt: 11000,
    recordedAt: 11000,
  };
  const legacyProposal = proposal({
    id: 'act_a3_legacy',
    accountId: accountB,
    entity: legacyEntity,
    expectedClaim: legacyClaim,
    before: 2500,
    after: 2000,
  });
  legacyProposal.intent = 'RECORD_PAYMENT';
  legacyProposal.status = 'CONFIRMED';
  legacyProposal.confirmedAt = 12000;
  const legacyExecution: ActionExecution = {
    id: 'exe_a3_legacy',
    accountId: accountB,
    proposalId: legacyProposal.id,
    intent: 'RECORD_PAYMENT',
    executionMode: 'MANUAL_CONFIRMATION',
    authorizedBy: 'user:legacy',
    claimIds: [legacyClaim.id],
    eventIds: [legacyEvent.id],
    downstreamAnalysisRunIds: [],
    downstreamWarnings: [],
    executedAt: 12000,
  };
  legacyProposal.executionId = legacyExecution.id;
  const legacyAudit: ActionAuditEntry = {
    id: 'aud_a3_legacy',
    accountId: accountB,
    proposalId: legacyProposal.id,
    action: 'CONFIRMED',
    timestamp: 12000,
    detail: 'Legacy confirmed action.',
    executionId: legacyExecution.id,
  };

  writeJson(tempDir, 'company-knowledge.json', {
    entities: [legacyEntity],
    relationships: [],
    claims: [legacyClaim],
    events: [legacyEvent],
    projectionRuns: [],
  });
  writeJson(tempDir, 'company-actions.json', {
    proposals: [legacyProposal],
    executions: [legacyExecution],
    auditEntries: [legacyAudit],
  });

  const knowledgeBefore = fs.readFileSync(
    path.join(tempDir, 'company-knowledge.json'),
    'utf8'
  );
  const actionsBefore = fs.readFileSync(
    path.join(tempDir, 'company-actions.json'),
    'utf8'
  );

  const snapshot = readLegacyA3Snapshot(tempDir);
  const dryRun = await importLegacyA3({
    snapshot,
    dryRun: true,
  });
  assert(
    dryRun.conflicts.length === 0 &&
      dryRun.counts.entities === 1 &&
      dryRun.counts.proposals === 1 &&
      dryRun.imported.entities === 0,
    'A3 dry-run must validate legacy records without writing them.'
  );

  const imported = await importLegacyA3({ snapshot });
  assert(
    imported.conflicts.length === 0 &&
      imported.imported.entities === 1 &&
      imported.imported.claims === 1 &&
      imported.imported.events === 1 &&
      imported.imported.proposals === 1 &&
      imported.imported.executions === 1 &&
      imported.imported.auditEntries === 1,
    'A3 importer must preserve the full Living Knowledge + Action record IDs.'
  );

  const repeated = await importLegacyA3({ snapshot });
  assert(
    repeated.conflicts.length === 0 &&
      Object.values(repeated.imported).every(
        (value) => value === 0
      ) &&
      repeated.skippedExisting >= 5,
    'A3 legacy import must be idempotent.'
  );

  assert(
    fs.readFileSync(
      path.join(tempDir, 'company-knowledge.json'),
      'utf8'
    ) === knowledgeBefore &&
      fs.readFileSync(
        path.join(tempDir, 'company-actions.json'),
        'utf8'
      ) === actionsBefore,
    'A3 legacy importer must never mutate source JSON files.'
  );

  const importedProposal =
    await postgresActionRepository.getProposal(
      accountB,
      legacyProposal.id
    );
  const importedExecution =
    await postgresActionRepository.getExecutionByProposal(
      accountB,
      legacyProposal.id
    );
  assert(
    importedProposal?.executionId === legacyExecution.id &&
      importedExecution?.id === legacyExecution.id &&
      importedExecution.claimIds[0] === legacyClaim.id &&
      importedExecution.eventIds[0] === legacyEvent.id,
    'Legacy proposal/execution/claim/event relationships must survive import.'
  );

  assert(
    (await postgresCompanyKnowledgeRepository.getEntity(
      accountB,
      productA.id
    )) === null &&
      (await postgresActionRepository.getProposal(
        accountB,
        proposalA.id
      )) === null,
    'A3 repositories must remain account scoped.'
  );

  let foreignExecutionLinkBlocked = false;
  try {
    await postgresPool().query(
      `INSERT INTO action_execution_claims
        (account_id, execution_id, claim_id, position)
       VALUES ($1,$2,$3,99)`,
      [
        accountA,
        artifactsA.execution.id,
        legacyClaim.id,
      ]
    );
  } catch {
    foreignExecutionLinkBlocked = true;
  }
  assert(
    foreignExecutionLinkBlocked,
    'Database must reject cross-account execution-to-claim links.'
  );

  console.log('PRODUCTION_A3_POSTGRES_CHECK_PASSED');
  console.log(
    'Migration 002, authority-aware relational state, atomic/idempotent confirmed Actions, transactional stale checks, rollback safety, legacy A3 import, and cross-account constraints are verified.'
  );
}

main()
  .catch((error) => {
    console.error('PRODUCTION_A3_POSTGRES_CHECK_FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
