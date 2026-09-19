import { actionStore } from '../actions/actionStore.js';
import type { RequestIdentity } from '../requestIdentity.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import { automationApprovalStore } from './automationApprovalStore.js';
import { automationPolicyEvaluator } from './automationPolicyEvaluator.js';
import { automationPolicyStore } from './automationPolicyStore.js';
import type {
  AutomationActorRole,
  AutomationApprovalRequest,
} from './types.js';

const DEFAULT_APPROVAL_ROLES: AutomationActorRole[] = [
  'OWNER',
  'ADMIN',
  'APPROVER',
];

export class AutomationApprovalError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'AUTOMATION_APPROVAL_NOT_REQUIRED'
    | 'AUTOMATION_APPROVER_ROLE_NOT_ALLOWED'
    | 'AUTOMATION_APPROVAL_NOT_PENDING'
    | 'AUTOMATION_APPROVAL_EXPIRED'
    | 'AUTOMATION_PROPOSAL_NOT_READY';

  constructor(
    code:
      | 'AUTOMATION_APPROVAL_NOT_REQUIRED'
      | 'AUTOMATION_APPROVER_ROLE_NOT_ALLOWED'
      | 'AUTOMATION_APPROVAL_NOT_PENDING'
      | 'AUTOMATION_APPROVAL_EXPIRED'
      | 'AUTOMATION_PROPOSAL_NOT_READY',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AutomationApprovalError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class AutomationApprovalService {
  public request(params: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
  }): AutomationApprovalRequest {
    const proposal = actionStore.requireProposal(
      params.accountId,
      params.proposalId
    );

    const evaluation = automationPolicyEvaluator.evaluate({
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

    const policy = automationPolicyStore.getPolicy(params.accountId);
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

    return automationApprovalStore.ensureRequest({
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

  public approve(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
    now?: number;
  }): AutomationApprovalRequest {
    return this.resolve({
      ...params,
      status: 'APPROVED',
    });
  }

  public reject(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
    now?: number;
  }): AutomationApprovalRequest {
    return this.resolve({
      ...params,
      status: 'REJECTED',
    });
  }

  private resolve(params: {
    accountId: string;
    approvalId: string;
    identity: RequestIdentity;
    note?: string;
    now?: number;
    status: 'APPROVED' | 'REJECTED';
  }): AutomationApprovalRequest {
    const approval = automationApprovalStore.require(
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
      automationApprovalStore.resolve({
        accountId: params.accountId,
        approvalId: approval.id,
        status: 'REJECTED',
        resolvedBy: 'system:expiry',
        resolvedByRole: 'SERVICE',
        resolutionNote: 'Approval request expired with the action proposal.',
        now,
      });
      throw new AutomationApprovalError(
        'AUTOMATION_APPROVAL_EXPIRED',
        409,
        'Automation approval expired with the underlying action proposal.'
      );
    }

    const proposal = actionStore.requireProposal(
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

    return automationApprovalStore.resolve({
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

export const automationApprovalService =
  new AutomationApprovalService();
