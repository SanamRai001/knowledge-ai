import { actionPersistence } from '../actions/actionPersistence.js';
import type { RequestIdentity } from '../requestIdentity.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import {
  AutomationApprovalError,
  automationApprovalService,
} from './automationApprovalService.js';
import { automationPersistence } from './automationPersistence.js';
import { automationPolicyRuntimeEvaluator } from './automationPolicyRuntimeEvaluator.js';
import type {
  AutomationActorRole,
  AutomationApprovalRequest,
} from './types.js';

const DEFAULT_APPROVAL_ROLES: AutomationActorRole[] = [
  'OWNER',
  'ADMIN',
  'APPROVER',
];

export class AutomationApprovalRuntimeService {
  public async request(params: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
  }): Promise<AutomationApprovalRequest> {
    if (!automationPersistence.usesPostgres()) {
      return automationApprovalService.request(params);
    }

    const proposal = await actionPersistence.requireProposal(
      params.accountId,
      params.proposalId
    );

    const evaluation =
      await automationPolicyRuntimeEvaluator.evaluate({
        accountId: params.accountId,
        proposal,
        identity: params.identity,
      });

    if (evaluation.decision !== 'REQUIRE_APPROVAL') {
      throw new AutomationApprovalError(
        'AUTOMATION_APPROVAL_NOT_REQUIRED',
        409,
        'Current automation policy does not require an approval escalation for this proposal.'
      );
    }

    const policy = await automationPersistence.getPolicy(
      params.accountId
    );
    if (!policy || !evaluation.policyId || !evaluation.policyVersion) {
      throw new AutomationApprovalError(
        'AUTOMATION_APPROVAL_NOT_REQUIRED',
        409,
        'Approval escalation requires an active versioned automation policy.'
      );
    }

    const eligibleRoles =
      policy.approvalRoles && policy.approvalRoles.length > 0
        ? policy.approvalRoles
        : DEFAULT_APPROVAL_ROLES;

    return automationPersistence.ensureApprovalRequest({
      accountId: params.accountId,
      proposalId: proposal.id,
      policyId: policy.id,
      policyVersion: policy.version,
      requestedBy: automationActorLabel(params.identity),
      requestedByRole: resolveAutomationActorRole(params.identity),
      eligibleRoles,
      decisionReasonCodes: evaluation.reasonCodes,
      decisionReasons: evaluation.reasons,
      expiresAt: proposal.expiresAt,
    });
  }

  public async approve(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
    now?: number;
  }): Promise<AutomationApprovalRequest> {
    if (!automationPersistence.usesPostgres()) {
      return automationApprovalService.approve(params);
    }
    return this.resolve({ ...params, status: 'APPROVED' });
  }

  public async reject(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
    now?: number;
  }): Promise<AutomationApprovalRequest> {
    if (!automationPersistence.usesPostgres()) {
      return automationApprovalService.reject(params);
    }
    return this.resolve({ ...params, status: 'REJECTED' });
  }

  private async resolve(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
    now?: number;
    status: 'APPROVED' | 'REJECTED';
  }): Promise<AutomationApprovalRequest> {
    const approval = await automationPersistence.requireApproval(
      params.accountId,
      params.approvalId
    );

    if (approval.status !== 'PENDING') {
      throw new AutomationApprovalError(
        'AUTOMATION_APPROVAL_NOT_PENDING',
        409,
        'This automation approval request is already ' +
          approval.status.toLowerCase() +
          '.'
      );
    }

    const now = params.now ?? Date.now();
    if (approval.expiresAt <= now) {
      await automationPersistence.resolveApproval({
        accountId: params.accountId,
        approvalId: approval.id,
        status: 'REJECTED',
        resolvedBy: 'system:expiry',
        resolvedByRole: 'SERVICE',
        resolutionNote:
          'Approval request expired with the action proposal.',
        now,
      });
      throw new AutomationApprovalError(
        'AUTOMATION_APPROVAL_EXPIRED',
        409,
        'Automation approval expired with the underlying action proposal.'
      );
    }

    const proposal = await actionPersistence.requireProposal(
      params.accountId,
      approval.proposalId
    );
    if (proposal.status !== 'PROPOSED') {
      throw new AutomationApprovalError(
        'AUTOMATION_PROPOSAL_NOT_READY',
        409,
        'The underlying action proposal is no longer pending and cannot be approved.'
      );
    }

    const actorRole = resolveAutomationActorRole(params.identity);
    if (!approval.eligibleRoles.includes(actorRole)) {
      throw new AutomationApprovalError(
        'AUTOMATION_APPROVER_ROLE_NOT_ALLOWED',
        403,
        'The current actor role is not eligible to resolve this automation approval.'
      );
    }

    return automationPersistence.resolveApproval({
      accountId: params.accountId,
      approvalId: approval.id,
      status: params.status,
      resolvedBy: automationActorLabel(params.identity),
      resolvedByRole: actorRole,
      resolutionNote: params.note?.trim() || undefined,
      now,
    });
  }
}

export const automationApprovalRuntimeService =
  new AutomationApprovalRuntimeService();
