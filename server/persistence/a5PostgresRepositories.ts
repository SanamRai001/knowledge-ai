import type { PoolClient } from 'pg';
import { postgresPool, withTransaction } from './postgres.js';
import {
  commitConfirmedActionWithClient,
} from './a3PostgresRepositories.js';
import type {
  AutomationApprovalRequest,
  AutomationControlRevision,
  AutomationControlState,
  AutomationPolicy,
  AutomationPolicyRevision,
  AutomationRun,
} from '../automation/types.js';
import type { DomainPackInstallation } from '../platform/domainPacks/types.js';
import type { ToolInvocationAudit } from '../platform/tools/types.js';
import type {
  AutomationControlCommitInput,
  AutomationExecutionClaimInput,
  AutomationExecutionCommitInput,
  AutomationExecutionCommitResult,
  AutomationExecutionTransactionRepository,
  AutomationGovernanceTransactionRepository,
  AutomationPolicyCommitInput,
  AutomationRepository,
  PlatformStateRepository,
} from './a5Types.js';

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

function num(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function lockAutomationAccount(
  client: Pick<PoolClient, 'query'>,
  accountId: string
): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    ['knowledge-ai:automation-account:' + accountId]
  );
}

async function lockAutomationProposal(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  proposalId: string
): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [
      'knowledge-ai:automation-execution:' +
        accountId +
        ':' +
        proposalId,
    ]
  );
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

