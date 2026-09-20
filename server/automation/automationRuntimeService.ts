import type { ActionIntent } from '../actions/types.js';
import { actionPersistence } from '../actions/actionPersistence.js';
import type { RequestIdentity } from '../requestIdentity.js';
import { automationApprovalRuntimeService } from './automationApprovalRuntimeService.js';
import { automationControlRuntimeService } from './automationControlRuntimeService.js';
import { automationExecutionRuntimeService } from './automationExecutionRuntimeService.js';
import { automationPersistence } from './automationPersistence.js';
import { automationPolicyRuntimeEvaluator } from './automationPolicyRuntimeEvaluator.js';
import { automationQualityRuntimeService } from './automationQualityRuntimeService.js';
import type {
  AutomationActorRole,
  AutomationApprovalRequest,
  AutomationControlState,
  AutomationPolicy,
  AutomationPolicyMode,
  AutomationRiskClass,
  AutomationRun,
  AutomationRunFeedback,
} from './types.js';

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

export class AutomationRuntimeService {
  public usesPostgres(): boolean {
    return automationPersistence.usesPostgres();
  }

  public async getPolicy(accountId: string) {
    return automationPersistence.getPolicy(accountId);
  }

  public async upsertPolicy(params: {
    accountId: string;
    actor: string;
    policy: PolicyInput;
  }) {
    return automationPersistence.upsertPolicy(params);
  }

  public async listPolicyHistory(params: {
    accountId: string;
    limit?: number;
  }) {
    return automationPersistence.listPolicyHistory(params);
  }

  public async getControl(accountId: string) {
    return automationControlRuntimeService.get(accountId);
  }

  public async listControlHistory(params: {
    accountId: string;
    limit?: number;
  }) {
    return automationPersistence.listControlHistory(params);
  }

  public async disableControl(params: {
    accountId: string;
    identity: RequestIdentity;
    reason?: string;
  }): Promise<AutomationControlState> {
    return automationControlRuntimeService.disable(params);
  }

  public async enableControl(params: {
    accountId: string;
    identity: RequestIdentity;
    reason?: string;
  }): Promise<AutomationControlState> {
    return automationControlRuntimeService.enable(params);
  }

  public async listRuns(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationRun['status'];
    limit?: number;
  }) {
    return automationPersistence.listRuns(params);
  }

  public async requireRun(
    accountId: string,
    runId: string
  ) {
    return automationPersistence.requireRun(accountId, runId);
  }

  public async listApprovals(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationApprovalRequest['status'];
    limit?: number;
  }) {
    return automationPersistence.listApprovals(params);
  }

  public async requestApproval(params: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
  }) {
    return automationApprovalRuntimeService.request(params);
  }

  public async approve(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
  }) {
    return automationApprovalRuntimeService.approve(params);
  }

  public async reject(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
  }) {
    return automationApprovalRuntimeService.reject(params);
  }

  public async evaluate(params: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
  }) {
    const proposal = await actionPersistence.requireProposal(
      params.accountId,
      params.proposalId
    );
    return automationPolicyRuntimeEvaluator.evaluate({
      accountId: params.accountId,
      proposal,
      identity: params.identity,
    });
  }

  public async execute(params: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
  }) {
    return automationExecutionRuntimeService.executeEligible(
      params
    );
  }

  public async compensate(params: {
    accountId: string;
    runId: string;
    identity: RequestIdentity;
  }) {
    return automationExecutionRuntimeService.compensate(params);
  }

  public async quality(accountId: string) {
    return automationQualityRuntimeService.summary(accountId);
  }

  public async dashboard(accountId: string) {
    return automationQualityRuntimeService.dashboard(accountId);
  }

  public async setFeedback(params: {
    accountId: string;
    runId: string;
    feedback: AutomationRunFeedback;
    identity: RequestIdentity;
    note?: string;
  }) {
    return automationQualityRuntimeService.setFeedback(params);
  }
}

export const automationRuntimeService =
  new AutomationRuntimeService();

export type {
  ActionIntent,
  AutomationActorRole,
  AutomationPolicyMode,
  AutomationRiskClass,
};
