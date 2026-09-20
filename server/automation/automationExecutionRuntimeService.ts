import { actionPersistence } from '../actions/actionPersistence.js';
import {
  ActionExecutionError,
} from '../actions/actionExecutionService.js';
import { actionRuntimeExecutionService } from '../actions/actionRuntimeExecutionService.js';
import { effectiveCompanyStateRuntimeService } from '../companyKnowledge/effectiveCompanyStateRuntimeService.js';
import type { RequestIdentity } from '../requestIdentity.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import {
  AutomationExecutionError,
  automationExecutionService,
} from './automationExecutionService.js';
import { automationPersistence } from './automationPersistence.js';
import { automationPolicyRuntimeEvaluator } from './automationPolicyRuntimeEvaluator.js';
import type {
  AutomationEvaluation,
  AutomationFailureCategory,
} from './types.js';

const DEFAULT_MAX_ATTEMPTS = 2;
const COMPENSATION_ROLES = ['OWNER', 'ADMIN', 'APPROVER'] as const;

function blockedCategory(
  evaluation: AutomationEvaluation
): AutomationFailureCategory {
  return evaluation.reasonCodes.includes(
    'AUTOMATION_KILL_SWITCH_ACTIVE'
  )
    ? 'KILL_SWITCH'
    : 'POLICY';
}

function executionFailureCategory(
  error: ActionExecutionError
): AutomationFailureCategory {
  return error.code === 'ACTION_STALE' ||
    error.code === 'ACTION_EXPIRED'
    ? 'STALE_STATE'
    : 'VALIDATION';
}

