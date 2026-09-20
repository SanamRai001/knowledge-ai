import { actionPersistence } from '../actions/actionPersistence.js';
import type { RequestIdentity } from '../requestIdentity.js';
import { automationActorLabel } from './automationActor.js';
import { automationPersistence } from './automationPersistence.js';
import {
  AutomationQualityError,
  automationQualityService,
} from './automationQualityService.js';
import type {
  AutomationQualitySummary,
  AutomationRun,
  AutomationRunFeedback,
} from './types.js';

function rate(
  numerator: number,
  denominator: number
): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

export class AutomationQualityRuntimeService {
  public async summary(
    accountId: string
  ): Promise<AutomationQualitySummary> {
    if (!automationPersistence.usesPostgres()) {
      return automationQualityService.summary(accountId);
    }

    const [runs, approvals] = await Promise.all([
      automationPersistence.listAllRuns(accountId),
      automationPersistence.listAllApprovals(accountId),
    ]);

    const cleanSuccess = runs.filter(
      (run) => run.status === 'SUCCEEDED'
    ).length;
    const failed = runs.filter(
      (run) => run.status === 'FAILED'
    ).length;
    const compensated = runs.filter(
      (run) => run.status === 'COMPENSATED'
    ).length;
    const recoveryRequired = runs.filter(
      (run) => run.status === 'RECOVERY_REQUIRED'
    ).length;
    const blocked = runs.filter(
      (run) => run.status === 'BLOCKED'
    ).length;

    const executionPopulation =
      cleanSuccess + failed + compensated + recoveryRequired;

    const policyDenials = runs.filter(
      (run) =>
        run.status === 'BLOCKED' &&
        (run.failureCategory === 'POLICY' ||
          run.failureCategory === 'KILL_SWITCH' ||
          run.failureCategory === 'UNSUPPORTED')
    ).length;

    const feedbackRuns = runs.filter((run) =>
      Boolean(run.feedback)
    );
    const correct = feedbackRuns.filter(
      (run) => run.feedback === 'CORRECT'
    ).length;
    const falseTriggers = feedbackRuns.filter(
      (run) => run.feedback === 'FALSE_TRIGGER'
    ).length;
    const needsCorrection = feedbackRuns.filter(
      (run) => run.feedback === 'NEEDS_CORRECTION'
    ).length;

    const humanCorrectionRunIds = new Set(
      runs
        .filter(
          (run) =>
            run.status === 'COMPENSATED' ||
            run.status === 'RECOVERY_REQUIRED' ||
            run.feedback === 'FALSE_TRIGGER' ||
            run.feedback === 'NEEDS_CORRECTION'
        )
        .map((run) => run.id)
    );

    const approvalsGranted = approvals.filter(
      (approval) => approval.status === 'APPROVED'
    ).length;
    const approvalsRejected = approvals.filter(
      (approval) => approval.status === 'REJECTED'
    ).length;
    const approvalsPending = approvals.filter(
      (approval) => approval.status === 'PENDING'
    ).length;

    const recordedDecisionPopulation =
      runs.length + approvals.length;

    return {
      accountId,
      generatedAt: Date.now(),
      population: {
        automationRuns: runs.length,
        approvalRequests: approvals.length,
        feedbackRatedRuns: feedbackRuns.length,
      },
      executions: {
        attempted: executionPopulation,
        successful: cleanSuccess,
        failed,
        successRate: rate(cleanSuccess, executionPopulation),
        failureRate: rate(failed, executionPopulation),
      },
      governance: {
        blockedRuns: blocked,
        policyDenials,
        approvalEscalations: approvals.length,
        approvalEscalationRate: rate(
          approvals.length,
          recordedDecisionPopulation
        ),
        approvalsGranted,
        approvalsRejected,
        approvalsPending,
      },
      recovery: {
        compensatedRuns: compensated,
        compensationRate: rate(
          compensated,
          executionPopulation
        ),
        recoveryRequiredRuns: recoveryRequired,
        technicalFailures: runs.filter(
          (run) =>
            run.status === 'FAILED' &&
            run.failureCategory === 'TECHNICAL'
        ).length,
        staleStateFailures: runs.filter(
          (run) =>
            run.status === 'FAILED' &&
            run.failureCategory === 'STALE_STATE'
        ).length,
      },
      feedback: {
        correct,
        falseTriggers,
        needsCorrection,
        falseTriggerRate: rate(
          falseTriggers,
          feedbackRuns.length
        ),
        humanCorrectionSignals:
          humanCorrectionRunIds.size,
      },
      timeSaved: {
        estimatedMinutes: null,
        reason:
          'Knowledge AI does not yet have a measured manual-task baseline, so Phase 7 does not fabricate a time-saved estimate.',
      },
    };
  }

  public async setFeedback(params: {
    accountId: string;
    runId: string;
    feedback: AutomationRunFeedback;
    identity: RequestIdentity;
    note?: string;
  }): Promise<AutomationRun> {
    if (!automationPersistence.usesPostgres()) {
      return automationQualityService.setFeedback(params);
    }

    const run = await automationPersistence.requireRun(
      params.accountId,
      params.runId
    );

    if (run.status === 'RUNNING') {
      throw new AutomationQualityError(
        'AUTOMATION_FEEDBACK_RUN_ACTIVE',
        409,
        'Automation feedback can only be recorded after the run reaches a terminal state.'
      );
    }

    const note = params.note?.trim();
    if (note && note.length > 500) {
      throw new AutomationQualityError(
        'AUTOMATION_FEEDBACK_INVALID',
        400,
        'Automation feedback note must be 500 characters or fewer.'
      );
    }

    return automationPersistence.setRunFeedback({
      accountId: params.accountId,
      runId: params.runId,
      feedback: params.feedback,
      actor: automationActorLabel(params.identity),
      note,
    });
  }

  public async dashboard(accountId: string) {
    if (!automationPersistence.usesPostgres()) {
      return automationQualityService.dashboard(accountId);
    }

    const [quality, policy, control, runs, approvals] =
      await Promise.all([
        this.summary(accountId),
        automationPersistence.getPolicy(accountId),
        automationPersistence.getControl(accountId),
        automationPersistence.listRuns({
          accountId,
          limit: 100,
        }),
        automationPersistence.listApprovals({
          accountId,
          limit: 100,
        }),
      ]);

    const proposalIds = new Set([
      ...runs.map((run) => run.proposalId),
      ...approvals.map((approval) => approval.proposalId),
    ]);
    const proposals = new Map<string, any>();
    await Promise.all(
      Array.from(proposalIds).map(async (proposalId) => {
        const proposal = await actionPersistence.getProposal(
          accountId,
          proposalId
        );
        if (proposal) {
          proposals.set(proposalId, {
            id: proposal.id,
            intent: proposal.intent,
            instruction: proposal.instruction,
            status: proposal.status,
            createdAt: proposal.createdAt,
          });
        }
      })
    );

    return {
      quality,
      policy,
      control,
      runs: runs.map((run) => ({
        run,
        proposal: proposals.get(run.proposalId) || null,
      })),
      approvals: approvals.map((approval) => ({
        approval,
        proposal:
          proposals.get(approval.proposalId) || null,
      })),
    };
  }
}

export const automationQualityRuntimeService =
  new AutomationQualityRuntimeService();
