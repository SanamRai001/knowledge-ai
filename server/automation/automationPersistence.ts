import crypto from 'crypto';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import {
  postgresAutomationGovernanceTransactionRepository,
  postgresAutomationRepository,
} from '../persistence/a5PostgresRepositories.js';
import { postgresAccountRepository } from '../persistence/postgresRepositories.js';
import { automationPolicyStore } from './automationPolicyStore.js';
import {
  AutomationApprovalAccessError,
  automationApprovalStore,
} from './automationApprovalStore.js';
import { automationControlStore } from './automationControlStore.js';
import {
  AutomationRunAccessError,
  automationRunStore,
} from './automationRunStore.js';
import type {
  AutomationActorRole,
  AutomationApprovalRequest,
  AutomationControlRevision,
  AutomationControlState,
  AutomationPolicy,
  AutomationPolicyRevision,
  AutomationRun,
  AutomationRunFeedback,
} from './types.js';

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

type PolicyInput = Omit<
  AutomationPolicy,
  | 'id'
  | 'accountId'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
  | 'createdBy'
  | 'updatedBy'
>;

export class AutomationPersistence {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  public async getPolicy(
    accountId: string
  ): Promise<AutomationPolicy | null> {
    if (!this.usesPostgres()) {
      return automationPolicyStore.getPolicy(accountId);
    }
    return postgresAutomationRepository.getPolicy(accountId);
  }

  public async upsertPolicy(params: {
    accountId: string;
    actor: string;
    policy: PolicyInput;
  }): Promise<AutomationPolicy> {
    if (!this.usesPostgres()) {
      return automationPolicyStore.upsertPolicy(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);
    const current = await postgresAutomationRepository.getPolicy(
      params.accountId
    );
    const now = Date.now();

    const next: AutomationPolicy = current
      ? {
          ...clone(params.policy),
          id: current.id,
          accountId: current.accountId,
          version: current.version + 1,
          createdAt: current.createdAt,
          updatedAt: now,
          createdBy: current.createdBy,
          updatedBy: params.actor,
        }
      : {
          ...clone(params.policy),
          id: id('autopol'),
          accountId: params.accountId,
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: params.actor,
          updatedBy: params.actor,
        };

    const revision: AutomationPolicyRevision = {
      id: id('autopolrev'),
      accountId: params.accountId,
      policyId: next.id,
      version: next.version,
      snapshot: clone(next),
      changedAt: now,
      changedBy: params.actor,
      reason: current ? 'UPDATED' : 'CREATED',
    };

    return postgresAutomationGovernanceTransactionRepository.commitPolicyRevision({
      policy: next,
      revision,
      expectedPreviousVersion: current?.version || 0,
    });
  }

  public async listPolicyHistory(params: {
    accountId: string;
    limit?: number;
  }): Promise<AutomationPolicyRevision[]> {
    if (!this.usesPostgres()) {
      return automationPolicyStore.listHistory(params);
    }
    const current = await postgresAutomationRepository.getPolicy(
      params.accountId
    );
    return postgresAutomationRepository.listPolicyRevisions({
      accountId: params.accountId,
      policyId: current?.id,
      limit: params.limit,
    });
  }

  public async getApproval(
    accountId: string,
    approvalId: string
  ): Promise<AutomationApprovalRequest | null> {
    if (!this.usesPostgres()) {
      return automationApprovalStore.get(accountId, approvalId);
    }
    return postgresAutomationRepository.getApproval(
      accountId,
      approvalId
    );
  }

  public async requireApproval(
    accountId: string,
    approvalId: string
  ): Promise<AutomationApprovalRequest> {
    const approval = await this.getApproval(accountId, approvalId);
    if (!approval) throw new AutomationApprovalAccessError();
    return approval;
  }

  public async listApprovals(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationApprovalRequest['status'];
    limit?: number;
  }): Promise<AutomationApprovalRequest[]> {
    if (!this.usesPostgres()) {
      return automationApprovalStore.list(params);
    }
    return postgresAutomationRepository.listApprovals(params);
  }

  public async listAllApprovals(
    accountId: string
  ): Promise<AutomationApprovalRequest[]> {
    if (!this.usesPostgres()) {
      return automationApprovalStore.listAll(accountId);
    }
    return postgresAutomationRepository.listApprovals({
      accountId,
      limit: 1000,
    });
  }