export class AutomationExecutionRuntimeService {
  public async executeEligible(params: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
    now?: number;
    maxAttempts?: number;
  }) {
    if (!automationPersistence.usesPostgres()) {
      return automationExecutionService.executeEligible(params);
    }

    const actor = automationActorLabel(params.identity);
    const actorRole = resolveAutomationActorRole(params.identity);

    const existingExecution =
      await actionPersistence.getExecutionByProposal(
        params.accountId,
        params.proposalId
      );

    if (existingExecution) {
      if (
        existingExecution.executionMode === 'AUTOMATION_POLICY'
      ) {
        const priorRun =
          (
            await automationPersistence.listRuns({
              accountId: params.accountId,
              proposalId: params.proposalId,
              status: 'SUCCEEDED',
              limit: 1,
            })
          )[0] ||
          (await automationPersistence.createRun({
            accountId: params.accountId,
            proposalId: params.proposalId,
            status: 'SUCCEEDED',
            attemptCount: 0,
            maxAttempts: 0,
            actor,
            actorRole,
            policyId: existingExecution.automationPolicyId,
            policyVersion:
              existingExecution.automationPolicyVersion,
            executionId: existingExecution.id,
            completedAt: Date.now(),
          }));

        return {
          replayed: true,
          evaluation: null,
          run: priorRun,
          proposal: await actionPersistence.requireProposal(
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

    const proposal = await actionPersistence.requireProposal(
      params.accountId,
      params.proposalId
    );

    if (proposal.intent !== 'RECEIVE_INVENTORY') {
      const run = await automationPersistence.createRun({
        accountId: params.accountId,
        proposalId: proposal.id,
        status: 'BLOCKED',
        attemptCount: 0,
        maxAttempts: 0,
        actor,
        actorRole,
        failureCategory: 'UNSUPPORTED',
        retryable: false,
        lastError:
          'Automatic execution supports RECEIVE_INVENTORY only.',
        completedAt: Date.now(),
      });

      throw new AutomationExecutionError(
        'AUTOMATION_INTENT_NOT_SUPPORTED',
        409,
        'Phase 7 automatic execution supports RECEIVE_INVENTORY only.',
        { runId: run.id }
      );
    }

    const firstEvaluation =
      await automationPolicyRuntimeEvaluator.evaluate({
        accountId: params.accountId,
        proposal,
        identity: params.identity,
      });

    if (firstEvaluation.decision !== 'ALLOW_AUTO_EXECUTE') {
      const run = await automationPersistence.createRun({
        accountId: params.accountId,
        proposalId: proposal.id,
        status: 'BLOCKED',
        attemptCount: 0,
        maxAttempts: 0,
        actor,
        actorRole,
        policyId: firstEvaluation.policyId,
        policyVersion: firstEvaluation.policyVersion,
        failureCategory: blockedCategory(firstEvaluation),
        retryable: false,
        lastError: firstEvaluation.reasons.join(' '),
        completedAt: Date.now(),
      });

      throw new AutomationExecutionError(
        'AUTOMATION_EXECUTION_NOT_ALLOWED',
        409,
        'Current deterministic automation policy does not allow this proposal to execute automatically.',
        {
          evaluation: firstEvaluation,
          runId: run.id,
        }
      );
    }

    const maxAttempts = Math.max(
      1,
      Math.min(
        params.maxAttempts || DEFAULT_MAX_ATTEMPTS,
        3
      )
    );

    let run = await automationPersistence.createRun({
      accountId: params.accountId,
      proposalId: proposal.id,
      status: 'RUNNING',
      attemptCount: 0,
      maxAttempts,
      actor,
      actorRole,
      policyId: firstEvaluation.policyId,
      policyVersion: firstEvaluation.policyVersion,
    });

    for (
      let attemptCount = 1;
      attemptCount <= maxAttempts;
      attemptCount += 1
    ) {
      const currentProposal =
        await actionPersistence.requireProposal(
          params.accountId,
          proposal.id
        );
      const evaluation =
        await automationPolicyRuntimeEvaluator.evaluate({
          accountId: params.accountId,
          proposal: currentProposal,
          identity: params.identity,
        });

      if (evaluation.decision !== 'ALLOW_AUTO_EXECUTE') {
        run = await automationPersistence.updateRun(
          params.accountId,
          run.id,
          {
            status: 'BLOCKED',
            attemptCount: attemptCount - 1,
            failureCategory: blockedCategory(evaluation),
            retryable: false,
            lastError: evaluation.reasons.join(' '),
            completedAt: Date.now(),
          }
        );

        throw new AutomationExecutionError(
          'AUTOMATION_EXECUTION_NOT_ALLOWED',
          409,
          'Automation permission changed before execution.',
          { evaluation, runId: run.id }
        );
      }

      const [policy, control] = await Promise.all([
        automationPersistence.getPolicy(params.accountId),
        automationPersistence.getControl(params.accountId),
      ]);

      if (
        !policy ||
        !evaluation.policyId ||
        !evaluation.policyVersion ||
        policy.id !== evaluation.policyId ||
        policy.version !== evaluation.policyVersion ||
        !policy.enabled
      ) {
        run = await automationPersistence.updateRun(
          params.accountId,
          run.id,
          {
            status: 'BLOCKED',
            attemptCount: attemptCount - 1,
            failureCategory: 'POLICY',
            retryable: false,
            lastError:
              'Automation policy changed before execution.',
            completedAt: Date.now(),
          }
        );

        throw new AutomationExecutionError(
          'AUTOMATION_POLICY_CHANGED',
          409,
          'Automation policy changed before execution. Re-evaluate the proposal under the current policy.',
          { evaluation, runId: run.id }
        );
      }

      if (control.emergencyDisabled) {
        run = await automationPersistence.updateRun(
          params.accountId,
          run.id,
          {
            status: 'BLOCKED',
            attemptCount: attemptCount - 1,
            failureCategory: 'KILL_SWITCH',
            retryable: false,
            lastError:
              control.reason ||
              'Workspace emergency automation stop is active.',
            completedAt: Date.now(),
          }
        );

        throw new AutomationExecutionError(
          'AUTOMATION_EXECUTION_NOT_ALLOWED',
          409,
          'Workspace emergency automation stop is active.',
          { evaluation, runId: run.id }
        );
      }

      run = await automationPersistence.updateRun(
        params.accountId,
        run.id,
        {
          status: 'RUNNING',
          attemptCount,
          policyId: policy.id,
          policyVersion: policy.version,
          retryable: undefined,
          failureCategory: undefined,
          lastError: undefined,
        }
      );

      try {
        const result =
          await actionRuntimeExecutionService.confirm({
            accountId: params.accountId,
            proposalId: proposal.id,
            now: params.now,
            authorization: {
              mode: 'AUTOMATION_POLICY',
              actor,
              actorRole,
              automationPolicyId: policy.id,
              automationPolicyVersion: policy.version,
            },
          });

        run = await automationPersistence.updateRun(
          params.accountId,
          run.id,
          {
            status: 'SUCCEEDED',
            executionId: result.execution.id,
            retryable: false,
            completedAt: Date.now(),
          }
        );

        return {
          replayed: false,
          evaluation,
          run,
          ...result,
        };
      } catch (error: any) {
        if (error instanceof ActionExecutionError) {
          run = await automationPersistence.updateRun(
            params.accountId,
            run.id,
            {
              status: 'FAILED',
              attemptCount,
              failureCategory:
                executionFailureCategory(error),
              retryable: false,
              lastError: error.message,
              completedAt: Date.now(),
            }
          );
          throw error;
        }

        if (attemptCount < maxAttempts) {
          run = await automationPersistence.updateRun(
            params.accountId,
            run.id,
            {
              status: 'RUNNING',
              attemptCount,
              failureCategory: 'TECHNICAL',
              retryable: true,
              lastError:
                error?.message ||
                'Unexpected automatic execution failure.',
            }
          );
          continue;
        }

        run = await automationPersistence.updateRun(
          params.accountId,
          run.id,
          {
            status: 'FAILED',
            attemptCount,
            failureCategory: 'TECHNICAL',
            retryable: false,
            lastError:
              error?.message ||
              'Unexpected automatic execution failure.',
            completedAt: Date.now(),
          }
        );

        throw new AutomationExecutionError(
          'AUTOMATION_TECHNICAL_FAILURE',
          500,
          'Automatic execution failed after the bounded retry limit.',
          { runId: run.id }
        );
      }
    }

    throw new AutomationExecutionError(
      'AUTOMATION_TECHNICAL_FAILURE',
      500,
      'Automatic execution failed unexpectedly.'
    );
  }

  public async compensate(params: {
    accountId: string;
    runId: string;
    identity: RequestIdentity;
    now?: number;
  }) {
    if (!automationPersistence.usesPostgres()) {
      return automationExecutionService.compensate(params);
    }

    const actor = automationActorLabel(params.identity);
    const actorRole = resolveAutomationActorRole(params.identity);

    if (
      !COMPENSATION_ROLES.includes(
        actorRole as (typeof COMPENSATION_ROLES)[number]
      )
    ) {
      throw new AutomationExecutionError(
        'AUTOMATION_COMPENSATION_NOT_ALLOWED',
        403,
        'Only OWNER, ADMIN, or APPROVER actors may execute an automation compensation.'
      );
    }

    let run = await automationPersistence.requireRun(
      params.accountId,
      params.runId
    );

    if (run.status === 'COMPENSATED') {
      const compensationExecution =
        run.compensationProposalId
          ? await actionPersistence.getExecutionByProposal(
              params.accountId,
              run.compensationProposalId
            )
          : null;

      return {
        replayed: true,
        run,
        compensationProposal:
          run.compensationProposalId
            ? await actionPersistence.requireProposal(
                params.accountId,
                run.compensationProposalId
              )
            : null,
        compensationExecution,
      };
    }

    if (run.status !== 'SUCCEEDED' || !run.executionId) {
      throw new AutomationExecutionError(
        'AUTOMATION_COMPENSATION_NOT_ALLOWED',
        409,
        'Only a successful automatic execution can be compensated.'
      );
    }

    const originalProposal =
      await actionPersistence.requireProposal(
        params.accountId,
        run.proposalId
      );
    const originalExecution =
      await actionPersistence.getExecutionByProposal(
        params.accountId,
        originalProposal.id
      );

    if (
      !originalExecution ||
      originalExecution.id !== run.executionId ||
      originalExecution.executionMode !== 'AUTOMATION_POLICY' ||
      originalProposal.intent !== 'RECEIVE_INVENTORY'
    ) {
      throw new AutomationExecutionError(
        'AUTOMATION_COMPENSATION_NOT_ALLOWED',
        409,
        'This run does not represent a compensatable automatic inventory receipt.'
      );
    }

    const mutation = originalProposal.mutations.find(
      (item) => item.predicate === 'CURRENT_STOCK'
    );
    if (!mutation) {
      throw new AutomationExecutionError(
        'AUTOMATION_COMPENSATION_NOT_ALLOWED',
        409,
        'Original automatic inventory execution does not contain a stock mutation.'
      );
    }

    const current =
      await effectiveCompanyStateRuntimeService.resolve(
        params.accountId,
        mutation.entityId,
        mutation.predicate
      );

    const unchangedSinceAutomation =
      current.status === 'RESOLVED' &&
      current.effectiveClaim.sourceRef.sourceVersionId ===
        originalProposal.id &&
      JSON.stringify(current.value) ===
        JSON.stringify(mutation.afterValue);

    if (!unchangedSinceAutomation) {
      run = await automationPersistence.updateRun(
        params.accountId,
        run.id,
        {
          status: 'RECOVERY_REQUIRED',
          failureCategory: 'VALIDATION',
          retryable: false,
          lastError:
            'Current effective stock changed after the automatic execution. Blind compensation was refused.',
        }
      );

      throw new AutomationExecutionError(
        'AUTOMATION_COMPENSATION_STATE_CHANGED',
        409,
        'Current company state changed after the automatic execution. Review the newer state before creating a compensating action.',
        { runId: run.id }
      );
    }

    const now = params.now ?? Date.now();
    const compensationProposal =
      await actionPersistence.createProposal({
        accountId: params.accountId,
        instruction:
          'Compensate automatic inventory receipt from proposal ' +
          originalProposal.id +
          '.',
        intent: 'RECEIVE_INVENTORY',
        status: 'PROPOSED',
        parserSource: 'DETERMINISTIC',
        parsedInput: {
          intent: 'RECEIVE_INVENTORY',
          productReference: mutation.entityLabel,
          quantity:
            typeof originalProposal.parsedInput.quantity ===
            'number'
              ? originalProposal.parsedInput.quantity
              : undefined,
        },
        targetEntityIds: [mutation.entityId],
        mutations: [
          {
            ...mutation,
            beforeValue: mutation.afterValue,
            afterValue: mutation.beforeValue,
            valueSource: 'DETERMINISTIC_CALCULATION',
            explanation:
              'Compensating action restores stock to the value that existed immediately before the automatic receipt.',
          },
        ],
        preconditions: [
          {
            entityId: mutation.entityId,
            predicate: mutation.predicate,
            effectiveClaimId: current.effectiveClaim.id,
            effectiveValue: current.value,
            authority: current.effectiveClaim.authority,
          },
        ],
        eventType: 'AUTOMATION_INVENTORY_COMPENSATED',
        eventData: {
          automationRunId: run.id,
          originalProposalId: originalProposal.id,
          originalExecutionId: originalExecution.id,
          previousStock: mutation.afterValue,
          restoredStock: mutation.beforeValue,
          occurredAt: now,
        },
        calculationSummary:
          'Restore CURRENT_STOCK from ' +
          String(mutation.afterValue) +
          ' to ' +
          String(mutation.beforeValue) +
          ' because no later effective stock change exists.',
        expiresAt: now + 30 * 60 * 1000,
      });

    const result =
      await actionRuntimeExecutionService.confirm({
        accountId: params.accountId,
        proposalId: compensationProposal.id,
        now,
        authorization: {
          mode: 'AUTOMATION_COMPENSATION',
          actor,
          actorRole,
          automationPolicyId: run.policyId,
          automationPolicyVersion: run.policyVersion,
        },
      });

    run = await automationPersistence.updateRun(
      params.accountId,
      run.id,
      {
        status: 'COMPENSATED',
        compensationProposalId: compensationProposal.id,
        compensationExecutionId: result.execution.id,
      }
    );

    return {
      replayed: false,
      run,
      compensationProposal: result.proposal,
      compensationExecution: result.execution,
    };
  }
}

export const automationExecutionRuntimeService =
  new AutomationExecutionRuntimeService();
