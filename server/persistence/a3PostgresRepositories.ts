import crypto from 'crypto';
import type { PoolClient } from 'pg';
import {
  postgresPool,
  withTransaction,
} from './postgres.js';
import type {
  BusinessEvent,
  CompanyEntity,
  CompanyRelationship,
  KnowledgeClaim,
  KnowledgeClaimValue,
  KnowledgeProjectionRun,
} from '../companyKnowledge/types.js';
import type {
  ActionAuditEntry,
  ActionExecution,
  ActionProposal,
  ActionProposalStatus,
} from '../actions/types.js';
import type {
  ActionRepository,
  CompanyKnowledgeRepository,
  ConfirmedActionTransactionInput,
  ConfirmedActionTransactionRepository,
  ConfirmedActionTransactionResult,
} from './a3Types.js';

function epoch(value: Date | string | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error('PostgreSQL returned an invalid timestamp.');
  }
  return parsed;
}

function date(value: number | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function entityFromRow(row: any): CompanyEntity {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type,
    canonicalName: row.canonical_name,
    normalizedName: row.normalized_name,
    identityKey: row.identity_key,
    aliases: row.aliases || [],
    sourceRefs: row.source_refs || [],
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
    firstObservedAt: epoch(row.first_observed_at)!,
    lastObservedAt: epoch(row.last_observed_at)!,
  };
}

function relationshipFromRow(row: any): CompanyRelationship {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    accountId: row.account_id,
    subjectEntityId: row.subject_entity_id,
    predicate: row.predicate,
    objectEntityId: row.object_entity_id,
    claimKind: row.claim_kind,
    authority: {
      level: row.authority_level,
      rank: row.authority_rank,
      reason: row.authority_reason,
    },
    sourceRefs: row.source_refs || [],
    firstObservedAt: epoch(row.first_observed_at)!,
    lastObservedAt: epoch(row.last_observed_at)!,
    occurrenceCount: row.occurrence_count,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function claimFromRow(row: any): KnowledgeClaim {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    accountId: row.account_id,
    subjectEntityId: row.subject_entity_id,
    predicate: row.predicate,
    value: row.value as KnowledgeClaimValue,
    valueType: row.value_type,
    claimKind: row.claim_kind,
    authority: {
      level: row.authority_level,
      rank: row.authority_rank,
      reason: row.authority_reason,
    },
    sourceRef: row.source_ref,
    observedAt: epoch(row.observed_at)!,
    validFrom: epoch(row.valid_from) ?? undefined,
    validTo: epoch(row.valid_to) ?? undefined,
    isCurrent: row.is_current,
    supersedesClaimId: row.supersedes_claim_id ?? undefined,
    createdAt: epoch(row.created_at)!,
  };
}

async function eventFromRow(
  client: Pick<PoolClient, 'query'>,
  row: any
): Promise<BusinessEvent> {
  const subjects = await client.query(
    `SELECT entity_id
     FROM business_event_subjects
     WHERE account_id = $1 AND event_id = $2
     ORDER BY position ASC`,
    [row.account_id, row.id]
  );

  return {
    id: row.id,
    fingerprint: row.fingerprint,
    accountId: row.account_id,
    type: row.type,
    subjectEntityIds: subjects.rows.map((item) => item.entity_id),
    data: row.data || {},
    sourceRef: row.source_ref,
    occurredAt: epoch(row.occurred_at) ?? undefined,
    recordedAt: epoch(row.recorded_at)!,
    projectionRunId: row.projection_run_id ?? undefined,
  };
}

function projectionRunFromRow(row: any): KnowledgeProjectionRun {
  return {
    id: row.id,
    accountId: row.account_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id ?? undefined,
    sourceVersionLabel: row.source_version_label ?? undefined,
    startedAt: epoch(row.started_at)!,
    completedAt: epoch(row.completed_at) ?? undefined,
    status: row.status,
    entityIds: row.entity_ids || [],
    relationshipIds: row.relationship_ids || [],
    claimIds: row.claim_ids || [],
    eventIds: row.event_ids || [],
    error: row.error ?? undefined,
  };
}

function proposalFromRow(
  row: any,
  targetEntityIds: string[]
): ActionProposal {
  return {
    id: row.id,
    accountId: row.account_id,
    instruction: row.instruction,
    intent: row.intent,
    status: row.status,
    parserSource: row.parser_source,
    parsedInput: row.parsed_input,
    targetEntityIds,
    targetCandidates: row.target_candidates ?? undefined,
    needsInputReason: row.needs_input_reason ?? undefined,
    mutations: row.mutations || [],
    preconditions: row.preconditions || [],
    eventType: row.event_type ?? undefined,
    eventData: row.event_data || {},
    calculationSummary: row.calculation_summary ?? undefined,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
    expiresAt: epoch(row.expires_at)!,
    confirmedAt: epoch(row.confirmed_at) ?? undefined,
    cancelledAt: epoch(row.cancelled_at) ?? undefined,
    staleAt: epoch(row.stale_at) ?? undefined,
    failedAt: epoch(row.failed_at) ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    executionId: row.execution_id ?? undefined,
  };
}