function policyFromRow(row: any): AutomationPolicy {
  return {
    id: row.id,
    accountId: row.account_id,
    version: row.version,
    enabled: row.enabled,
    mode: row.mode,
    allowedActionIntents: row.allowed_action_intents || [],
    maxRiskClass: row.max_risk_class,
    maxAmount: num(row.max_amount),
    maxQuantity: num(row.max_quantity),
    allowedIdentitySources: row.allowed_identity_sources || [],
    allowedActorRoles: row.allowed_actor_roles ?? undefined,
    approvalRoles: row.approval_roles ?? undefined,
    allowedTargetEntityTypes:
      row.allowed_target_entity_types ?? undefined,
    allowedTargetEntityIds:
      row.allowed_target_entity_ids ?? undefined,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function policyRevisionFromRow(
  row: any
): AutomationPolicyRevision {
  return {
    id: row.id,
    accountId: row.account_id,
    policyId: row.policy_id,
    version: row.version,
    snapshot: row.snapshot,
    changedAt: epoch(row.changed_at)!,
    changedBy: row.changed_by,
    reason: row.reason,
  };
}

function approvalFromRow(
  row: any
): AutomationApprovalRequest {
  return {
    id: row.id,
    accountId: row.account_id,
    proposalId: row.proposal_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    status: row.status,
    requestedBy: row.requested_by,
    requestedByRole: row.requested_by_role,
    eligibleRoles: row.eligible_roles || [],
    decisionReasonCodes: row.decision_reason_codes || [],
    decisionReasons: row.decision_reasons || [],
    requestedAt: epoch(row.requested_at)!,
    expiresAt: epoch(row.expires_at)!,
    resolvedAt: epoch(row.resolved_at) ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedByRole: row.resolved_by_role ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
  };
}

function controlFromRow(row: any): AutomationControlState {
  return {
    accountId: row.account_id,
    version: row.version,
    emergencyDisabled: row.emergency_disabled,
    reason: row.reason ?? undefined,
    updatedAt: epoch(row.updated_at)!,
    updatedBy: row.updated_by,
  };
}

function controlRevisionFromRow(
  row: any
): AutomationControlRevision {
  return {
    id: row.id,
    accountId: row.account_id,
    version: row.version,
    snapshot: row.snapshot,
    changedAt: epoch(row.changed_at)!,
    changedBy: row.changed_by,
  };
}

function automationRunFromRow(row: any): AutomationRun {
  return {
    id: row.id,
    accountId: row.account_id,
    proposalId: row.proposal_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    actor: row.actor,
    actorRole: row.actor_role,
    policyId: row.policy_id ?? undefined,
    policyVersion: row.policy_version ?? undefined,
    executionId: row.execution_id ?? undefined,
    failureCategory: row.failure_category ?? undefined,
    retryable:
      row.retryable === null ? undefined : row.retryable,
    lastError: row.last_error ?? undefined,
    startedAt: epoch(row.started_at)!,
    updatedAt: epoch(row.updated_at)!,
    completedAt: epoch(row.completed_at) ?? undefined,
    compensationProposalId:
      row.compensation_proposal_id ?? undefined,
    compensationExecutionId:
      row.compensation_execution_id ?? undefined,
    feedback: row.feedback ?? undefined,
    feedbackAt: epoch(row.feedback_at) ?? undefined,
    feedbackBy: row.feedback_by ?? undefined,
    feedbackNote: row.feedback_note ?? undefined,
  };
}

function domainPackFromRow(row: any): DomainPackInstallation {
  return {
    id: row.id,
    accountId: row.account_id,
    packId: row.pack_id,
    packVersion: row.pack_version,
    status: row.status,
    installedAt: epoch(row.installed_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function toolInvocationFromRow(row: any): ToolInvocationAudit {
  return {
    id: row.id,
    accountId: row.account_id,
    toolId: row.tool_id,
    toolVersion: row.tool_version,
    requestId: row.request_id,
    apiKeyId: row.api_key_id,
    status: row.status,
    inputHash: row.input_hash,
    startedAt: epoch(row.started_at)!,
    completedAt: epoch(row.completed_at) ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

async function savePolicyWith(
  client: Pick<PoolClient, 'query'>,
  policy: AutomationPolicy
): Promise<void> {
  const result = await client.query(
    `INSERT INTO automation_policies
      (id, account_id, version, enabled, mode, allowed_action_intents,
       max_risk_class, max_amount, max_quantity, allowed_identity_sources,
       allowed_actor_roles, approval_roles, allowed_target_entity_types,
       allowed_target_entity_ids, created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       version = EXCLUDED.version,
       enabled = EXCLUDED.enabled,
       mode = EXCLUDED.mode,
       allowed_action_intents = EXCLUDED.allowed_action_intents,
       max_risk_class = EXCLUDED.max_risk_class,
       max_amount = EXCLUDED.max_amount,
       max_quantity = EXCLUDED.max_quantity,
       allowed_identity_sources = EXCLUDED.allowed_identity_sources,
       allowed_actor_roles = EXCLUDED.allowed_actor_roles,
       approval_roles = EXCLUDED.approval_roles,
       allowed_target_entity_types = EXCLUDED.allowed_target_entity_types,
       allowed_target_entity_ids = EXCLUDED.allowed_target_entity_ids,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by
     WHERE automation_policies.account_id = EXCLUDED.account_id
     RETURNING id`,
    [
      policy.id,
      policy.accountId,
      policy.version,
      policy.enabled,
      policy.mode,
      policy.allowedActionIntents,
      policy.maxRiskClass,
      policy.maxAmount ?? null,
      policy.maxQuantity ?? null,
      policy.allowedIdentitySources,
      policy.allowedActorRoles ?? null,
      policy.approvalRoles ?? null,
      policy.allowedTargetEntityTypes ?? null,
      policy.allowedTargetEntityIds ?? null,
      new Date(policy.createdAt),
      new Date(policy.updatedAt),
      policy.createdBy,
      policy.updatedBy,
    ]
  );
  await assertOwnedUpsert(result, 'AutomationPolicy');
}

async function savePolicyRevisionWith(
  client: Pick<PoolClient, 'query'>,
  revision: AutomationPolicyRevision
): Promise<void> {
  const result = await client.query(
    `INSERT INTO automation_policy_revisions
      (id, account_id, policy_id, version, snapshot, changed_at,
       changed_by, reason)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      revision.id,
      revision.accountId,
      revision.policyId,
      revision.version,
      json(revision.snapshot),
      new Date(revision.changedAt),
      revision.changedBy,
      revision.reason,
    ]
  );

  if (result.rowCount) return;

  const existing = await client.query(
    `SELECT account_id, policy_id, version
     FROM automation_policy_revisions
     WHERE id = $1`,
    [revision.id]
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.account_id !== revision.accountId ||
    row.policy_id !== revision.policyId ||
    row.version !== revision.version
  ) {
    throw new Error(
      'AutomationPolicyRevision identity conflict.'
    );
  }
}

async function saveApprovalWith(
  client: Pick<PoolClient, 'query'>,
  approval: AutomationApprovalRequest
): Promise<void> {
  const result = await client.query(
    `INSERT INTO automation_approvals
      (id, account_id, proposal_id, policy_id, policy_version, status,
       requested_by, requested_by_role, eligible_roles,
       decision_reason_codes, decision_reasons, requested_at, expires_at,
       resolved_at, resolved_by, resolved_by_role, resolution_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       resolved_at = EXCLUDED.resolved_at,
       resolved_by = EXCLUDED.resolved_by,
       resolved_by_role = EXCLUDED.resolved_by_role,
       resolution_note = EXCLUDED.resolution_note
     WHERE automation_approvals.account_id = EXCLUDED.account_id
       AND automation_approvals.proposal_id = EXCLUDED.proposal_id
       AND automation_approvals.policy_id = EXCLUDED.policy_id
       AND automation_approvals.policy_version = EXCLUDED.policy_version
     RETURNING id`,
    [
      approval.id,
      approval.accountId,
      approval.proposalId,
      approval.policyId,
      approval.policyVersion,
      approval.status,
      approval.requestedBy,
      approval.requestedByRole,
      approval.eligibleRoles,
      approval.decisionReasonCodes,
      json(approval.decisionReasons),
      new Date(approval.requestedAt),
      new Date(approval.expiresAt),
      date(approval.resolvedAt),
      approval.resolvedBy ?? null,
      approval.resolvedByRole ?? null,
      approval.resolutionNote ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'AutomationApproval');
}

async function saveControlWith(
  client: Pick<PoolClient, 'query'>,
  control: AutomationControlState
): Promise<void> {
  const result = await client.query(
    `INSERT INTO automation_controls
      (account_id, version, emergency_disabled, reason, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (account_id) DO UPDATE SET
       version = EXCLUDED.version,
       emergency_disabled = EXCLUDED.emergency_disabled,
       reason = EXCLUDED.reason,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by
     RETURNING account_id`,
    [
      control.accountId,
      control.version,
      control.emergencyDisabled,
      control.reason ?? null,
      new Date(control.updatedAt),
      control.updatedBy,
    ]
  );
  await assertOwnedUpsert(result, 'AutomationControl');
}

async function saveControlRevisionWith(
  client: Pick<PoolClient, 'query'>,
  revision: AutomationControlRevision
): Promise<void> {
  const result = await client.query(
    `INSERT INTO automation_control_revisions
      (id, account_id, version, snapshot, changed_at, changed_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      revision.id,
      revision.accountId,
      revision.version,
      json(revision.snapshot),
      new Date(revision.changedAt),
      revision.changedBy,
    ]
  );

  if (result.rowCount) return;

  const existing = await client.query(
    `SELECT account_id, version
     FROM automation_control_revisions
     WHERE id = $1`,
    [revision.id]
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.account_id !== revision.accountId ||
    row.version !== revision.version
  ) {
    throw new Error('AutomationControlRevision identity conflict.');
  }
}

async function saveRunWith(
  client: Pick<PoolClient, 'query'>,
  run: AutomationRun
): Promise<void> {
  const result = await client.query(
    `INSERT INTO automation_runs
      (id, account_id, proposal_id, status, attempt_count, max_attempts,
       actor, actor_role, policy_id, policy_version, execution_id,
       failure_category, retryable, last_error, started_at, updated_at,
       completed_at, compensation_proposal_id, compensation_execution_id,
       feedback, feedback_at, feedback_by, feedback_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20,$21,$22,$23)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       attempt_count = EXCLUDED.attempt_count,
       max_attempts = EXCLUDED.max_attempts,
       execution_id = EXCLUDED.execution_id,
       failure_category = EXCLUDED.failure_category,
       retryable = EXCLUDED.retryable,
       last_error = EXCLUDED.last_error,
       updated_at = EXCLUDED.updated_at,
       completed_at = EXCLUDED.completed_at,
       compensation_proposal_id = EXCLUDED.compensation_proposal_id,
       compensation_execution_id = EXCLUDED.compensation_execution_id,
       feedback = EXCLUDED.feedback,
       feedback_at = EXCLUDED.feedback_at,
       feedback_by = EXCLUDED.feedback_by,
       feedback_note = EXCLUDED.feedback_note
     WHERE automation_runs.account_id = EXCLUDED.account_id
       AND automation_runs.proposal_id = EXCLUDED.proposal_id
     RETURNING id`,
    [
      run.id,
      run.accountId,
      run.proposalId,
      run.status,
      run.attemptCount,
      run.maxAttempts,
      run.actor,
      run.actorRole,
      run.policyId ?? null,
      run.policyVersion ?? null,
      run.executionId ?? null,
      run.failureCategory ?? null,
      run.retryable ?? null,
      run.lastError ?? null,
      new Date(run.startedAt),
      new Date(run.updatedAt),
      date(run.completedAt),
      run.compensationProposalId ?? null,
      run.compensationExecutionId ?? null,
      run.feedback ?? null,
      date(run.feedbackAt),
      run.feedbackBy ?? null,
      run.feedbackNote ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'AutomationRun');
}

async function saveDomainPackWith(
  client: Pick<PoolClient, 'query'>,
  installation: DomainPackInstallation
): Promise<void> {
  const result = await client.query(
    `INSERT INTO platform_domain_pack_installations
      (id, account_id, pack_id, pack_version, status, installed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at
     WHERE platform_domain_pack_installations.account_id = EXCLUDED.account_id
       AND platform_domain_pack_installations.pack_id = EXCLUDED.pack_id
       AND platform_domain_pack_installations.pack_version = EXCLUDED.pack_version
     RETURNING id`,
    [
      installation.id,
      installation.accountId,
      installation.packId,
      installation.packVersion,
      installation.status,
      new Date(installation.installedAt),
      new Date(installation.updatedAt),
    ]
  );
  await assertOwnedUpsert(result, 'DomainPackInstallation');
}

async function saveToolInvocationWith(
  client: Pick<PoolClient, 'query'>,
  record: ToolInvocationAudit
): Promise<void> {
  const result = await client.query(
    `INSERT INTO platform_tool_invocation_audit
      (id, account_id, tool_id, tool_version, request_id, api_key_id,
       status, input_hash, started_at, completed_at, error_code, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       completed_at = EXCLUDED.completed_at,
       error_code = EXCLUDED.error_code,
       error_message = EXCLUDED.error_message
     WHERE platform_tool_invocation_audit.account_id = EXCLUDED.account_id
       AND platform_tool_invocation_audit.tool_id = EXCLUDED.tool_id
       AND platform_tool_invocation_audit.tool_version = EXCLUDED.tool_version
       AND platform_tool_invocation_audit.request_id = EXCLUDED.request_id
       AND platform_tool_invocation_audit.api_key_id = EXCLUDED.api_key_id
       AND platform_tool_invocation_audit.input_hash = EXCLUDED.input_hash
     RETURNING id`,
    [
      record.id,
      record.accountId,
      record.toolId,
      record.toolVersion,
      record.requestId,
      record.apiKeyId,
      record.status,
      record.inputHash,
      new Date(record.startedAt),
      date(record.completedAt),
      record.errorCode ?? null,
      record.errorMessage ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'ToolInvocationAudit');
}

export class PostgresAutomationRepository
  implements AutomationRepository
{
  async getPolicy(accountId: string) {
    const result = await postgresPool().query(
      'SELECT * FROM automation_policies WHERE account_id = $1',
      [accountId]
    );
    return result.rowCount ? policyFromRow(result.rows[0]) : null;
  }

  async savePolicy(policy: AutomationPolicy) {
    await savePolicyWith(postgresPool(), policy);
  }

  async getPolicyRevision(accountId: string, revisionId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM automation_policy_revisions
       WHERE account_id = $1 AND id = $2`,
      [accountId, revisionId]
    );
    return result.rowCount
      ? policyRevisionFromRow(result.rows[0])
      : null;
  }

  async listPolicyRevisions(params: {
    accountId: string;
    policyId?: string;
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.policyId) {
      values.push(params.policyId);
      clauses.push('policy_id = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM automation_policy_revisions
       WHERE ${clauses.join(' AND ')}
       ORDER BY changed_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(policyRevisionFromRow);
  }

  async savePolicyRevision(revision: AutomationPolicyRevision) {
    await savePolicyRevisionWith(postgresPool(), revision);
  }

  async getApproval(accountId: string, approvalId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM automation_approvals
       WHERE account_id = $1 AND id = $2`,
      [accountId, approvalId]
    );
    return result.rowCount ? approvalFromRow(result.rows[0]) : null;
  }

  async listApprovals(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationApprovalRequest['status'];
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.proposalId) {
      values.push(params.proposalId);
      clauses.push('proposal_id = $' + values.length);
    }
    if (params.status) {
      values.push(params.status);
      clauses.push('status = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM automation_approvals
       WHERE ${clauses.join(' AND ')}
       ORDER BY requested_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(approvalFromRow);
  }

  async saveApproval(approval: AutomationApprovalRequest) {
    await saveApprovalWith(postgresPool(), approval);
  }

  async getControl(accountId: string) {
    const result = await postgresPool().query(
      'SELECT * FROM automation_controls WHERE account_id = $1',
      [accountId]
    );
    return result.rowCount ? controlFromRow(result.rows[0]) : null;
  }

  async saveControl(control: AutomationControlState) {
    await saveControlWith(postgresPool(), control);
  }

  async getControlRevision(accountId: string, revisionId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM automation_control_revisions
       WHERE account_id = $1 AND id = $2`,
      [accountId, revisionId]
    );
    return result.rowCount
      ? controlRevisionFromRow(result.rows[0])
      : null;
  }

  async listControlRevisions(params: {
    accountId: string;
    limit?: number;
  }) {
    const result = await postgresPool().query(
      `SELECT * FROM automation_control_revisions
       WHERE account_id = $1
       ORDER BY changed_at DESC
       LIMIT $2`,
      [
        params.accountId,
        Math.max(1, Math.min(params.limit || 100, 1000)),
      ]
    );
    return result.rows.map(controlRevisionFromRow);
  }

  async saveControlRevision(revision: AutomationControlRevision) {
    await saveControlRevisionWith(postgresPool(), revision);
  }

  async getRun(accountId: string, runId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM automation_runs
       WHERE account_id = $1 AND id = $2`,
      [accountId, runId]
    );
    return result.rowCount
      ? automationRunFromRow(result.rows[0])
      : null;
  }

  async listRuns(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationRun['status'];
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.proposalId) {
      values.push(params.proposalId);
      clauses.push('proposal_id = $' + values.length);
    }
    if (params.status) {
      values.push(params.status);
      clauses.push('status = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM automation_runs
       WHERE ${clauses.join(' AND ')}
       ORDER BY started_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(automationRunFromRow);
  }

  async saveRun(run: AutomationRun) {
    await saveRunWith(postgresPool(), run);
  }
}

export class PostgresAutomationGovernanceTransactionRepository
  implements AutomationGovernanceTransactionRepository
{
  async commitPolicyRevision(
    input: AutomationPolicyCommitInput
  ): Promise<AutomationPolicy> {
    return withTransaction(async (client) => {
      await lockAutomationAccount(
        client,
        input.policy.accountId
      );

      const currentResult = await client.query(
        `SELECT * FROM automation_policies
         WHERE account_id = $1
         FOR UPDATE`,
        [input.policy.accountId]
      );
      const current = currentResult.rowCount
        ? policyFromRow(currentResult.rows[0])
        : null;
      const currentVersion = current?.version || 0;

      if (currentVersion !== input.expectedPreviousVersion) {
        throw new Error(
          'AUTOMATION_POLICY_VERSION_STALE: current policy version changed before commit.'
        );
      }
      if (
        input.policy.version !==
          input.expectedPreviousVersion + 1 ||
        input.revision.version !== input.policy.version ||
        input.revision.accountId !== input.policy.accountId ||
        input.revision.policyId !== input.policy.id ||
        input.revision.snapshot.id !== input.policy.id ||
        input.revision.snapshot.version !== input.policy.version
      ) {
        throw new Error(
          'AUTOMATION_POLICY_REVISION_INVALID: policy and revision identities/versions must match.'
        );
      }
      if (current && current.id !== input.policy.id) {
        throw new Error(
          'AUTOMATION_POLICY_ID_CHANGED: an account policy cannot change identity during update.'
        );
      }

      await savePolicyWith(client, input.policy);
      await savePolicyRevisionWith(client, input.revision);
      return input.policy;
    });
  }

  async commitControlRevision(
    input: AutomationControlCommitInput
  ): Promise<AutomationControlState> {
    return withTransaction(async (client) => {
      await lockAutomationAccount(
        client,
        input.control.accountId
      );

      const currentResult = await client.query(
        `SELECT * FROM automation_controls
         WHERE account_id = $1
         FOR UPDATE`,
        [input.control.accountId]
      );
      const current = currentResult.rowCount
        ? controlFromRow(currentResult.rows[0])
        : null;
      const currentVersion = current?.version || 0;

      if (currentVersion !== input.expectedPreviousVersion) {
        throw new Error(
          'AUTOMATION_CONTROL_VERSION_STALE: emergency control changed before commit.'
        );
      }
      if (
        input.control.version !==
          input.expectedPreviousVersion + 1 ||
        input.revision.version !== input.control.version ||
        input.revision.accountId !== input.control.accountId ||
        input.revision.snapshot.accountId !==
          input.control.accountId ||
        input.revision.snapshot.version !== input.control.version
      ) {
        throw new Error(
          'AUTOMATION_CONTROL_REVISION_INVALID: control and revision identities/versions must match.'
        );
      }

      await saveControlWith(client, input.control);
      await saveControlRevisionWith(client, input.revision);
      return input.control;
    });
  }
}

export class PostgresAutomationExecutionTransactionRepository
  implements AutomationExecutionTransactionRepository
{
  async claimPolicyExecution(
    input: AutomationExecutionClaimInput
  ): Promise<AutomationRun> {
    return withTransaction(async (client) => {
      await lockAutomationProposal(
        client,
        input.accountId,
        input.proposalId
      );

      const existingResult =
        await client.query(
          `SELECT *
           FROM automation_runs
           WHERE account_id = $1
             AND proposal_id = $2
             AND status IN ('RUNNING','SUCCEEDED')
           ORDER BY started_at DESC, id DESC
           FOR UPDATE`,
          [
            input.accountId,
            input.proposalId,
          ]
        );

      const existing = existingResult.rowCount
        ? automationRunFromRow(
            existingResult.rows[0]
          )
        : null;

      if (
        existing &&
        existing.status === 'SUCCEEDED'
      ) {
        return existing;
      }

      if (
        existing &&
        existing.status === 'RUNNING' &&
        existing.policyId ===
          input.policyId &&
        existing.policyVersion ===
          input.policyVersion
      ) {
        return existing;
      }

      if (
        existing &&
        existing.status === 'RUNNING'
      ) {
        await saveRunWith(client, {
          ...existing,
          status: 'BLOCKED',
          failureCategory:
            'POLICY',
          retryable: false,
          lastError:
            'Automation execution claim was superseded by a newer policy revision before Action commit.',
          updatedAt: input.now,
          completedAt: input.now,
        });
      }

      const run: AutomationRun = {
        id:
          'autorun_' +
          crypto.randomBytes(10).toString('hex'),
        accountId: input.accountId,
        proposalId: input.proposalId,
        status: 'RUNNING',
        attemptCount: 0,
        maxAttempts: input.maxAttempts,
        actor: input.actor,
        actorRole: input.actorRole,
        policyId: input.policyId,
        policyVersion:
          input.policyVersion,
        startedAt: input.now,
        updatedAt: input.now,
      };

      await saveRunWith(client, run);
      return run;
    });
  }

  async commitPolicyExecution(
    input: AutomationExecutionCommitInput
  ): Promise<AutomationExecutionCommitResult> {
    return withTransaction(async (client) => {
      await lockAutomationAccount(
        client,
        input.accountId
      );
      await lockAutomationProposal(
        client,
        input.accountId,
        input.proposalId
      );

      const runResult = await client.query(
        `SELECT *
         FROM automation_runs
         WHERE account_id = $1
           AND id = $2
           AND proposal_id = $3
         FOR UPDATE`,
        [
          input.accountId,
          input.runId,
          input.proposalId,
        ]
      );

      if (!runResult.rowCount) {
        throw new Error(
          'AUTOMATION_EXECUTION_CLAIM_MISSING: durable Automation run claim was not found.'
        );
      }

      const currentRun =
        automationRunFromRow(
          runResult.rows[0]
        );

      if (
        currentRun.status ===
          'SUCCEEDED' &&
        currentRun.executionId
      ) {
        const action =
          await commitConfirmedActionWithClient(
            client,
            input.action
          );

        if (
          action.execution.id !==
          currentRun.executionId
        ) {
          throw new Error(
            'AUTOMATION_EXECUTION_REPLAY_MISMATCH: successful Automation run points to a different Action execution.'
          );
        }

        return {
          run: currentRun,
          action,
          idempotentReplay: true,
        };
      }

      if (
        currentRun.status !== 'RUNNING'
      ) {
        throw new Error(
          'AUTOMATION_EXECUTION_CLAIM_NOT_RUNNING: Automation run is not eligible to commit an Action.'
        );
      }

      const policyResult =
        await client.query(
          `SELECT *
           FROM automation_policies
           WHERE account_id = $1
           FOR UPDATE`,
          [input.accountId]
        );
      if (!policyResult.rowCount) {
        throw new Error(
          'AUTOMATION_POLICY_CHANGED: active Automation policy disappeared before execution commit.'
        );
      }

      const policy =
        policyFromRow(
          policyResult.rows[0]
        );

      if (
        policy.id !==
          input.expectedPolicyId ||
        policy.version !==
          input.expectedPolicyVersion ||
        !policy.enabled ||
        policy.mode !==
          'AUTO_EXECUTE_LOW_RISK'
      ) {
        throw new Error(
          'AUTOMATION_POLICY_CHANGED: policy identity/version/mode changed before execution commit.'
        );
      }

      const controlResult =
        await client.query(
          `SELECT *
           FROM automation_controls
           WHERE account_id = $1
           FOR UPDATE`,
          [input.accountId]
        );
      const control =
        controlResult.rowCount
          ? controlFromRow(
              controlResult.rows[0]
            )
          : {
              accountId:
                input.accountId,
              version: 0,
              emergencyDisabled: false,
              updatedAt: 0,
              updatedBy:
                'system:default',
            };

      if (
        control.version !==
          input.expectedControlVersion ||
        control.emergencyDisabled
      ) {
        throw new Error(
          control.emergencyDisabled
            ? 'AUTOMATION_KILL_SWITCH_ACTIVE: emergency automation stop became active before execution commit.'
            : 'AUTOMATION_CONTROL_CHANGED: automation control version changed before execution commit.'
        );
      }

      if (
        currentRun.policyId !==
          policy.id ||
        currentRun.policyVersion !==
          policy.version
      ) {
        throw new Error(
          'AUTOMATION_EXECUTION_CLAIM_POLICY_MISMATCH: durable run claim does not match the locked policy revision.'
        );
      }

      if (
        input.action.accountId !==
          input.accountId ||
        input.action.proposalId !==
          input.proposalId ||
        input.action.execution
          .executionMode !==
          'AUTOMATION_POLICY' ||
        input.action.execution
          .automationPolicyId !==
          policy.id ||
        input.action.execution
          .automationPolicyVersion !==
          policy.version
      ) {
        throw new Error(
          'AUTOMATION_ACTION_AUTHORIZATION_MISMATCH: prepared Action does not match the locked Automation policy.'
        );
      }

      const action =
        await commitConfirmedActionWithClient(
          client,
          input.action
        );

      if (
        action.execution.executionMode !==
          'AUTOMATION_POLICY' ||
        action.execution.automationPolicyId !==
          policy.id ||
        action.execution
          .automationPolicyVersion !==
          policy.version
      ) {
        throw new Error(
          'AUTOMATION_ALREADY_EXECUTED_DIFFERENT_MODE: governed proposal was committed through a different execution mode or policy.'
        );
      }

      const completedRun: AutomationRun = {
        ...currentRun,
        status: 'SUCCEEDED',
        attemptCount:
          input.attemptCount,
        executionId:
          action.execution.id,
        failureCategory: undefined,
        retryable: false,
        lastError: undefined,
        updatedAt:
          input.completedAt,
        completedAt:
          input.completedAt,
      };

      await saveRunWith(
        client,
        completedRun
      );

      return {
        run: completedRun,
        action,
        idempotentReplay:
          action.idempotentReplay,
      };
    });
  }
}

export class PostgresPlatformStateRepository
  implements PlatformStateRepository
{
  async getDomainPackInstallation(
    accountId: string,
    installationId: string
  ) {
    const result = await postgresPool().query(
      `SELECT * FROM platform_domain_pack_installations
       WHERE account_id = $1 AND id = $2`,
      [accountId, installationId]
    );
    return result.rowCount ? domainPackFromRow(result.rows[0]) : null;
  }

  async listDomainPackInstallations(accountId: string) {
    const result = await postgresPool().query(
      `SELECT * FROM platform_domain_pack_installations
       WHERE account_id = $1
       ORDER BY updated_at DESC`,
      [accountId]
    );
    return result.rows.map(domainPackFromRow);
  }

  async saveDomainPackInstallation(
    installation: DomainPackInstallation
  ) {
    await saveDomainPackWith(postgresPool(), installation);
  }

  async getToolInvocation(
    accountId: string,
    invocationId: string
  ) {
    const result = await postgresPool().query(
      `SELECT * FROM platform_tool_invocation_audit
       WHERE account_id = $1 AND id = $2`,
      [accountId, invocationId]
    );
    return result.rowCount
      ? toolInvocationFromRow(result.rows[0])
      : null;
  }

  async listToolInvocations(params: {
    accountId: string;
    toolId?: string;
    limit?: number;
  }) {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];
    if (params.toolId) {
      values.push(params.toolId);
      clauses.push('tool_id = $' + values.length);
    }
    values.push(Math.max(1, Math.min(params.limit || 100, 1000)));
    const result = await postgresPool().query(
      `SELECT * FROM platform_tool_invocation_audit
       WHERE ${clauses.join(' AND ')}
       ORDER BY started_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(toolInvocationFromRow);
  }

  async saveToolInvocation(record: ToolInvocationAudit) {
    await saveToolInvocationWith(postgresPool(), record);
  }
}

export const postgresAutomationRepository =
  new PostgresAutomationRepository();

export const postgresAutomationGovernanceTransactionRepository =
  new PostgresAutomationGovernanceTransactionRepository();

export const postgresAutomationExecutionTransactionRepository =
  new PostgresAutomationExecutionTransactionRepository();

export const postgresPlatformStateRepository =
  new PostgresPlatformStateRepository();
