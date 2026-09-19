import type { ActionIntent, ActionProposal } from '../actions/types.js';
import type { RequestIdentity } from '../requestIdentity.js';
import { automationPolicyStore } from './automationPolicyStore.js';
import {
  AutomationEvaluation,
  AutomationEvaluationInput,
  AutomationPolicy,
  AutomationReasonCode,
  AutomationRiskClass,
  AutomationRiskProfile,
} from './types.js';

const RISK_ORDER: Record<AutomationRiskClass, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const RISK_BY_INTENT: Record<ActionIntent, AutomationRiskProfile> = {
  RECEIVE_INVENTORY: {
    intent: 'RECEIVE_INVENTORY',
    riskClass: 'LOW',
    autoExecutable: true,
    reason:
      'Inventory receipt is deterministically validated, idempotent, non-financial, and has a bounded quantity mutation.',
  },
  UPDATE_STATUS: {
    intent: 'UPDATE_STATUS',
    riskClass: 'MEDIUM',
    autoExecutable: false,
    reason:
      'Status changes can materially alter business workflow and require approval in the initial automation phase.',
  },
  RECORD_PAYMENT: {
    intent: 'RECORD_PAYMENT',
    riskClass: 'HIGH',
    autoExecutable: false,
    reason:
      'Payment recording changes financial state and is never eligible for low-risk automatic execution.',
  },
  CREATE_ORDER: {
    intent: 'CREATE_ORDER',
    riskClass: 'HIGH',
    autoExecutable: false,
    reason:
      'Create Order is not an executable Phase 4 action path and cannot be automated.',
  },
};

function actorSourceAllowed(
  policy: AutomationPolicy,
  identity: RequestIdentity
): boolean {
  return policy.allowedIdentitySources.includes(identity.source);
}