async function executionFromRow(
  client: Pick<PoolClient, 'query'>,
  row: any
): Promise<ActionExecution> {
  const [claims, events] = await Promise.all([
    client.query(
      `SELECT claim_id
       FROM action_execution_claims
       WHERE account_id = $1 AND execution_id = $2
       ORDER BY position ASC`,
      [row.account_id, row.id]
    ),
    client.query(
      `SELECT event_id
       FROM action_execution_events
       WHERE account_id = $1 AND execution_id = $2
       ORDER BY position ASC`,
      [row.account_id, row.id]
    ),
  ]);

  return {
    id: row.id,
    accountId: row.account_id,
    proposalId: row.proposal_id,
    intent: row.intent,
    executionMode: row.execution_mode ?? undefined,
    authorizedBy: row.authorized_by ?? undefined,
    authorizedByRole: row.authorized_by_role ?? undefined,
    automationPolicyId: row.automation_policy_id ?? undefined,
    automationPolicyVersion:
      row.automation_policy_version ?? undefined,
    claimIds: claims.rows.map((item) => item.claim_id),
    eventIds: events.rows.map((item) => item.event_id),
    downstreamAnalysisRunIds:
      row.downstream_analysis_run_ids || [],
    downstreamWarnings: row.downstream_warnings || [],
    executedAt: epoch(row.executed_at)!,
  };
}

function auditFromRow(row: any): ActionAuditEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    proposalId: row.proposal_id,
    action: row.action,
    timestamp: epoch(row.occurred_at)!,
    detail: row.detail,
    executionId: row.execution_id ?? undefined,
  };
}

async function proposalTargets(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  proposalId: string
): Promise<string[]> {
  const result = await client.query(
    `SELECT entity_id
     FROM action_proposal_targets
     WHERE account_id = $1 AND proposal_id = $2
     ORDER BY position ASC`,
    [accountId, proposalId]
  );
  return result.rows.map((row) => row.entity_id);
}

async function insertEntity(
  client: Pick<PoolClient, 'query'>,
  entity: CompanyEntity
): Promise<void> {
  await client.query(
    `INSERT INTO company_entities
      (id, account_id, type, canonical_name, normalized_name,
       identity_key, aliases, source_refs, created_at, updated_at,
       first_observed_at, last_observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       canonical_name = EXCLUDED.canonical_name,
       normalized_name = EXCLUDED.normalized_name,
       identity_key = EXCLUDED.identity_key,
       aliases = EXCLUDED.aliases,
       source_refs = EXCLUDED.source_refs,
       updated_at = EXCLUDED.updated_at,
       first_observed_at = LEAST(company_entities.first_observed_at, EXCLUDED.first_observed_at),
       last_observed_at = GREATEST(company_entities.last_observed_at, EXCLUDED.last_observed_at)
     WHERE company_entities.account_id = EXCLUDED.account_id`,
    [
      entity.id,
      entity.accountId,
      entity.type,
      entity.canonicalName,
      entity.normalizedName,
      entity.identityKey,
      json(entity.aliases),
      json(entity.sourceRefs),
      new Date(entity.createdAt),
      new Date(entity.updatedAt),
      new Date(entity.firstObservedAt),
      new Date(entity.lastObservedAt),
    ]
  );
}

async function insertRelationship(
  client: Pick<PoolClient, 'query'>,
  relationship: CompanyRelationship
): Promise<void> {
  await client.query(
    `INSERT INTO company_relationships
      (id, account_id, fingerprint, subject_entity_id, predicate,
       object_entity_id, claim_kind, authority_level, authority_rank,
       authority_reason, source_refs, first_observed_at, last_observed_at,
       occurrence_count, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       authority_level = EXCLUDED.authority_level,
       authority_rank = EXCLUDED.authority_rank,
       authority_reason = EXCLUDED.authority_reason,
       source_refs = EXCLUDED.source_refs,
       first_observed_at = LEAST(company_relationships.first_observed_at, EXCLUDED.first_observed_at),
       last_observed_at = GREATEST(company_relationships.last_observed_at, EXCLUDED.last_observed_at),
       occurrence_count = EXCLUDED.occurrence_count,
       updated_at = EXCLUDED.updated_at
     WHERE company_relationships.account_id = EXCLUDED.account_id`,
    [
      relationship.id,
      relationship.accountId,
      relationship.fingerprint,
      relationship.subjectEntityId,
      relationship.predicate,
      relationship.objectEntityId,
      relationship.claimKind,
      relationship.authority.level,
      relationship.authority.rank,
      relationship.authority.reason,
      json(relationship.sourceRefs),
      new Date(relationship.firstObservedAt),
      new Date(relationship.lastObservedAt),
      relationship.occurrenceCount,
      new Date(relationship.createdAt),
      new Date(relationship.updatedAt),
    ]
  );
}

