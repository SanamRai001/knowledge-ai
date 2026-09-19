import { actionExecutionService } from '../actions/actionExecutionService.js';
import { actionStore } from '../actions/actionStore.js';
import type { RequestIdentity } from '../requestIdentity.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import { automationPolicyEvaluator } from './automationPolicyEvaluator.js';
import { automationPolicyStore } from './automationPolicyStore.js';
import type { AutomationEvaluation } from './types.js';

export class AutomationExecutionError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'AUTOMATION_EXECUTION_NOT_ALLOWED'
    | 'AUTOMATION_INTENT_NOT_SUPPORTED'
    | 'AUTOMATION_ALREADY_EXECUTED_DIFFERENT_MODE'
    | 'AUTOMATION_POLICY_CHANGED';

  public readonly evaluation?: AutomationEvaluation;

  constructor(
    code:
      | 'AUTOMATION_EXECUTION_NOT_ALLOWED'
      | 'AUTOMATION_INTENT_NOT_SUPPORTED'
      | 'AUTOMATION_ALREADY_EXECUTED_DIFFERENT_MODE'
      | 'AUTOMATION_POLICY_CHANGED',
    statusCode: number,
    message: string,
    evaluation?: AutomationEvaluation
  ) {
    super(message);
    this.name = 'AutomationExecutionError';
    this.code = code;
    this.statusCode = statusCode;
    this.evaluation = evaluation;
  }
}

export class AutomationExecutionService {
  public executeEligible(params: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
    now?: number;
  }) {
    const existingExecution = actionStore.getExecutionByProposal(
      params.accountId,
      params.proposalId
    );

    if (existingExecution) {
      if (
        existingExecution.executionMode === 'AUTOMATION_POLICY'
      ) {
        return {
          replayed: true,
          evaluation: null,
          proposal: actionStore.requireProposal(
            params.accountId,
            params.proposalId
          ),
          execution: existingExecution,
        };
      }

      throw new AutomationExecutionError(
        'AUTOMATION_ALREADY_EXECUTED_DIFFERENT_MODE',
        409,
        'This action proposal has already been executed through a non-automation path.'
      );
    }

    const proposal = actionStore.requireProposal(
      params.accountId,
      params.proposalId
    );

    // Defense in depth: Phase 7C intentionally exposes exactly one
    // auto-executable action family even if policy configuration is broader.
    if (proposal.intent !== 'RECEIVE_INVENTORY') {
      throw new AutomationExecutionError(
        'AUTOMATION_INTENT_NOT_SUPPORTED',
        409,
        'Phase 7C automatic execution supports RECEIVE_INVENTORY only.'
      );
    }

    const evaluation = automationPolicyEvaluator.evaluate({
      accountId: params.accountId,
      proposal,
      identity: params.identity,
    });

    if (evaluation.decision !== 'ALLOW_AUTO_EXECUTE') {
      throw new AutomationExecutionError(
        'AUTOMATION_EXECUTION_NOT_ALLOWED',
        409,
        'Current deterministic automation policy does not allow this proposal to execute automatically.',
        evaluation
      );
    }

    const policy = automationPolicyStore.getPolicy(params.accountId);
    if (
      !policy ||
      !evaluation.policyId ||
      !evaluation.policyVersion ||
      policy.id !== evaluation.policyId ||
      policy.version !== evaluation.policyVersion ||
      !policy.enabled
    ) {
      throw new AutomationExecutionError(
        'AUTOMATION_POLICY_CHANGED',
        409,
        'Automation policy changed before execution. Re-evaluate the proposal under the current policy.',
        evaluation
      );
    }

    const result = actionExecutionService.confirm({
      accountId: params.accountId,
      proposalId: proposal.id,
      now: params.now,
      authorization: {
        mode: 'AUTOMATION_POLICY',
        actor: automationActorLabel(params.identity),
        actorRole: resolveAutomationActorRole(params.identity),
        automationPolicyId: policy.id,
        automationPolicyVersion: policy.version,
      },
    });

    return {
      replayed: false,
      evaluation,
      ...result,
    };
  }
}

export const automationExecutionService =
  new AutomationExecutionService();