function proposalAmount(proposal: ActionProposal): number | undefined {
  const value = proposal.parsedInput.amount;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function proposalQuantity(proposal: ActionProposal): number | undefined {
  const value = proposal.parsedInput.quantity;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function result(params: {
  input: AutomationEvaluationInput;
  risk: AutomationRiskProfile;
  decision: AutomationEvaluation['decision'];
  reasonCodes: AutomationReasonCode[];
  reasons: string[];
  policy?: AutomationPolicy | null;
}): AutomationEvaluation {
  return {
    accountId: params.input.accountId,
    proposalId: params.input.proposal.id,
    intent: params.input.proposal.intent,
    decision: params.decision,
    reasonCodes: params.reasonCodes,
    reasons: params.reasons,
    risk: structuredClone(params.risk),
    policyId: params.policy?.id,
    policyVersion: params.policy?.version,
    evaluatedAt: Date.now(),
  };
}

export class AutomationPolicyEvaluator {
  public riskFor(intent: ActionIntent): AutomationRiskProfile {
    return structuredClone(RISK_BY_INTENT[intent]);
  }

  public evaluate(input: AutomationEvaluationInput): AutomationEvaluation {
    const risk = this.riskFor(input.proposal.intent);
    const policy = automationPolicyStore.getPolicy(input.accountId);

    if (
      input.proposal.accountId !== input.accountId ||
      input.proposal.status !== 'PROPOSED'
    ) {
      return result({
        input,
        risk,
        decision: 'DENY',
        reasonCodes: ['PROPOSAL_NOT_READY'],
        reasons: [
          'Only a current PROPOSED action in the same account scope can be considered for automation.',
        ],
        policy,
      });
    }

    if (!policy) {
      return result({
        input,
        risk,
        decision: 'DENY',
        reasonCodes: ['POLICY_MISSING'],
        reasons: [
          'No automation policy exists. The conservative default is suggestion-only.',
        ],
        policy,
      });
    }

    if (!policy.enabled) {
      return result({
        input,
        risk,
        decision: 'DENY',
        reasonCodes: ['POLICY_DISABLED'],
        reasons: ['Workspace automation is disabled by policy.'],
        policy,
      });
    }

    if (!actorSourceAllowed(policy, input.identity)) {
      return result({
        input,
        risk,
        decision: 'DENY',
        reasonCodes: ['ACTOR_SOURCE_NOT_ALLOWED'],
        reasons: [
          'The current request identity source is not allowed by automation policy.',
        ],
        policy,
      });
    }

    if (!policy.allowedActionIntents.includes(input.proposal.intent)) {
      return result({
        input,
        risk,
        decision: 'DENY',
        reasonCodes: ['ACTION_NOT_ALLOWED'],
        reasons: [
          'This action type is not allowlisted by the workspace automation policy.',
        ],
        policy,
      });
    }

    if (input.proposal.intent === 'CREATE_ORDER') {
      return result({
        input,
        risk,
        decision: 'DENY',
        reasonCodes: ['ACTION_UNSUPPORTED'],
        reasons: [
          'Create Order has no executable Phase 4 action path and cannot be approved or auto-executed by automation policy.',
        ],
        policy,
      });
    }

    if (policy.mode === 'SUGGEST_ONLY') {
      return result({
        input,
        risk,
        decision: 'DENY',
        reasonCodes: ['POLICY_SUGGEST_ONLY'],
        reasons: [
          'Policy is suggestion-only. Automatic or approval-routed execution is not permitted.',
        ],
        policy,
      });
    }

    if (policy.mode === 'REQUIRE_APPROVAL') {
      return result({
        input,
        risk,
        decision: 'REQUIRE_APPROVAL',
        reasonCodes: ['POLICY_REQUIRES_APPROVAL'],
        reasons: ['Policy requires explicit approval for this action.'],
        policy,
      });
    }

    if (!risk.autoExecutable) {
      return result({
        input,
        risk,
        decision: 'REQUIRE_APPROVAL',
        reasonCodes: ['ACTION_NOT_AUTOMATABLE'],
        reasons: [
          risk.reason,
          'The action remains available only through the existing explicit approval path.',
        ],
        policy,
      });
    }

    if (
      RISK_ORDER[risk.riskClass] >
      RISK_ORDER[policy.maxRiskClass]
    ) {
      return result({
        input,
        risk,
        decision: 'REQUIRE_APPROVAL',
        reasonCodes: ['RISK_EXCEEDS_POLICY'],
        reasons: [
          'Action risk exceeds the maximum automatic risk class allowed by policy.',
        ],
        policy,
      });
    }

    const amount = proposalAmount(input.proposal);
    if (
      amount !== undefined &&
      policy.maxAmount !== undefined &&
      amount > policy.maxAmount
    ) {
      return result({
        input,
        risk,
        decision: 'REQUIRE_APPROVAL',
        reasonCodes: ['AMOUNT_EXCEEDS_POLICY'],
        reasons: [
          'Action amount exceeds the maximum automatic amount configured by policy.',
        ],
        policy,
      });
    }

    const quantity = proposalQuantity(input.proposal);
    if (
      quantity !== undefined &&
      policy.maxQuantity !== undefined &&
      quantity > policy.maxQuantity
    ) {
      return result({
        input,
        risk,
        decision: 'REQUIRE_APPROVAL',
        reasonCodes: ['QUANTITY_EXCEEDS_POLICY'],
        reasons: [
          'Action quantity exceeds the maximum automatic quantity configured by policy.',
        ],
        policy,
      });
    }

    return result({
      input,
      risk,
      decision: 'ALLOW_AUTO_EXECUTE',
      reasonCodes: ['LOW_RISK_POLICY_ALLOW'],
      reasons: [
        'The action is in the bounded low-risk allowlist and satisfies all deterministic workspace policy constraints.',
      ],
      policy,
    });
  }
}

export const automationPolicyEvaluator = new AutomationPolicyEvaluator();