async function insertClaim(
  client: Pick<PoolClient, 'query'>,
  claim: KnowledgeClaim
): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_claims
      (id, account_id, fingerprint, subject_entity_id, predicate,
       value, value_type, claim_kind, authority_level, authority_rank,
       authority_reason, source_ref, observed_at, valid_from, valid_to,
       is_current, supersedes_claim_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,
             $13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO NOTHING`,
    [
      claim.id,
      claim.accountId,
      claim.fingerprint,
      claim.subjectEntityId,
      claim.predicate,
      json(claim.value),
      claim.valueType,
      claim.claimKind,
      claim.authority.level,
      claim.authority.rank,
      claim.authority.reason,
      json(claim.sourceRef),
      new Date(claim.observedAt),
      date(claim.validFrom),
      date(claim.validTo),
      claim.isCurrent,
      claim.supersedesClaimId ?? null,
      new Date(claim.createdAt),
    ]
  );
}

async function insertEvent(
  client: Pick<PoolClient, 'query'>,
  event: BusinessEvent
): Promise<void> {
  await client.query(
    `INSERT INTO business_events
      (id, account_id, fingerprint, type, data, source_ref,
       occurred_at, recorded_at, projection_run_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
     ON CONFLICT (id) DO NOTHING`,
    [
      event.id,
      event.accountId,
      event.fingerprint,
      event.type,
      json(event.data),
      json(event.sourceRef),
      date(event.occurredAt),
      new Date(event.recordedAt),
      event.projectionRunId ?? null,
    ]
  );

  for (let index = 0; index < event.subjectEntityIds.length; index += 1) {
    await client.query(
      `INSERT INTO business_event_subjects
        (account_id, event_id, entity_id, position)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (account_id, event_id, entity_id) DO NOTHING`,
      [
        event.accountId,
        event.id,
        event.subjectEntityIds[index],
        index,
      ]
    );
  }
}

async function insertProjectionRun(
  client: Pick<PoolClient, 'query'>,
  run: KnowledgeProjectionRun
): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_projection_runs
      (id, account_id, source_type, source_id, source_version_id,
       source_version_label, started_at, completed_at, status,
       entity_ids, relationship_ids, claim_ids, event_ids, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,
             $12::jsonb,$13::jsonb,$14)
     ON CONFLICT (id) DO UPDATE SET
       source_type = EXCLUDED.source_type,
       source_id = EXCLUDED.source_id,
       source_version_id = EXCLUDED.source_version_id,
       source_version_label = EXCLUDED.source_version_label,
       completed_at = EXCLUDED.completed_at,
       status = EXCLUDED.status,
       entity_ids = EXCLUDED.entity_ids,
       relationship_ids = EXCLUDED.relationship_ids,
       claim_ids = EXCLUDED.claim_ids,
       event_ids = EXCLUDED.event_ids,
       error = EXCLUDED.error
     WHERE knowledge_projection_runs.account_id = EXCLUDED.account_id`,
    [
      run.id,
      run.accountId,
      run.sourceType,
      run.sourceId,
      run.sourceVersionId ?? null,
      run.sourceVersionLabel ?? null,
      new Date(run.startedAt),
      date(run.completedAt),
      run.status,
      json(run.entityIds),
      json(run.relationshipIds),
      json(run.claimIds),
      json(run.eventIds),
      run.error ?? null,
    ]
  );
}

async function insertProposal(
  client: Pick<PoolClient, 'query'>,
  proposal: ActionProposal
): Promise<void> {
  await client.query(
    `INSERT INTO action_proposals
      (id, account_id, instruction, intent, status, parser_source,
       parsed_input, target_candidates, needs_input_reason, mutations,
       preconditions, event_type, event_data, calculation_summary,
       created_at, updated_at, expires_at, confirmed_at, cancelled_at,
       stale_at, failed_at, failure_reason, execution_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,
             $11::jsonb,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23)
     ON CONFLICT (id) DO NOTHING`,
    [
      proposal.id,
      proposal.accountId,
      proposal.instruction,
      proposal.intent,
      proposal.status,
      proposal.parserSource,
      json(proposal.parsedInput),
      proposal.targetCandidates
        ? json(proposal.targetCandidates)
        : null,
      proposal.needsInputReason ?? null,
      json(proposal.mutations),
      json(proposal.preconditions),
      proposal.eventType ?? null,
      json(proposal.eventData),
      proposal.calculationSummary ?? null,
      new Date(proposal.createdAt),
      new Date(proposal.updatedAt),
      new Date(proposal.expiresAt),
      date(proposal.confirmedAt),
      date(proposal.cancelledAt),
      date(proposal.staleAt),
      date(proposal.failedAt),
      proposal.failureReason ?? null,
      proposal.executionId ?? null,
    ]
  );

  for (let index = 0; index < proposal.targetEntityIds.length; index += 1) {
    await client.query(
      `INSERT INTO action_proposal_targets
        (account_id, proposal_id, entity_id, position)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (account_id, proposal_id, entity_id) DO NOTHING`,
      [
        proposal.accountId,
        proposal.id,
        proposal.targetEntityIds[index],
        index,
      ]
    );
  }
}

