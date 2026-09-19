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
  | 'AUTOMATION_KILL_SWITCH_ACTIVE'
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


export interface AutomationControlState {
  accountId: string;
  version: number;
  emergencyDisabled: boolean;
  reason?: string;
  updatedAt: number;
  updatedBy: string;
}

export interface AutomationControlRevision {
  id: string;
  accountId: string;
  version: number;
  snapshot: AutomationControlState;
  changedAt: number;
  changedBy: string;
}

export type AutomationRunStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'BLOCKED'
  | 'FAILED'
  | 'COMPENSATED'
  | 'RECOVERY_REQUIRED';

export type AutomationFailureCategory =
  | 'POLICY'
  | 'KILL_SWITCH'
  | 'STALE_STATE'
  | 'VALIDATION'
  | 'TECHNICAL'
  | 'UNSUPPORTED';

export type AutomationRunFeedback =
  | 'CORRECT'
  | 'FALSE_TRIGGER'
  | 'NEEDS_CORRECTION';

export interface AutomationRun {
  id: string;
  accountId: string;
  proposalId: string;
  status: AutomationRunStatus;
  attemptCount: number;
  maxAttempts: number;
  actor: string;
  actorRole: AutomationActorRole;
  policyId?: string;
  policyVersion?: number;
  executionId?: string;
  failureCategory?: AutomationFailureCategory;
  retryable?: boolean;
  lastError?: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  compensationProposalId?: string;
  compensationExecutionId?: string;
  feedback?: AutomationRunFeedback;
  feedbackAt?: number;
  feedbackBy?: string;
  feedbackNote?: string;
}

export interface AutomationQualitySummary {
  accountId: string;
  generatedAt: number;
  population: {
    automationRuns: number;
    approvalRequests: number;
    feedbackRatedRuns: number;
  };
  executions: {
    attempted: number;
    successful: number;
    failed: number;
    successRate: number | null;
    failureRate: number | null;
  };
  governance: {
    blockedRuns: number;
    policyDenials: number;
    approvalEscalations: number;
    approvalEscalationRate: number | null;
    approvalsGranted: number;
    approvalsRejected: number;
    approvalsPending: number;
  };
  recovery: {
    compensatedRuns: number;
    compensationRate: number | null;
    recoveryRequiredRuns: number;
    technicalFailures: number;
    staleStateFailures: number;
  };
  feedback: {
    correct: number;
    falseTriggers: number;
    needsCorrection: number;
    falseTriggerRate: number | null;
    humanCorrectionSignals: number;
  };
  timeSaved: {
    estimatedMinutes: null;
    reason: string;
  };
}