  public async ensureApprovalRequest(params: {
    accountId: string;
    proposalId: string;
    policyId: string;
    policyVersion: number;
    requestedBy: string;
    requestedByRole: AutomationActorRole;
    eligibleRoles: AutomationActorRole[];
    decisionReasonCodes: AutomationApprovalRequest['decisionReasonCodes'];
    decisionReasons: string[];
    expiresAt: number;
  }): Promise<AutomationApprovalRequest> {
    if (!this.usesPostgres()) {
      return automationApprovalStore.ensureRequest(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);
    const existing = (
      await postgresAutomationRepository.listApprovals({
        accountId: params.accountId,
        proposalId: params.proposalId,
        limit: 100,
      })
    )
      .filter(
        (item) =>
          item.policyId === params.policyId &&
          item.policyVersion === params.policyVersion
      )
      .sort((a, b) => b.requestedAt - a.requestedAt)[0];

    if (existing) return existing;

    const approval: AutomationApprovalRequest = {
      id: id('autoapr'),
      accountId: params.accountId,
      proposalId: params.proposalId,
      policyId: params.policyId,
      policyVersion: params.policyVersion,
      status: 'PENDING',
      requestedBy: params.requestedBy,
      requestedByRole: params.requestedByRole,
      eligibleRoles: clone(params.eligibleRoles),
      decisionReasonCodes: clone(params.decisionReasonCodes),
      decisionReasons: clone(params.decisionReasons),
      requestedAt: Date.now(),
      expiresAt: params.expiresAt,
    };

    await postgresAutomationRepository.saveApproval(approval);
    return approval;
  }

  public async resolveApproval(params: {
    accountId: string;
    approvalId: string;
    status: 'APPROVED' | 'REJECTED';
    resolvedBy: string;
    resolvedByRole: AutomationActorRole;
    resolutionNote?: string;
    now?: number;
  }): Promise<AutomationApprovalRequest> {
    if (!this.usesPostgres()) {
      return automationApprovalStore.resolve(params);
    }

    const current = await this.requireApproval(
      params.accountId,
      params.approvalId
    );
    if (current.status !== 'PENDING') return current;

    const now = params.now ?? Date.now();
    const updated: AutomationApprovalRequest = {
      ...current,
      status:
        current.expiresAt <= now ? 'EXPIRED' : params.status,
      resolvedAt: now,
      resolvedBy: params.resolvedBy,
      resolvedByRole: params.resolvedByRole,
      resolutionNote: params.resolutionNote,
    };
    await postgresAutomationRepository.saveApproval(updated);
    return updated;
  }

  public async getControl(
    accountId: string
  ): Promise<AutomationControlState> {
    if (!this.usesPostgres()) {
      return automationControlStore.get(accountId);
    }

    const existing =
      await postgresAutomationRepository.getControl(accountId);
    return (
      existing || {
        accountId,
        version: 0,
        emergencyDisabled: false,
        updatedAt: 0,
        updatedBy: 'system:default',
      }
    );
  }

  public async setControl(params: {
    accountId: string;
    emergencyDisabled: boolean;
    actor: string;
    reason?: string;
  }): Promise<AutomationControlState> {
    if (!this.usesPostgres()) {
      return automationControlStore.set(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);
    const current = await postgresAutomationRepository.getControl(
      params.accountId
    );
    const now = Date.now();
    const next: AutomationControlState = {
      accountId: params.accountId,
      version: (current?.version || 0) + 1,
      emergencyDisabled: params.emergencyDisabled,
      reason: params.reason?.trim() || undefined,
      updatedAt: now,
      updatedBy: params.actor,
    };
    const revision: AutomationControlRevision = {
      id: id('autoctlrev'),
      accountId: params.accountId,
      version: next.version,
      snapshot: clone(next),
      changedAt: now,
      changedBy: params.actor,
    };

    return postgresAutomationGovernanceTransactionRepository.commitControlRevision({
      control: next,
      revision,
      expectedPreviousVersion: current?.version || 0,
    });
  }

  public async listControlHistory(params: {
    accountId: string;
    limit?: number;
  }): Promise<AutomationControlRevision[]> {
    if (!this.usesPostgres()) {
      return automationControlStore.listHistory(params);
    }
    return postgresAutomationRepository.listControlRevisions(params);
  }

  public async createRun(
    params: Omit<
      AutomationRun,
      'id' | 'startedAt' | 'updatedAt'
    >
  ): Promise<AutomationRun> {
    if (!this.usesPostgres()) {
      return automationRunStore.create(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);
    const now = Date.now();
    const run: AutomationRun = {
      ...clone(params),
      id: id('autorun'),
      startedAt: now,
      updatedAt: now,
    };
    await postgresAutomationRepository.saveRun(run);
    return run;
  }

  public async getRun(
    accountId: string,
    runId: string
  ): Promise<AutomationRun | null> {
    if (!this.usesPostgres()) {
      return automationRunStore.get(accountId, runId);
    }
    return postgresAutomationRepository.getRun(accountId, runId);
  }

  public async requireRun(
    accountId: string,
    runId: string
  ): Promise<AutomationRun> {
    const run = await this.getRun(accountId, runId);
    if (!run) throw new AutomationRunAccessError();
    return run;
  }

  public async updateRun(
    accountId: string,
    runId: string,
    updates: Partial<AutomationRun>
  ): Promise<AutomationRun> {
    if (!this.usesPostgres()) {
      return automationRunStore.update(accountId, runId, updates);
    }

    const current = await this.requireRun(accountId, runId);
    const updated: AutomationRun = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      proposalId: current.proposalId,
      updatedAt: Date.now(),
    };
    await postgresAutomationRepository.saveRun(updated);
    return updated;
  }

  public async setRunFeedback(params: {
    accountId: string;
    runId: string;
    feedback: AutomationRunFeedback;
    actor: string;
    note?: string;
  }): Promise<AutomationRun> {
    return this.updateRun(params.accountId, params.runId, {
      feedback: params.feedback,
      feedbackAt: Date.now(),
      feedbackBy: params.actor,
      feedbackNote: params.note?.trim() || undefined,
    });
  }

  public async listRuns(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationRun['status'];
    limit?: number;
  }): Promise<AutomationRun[]> {
    if (!this.usesPostgres()) {
      return automationRunStore.list(params);
    }
    return postgresAutomationRepository.listRuns(params);
  }

  public async listAllRuns(
    accountId: string
  ): Promise<AutomationRun[]> {
    if (!this.usesPostgres()) {
      return automationRunStore.listAll(accountId);
    }
    return postgresAutomationRepository.listRuns({
      accountId,
      limit: 1000,
    });
  }
}

export const automationPersistence =
  new AutomationPersistence();