async function insertExecution(
  client: Pick<PoolClient, 'query'>,
  execution: ActionExecution
): Promise<void> {
  await client.query(
    `INSERT INTO action_executions
      (id, account_id, proposal_id, intent, execution_mode,
       authorized_by, authorized_by_role, automation_policy_id,
       automation_policy_version, downstream_analysis_run_ids,
       downstream_warnings, executed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
    [
      execution.id,
      execution.accountId,
      execution.proposalId,
      execution.intent,
      execution.executionMode ?? null,
      execution.authorizedBy ?? null,
      execution.authorizedByRole ?? null,
      execution.automationPolicyId ?? null,
      execution.automationPolicyVersion ?? null,
      json(execution.downstreamAnalysisRunIds || []),
      json(execution.downstreamWarnings || []),
      new Date(execution.executedAt),
    ]
  );

  for (let index = 0; index < execution.claimIds.length; index += 1) {
    await client.query(
      `INSERT INTO action_execution_claims
        (account_id, execution_id, claim_id, position)
       VALUES ($1,$2,$3,$4)`,
      [
        execution.accountId,
        execution.id,
        execution.claimIds[index],
        index,
      ]
    );
  }

  for (let index = 0; index < execution.eventIds.length; index += 1) {
    await client.query(
      `INSERT INTO action_execution_events
        (account_id, execution_id, event_id, position)
       VALUES ($1,$2,$3,$4)`,
      [
        execution.accountId,
        execution.id,
        execution.eventIds[index],
        index,
      ]
    );
  }
}

async function insertAudit(
  client: Pick<PoolClient, 'query'>,
  entry: ActionAuditEntry
): Promise<void> {
  await client.query(
    `INSERT INTO action_audit_entries
      (id, account_id, proposal_id, action, occurred_at, detail,
       execution_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO NOTHING`,
    [
      entry.id,
      entry.accountId,
      entry.proposalId,
      entry.action,
      new Date(entry.timestamp),
      entry.detail,
      entry.executionId ?? null,
    ]
  );
}

async function loadProposal(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  proposalId: string,
  lock = false
): Promise<ActionProposal | null> {
  const result = await client.query(
    `SELECT *
     FROM action_proposals
     WHERE account_id = $1 AND id = $2` +
      (lock ? ' FOR UPDATE' : ''),
    [accountId, proposalId]
  );
  if (!result.rowCount) return null;
  return proposalFromRow(
    result.rows[0],
    await proposalTargets(client, accountId, proposalId)
  );
}

async function currentEffectiveState(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  entityId: string,
  predicate: string
): Promise<
  | { status: 'MISSING' }
  | { status: 'CONFLICT' }
  | {
      status: 'RESOLVED';
      claim: KnowledgeClaim;
      value: KnowledgeClaimValue;
    }
> {
  const result = await client.query(
    `SELECT *
     FROM knowledge_claims
     WHERE account_id = $1
       AND subject_entity_id = $2
       AND predicate = $3
       AND is_current = true
     ORDER BY authority_rank DESC, observed_at DESC, created_at DESC, id ASC
     FOR UPDATE`,
    [accountId, entityId, predicate.trim().toUpperCase()]
  );

  if (!result.rowCount) return { status: 'MISSING' };
  const claims = result.rows.map(claimFromRow);
  const highestRank = claims[0].authority.rank;
  const highest = claims.filter(
    (claim) => claim.authority.rank === highestRank
  );
  const values = new Map<string, KnowledgeClaim[]>();
  for (const claim of highest) {
    const key = JSON.stringify(claim.value);
    const group = values.get(key) || [];
    group.push(claim);
    values.set(key, group);
  }
  if (values.size !== 1) return { status: 'CONFLICT' };

  const equivalent = Array.from(values.values())[0];
  const claim = [...equivalent].sort(
    (left, right) =>
      right.observedAt - left.observedAt ||
      right.createdAt - left.createdAt
  )[0];

  return {
    status: 'RESOLVED',
    claim,
    value: claim.value,
  };
}

async function lockStateKey(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  entityId: string,
  predicate: string
): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [
      'knowledge-ai:state:' +
        accountId +
        ':' +
        entityId +
        ':' +
        predicate.trim().toUpperCase(),
    ]
  );
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class PostgresActionTransactionError extends Error {
  public readonly code:
    | 'ACTION_PROPOSAL_NOT_FOUND'
    | 'ACTION_NOT_CONFIRMABLE'
    | 'ACTION_STALE';
  public readonly statusCode: number;

  constructor(
    code:
      | 'ACTION_PROPOSAL_NOT_FOUND'
      | 'ACTION_NOT_CONFIRMABLE'
      | 'ACTION_STALE',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'PostgresActionTransactionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class PostgresCompanyKnowledgeRepository
  implements CompanyKnowledgeRepository
{
  async getEntity(
    accountId: string,
    entityId: string
  ): Promise<CompanyEntity | null> {
    const result = await postgresPool().query(
      `SELECT * FROM company_entities
       WHERE account_id = $1 AND id = $2`,
      [accountId, entityId]
    );
    return result.rowCount
      ? entityFromRow(result.rows[0])
      : null;
  }

  async listEntities(params: {
    accountId: string;
    type?: CompanyEntity['type'];
    limit?: number;
  }): Promise<CompanyEntity[]> {
    const limit = Math.max(1, Math.min(params.limit || 200, 1000));
    const result = await postgresPool().query(
      `SELECT * FROM company_entities
       WHERE account_id = $1
         AND ($2::text IS NULL OR type = $2)
       ORDER BY last_observed_at DESC, id ASC
       LIMIT $3`,
      [params.accountId, params.type ?? null, limit]
    );
    return result.rows.map(entityFromRow);
  }

  async saveEntity(entity: CompanyEntity): Promise<void> {
    await insertEntity(postgresPool(), entity);
  }

  async getRelationship(
    accountId: string,
    relationshipId: string
  ): Promise<CompanyRelationship | null> {
    const result = await postgresPool().query(
      `SELECT * FROM company_relationships
       WHERE account_id = $1 AND id = $2`,
      [accountId, relationshipId]
    );
    return result.rowCount
      ? relationshipFromRow(result.rows[0])
      : null;
  }

  async saveRelationship(
    relationship: CompanyRelationship
  ): Promise<void> {
    await insertRelationship(postgresPool(), relationship);
  }

  async listRelationships(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    limit?: number;
  }): Promise<CompanyRelationship[]> {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    const result = await postgresPool().query(
      `SELECT *
       FROM company_relationships
       WHERE account_id = $1
         AND (
           $2::text IS NULL OR
           subject_entity_id = $2 OR
           object_entity_id = $2
         )
         AND ($3::text IS NULL OR predicate = $3)
       ORDER BY last_observed_at DESC, id ASC
       LIMIT $4`,
      [
        params.accountId,
        params.entityId ?? null,
        params.predicate?.trim().toUpperCase() ?? null,
        limit,
      ]
    );
    return result.rows.map(relationshipFromRow);
  }

  async getClaim(
    accountId: string,
    claimId: string
  ): Promise<KnowledgeClaim | null> {
    const result = await postgresPool().query(
      `SELECT * FROM knowledge_claims
       WHERE account_id = $1 AND id = $2`,
      [accountId, claimId]
    );
    return result.rowCount
      ? claimFromRow(result.rows[0])
      : null;
  }

  async listClaims(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    currentOnly?: boolean;
    limit?: number;
  }): Promise<KnowledgeClaim[]> {
    const limit = Math.max(1, Math.min(params.limit || 200, 1000));
    const result = await postgresPool().query(
      `SELECT * FROM knowledge_claims
       WHERE account_id = $1
         AND ($2::text IS NULL OR subject_entity_id = $2)
         AND ($3::text IS NULL OR predicate = $3)
         AND ($4::boolean = false OR is_current = true)
       ORDER BY observed_at DESC, created_at DESC, id ASC
       LIMIT $5`,
      [
        params.accountId,
        params.entityId ?? null,
        params.predicate?.trim().toUpperCase() ?? null,
        params.currentOnly !== false,
        limit,
      ]
    );
    return result.rows.map(claimFromRow);
  }

  async saveClaim(claim: KnowledgeClaim): Promise<void> {
    await insertClaim(postgresPool(), claim);
  }

  async saveClaimWithSupersession(params: {
    claim: KnowledgeClaim;
    closeClaimId?: string;
    closeValidTo?: number;
  }): Promise<void> {
    await withTransaction(async (client) => {
      if (params.closeClaimId) {
        const closed = await client.query(
          `UPDATE knowledge_claims
           SET is_current = false,
               valid_to = $3
           WHERE account_id = $1
             AND id = $2
             AND is_current = true`,
          [
            params.claim.accountId,
            params.closeClaimId,
            new Date(
              params.closeValidTo ??
                params.claim.observedAt
            ),
          ]
        );
        if (!closed.rowCount) {
          const existing = await client.query(
            `SELECT is_current
             FROM knowledge_claims
             WHERE account_id = $1 AND id = $2`,
            [
              params.claim.accountId,
              params.closeClaimId,
            ]
          );
          if (
            !existing.rowCount ||
            existing.rows[0].is_current !== false
          ) {
            throw new Error(
              'Knowledge claim supersession target is no longer available.'
            );
          }
        }
      }

      await insertClaim(client, params.claim);
    });
  }

  async closeClaim(params: {
    accountId: string;
    claimId: string;
    validTo: number;
  }): Promise<void> {
    const result = await postgresPool().query(
      `UPDATE knowledge_claims
       SET is_current = false, valid_to = $3
       WHERE account_id = $1 AND id = $2`,
      [
        params.accountId,
        params.claimId,
        new Date(params.validTo),
      ]
    );
    if (!result.rowCount) {
      throw new Error(
        'Knowledge claim not found in the current account scope.'
      );
    }
  }

  async getEvent(
    accountId: string,
    eventId: string
  ): Promise<BusinessEvent | null> {
    const result = await postgresPool().query(
      `SELECT * FROM business_events
       WHERE account_id = $1 AND id = $2`,
      [accountId, eventId]
    );
    return result.rowCount
      ? eventFromRow(postgresPool(), result.rows[0])
      : null;
  }

  async listEvents(params: {
    accountId: string;
    entityId?: string;
    type?: string;
    since?: number;
    limit?: number;
  }): Promise<BusinessEvent[]> {
    const limit = Math.max(1, Math.min(params.limit || 200, 1000));
    const result = await postgresPool().query(
      `SELECT DISTINCT event.*
       FROM business_events event
       LEFT JOIN business_event_subjects subject
         ON subject.account_id = event.account_id
        AND subject.event_id = event.id
       WHERE event.account_id = $1
         AND ($2::text IS NULL OR subject.entity_id = $2)
         AND ($3::text IS NULL OR event.type = $3)
         AND (
           $4::timestamptz IS NULL OR
           GREATEST(
             COALESCE(event.occurred_at, event.recorded_at),
             event.recorded_at
           ) >= $4
         )
       ORDER BY event.recorded_at DESC, event.id ASC
       LIMIT $5`,
      [
        params.accountId,
        params.entityId ?? null,
        params.type?.trim().toUpperCase() ?? null,
        params.since === undefined
          ? null
          : new Date(params.since),
        limit,
      ]
    );

    return Promise.all(
      result.rows.map((row) =>
        eventFromRow(postgresPool(), row)
      )
    );
  }

  async saveEvent(event: BusinessEvent): Promise<void> {
    await insertEvent(postgresPool(), event);
  }

  async getProjectionRun(
    accountId: string,
    runId: string
  ): Promise<KnowledgeProjectionRun | null> {
    const result = await postgresPool().query(
      `SELECT * FROM knowledge_projection_runs
       WHERE account_id = $1 AND id = $2`,
      [accountId, runId]
    );
    return result.rowCount
      ? projectionRunFromRow(result.rows[0])
      : null;
  }

  async saveProjectionRun(
    run: KnowledgeProjectionRun
  ): Promise<void> {
    await insertProjectionRun(postgresPool(), run);
  }

  async listProjectionRuns(params: {
    accountId: string;
    sourceType?: KnowledgeProjectionRun['sourceType'];
    sourceId?: string;
    limit?: number;
  }): Promise<KnowledgeProjectionRun[]> {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    const result = await postgresPool().query(
      `SELECT *
       FROM knowledge_projection_runs
       WHERE account_id = $1
         AND ($2::text IS NULL OR source_type = $2)
         AND ($3::text IS NULL OR source_id = $3)
       ORDER BY started_at DESC, id ASC
       LIMIT $4`,
      [
        params.accountId,
        params.sourceType ?? null,
        params.sourceId ?? null,
        limit,
      ]
    );
    return result.rows.map(projectionRunFromRow);
  }

  async snapshotCounts(accountId: string): Promise<{
    entities: number;
    relationships: number;
    currentClaims: number;
    events: number;
  }> {
    const result = await postgresPool().query(
      `SELECT
         (SELECT count(*)::int FROM company_entities WHERE account_id = $1) AS entities,
         (SELECT count(*)::int FROM company_relationships WHERE account_id = $1) AS relationships,
         (SELECT count(*)::int FROM knowledge_claims WHERE account_id = $1 AND is_current = true) AS current_claims,
         (SELECT count(*)::int FROM business_events WHERE account_id = $1) AS events`,
      [accountId]
    );
    return {
      entities: Number(result.rows[0]?.entities || 0),
      relationships: Number(result.rows[0]?.relationships || 0),
      currentClaims: Number(result.rows[0]?.current_claims || 0),
      events: Number(result.rows[0]?.events || 0),
    };
  }
}

export class PostgresActionRepository
  implements ActionRepository
{
  async getProposal(
    accountId: string,
    proposalId: string
  ): Promise<ActionProposal | null> {
    return loadProposal(
      postgresPool(),
      accountId,
      proposalId
    );
  }

  async saveProposal(proposal: ActionProposal): Promise<void> {
    await insertProposal(postgresPool(), proposal);
  }

  async createProposalWithAudit(
    proposal: ActionProposal,
    auditEntry: ActionAuditEntry
  ): Promise<void> {
    await withTransaction(async (client) => {
      await insertProposal(client, proposal);
      await insertAudit(client, auditEntry);
    });
  }

  async listProposals(params: {
    accountId: string;
    status?: ActionProposalStatus;
    limit?: number;
  }): Promise<ActionProposal[]> {
    const limit = Math.max(1, Math.min(params.limit || 100, 500));
    const result = await postgresPool().query(
      `SELECT *
       FROM action_proposals
       WHERE account_id = $1
         AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC, id ASC
       LIMIT $3`,
      [params.accountId, params.status ?? null, limit]
    );

    return Promise.all(
      result.rows.map(async (row) =>
        proposalFromRow(
          row,
          await proposalTargets(
            postgresPool(),
            params.accountId,
            row.id
          )
        )
      )
    );
  }

  async transitionProposalWithAudit(params: {
    accountId: string;
    proposalId: string;
    status: ActionProposalStatus;
    timestamp: number;
    detail: string;
    auditEntryId: string;
    executionId?: string;
    failureReason?: string;
  }): Promise<ActionProposal> {
    return withTransaction(async (client) => {
      const timestampColumn =
        params.status === 'CONFIRMED'
          ? 'confirmed_at'
          : params.status === 'CANCELLED'
            ? 'cancelled_at'
            : params.status === 'STALE'
              ? 'stale_at'
              : params.status === 'FAILED'
                ? 'failed_at'
                : null;

      const result = await client.query(
        `UPDATE action_proposals
         SET status = $3,
             updated_at = $4,
             execution_id = COALESCE($5, execution_id),
             failure_reason = COALESCE($6, failure_reason),
             confirmed_at = CASE WHEN $7 = 'confirmed_at' THEN $4 ELSE confirmed_at END,
             cancelled_at = CASE WHEN $7 = 'cancelled_at' THEN $4 ELSE cancelled_at END,
             stale_at = CASE WHEN $7 = 'stale_at' THEN $4 ELSE stale_at END,
             failed_at = CASE WHEN $7 = 'failed_at' THEN $4 ELSE failed_at END
         WHERE account_id = $1 AND id = $2
         RETURNING *`,
        [
          params.accountId,
          params.proposalId,
          params.status,
          new Date(params.timestamp),
          params.executionId ?? null,
          params.failureReason ?? null,
          timestampColumn,
        ]
      );
      if (!result.rowCount) {
        throw new Error(
          'Action proposal not found in the current account scope.'
        );
      }

      const audit: ActionAuditEntry = {
        id: params.auditEntryId,
        accountId: params.accountId,
        proposalId: params.proposalId,
        action: params.status,
        timestamp: params.timestamp,
        detail: params.detail,
        executionId: params.executionId,
      };
      await insertAudit(client, audit);

      return proposalFromRow(
        result.rows[0],
        await proposalTargets(
          client,
          params.accountId,
          params.proposalId
        )
      );
    });
  }

  async transitionProposal(params: {
    accountId: string;
    proposalId: string;
    status: ActionProposalStatus;
    timestamp: number;
    executionId?: string;
    failureReason?: string;
  }): Promise<ActionProposal> {
    const timestampColumn =
      params.status === 'CONFIRMED'
        ? 'confirmed_at'
        : params.status === 'CANCELLED'
          ? 'cancelled_at'
          : params.status === 'STALE'
            ? 'stale_at'
            : params.status === 'FAILED'
              ? 'failed_at'
              : null;

    const result = await postgresPool().query(
      `UPDATE action_proposals
       SET status = $3,
           updated_at = $4,
           execution_id = COALESCE($5, execution_id),
           failure_reason = COALESCE($6, failure_reason),
           confirmed_at = CASE WHEN $7 = 'confirmed_at' THEN $4 ELSE confirmed_at END,
           cancelled_at = CASE WHEN $7 = 'cancelled_at' THEN $4 ELSE cancelled_at END,
           stale_at = CASE WHEN $7 = 'stale_at' THEN $4 ELSE stale_at END,
           failed_at = CASE WHEN $7 = 'failed_at' THEN $4 ELSE failed_at END
       WHERE account_id = $1 AND id = $2
       RETURNING *`,
      [
        params.accountId,
        params.proposalId,
        params.status,
        new Date(params.timestamp),
        params.executionId ?? null,
        params.failureReason ?? null,
        timestampColumn,
      ]
    );
    if (!result.rowCount) {
      throw new Error(
        'Action proposal not found in the current account scope.'
      );
    }
    return proposalFromRow(
      result.rows[0],
      await proposalTargets(
        postgresPool(),
        params.accountId,
        params.proposalId
      )
    );
  }

  async getExecutionByProposal(
    accountId: string,
    proposalId: string
  ): Promise<ActionExecution | null> {
    const result = await postgresPool().query(
      `SELECT * FROM action_executions
       WHERE account_id = $1 AND proposal_id = $2`,
      [accountId, proposalId]
    );
    return result.rowCount
      ? executionFromRow(postgresPool(), result.rows[0])
      : null;
  }

  async saveExecution(
    execution: ActionExecution
  ): Promise<void> {
    await withTransaction(async (client) => {
      await insertExecution(client, execution);
    });
  }

  async updateExecutionAnalysis(params: {
    accountId: string;
    executionId: string;
    downstreamAnalysisRunIds: string[];
    downstreamWarnings: string[];
  }): Promise<ActionExecution> {
    const result = await postgresPool().query(
      `UPDATE action_executions
       SET downstream_analysis_run_ids = $3::jsonb,
           downstream_warnings = $4::jsonb
       WHERE account_id = $1 AND id = $2
       RETURNING *`,
      [
        params.accountId,
        params.executionId,
        json(params.downstreamAnalysisRunIds),
        json(params.downstreamWarnings),
      ]
    );
    if (!result.rowCount) {
      throw new Error(
        'Action execution not found in the current account scope.'
      );
    }
    return executionFromRow(
      postgresPool(),
      result.rows[0]
    );
  }

  async saveAudit(entry: ActionAuditEntry): Promise<void> {
    await insertAudit(postgresPool(), entry);
  }

  async listAudit(params: {
    accountId: string;
    proposalId?: string;
    limit?: number;
  }): Promise<ActionAuditEntry[]> {
    const limit = Math.max(1, Math.min(params.limit || 200, 1000));
    const result = await postgresPool().query(
      `SELECT * FROM action_audit_entries
       WHERE account_id = $1
         AND ($2::text IS NULL OR proposal_id = $2)
       ORDER BY occurred_at DESC, id ASC
       LIMIT $3`,
      [params.accountId, params.proposalId ?? null, limit]
    );
    return result.rows.map(auditFromRow);
  }
}

export class PostgresConfirmedActionTransactionRepository
  implements ConfirmedActionTransactionRepository
{
  async commitConfirmedAction(
    input: ConfirmedActionTransactionInput
  ): Promise<ConfirmedActionTransactionResult> {
    return withTransaction(async (client) => {
      const proposal = await loadProposal(
        client,
        input.accountId,
        input.proposalId,
        true
      );
      if (!proposal) {
        throw new PostgresActionTransactionError(
          'ACTION_PROPOSAL_NOT_FOUND',
          404,
          'Action proposal not found in the current account scope.'
        );
      }

      const existingExecutionResult = await client.query(
        `SELECT * FROM action_executions
         WHERE account_id = $1 AND proposal_id = $2
         FOR UPDATE`,
        [input.accountId, input.proposalId]
      );
      if (existingExecutionResult.rowCount) {
        const execution = await executionFromRow(
          client,
          existingExecutionResult.rows[0]
        );
        const eventResult = await client.query(
          `SELECT event.*
           FROM business_events event
           JOIN action_execution_events link
             ON link.account_id = event.account_id
            AND link.event_id = event.id
           WHERE link.account_id = $1
             AND link.execution_id = $2
           ORDER BY link.position ASC
           LIMIT 1`,
          [input.accountId, execution.id]
        );
        const auditResult = await client.query(
          `SELECT * FROM action_audit_entries
           WHERE account_id = $1
             AND proposal_id = $2
             AND execution_id = $3
             AND action = 'CONFIRMED'
           ORDER BY occurred_at DESC
           LIMIT 1`,
          [input.accountId, input.proposalId, execution.id]
        );
        const claims = await Promise.all(
          execution.claimIds.map(async (claimId) => {
            const result = await client.query(
              `SELECT * FROM knowledge_claims
               WHERE account_id = $1 AND id = $2`,
              [input.accountId, claimId]
            );
            if (!result.rowCount) {
              throw new Error(
                'Existing execution references missing knowledge claim.'
              );
            }
            return claimFromRow(result.rows[0]);
          })
        );
        if (!eventResult.rowCount || !auditResult.rowCount) {
          throw new Error(
            'Existing confirmed execution is missing relational event/audit links.'
          );
        }

        return {
          proposal,
          execution,
          claims,
          event: await eventFromRow(
            client,
            eventResult.rows[0]
          ),
          auditEntry: auditFromRow(auditResult.rows[0]),
          idempotentReplay: true,
        };
      }

      if (proposal.status !== input.expectedProposalStatus) {
        throw new PostgresActionTransactionError(
          'ACTION_NOT_CONFIRMABLE',
          409,
          'Action proposal is ' +
            proposal.status +
            ' and cannot be confirmed.'
        );
      }

      const lockKeys = new Set<string>();
      for (const precondition of proposal.preconditions) {
        lockKeys.add(
          precondition.entityId +
            ':' +
            precondition.predicate.trim().toUpperCase()
        );
      }
      for (const mutation of proposal.mutations) {
        lockKeys.add(
          mutation.entityId +
            ':' +
            mutation.predicate.trim().toUpperCase()
        );
      }

      for (const key of [...lockKeys].sort()) {
        const separator = key.indexOf(':');
        await lockStateKey(
          client,
          input.accountId,
          key.slice(0, separator),
          key.slice(separator + 1)
        );
      }

      for (const precondition of proposal.preconditions) {
        const current = await currentEffectiveState(
          client,
          input.accountId,
          precondition.entityId,
          precondition.predicate
        );

        const same =
          precondition.effectiveClaimId === undefined
            ? current.status === 'MISSING' &&
              precondition.effectiveValue === null
            : current.status === 'RESOLVED' &&
              current.claim.id ===
                precondition.effectiveClaimId &&
              equalValue(
                current.value,
                precondition.effectiveValue
              );

        if (!same) {
          throw new PostgresActionTransactionError(
            'ACTION_STALE',
            409,
            'Effective company state changed after this proposal was created.'
          );
        }
      }

      for (const closing of input.claimsToClose) {
        const result = await client.query(
          `UPDATE knowledge_claims
           SET is_current = false, valid_to = $3
           WHERE account_id = $1
             AND id = $2
             AND is_current = true`,
          [
            input.accountId,
            closing.claimId,
            new Date(closing.validTo),
          ]
        );
        if (!result.rowCount) {
          throw new PostgresActionTransactionError(
            'ACTION_STALE',
            409,
            'A claim expected to be superseded is no longer current.'
          );
        }
      }

      for (const claim of input.claimsToInsert) {
        if (claim.accountId !== input.accountId) {
          throw new Error(
            'Confirmed action cannot insert a foreign-account claim.'
          );
        }
        await insertClaim(client, claim);
      }

      if (input.eventToInsert.accountId !== input.accountId) {
        throw new Error(
          'Confirmed action cannot insert a foreign-account event.'
        );
      }
      await insertEvent(client, input.eventToInsert);

      if (
        input.execution.accountId !== input.accountId ||
        input.execution.proposalId !== input.proposalId
      ) {
        throw new Error(
          'Confirmed action execution identity does not match the transaction.'
        );
      }
      await insertExecution(client, input.execution);

      const updated = await client.query(
        `UPDATE action_proposals
         SET status = 'CONFIRMED',
             updated_at = $3,
             confirmed_at = $3,
             execution_id = $4
         WHERE account_id = $1
           AND id = $2
           AND status = 'PROPOSED'
         RETURNING *`,
        [
          input.accountId,
          input.proposalId,
          new Date(input.confirmedAt),
          input.execution.id,
        ]
      );
      if (!updated.rowCount) {
        throw new PostgresActionTransactionError(
          'ACTION_NOT_CONFIRMABLE',
          409,
          'Proposal state changed before confirmation could commit.'
        );
      }

      if (
        input.auditEntry.accountId !== input.accountId ||
        input.auditEntry.proposalId !== input.proposalId ||
        input.auditEntry.executionId !== input.execution.id ||
        input.auditEntry.action !== 'CONFIRMED'
      ) {
        throw new Error(
          'Confirmed action audit identity does not match the transaction.'
        );
      }
      await insertAudit(client, input.auditEntry);

      return {
        proposal: proposalFromRow(
          updated.rows[0],
          proposal.targetEntityIds
        ),
        execution: input.execution,
        claims: input.claimsToInsert,
        event: input.eventToInsert,
        auditEntry: input.auditEntry,
        idempotentReplay: false,
      };
    });
  }
}

export const postgresCompanyKnowledgeRepository =
  new PostgresCompanyKnowledgeRepository();
export const postgresActionRepository =
  new PostgresActionRepository();
export const postgresConfirmedActionTransactionRepository =
  new PostgresConfirmedActionTransactionRepository();
