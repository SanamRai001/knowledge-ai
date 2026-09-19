import type { ActionIntent, ActionProposal } from '../actions/types.js';
import type { RequestIdentity } from '../requestIdentity.js';

export type AutomationPolicyMode =
  | 'SUGGEST_ONLY'
  | 'REQUIRE_APPROVAL'
  | 'AUTO_EXECUTE_LOW_RISK';

export type AutomationRiskClass = 'LOW' | 'MEDIUM' | 'HIGH';

export type AutomationDecision =
  | 'DENY'
  | 'REQUIRE_APPROVAL'
  | 'ALLOW_AUTO_EXECUTE';

export type AutomationActorRole =
  | 'OWNER'
  | 'ADMIN'
  | 'APPROVER'
  | 'OPERATOR'
  | 'SERVICE'
  | 'MEMBER';

export type AutomationReasonCode =
  | 'POLICY_MISSING'
  | 'POLICY_DISABLED'
  | 'POLICY_SUGGEST_ONLY'
  | 'POLICY_REQUIRES_APPROVAL'
  | 'ACTION_NOT_ALLOWED'
  | 'ACTION_UNSUPPORTED'
  | 'ACTION_NOT_AUTOMATABLE'
  | 'PROPOSAL_NOT_READY'
  | 'ACTOR_SOURCE_NOT_ALLOWED'
  | 'ACTOR_ROLE_NOT_ALLOWED'
  | 'TARGET_ENTITY_TYPE_NOT_ALLOWED'
  | 'TARGET_ENTITY_NOT_ALLOWED'
  | 'RISK_EXCEEDS_POLICY'
  | 'AMOUNT_EXCEEDS_POLICY'
  | 'QUANTITY_EXCEEDS_POLICY'
  | 'LOW_RISK_POLICY_ALLOW';

export interface AutomationPolicy {
  id: string;
  accountId: string;
  version: number;
  enabled: boolean;
  mode: AutomationPolicyMode;
  allowedActionIntents: ActionIntent[];
  maxRiskClass: AutomationRiskClass;
  maxAmount?: number;
  maxQuantity?: number;
  allowedIdentitySources: RequestIdentity['source'][];
  allowedActorRoles?: AutomationActorRole[];
  approvalRoles?: AutomationActorRole[];
  allowedTargetEntityTypes?: string[];
  allowedTargetEntityIds?: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AutomationPolicyRevision {
  id: string;
  accountId: string;
  policyId: string;
  version: number;
  snapshot: AutomationPolicy;
  changedAt: number;
  changedBy: string;
  reason: 'CREATED' | 'UPDATED';
}

export interface AutomationRiskProfile {
  intent: ActionIntent;
  riskClass: AutomationRiskClass;
  autoExecutable: boolean;
  reason: string;
}

export interface AutomationEvaluation {
  accountId: string;
  proposalId: string;
  intent: ActionIntent;
  decision: AutomationDecision;
  reasonCodes: AutomationReasonCode[];
  reasons: string[];
  risk: AutomationRiskProfile;
  actorRole: AutomationActorRole;
  policyId?: string;
  policyVersion?: number;
  evaluatedAt: number;
}

export interface AutomationEvaluationInput {
  accountId: string;
  proposal: ActionProposal;
  identity: RequestIdentity;
}


export type AutomationApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface AutomationApprovalRequest {
  id: string;
  accountId: string;
  proposalId: string;
  policyId: string;
  policyVersion: number;
  status: AutomationApprovalStatus;
  requestedBy: string;
  requestedByRole: AutomationActorRole;
  eligibleRoles: AutomationActorRole[];
  decisionReasonCodes: AutomationReasonCode[];
  decisionReasons: string[];
  requestedAt: number;
  expiresAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resolvedByRole?: AutomationActorRole;
  resolutionNote?: string;
}
