import type { PoolClient } from 'pg';
import { postgresPool, withTransaction } from './postgres.js';
import type {
  WatchAlert,
  WatchDraft,
  WatchEvaluation,
  WatchJob,
  WatchRule,
} from '../watch/types.js';
import type {
  ExternalImportState,
  IntegrationConnection,
  SyncRun,
} from '../integrations/types.js';
import type {
  IntegrationCheckpointCommitInput,
  IntegrationCheckpointRepository,
  IntegrationRepository,
  WatchJobEvaluationCommitInput,
  WatchJobEvaluationCommitResult,
  WatchJobTerminalFailureCommitInput,
  WatchJobTerminalFailureCommitResult,
  WatchRepository,
} from './a4Types.js';

function epoch(value: Date | string | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
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

export class PostgresWatchTransactionError
  extends Error
{
  constructor(
    public readonly code:
      | 'WATCH_JOB_NOT_FOUND'
      | 'WATCH_JOB_NOT_CLAIMED'
      | 'WATCH_JOB_RULE_STALE'
      | 'WATCH_JOB_RULE_STATE_CHANGED'
      | 'WATCH_JOB_EVALUATION_INVALID',
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name =
      'PostgresWatchTransactionError';
  }
}

function watchRuleFromRow(row: any): WatchRule {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    origin: row.origin,
    version: row.version,
    condition: row.condition,
    evaluationMode: row.evaluation_mode,
    intervalMinutes: row.interval_minutes ?? undefined,
    currentState: row.current_state,
    lastEvaluationAt: epoch(row.last_evaluation_at) ?? undefined,
    lastTriggeredAt: epoch(row.last_triggered_at) ?? undefined,
    nextEvaluationAt: epoch(row.next_evaluation_at) ?? undefined,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function watchDraftFromRow(row: any): WatchDraft {
  return {
    id: row.id,
    accountId: row.account_id,
    instruction: row.instruction,
    status: row.status,
    parserSource: row.parser_source,
    proposedName: row.proposed_name,
    parsedRequest: row.parsed_request ?? undefined,
    condition: row.condition ?? undefined,
    candidates: row.candidates ?? undefined,
    needsInputReason: row.needs_input_reason ?? undefined,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
    expiresAt: epoch(row.expires_at)!,
    savedRuleId: row.saved_rule_id ?? undefined,
  };
}

function watchEvaluationFromRow(row: any): WatchEvaluation {
  return {
    id: row.id,
    accountId: row.account_id,
    jobId: row.job_id ?? undefined,
    watchRuleId: row.watch_rule_id,
    ruleVersion: row.rule_version,
    status: row.status,
    conditionMatched:
      row.condition_matched === null ? undefined : row.condition_matched,
    observedValue:
      row.observed_value === null ? undefined : Number(row.observed_value),
    comparisonOperator: row.comparison_operator,
    threshold: Number(row.threshold),
    previousConditionState: row.previous_condition_state,
    nextConditionState: row.next_condition_state,
    evidence: row.evidence ?? undefined,
    evaluatedAt: epoch(row.evaluated_at)!,
    error: row.error ?? undefined,
  };
}

function watchAlertFromRow(row: any): WatchAlert {
  return {
    id: row.id,
    episodeKey: row.episode_key,
    accountId: row.account_id,
    watchRuleId: row.watch_rule_id,
    ruleVersion: row.rule_version,
    status: row.status,
    title: row.title,
    summary: row.summary,
    firstTriggeredAt: epoch(row.first_triggered_at)!,
    lastTriggeredAt: epoch(row.last_triggered_at)!,
    occurrenceCount: row.occurrence_count,
    evaluationIds: row.evaluation_ids || [],
    lastEvaluationId: row.last_evaluation_id,
    evidence: row.evidence,
    acknowledgedAt: epoch(row.acknowledged_at) ?? undefined,
    resolvedAt: epoch(row.resolved_at) ?? undefined,
    resolutionReason: row.resolution_reason ?? undefined,
    snoozedUntil: epoch(row.snoozed_until) ?? undefined,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function watchJobFromRow(row: any): WatchJob {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    accountId: row.account_id,
    watchRuleId: row.watch_rule_id,
    ruleVersion: row.rule_version,
    scheduledFor: epoch(row.scheduled_for)!,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: epoch(row.next_attempt_at)!,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
    startedAt: epoch(row.started_at) ?? undefined,
    completedAt: epoch(row.completed_at) ?? undefined,
    evaluationId: row.evaluation_id ?? undefined,
    lastError: row.last_error ?? undefined,
    skipReason: row.skip_reason ?? undefined,
  };
}

function integrationConnectionFromRow(row: any): IntegrationConnection {
  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    capabilities: row.capabilities,
    settings: row.settings || {},
    credentialRef: row.credential_ref ?? undefined,
    cursor: row.cursor ?? undefined,
    attentionReason: row.attention_reason ?? undefined,
    lastFailureCategory: row.last_failure_category ?? undefined,
    consecutiveFailureCount:
      row.consecutive_failure_count ?? undefined,
    nextRetryAt: epoch(row.next_retry_at) ?? undefined,
    syncLeaseId: row.sync_lease_id ?? undefined,
    syncLeaseExpiresAt: epoch(row.sync_lease_expires_at) ?? undefined,
    lastSyncAt: epoch(row.last_sync_at) ?? undefined,
    lastSuccessfulSyncAt:
      epoch(row.last_successful_sync_at) ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function syncRunFromRow(row: any): SyncRun {
  return {
    id: row.id,
    accountId: row.account_id,
    connectionId: row.connection_id,
    provider: row.provider,
    status: row.status,
    cursorBefore: row.cursor_before ?? undefined,
    cursorAfter: row.cursor_after ?? undefined,
    startedAt: epoch(row.started_at)!,
    completedAt: epoch(row.completed_at) ?? undefined,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryable:
      row.retryable === null ? undefined : row.retryable,
    failureCategory: row.failure_category ?? undefined,
    nextRetryAt: epoch(row.next_retry_at) ?? undefined,
    processedCount: row.processed_count,
    importedCount: row.imported_count,
    skippedCount: row.skipped_count,
    tombstoneCount: row.tombstone_count,
    failedCount: row.failed_count,
    recordResults: row.record_results || [],
    error: row.error ?? undefined,
  };
}

function externalImportFromRow(row: any): ExternalImportState {
  return {
    id: row.id,
    status: row.status,
    accountId: row.account_id,
    connectionId: row.connection_id,
    provider: row.provider,
    externalId: row.external_id,
    externalVersion: row.external_version,
    externalName: row.external_name,
    resourceKind: row.resource_kind,
    internalKind: row.internal_kind,
    internalId: row.internal_id ?? undefined,
    internalVersionId: row.internal_version_id ?? undefined,
    sourceVersionId:
      row.source_version_id ?? undefined,
    knowledgeProjectionRunId:
      row.knowledge_projection_run_id ?? undefined,
    lastError: row.last_error ?? undefined,
    importedAt: epoch(row.imported_at)!,
    updatedAt: epoch(row.updated_at)!,
    provenance: row.provenance,
  };
}

async function assertOwnedUpsert(
  result: { rowCount: number | null },
  label: string
): Promise<void> {
  if (!result.rowCount) {
    throw new Error(
      label +
        ' could not be saved because the primary ID belongs to a different account.'
    );
  }
}

async function saveRuleWith(
  client: Pick<PoolClient, 'query'>,
  rule: WatchRule
): Promise<void> {
  const result = await client.query(
    `INSERT INTO watch_rules
      (id, account_id, name, description, status, origin, version,
       condition, evaluation_mode, interval_minutes, current_state,
       last_evaluation_at, last_triggered_at, next_evaluation_at,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       status = EXCLUDED.status,
       origin = EXCLUDED.origin,
       version = EXCLUDED.version,
       condition = EXCLUDED.condition,
       evaluation_mode = EXCLUDED.evaluation_mode,
       interval_minutes = EXCLUDED.interval_minutes,
       current_state = EXCLUDED.current_state,
       last_evaluation_at = EXCLUDED.last_evaluation_at,
       last_triggered_at = EXCLUDED.last_triggered_at,
       next_evaluation_at = EXCLUDED.next_evaluation_at,
       updated_at = EXCLUDED.updated_at
     WHERE watch_rules.account_id = EXCLUDED.account_id
     RETURNING id`,
    [
      rule.id,
      rule.accountId,
      rule.name,
      rule.description ?? null,
      rule.status,
      rule.origin,
      rule.version,
      json(rule.condition),
      rule.evaluationMode,
      rule.intervalMinutes ?? null,
      rule.currentState,
      date(rule.lastEvaluationAt),
      date(rule.lastTriggeredAt),
      date(rule.nextEvaluationAt),
      new Date(rule.createdAt),
      new Date(rule.updatedAt),
    ]
  );
  await assertOwnedUpsert(result, 'WatchRule');
}

async function saveDraftWith(
  client: Pick<PoolClient, 'query'>,
  draft: WatchDraft
): Promise<void> {
  const result = await client.query(
    `INSERT INTO watch_drafts
      (id, account_id, instruction, status, parser_source, proposed_name,
       parsed_request, condition, candidates, needs_input_reason,
       created_at, updated_at, expires_at, saved_rule_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       instruction = EXCLUDED.instruction,
       status = EXCLUDED.status,
       parser_source = EXCLUDED.parser_source,
       proposed_name = EXCLUDED.proposed_name,
       parsed_request = EXCLUDED.parsed_request,
       condition = EXCLUDED.condition,
       candidates = EXCLUDED.candidates,
       needs_input_reason = EXCLUDED.needs_input_reason,
       updated_at = EXCLUDED.updated_at,
       expires_at = EXCLUDED.expires_at,
       saved_rule_id = EXCLUDED.saved_rule_id
     WHERE watch_drafts.account_id = EXCLUDED.account_id
     RETURNING id`,
    [
      draft.id,
      draft.accountId,
      draft.instruction,
      draft.status,
      draft.parserSource,
      draft.proposedName,
      draft.parsedRequest ? json(draft.parsedRequest) : null,
      draft.condition ? json(draft.condition) : null,
      draft.candidates ? json(draft.candidates) : null,
      draft.needsInputReason ?? null,
      new Date(draft.createdAt),
      new Date(draft.updatedAt),
      new Date(draft.expiresAt),
      draft.savedRuleId ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'WatchDraft');
}

async function saveEvaluationWith(
  client: Pick<PoolClient, 'query'>,
  evaluation: WatchEvaluation
): Promise<void> {
  const result = await client.query(
    `INSERT INTO watch_evaluations
      (id, account_id, job_id, watch_rule_id, rule_version, status,
       condition_matched, observed_value, comparison_operator, threshold,
       previous_condition_state, next_condition_state, evidence,
       evaluated_at, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       job_id = EXCLUDED.job_id,
       status = EXCLUDED.status,
       condition_matched = EXCLUDED.condition_matched,
       observed_value = EXCLUDED.observed_value,
       comparison_operator = EXCLUDED.comparison_operator,
       threshold = EXCLUDED.threshold,
       previous_condition_state = EXCLUDED.previous_condition_state,
       next_condition_state = EXCLUDED.next_condition_state,
       evidence = EXCLUDED.evidence,
       evaluated_at = EXCLUDED.evaluated_at,
       error = EXCLUDED.error
     WHERE watch_evaluations.account_id = EXCLUDED.account_id
       AND watch_evaluations.watch_rule_id = EXCLUDED.watch_rule_id
     RETURNING id`,
    [
      evaluation.id,
      evaluation.accountId,
      evaluation.jobId ?? null,
      evaluation.watchRuleId,
      evaluation.ruleVersion,
      evaluation.status,
      evaluation.conditionMatched ?? null,
      evaluation.observedValue ?? null,
      evaluation.comparisonOperator,
      evaluation.threshold,
      evaluation.previousConditionState,
      evaluation.nextConditionState,
      evaluation.evidence ? json(evaluation.evidence) : null,
      new Date(evaluation.evaluatedAt),
      evaluation.error ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'WatchEvaluation');
}

async function saveAlertWith(
  client: Pick<PoolClient, 'query'>,
  alert: WatchAlert
): Promise<void> {
  const result = await client.query(
    `INSERT INTO watch_alerts
      (id, episode_key, account_id, watch_rule_id, rule_version, status,
       title, summary, first_triggered_at, last_triggered_at,
       occurrence_count, evaluation_ids, last_evaluation_id, evidence,
       acknowledged_at, resolved_at, resolution_reason, snoozed_until,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,
             $15,$16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       last_triggered_at = EXCLUDED.last_triggered_at,
       occurrence_count = EXCLUDED.occurrence_count,
       evaluation_ids = EXCLUDED.evaluation_ids,
       last_evaluation_id = EXCLUDED.last_evaluation_id,
       evidence = EXCLUDED.evidence,
       acknowledged_at = EXCLUDED.acknowledged_at,
       resolved_at = EXCLUDED.resolved_at,
       resolution_reason = EXCLUDED.resolution_reason,
       snoozed_until = EXCLUDED.snoozed_until,
       updated_at = EXCLUDED.updated_at
     WHERE watch_alerts.account_id = EXCLUDED.account_id
       AND watch_alerts.watch_rule_id = EXCLUDED.watch_rule_id
     RETURNING id`,
    [
      alert.id,
      alert.episodeKey,
      alert.accountId,
      alert.watchRuleId,
      alert.ruleVersion,
      alert.status,
      alert.title,
      alert.summary,
      new Date(alert.firstTriggeredAt),
      new Date(alert.lastTriggeredAt),
      alert.occurrenceCount,
      json(alert.evaluationIds),
      alert.lastEvaluationId,
      json(alert.evidence),
      date(alert.acknowledgedAt),
      date(alert.resolvedAt),
      alert.resolutionReason ?? null,
      date(alert.snoozedUntil),
      new Date(alert.createdAt),
      new Date(alert.updatedAt),
    ]
  );
  await assertOwnedUpsert(result, 'WatchAlert');
}

async function saveJobWith(
  client: Pick<PoolClient, 'query'>,
  job: WatchJob
): Promise<void> {
  const result = await client.query(
    `INSERT INTO watch_jobs
      (id, fingerprint, account_id, watch_rule_id, rule_version,
       scheduled_for, status, attempt_count, max_attempts, next_attempt_at,
       created_at, updated_at, started_at, completed_at, evaluation_id,
       last_error, skip_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       attempt_count = EXCLUDED.attempt_count,
       max_attempts = EXCLUDED.max_attempts,
       next_attempt_at = EXCLUDED.next_attempt_at,
       updated_at = EXCLUDED.updated_at,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       evaluation_id = EXCLUDED.evaluation_id,
       last_error = EXCLUDED.last_error,
       skip_reason = EXCLUDED.skip_reason
     WHERE watch_jobs.account_id = EXCLUDED.account_id
       AND watch_jobs.fingerprint = EXCLUDED.fingerprint
     RETURNING id`,
    [
      job.id,
      job.fingerprint,
      job.accountId,
      job.watchRuleId,
      job.ruleVersion,
      new Date(job.scheduledFor),
      job.status,
      job.attemptCount,
      job.maxAttempts,
      new Date(job.nextAttemptAt),
      new Date(job.createdAt),
      new Date(job.updatedAt),
      date(job.startedAt),
      date(job.completedAt),
      job.evaluationId ?? null,
      job.lastError ?? null,
      job.skipReason ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'WatchJob');
}

async function saveConnectionWith(
  client: Pick<PoolClient, 'query'>,
  connection: IntegrationConnection
): Promise<void> {
  const result = await client.query(
    `INSERT INTO integration_connections
      (id, account_id, provider, display_name, status, capabilities,
       settings, credential_ref, cursor, attention_reason,
       last_failure_category, consecutive_failure_count, next_retry_at,
       sync_lease_id, sync_lease_expires_at, last_sync_at,
       last_successful_sync_at, last_error, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,
             $16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       status = EXCLUDED.status,
       capabilities = EXCLUDED.capabilities,
       settings = EXCLUDED.settings,
       credential_ref = EXCLUDED.credential_ref,
       cursor = EXCLUDED.cursor,
       attention_reason = EXCLUDED.attention_reason,
       last_failure_category = EXCLUDED.last_failure_category,
       consecutive_failure_count = EXCLUDED.consecutive_failure_count,
       next_retry_at = EXCLUDED.next_retry_at,
       sync_lease_id = EXCLUDED.sync_lease_id,
       sync_lease_expires_at = EXCLUDED.sync_lease_expires_at,
       last_sync_at = EXCLUDED.last_sync_at,
       last_successful_sync_at = EXCLUDED.last_successful_sync_at,
       last_error = EXCLUDED.last_error,
       updated_at = EXCLUDED.updated_at
     WHERE integration_connections.account_id = EXCLUDED.account_id
       AND integration_connections.provider = EXCLUDED.provider
     RETURNING id`,
    [
      connection.id,
      connection.accountId,
      connection.provider,
      connection.displayName,
      connection.status,
      json(connection.capabilities),
      json(connection.settings || {}),
      connection.credentialRef ?? null,
      connection.cursor ?? null,
      connection.attentionReason ?? null,
      connection.lastFailureCategory ?? null,
      connection.consecutiveFailureCount ?? null,
      date(connection.nextRetryAt),
      connection.syncLeaseId ?? null,
      date(connection.syncLeaseExpiresAt),
      date(connection.lastSyncAt),
      date(connection.lastSuccessfulSyncAt),
      connection.lastError ?? null,
      new Date(connection.createdAt),
      new Date(connection.updatedAt),
    ]
  );
  await assertOwnedUpsert(result, 'IntegrationConnection');
}

async function saveSyncRunWith(
  client: Pick<PoolClient, 'query'>,
  run: SyncRun
): Promise<void> {
  const result = await client.query(
    `INSERT INTO integration_sync_runs
      (id, account_id, connection_id, provider, status, cursor_before,
       cursor_after, started_at, completed_at, attempt_count, max_attempts,
       retryable, failure_category, next_retry_at, processed_count,
       imported_count, skipped_count, tombstone_count, failed_count,
       record_results, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20::jsonb,$21)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       cursor_before = EXCLUDED.cursor_before,
       cursor_after = EXCLUDED.cursor_after,
       completed_at = EXCLUDED.completed_at,
       attempt_count = EXCLUDED.attempt_count,
       max_attempts = EXCLUDED.max_attempts,
       retryable = EXCLUDED.retryable,
       failure_category = EXCLUDED.failure_category,
       next_retry_at = EXCLUDED.next_retry_at,
       processed_count = EXCLUDED.processed_count,
       imported_count = EXCLUDED.imported_count,
       skipped_count = EXCLUDED.skipped_count,
       tombstone_count = EXCLUDED.tombstone_count,
       failed_count = EXCLUDED.failed_count,
       record_results = EXCLUDED.record_results,
       error = EXCLUDED.error
     WHERE integration_sync_runs.account_id = EXCLUDED.account_id
       AND integration_sync_runs.connection_id = EXCLUDED.connection_id
     RETURNING id`,
    [
      run.id,
      run.accountId,
      run.connectionId,
      run.provider,
      run.status,
      run.cursorBefore ?? null,
      run.cursorAfter ?? null,
      new Date(run.startedAt),
      date(run.completedAt),
      run.attemptCount,
      run.maxAttempts,
      run.retryable ?? null,
      run.failureCategory ?? null,
      date(run.nextRetryAt),
      run.processedCount,
      run.importedCount,
      run.skippedCount,
      run.tombstoneCount,
      run.failedCount,
      json(run.recordResults || []),
      run.error ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'SyncRun');
}

async function saveImportWith(
  client: Pick<PoolClient, 'query'>,
  imported: ExternalImportState
): Promise<void> {
  const result = await client.query(
    `INSERT INTO integration_external_imports
      (id, status, account_id, connection_id, provider, external_id,
       external_version, external_name, resource_kind, internal_kind,
       internal_id, internal_version_id, source_version_id,
       knowledge_projection_run_id, last_error, imported_at,
       updated_at, provenance)
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18::jsonb
     )
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       external_name = EXCLUDED.external_name,
       internal_kind = EXCLUDED.internal_kind,
       internal_id = EXCLUDED.internal_id,
       internal_version_id = EXCLUDED.internal_version_id,
       source_version_id = EXCLUDED.source_version_id,
       knowledge_projection_run_id = EXCLUDED.knowledge_projection_run_id,
       last_error = EXCLUDED.last_error,
       updated_at = EXCLUDED.updated_at,
       provenance = EXCLUDED.provenance
     WHERE integration_external_imports.account_id = EXCLUDED.account_id
       AND integration_external_imports.connection_id = EXCLUDED.connection_id
       AND integration_external_imports.external_id = EXCLUDED.external_id
       AND integration_external_imports.external_version = EXCLUDED.external_version
     RETURNING id`,
    [
      imported.id,
      imported.status,
      imported.accountId,
      imported.connectionId,
      imported.provider,
      imported.externalId,
      imported.externalVersion,
      imported.externalName,
      imported.resourceKind,
      imported.internalKind,
      imported.internalId ?? null,
      imported.internalVersionId ?? null,
      imported.sourceVersionId ?? null,
      imported.knowledgeProjectionRunId ?? null,
      imported.lastError ?? null,
      new Date(imported.importedAt),
      new Date(imported.updatedAt),
      json(imported.provenance),
    ]
  );
  await assertOwnedUpsert(result, 'ExternalImportState');
}

export class PostgresWatchRepository implements WatchRepository {
  public async getRule(accountId: string, ruleId: string) {
    const result = await postgresPool().query(
      'SELECT * FROM watch_rules WHERE account_id = $1 AND id = $2',
      [accountId, ruleId]
    );
    return result.rowCount ? watchRuleFromRow(result.rows[0]) : null;
  }

  public async listRules(params: {
    accountId: string;
    status?: WatchRule['status'];
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    let where = 'account_id = $1';
    if (params.status) {
      values.push(params.status);
      where += ' AND status = $2';
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 500)));
    const result = await postgresPool().query(
      `SELECT * FROM watch_rules
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(watchRuleFromRow);
  }

  public async saveRule(rule: WatchRule) {
    await saveRuleWith(postgresPool(), rule);
  }

  public async getDraft(accountId: string, draftId: string) {
    const result = await postgresPool().query(
      'SELECT * FROM watch_drafts WHERE account_id = $1 AND id = $2',
      [accountId, draftId]
    );
    return result.rowCount ? watchDraftFromRow(result.rows[0]) : null;
  }

  public async listDrafts(params: {
    accountId: string;
    limit?: number;
  }) {
    const result = await postgresPool().query(
      `SELECT * FROM watch_drafts
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [
        params.accountId,
        Math.max(1, Math.min(params.limit || 100, 500)),
      ]
    );
    return result.rows.map(watchDraftFromRow);
  }

  public async saveDraft(draft: WatchDraft) {
    await saveDraftWith(postgresPool(), draft);
  }

  public async getEvaluation(accountId: string, evaluationId: string) {
    const result = await postgresPool().query(
      'SELECT * FROM watch_evaluations WHERE account_id = $1 AND id = $2',
      [accountId, evaluationId]
    );
    return result.rowCount ? watchEvaluationFromRow(result.rows[0]) : null;
  }

  public async saveEvaluation(evaluation: WatchEvaluation) {
    await saveEvaluationWith(postgresPool(), evaluation);
  }

  public async listEvaluations(params: {
    accountId: string;
    watchRuleId?: string;
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.watchRuleId) {
      values.push(params.watchRuleId);
      clauses.push('watch_rule_id = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM watch_evaluations
       WHERE ${clauses.join(' AND ')}
       ORDER BY evaluated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(watchEvaluationFromRow);
  }

  public async getAlert(accountId: string, alertId: string) {
    const result = await postgresPool().query(
      'SELECT * FROM watch_alerts WHERE account_id = $1 AND id = $2',
      [accountId, alertId]
    );
    return result.rowCount ? watchAlertFromRow(result.rows[0]) : null;
  }

  public async listAlerts(params: {
    accountId: string;
    watchRuleId?: string;
    status?: WatchAlert['status'];
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.watchRuleId) {
      values.push(params.watchRuleId);
      clauses.push('watch_rule_id = $' + values.length);
    }
    if (params.status) {
      values.push(params.status);
      clauses.push('status = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM watch_alerts
       WHERE ${clauses.join(' AND ')}
       ORDER BY last_triggered_at DESC, created_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(watchAlertFromRow);
  }

  public async getActiveAlertForRule(
    accountId: string,
    watchRuleId: string
  ) {
    const result = await postgresPool().query(
      `SELECT * FROM watch_alerts
       WHERE account_id = $1
         AND watch_rule_id = $2
         AND status <> 'RESOLVED'
       ORDER BY last_triggered_at DESC
       LIMIT 1`,
      [accountId, watchRuleId]
    );
    return result.rowCount
      ? watchAlertFromRow(result.rows[0])
      : null;
  }

  public async saveAlert(alert: WatchAlert) {
    await saveAlertWith(postgresPool(), alert);
  }

  public async getJob(accountId: string, jobId: string) {
    const result = await postgresPool().query(
      'SELECT * FROM watch_jobs WHERE account_id = $1 AND id = $2',
      [accountId, jobId]
    );
    return result.rowCount ? watchJobFromRow(result.rows[0]) : null;
  }

  public async listJobs(params: {
    accountId: string;
    watchRuleId?: string;
    status?: WatchJob['status'];
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.watchRuleId) {
      values.push(params.watchRuleId);
      clauses.push('watch_rule_id = $' + values.length);
    }
    if (params.status) {
      values.push(params.status);
      clauses.push('status = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM watch_jobs
       WHERE ${clauses.join(' AND ')}
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(watchJobFromRow);
  }

  public async saveJob(job: WatchJob) {
    await saveJobWith(postgresPool(), job);
  }

  public async ensureJob(job: WatchJob): Promise<WatchJob> {
    return withTransaction(async (client) => {
      await client.query(
        `INSERT INTO watch_jobs
          (id, fingerprint, account_id, watch_rule_id, rule_version,
           scheduled_for, status, attempt_count, max_attempts, next_attempt_at,
           created_at, updated_at, started_at, completed_at, evaluation_id,
           last_error, skip_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (account_id, fingerprint) DO NOTHING`,
        [
          job.id,
          job.fingerprint,
          job.accountId,
          job.watchRuleId,
          job.ruleVersion,
          new Date(job.scheduledFor),
          job.status,
          job.attemptCount,
          job.maxAttempts,
          new Date(job.nextAttemptAt),
          new Date(job.createdAt),
          new Date(job.updatedAt),
          date(job.startedAt),
          date(job.completedAt),
          job.evaluationId ?? null,
          job.lastError ?? null,
          job.skipReason ?? null,
        ]
      );

      const result = await client.query(
        `SELECT * FROM watch_jobs
         WHERE account_id = $1 AND fingerprint = $2`,
        [job.accountId, job.fingerprint]
      );
      return watchJobFromRow(result.rows[0]);
    });
  }

  public async claimReadyJob(params: {
    now: number;
    leaseStartedAt: number;
  }): Promise<WatchJob | null> {
    return withTransaction(async (client) => {
      const selected = await client.query(
        `SELECT *
         FROM watch_jobs
         WHERE status = 'PENDING'
           AND next_attempt_at <= $1
         ORDER BY next_attempt_at ASC, scheduled_for ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [new Date(params.now)]
      );
      if (!selected.rowCount) return null;

      const row = selected.rows[0];
      const updated = await client.query(
        `UPDATE watch_jobs
         SET status = 'RUNNING',
             attempt_count = attempt_count + 1,
             started_at = $2,
             updated_at = $2
         WHERE id = $1
         RETURNING *`,
        [row.id, new Date(params.leaseStartedAt)]
      );
      return watchJobFromRow(updated.rows[0]);
    });
  }
  public async listDueIntervalRules(params: {
    now: number;
    limit?: number;
  }) {
    const result = await postgresPool().query(
      `SELECT * FROM watch_rules
       WHERE status = 'ACTIVE'
         AND evaluation_mode = 'INTERVAL'
         AND next_evaluation_at IS NOT NULL
         AND next_evaluation_at <= $1
       ORDER BY next_evaluation_at ASC
       LIMIT $2`,
      [
        new Date(params.now),
        Math.max(1, Math.min(params.limit || 500, 5000)),
      ]
    );
    return result.rows.map(watchRuleFromRow);
  }

  public async requeueStaleRunningJobs(params: {
    now: number;
    leaseMs: number;
  }) {
    const cutoff = new Date(params.now - params.leaseMs);
    const result = await postgresPool().query(
      `UPDATE watch_jobs
       SET status = 'PENDING',
           next_attempt_at = $1,
           started_at = NULL,
           last_error =
             'Recovered stale RUNNING job after worker restart/lease expiry.',
           updated_at = $1
       WHERE status = 'RUNNING'
         AND started_at IS NOT NULL
         AND started_at <= $2
       RETURNING *`,
      [new Date(params.now), cutoff]
    );
    return result.rows.map(watchJobFromRow);
  }

  public async commitClaimedJobEvaluation(
    input: WatchJobEvaluationCommitInput
  ): Promise<WatchJobEvaluationCommitResult> {
    return withTransaction(async (client) => {
      const jobResult = await client.query(
        `SELECT *
         FROM watch_jobs
         WHERE account_id = $1
           AND id = $2
         FOR UPDATE`,
        [
          input.accountId,
          input.jobId,
        ]
      );

      if (!jobResult.rowCount) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_NOT_FOUND',
          404,
          'Watch job not found in the current account scope.'
        );
      }

      const job =
        watchJobFromRow(
          jobResult.rows[0]
        );

      if (
        job.status === 'COMPLETED' &&
        job.evaluationId
      ) {
        const [
          evaluationResult,
          ruleResult,
          alertResult,
        ] = await Promise.all([
          client.query(
            `SELECT *
             FROM watch_evaluations
             WHERE account_id = $1
               AND id = $2`,
            [
              input.accountId,
              job.evaluationId,
            ]
          ),
          client.query(
            `SELECT *
             FROM watch_rules
             WHERE account_id = $1
               AND id = $2`,
            [
              input.accountId,
              job.watchRuleId,
            ]
          ),
          client.query(
            `SELECT *
             FROM watch_alerts
             WHERE account_id = $1
               AND watch_rule_id = $2
               AND last_evaluation_id = $3
             ORDER BY updated_at DESC
             LIMIT 1`,
            [
              input.accountId,
              job.watchRuleId,
              job.evaluationId,
            ]
          ),
        ]);

        if (
          !evaluationResult.rowCount ||
          !ruleResult.rowCount
        ) {
          throw new Error(
            'Completed Watch job is missing its relational evaluation/rule state.'
          );
        }

        return {
          job,
          rule:
            watchRuleFromRow(
              ruleResult.rows[0]
            ),
          evaluation:
            watchEvaluationFromRow(
              evaluationResult.rows[0]
            ),
          alert:
            alertResult.rowCount
              ? watchAlertFromRow(
                  alertResult.rows[0]
                )
              : undefined,
          idempotentReplay: true,
        };
      }

      if (job.status !== 'RUNNING') {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_NOT_CLAIMED',
          409,
          'Watch job must be RUNNING before its evaluation can commit.'
        );
      }

      if (
        job.ruleVersion !==
        input.expectedRuleVersion
      ) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_RULE_STALE',
          409,
          'Watch job rule version changed before evaluation commit.'
        );
      }

      const ruleResult =
        await client.query(
          `SELECT *
           FROM watch_rules
           WHERE account_id = $1
             AND id = $2
           FOR UPDATE`,
          [
            input.accountId,
            job.watchRuleId,
          ]
        );

      if (!ruleResult.rowCount) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_RULE_STALE',
          409,
          'Watch rule no longer exists.'
        );
      }

      const rule =
        watchRuleFromRow(
          ruleResult.rows[0]
        );

      if (
        rule.version !==
          input.expectedRuleVersion ||
        rule.status !== 'ACTIVE' ||
        rule.evaluationMode !==
          'INTERVAL'
      ) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_RULE_STALE',
          409,
          'Watch rule changed, paused, archived, or is no longer interval-driven before evaluation commit.'
        );
      }

      const evaluation =
        input.evaluation;

      if (
        evaluation.accountId !==
          input.accountId ||
        evaluation.jobId !==
          job.id ||
        evaluation.watchRuleId !==
          rule.id ||
        evaluation.ruleVersion !==
          rule.version
      ) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_EVALUATION_INVALID',
          422,
          'Watch evaluation identity does not match the claimed job/rule.'
        );
      }

      if (
        evaluation.previousConditionState !==
        rule.currentState
      ) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_RULE_STATE_CHANGED',
          409,
          'Watch rule state changed after measurement; retry with a fresh evaluation.'
        );
      }

      const existingEvaluation =
        await client.query(
          `SELECT *
           FROM watch_evaluations
           WHERE account_id = $1
             AND job_id = $2
           FOR UPDATE`,
          [
            input.accountId,
            job.id,
          ]
        );

      let committedEvaluation =
        evaluation;

      if (existingEvaluation.rowCount) {
        committedEvaluation =
          watchEvaluationFromRow(
            existingEvaluation.rows[0]
          );
      } else {
        await saveEvaluationWith(
          client,
          evaluation
        );
      }

      let alert:
        | WatchAlert
        | undefined;

      const activeAlertResult =
        await client.query(
          `SELECT *
           FROM watch_alerts
           WHERE account_id = $1
             AND watch_rule_id = $2
             AND status <> 'RESOLVED'
           ORDER BY last_triggered_at DESC
           FOR UPDATE
           LIMIT 1`,
          [
            input.accountId,
            rule.id,
          ]
        );

      const activeAlert =
        activeAlertResult.rowCount
          ? watchAlertFromRow(
              activeAlertResult.rows[0]
            )
          : null;

      if (
        committedEvaluation.status ===
        'COMPLETED'
      ) {
        const matched =
          committedEvaluation
            .conditionMatched === true;

        if (matched) {
          if (activeAlert) {
            const alreadyLinked =
              activeAlert.evaluationIds
                .includes(
                  committedEvaluation.id
                );
            const snoozeExpired =
              activeAlert.status ===
                'SNOOZED' &&
              typeof activeAlert
                .snoozedUntil ===
                'number' &&
              activeAlert.snoozedUntil <=
                committedEvaluation
                  .evaluatedAt;

            alert = {
              ...activeAlert,
              status: snoozeExpired
                ? 'OPEN'
                : activeAlert.status,
              snoozedUntil:
                snoozeExpired
                  ? undefined
                  : activeAlert
                      .snoozedUntil,
              lastTriggeredAt:
                Math.max(
                  activeAlert
                    .lastTriggeredAt,
                  committedEvaluation
                    .evaluatedAt
                ),
              occurrenceCount:
                activeAlert
                  .occurrenceCount +
                (alreadyLinked
                  ? 0
                  : 1),
              evaluationIds:
                alreadyLinked
                  ? activeAlert
                      .evaluationIds
                  : [
                      ...activeAlert
                        .evaluationIds,
                      committedEvaluation
                        .id,
                    ],
              lastEvaluationId:
                committedEvaluation.id,
              evidence:
                committedEvaluation
                  .evidence ||
                activeAlert.evidence,
              updatedAt:
                input.completedAt,
            };
            await saveAlertWith(
              client,
              alert
            );
          } else if (
            rule.currentState !== 'TRUE'
          ) {
            if (
              !input.newAlert ||
              !committedEvaluation
                .evidence
            ) {
              throw new PostgresWatchTransactionError(
                'WATCH_JOB_EVALUATION_INVALID',
                422,
                'Matched Watch evaluation requires alert copy/evidence for a new episode.'
              );
            }

            alert = {
              id: input.newAlert.id,
              episodeKey:
                input.newAlert
                  .episodeKey,
              accountId:
                input.accountId,
              watchRuleId:
                rule.id,
              ruleVersion:
                rule.version,
              status: 'OPEN',
              title:
                input.newAlert.title,
              summary:
                input.newAlert.summary,
              firstTriggeredAt:
                committedEvaluation
                  .evaluatedAt,
              lastTriggeredAt:
                committedEvaluation
                  .evaluatedAt,
              occurrenceCount: 1,
              evaluationIds: [
                committedEvaluation.id,
              ],
              lastEvaluationId:
                committedEvaluation.id,
              evidence:
                committedEvaluation
                  .evidence,
              createdAt:
                input.completedAt,
              updatedAt:
                input.completedAt,
            };

            await saveAlertWith(
              client,
              alert
            );
          }
        } else if (
          rule.currentState ===
            'TRUE' &&
          activeAlert
        ) {
          alert = {
            ...activeAlert,
            status: 'RESOLVED',
            resolvedAt:
              activeAlert.resolvedAt ||
              committedEvaluation
                .evaluatedAt,
            resolutionReason:
              'CONDITION_CLEARED',
            snoozedUntil: undefined,
            updatedAt:
              input.completedAt,
          };
          await saveAlertWith(
            client,
            alert
          );
        }
      }

      const intervalMs =
        rule.intervalMinutes &&
        rule.intervalMinutes > 0
          ? rule.intervalMinutes *
            60 *
            1000
          : undefined;

      const oneShotCompleted =
        committedEvaluation.status ===
          'COMPLETED' &&
        committedEvaluation
          .conditionMatched === true &&
        rule.condition.kind ===
          'TIME_REACHED';

      const updatedRule: WatchRule =
        committedEvaluation.status ===
        'FAILED'
          ? {
              ...rule,
              currentState:
                'ERROR',
              lastEvaluationAt:
                committedEvaluation
                  .evaluatedAt,
              nextEvaluationAt:
                intervalMs
                  ? committedEvaluation
                      .evaluatedAt +
                    intervalMs
                  : undefined,
              updatedAt:
                input.completedAt,
            }
          : {
              ...rule,
              status:
                oneShotCompleted
                  ? 'PAUSED'
                  : rule.status,
              currentState:
                committedEvaluation
                  .conditionMatched
                  ? 'TRUE'
                  : 'FALSE',
              lastEvaluationAt:
                committedEvaluation
                  .evaluatedAt,
              lastTriggeredAt:
                committedEvaluation
                  .conditionMatched
                  ? committedEvaluation
                      .evaluatedAt
                  : rule.lastTriggeredAt,
              nextEvaluationAt:
                oneShotCompleted
                  ? undefined
                  : intervalMs
                    ? committedEvaluation
                        .evaluatedAt +
                      intervalMs
                    : undefined,
              updatedAt:
                input.completedAt,
            };

      await saveRuleWith(
        client,
        updatedRule
      );

      const completedJob: WatchJob = {
        ...job,
        status: 'COMPLETED',
        completedAt:
          input.completedAt,
        evaluationId:
          committedEvaluation.id,
        lastError:
          committedEvaluation.status ===
          'FAILED'
            ? committedEvaluation.error
            : undefined,
        updatedAt:
          input.completedAt,
      };

      await saveJobWith(
        client,
        completedJob
      );

      return {
        job: completedJob,
        rule: updatedRule,
        evaluation:
          committedEvaluation,
        alert,
        idempotentReplay: false,
      };
    });
  }

  public async commitClaimedJobTerminalFailure(
    input: WatchJobTerminalFailureCommitInput
  ): Promise<WatchJobTerminalFailureCommitResult> {
    return withTransaction(async (client) => {
      const jobResult = await client.query(
        `SELECT *
         FROM watch_jobs
         WHERE account_id = $1
           AND id = $2
         FOR UPDATE`,
        [
          input.accountId,
          input.jobId,
        ]
      );

      if (!jobResult.rowCount) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_NOT_FOUND',
          404,
          'Watch job not found in the current account scope.'
        );
      }

      const job =
        watchJobFromRow(
          jobResult.rows[0]
        );

      const ruleResult =
        await client.query(
          `SELECT *
           FROM watch_rules
           WHERE account_id = $1
             AND id = $2
           FOR UPDATE`,
          [
            input.accountId,
            job.watchRuleId,
          ]
        );

      if (!ruleResult.rowCount) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_RULE_STALE',
          409,
          'Watch rule no longer exists.'
        );
      }

      const rule =
        watchRuleFromRow(
          ruleResult.rows[0]
        );

      if (job.status === 'FAILED') {
        return {
          job,
          rule,
          idempotentReplay: true,
        };
      }

      if (
        job.status !== 'RUNNING'
      ) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_NOT_CLAIMED',
          409,
          'Watch job must be RUNNING before terminal failure can commit.'
        );
      }

      if (
        job.ruleVersion !==
          input.expectedRuleVersion ||
        rule.version !==
          input.expectedRuleVersion
      ) {
        throw new PostgresWatchTransactionError(
          'WATCH_JOB_RULE_STALE',
          409,
          'Watch rule version changed before terminal failure commit.'
        );
      }

      const intervalMinutes =
        rule.intervalMinutes &&
        rule.intervalMinutes > 0
          ? rule.intervalMinutes
          : 60;

      const failedJob: WatchJob = {
        ...job,
        status: 'FAILED',
        completedAt:
          input.failedAt,
        lastError:
          input.error,
        updatedAt:
          input.failedAt,
      };

      const failedRule: WatchRule = {
        ...rule,
        currentState: 'ERROR',
        lastEvaluationAt:
          input.failedAt,
        nextEvaluationAt:
          input.failedAt +
          intervalMinutes *
            60 *
            1000,
        updatedAt:
          input.failedAt,
      };

      await saveJobWith(
        client,
        failedJob
      );
      await saveRuleWith(
        client,
        failedRule
      );

      return {
        job: failedJob,
        rule: failedRule,
        idempotentReplay: false,
      };
    });
  }

}

export class PostgresIntegrationRepository
  implements IntegrationRepository
{
  public async getConnection(accountId: string, connectionId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM integration_connections
       WHERE account_id = $1 AND id = $2`,
      [accountId, connectionId]
    );
    return result.rowCount
      ? integrationConnectionFromRow(result.rows[0])
      : null;
  }

  public async listConnections(accountId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM integration_connections
       WHERE account_id = $1
       ORDER BY updated_at DESC`,
      [accountId]
    );
    return result.rows.map(integrationConnectionFromRow);
  }

  public async saveConnection(connection: IntegrationConnection) {
    await saveConnectionWith(postgresPool(), connection);
  }

  public async tryAcquireSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
    leaseExpiresAt: number;
    now: number;
  }) {
    const result = await postgresPool().query(
      `UPDATE integration_connections
       SET sync_lease_id = $3,
           sync_lease_expires_at = $4,
           updated_at = $5
       WHERE account_id = $1
         AND id = $2
         AND (
           sync_lease_id IS NULL
           OR sync_lease_expires_at IS NULL
           OR sync_lease_expires_at <= $5
         )
       RETURNING *`,
      [
        params.accountId,
        params.connectionId,
        params.leaseId,
        new Date(params.leaseExpiresAt),
        new Date(params.now),
      ]
    );
    return result.rowCount
      ? integrationConnectionFromRow(result.rows[0])
      : null;
  }

  public async releaseSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
    now: number;
  }) {
    const released = await postgresPool().query(
      `UPDATE integration_connections
       SET sync_lease_id = NULL,
           sync_lease_expires_at = NULL,
           updated_at = $4
       WHERE account_id = $1
         AND id = $2
         AND sync_lease_id = $3
       RETURNING *`,
      [
        params.accountId,
        params.connectionId,
        params.leaseId,
        new Date(params.now),
      ]
    );
    if (released.rowCount) {
      return integrationConnectionFromRow(released.rows[0]);
    }

    const existing = await this.getConnection(
      params.accountId,
      params.connectionId
    );
    return existing;
  }

  public async getSyncRun(accountId: string, runId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM integration_sync_runs
       WHERE account_id = $1 AND id = $2`,
      [accountId, runId]
    );
    return result.rowCount ? syncRunFromRow(result.rows[0]) : null;
  }

  public async listSyncRuns(params: {
    accountId: string;
    connectionId?: string;
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    let where = 'account_id = $1';
    if (params.connectionId) {
      values.push(params.connectionId);
      where += ' AND connection_id = $2';
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM integration_sync_runs
       WHERE ${where}
       ORDER BY started_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(syncRunFromRow);
  }

  public async saveSyncRun(run: SyncRun) {
    await saveSyncRunWith(postgresPool(), run);
  }

  public async getImport(accountId: string, importId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM integration_external_imports
       WHERE account_id = $1 AND id = $2`,
      [accountId, importId]
    );
    return result.rowCount ? externalImportFromRow(result.rows[0]) : null;
  }

  public async findExactImport(params: {
    accountId: string;
    connectionId: string;
    externalId: string;
    externalVersion: string;
  }) {
    const result = await postgresPool().query(
      `SELECT * FROM integration_external_imports
       WHERE account_id = $1 AND connection_id = $2
         AND external_id = $3 AND external_version = $4`,
      [
        params.accountId,
        params.connectionId,
        params.externalId,
        params.externalVersion,
      ]
    );
    return result.rowCount ? externalImportFromRow(result.rows[0]) : null;
  }

  public async listImports(params: {
    accountId: string;
    connectionId?: string;
    externalId?: string;
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.connectionId) {
      values.push(params.connectionId);
      clauses.push('connection_id = $' + values.length);
    }
    if (params.externalId) {
      values.push(params.externalId);
      clauses.push('external_id = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM integration_external_imports
       WHERE ${clauses.join(' AND ')}
       ORDER BY imported_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(externalImportFromRow);
  }

  public async saveImport(importState: ExternalImportState) {
    await saveImportWith(postgresPool(), importState);
  }
}

export class PostgresIntegrationCheckpointRepository
  implements IntegrationCheckpointRepository
{
  public async commitSuccessfulCheckpoint(
    input: IntegrationCheckpointCommitInput
  ) {
    return withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT * FROM integration_connections
         WHERE account_id = $1 AND id = $2
         FOR UPDATE`,
        [input.accountId, input.connectionId]
      );
      if (!locked.rowCount) {
        throw new Error(
          'Integration connection not found in the current account scope.'
        );
      }

      const currentCursor: string | undefined =
        locked.rows[0].cursor ?? undefined;
      if (currentCursor !== input.expectedCursor) {
        throw new Error(
          'INTEGRATION_CHECKPOINT_STALE: connection cursor changed before checkpoint commit.'
        );
      }

      const runRow = await client.query(
        `SELECT * FROM integration_sync_runs
         WHERE account_id = $1 AND id = $2 AND connection_id = $3
         FOR UPDATE`,
        [input.accountId, input.runId, input.connectionId]
      );
      if (!runRow.rowCount) {
        throw new Error(
          'Sync run not found in the current connection scope.'
        );
      }

      for (const imported of input.imports) {
        if (
          imported.accountId !== input.accountId ||
          imported.connectionId !== input.connectionId ||
          imported.provider !==
            locked.rows[0].provider
        ) {
          throw new Error(
            'External import does not belong to this checkpoint account/connection/provider.'
          );
        }

        if (
          imported.status !== 'READY' &&
          imported.status !== 'TOMBSTONE'
        ) {
          throw new Error(
            'INTEGRATION_CHECKPOINT_IMPORT_NOT_READY: cursor cannot advance while a provider record is not fully committed.'
          );
        }

        if (
          imported.internalKind ===
            'DATASET' &&
          imported.status === 'READY'
        ) {
          if (
            !imported.internalId ||
            !imported.internalVersionId
          ) {
            throw new Error(
              'INTEGRATION_CHECKPOINT_DATASET_IDENTITY_MISSING: READY Dataset import lacks dataset/version identity.'
            );
          }

          const datasetVersion =
            await client.query(
              `SELECT source_version_id
               FROM dataset_versions
               WHERE account_id = $1
                 AND dataset_id = $2
                 AND id = $3`,
              [
                imported.accountId,
                imported.internalId,
                imported.internalVersionId,
              ]
            );

          if (!datasetVersion.rowCount) {
            throw new Error(
              'INTEGRATION_CHECKPOINT_DATASET_MISSING: cursor cannot advance before the DatasetVersion is committed.'
            );
          }

          const committedSourceVersionId:
            | string
            | undefined =
            datasetVersion.rows[0]
              .source_version_id ??
            undefined;

          if (committedSourceVersionId) {
            if (
              imported.sourceVersionId !==
              committedSourceVersionId
            ) {
              throw new Error(
                'INTEGRATION_CHECKPOINT_SOURCE_MISMATCH: external import does not reference the DatasetVersion source snapshot.'
              );
            }

            const sourceSnapshot =
              await client.query(
                `SELECT 1
                 FROM source_versions sv
                 JOIN source_objects so
                   ON so.account_id = sv.account_id
                  AND so.id = sv.source_object_id
                 WHERE sv.account_id = $1
                   AND sv.id = $2
                   AND sv.retention_state = 'ACTIVE'
                   AND so.status = 'ACTIVE'
                   AND so.kind = 'DATASET_SOURCE'`,
                [
                  imported.accountId,
                  committedSourceVersionId,
                ]
              );

            if (
              !sourceSnapshot.rowCount
            ) {
              throw new Error(
                'INTEGRATION_CHECKPOINT_SOURCE_UNAVAILABLE: cursor cannot advance without the active immutable Dataset source snapshot.'
              );
            }
          }

          if (!imported.knowledgeProjectionRunId) {
            throw new Error(
              'INTEGRATION_CHECKPOINT_PROJECTION_MISSING: cursor cannot advance before the DatasetVersion projection is completed.'
            );
          }

          const projection =
            await client.query(
              `SELECT 1
               FROM knowledge_projection_runs
               WHERE account_id = $1
                 AND id = $2
                 AND source_type = 'DATASET'
                 AND source_id = $3
                 AND source_version_id = $4
                 AND status = 'COMPLETED'
                 AND completed_at IS NOT NULL`,
              [
                imported.accountId,
                imported.knowledgeProjectionRunId,
                imported.internalId,
                imported.internalVersionId,
              ]
            );

          if (!projection.rowCount) {
            throw new Error(
              'INTEGRATION_CHECKPOINT_PROJECTION_MISSING: cursor cannot advance before the exact DatasetVersion projection is completed.'
            );
          }
        }

        await saveImportWith(client, imported);
      }

      const completedRun: SyncRun = {
        ...input.run,
        accountId: input.accountId,
        connectionId: input.connectionId,
        id: input.runId,
        status: 'COMPLETED',
        cursorBefore: input.expectedCursor,
        cursorAfter: input.nextCursor,
        completedAt: input.completedAt,
        retryable: false,
        failureCategory: undefined,
        nextRetryAt: undefined,
        error: undefined,
      };
      await saveSyncRunWith(client, completedRun);

      const connection = integrationConnectionFromRow(locked.rows[0]);
      const updatedConnection: IntegrationConnection = {
        ...connection,
        cursor: input.nextCursor,
        lastSyncAt: input.completedAt,
        lastSuccessfulSyncAt: input.completedAt,
        lastError: undefined,
        lastFailureCategory: undefined,
        attentionReason: undefined,
        consecutiveFailureCount: 0,
        nextRetryAt: undefined,
        updatedAt: input.completedAt,
      };
      await saveConnectionWith(client, updatedConnection);

      const refreshedConnection = await client.query(
        `SELECT * FROM integration_connections
         WHERE account_id = $1 AND id = $2`,
        [input.accountId, input.connectionId]
      );
      const refreshedRun = await client.query(
        `SELECT * FROM integration_sync_runs
         WHERE account_id = $1 AND id = $2`,
        [input.accountId, input.runId]
      );

      return {
        connection: integrationConnectionFromRow(
          refreshedConnection.rows[0]
        ),
        run: syncRunFromRow(refreshedRun.rows[0]),
        imports: input.imports.map((item) => structuredClone(item)),
      };
    });
  }
}

export const postgresWatchRepository =
  new PostgresWatchRepository();
export const postgresIntegrationRepository =
  new PostgresIntegrationRepository();
export const postgresIntegrationCheckpointRepository =
  new PostgresIntegrationCheckpointRepository();
