import type {
  ConfirmedActionTransactionInput,
  ConfirmedActionTransactionResult,
} from './a3Types.js';
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

export interface AutomationRepository {
  getPolicy(accountId: string): Promise<AutomationPolicy | null>;
  savePolicy(policy: AutomationPolicy): Promise<void>;
  getPolicyRevision(
    accountId: string,
    revisionId: string
  ): Promise<AutomationPolicyRevision | null>;
  listPolicyRevisions(params: {
    accountId: string;
    policyId?: string;
    limit?: number;
  }): Promise<AutomationPolicyRevision[]>;
  savePolicyRevision(revision: AutomationPolicyRevision): Promise<void>;

  getApproval(
    accountId: string,
    approvalId: string
  ): Promise<AutomationApprovalRequest | null>;
  listApprovals(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationApprovalRequest['status'];
    limit?: number;
  }): Promise<AutomationApprovalRequest[]>;
  saveApproval(approval: AutomationApprovalRequest): Promise<void>;

  getControl(accountId: string): Promise<AutomationControlState | null>;
  saveControl(control: AutomationControlState): Promise<void>;
  getControlRevision(
    accountId: string,
    revisionId: string
  ): Promise<AutomationControlRevision | null>;
  listControlRevisions(params: {
    accountId: string;
    limit?: number;
  }): Promise<AutomationControlRevision[]>;
  saveControlRevision(revision: AutomationControlRevision): Promise<void>;

  getRun(accountId: string, runId: string): Promise<AutomationRun | null>;
  listRuns(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationRun['status'];
    limit?: number;
  }): Promise<AutomationRun[]>;
  saveRun(run: AutomationRun): Promise<void>;
}

export interface AutomationPolicyCommitInput {
  policy: AutomationPolicy;
  revision: AutomationPolicyRevision;
  expectedPreviousVersion: number;
}

export interface AutomationControlCommitInput {
  control: AutomationControlState;
  revision: AutomationControlRevision;
  expectedPreviousVersion: number;
}

export interface AutomationGovernanceTransactionRepository {
  commitPolicyRevision(
    input: AutomationPolicyCommitInput
  ): Promise<AutomationPolicy>;
  commitControlRevision(
    input: AutomationControlCommitInput
  ): Promise<AutomationControlState>;
}

export interface AutomationExecutionClaimInput {
  accountId: string;
  proposalId: string;
  actor: string;
  actorRole: AutomationRun['actorRole'];
  policyId: string;
  policyVersion: number;
  maxAttempts: number;
  now: number;
}

export interface AutomationExecutionCommitInput {
  accountId: string;
  proposalId: string;
  runId: string;
  expectedPolicyId: string;
  expectedPolicyVersion: number;
  expectedControlVersion: number;
  attemptCount: number;
  completedAt: number;
  action: ConfirmedActionTransactionInput;
}

export interface AutomationExecutionCommitResult {
  run: AutomationRun;
  action: ConfirmedActionTransactionResult;
  idempotentReplay: boolean;
}

export interface AutomationExecutionTransactionRepository {
  claimPolicyExecution(
    input: AutomationExecutionClaimInput
  ): Promise<AutomationRun>;

  commitPolicyExecution(
    input: AutomationExecutionCommitInput
  ): Promise<AutomationExecutionCommitResult>;
}

export interface PlatformStateRepository {
  getDomainPackInstallation(
    accountId: string,
    installationId: string
  ): Promise<DomainPackInstallation | null>;
  listDomainPackInstallations(
    accountId: string
  ): Promise<DomainPackInstallation[]>;
  saveDomainPackInstallation(
    installation: DomainPackInstallation
  ): Promise<void>;

  getToolInvocation(
    accountId: string,
    invocationId: string
  ): Promise<ToolInvocationAudit | null>;
  listToolInvocations(params: {
    accountId: string;
    toolId?: string;
    limit?: number;
  }): Promise<ToolInvocationAudit[]>;
  saveToolInvocation(record: ToolInvocationAudit): Promise<void>;
}
