import crypto from 'crypto';
import { companyKnowledgeStore } from '../companyKnowledge/companyKnowledgeStore.js';
import { SOURCE_AUTHORITIES } from '../companyKnowledge/sourceAuthority.js';
import { KnowledgeSourceRef } from '../companyKnowledge/types.js';
import { discoveryService } from '../discovery/discoveryService.js';
import { actionStore } from './actionStore.js';
import { effectiveCompanyStateService } from '../companyKnowledge/effectiveCompanyStateService.js';
import {
  ActionExecution,
  ActionExecutionMode,
  ActionProposal,
} from './types.js';

export class ActionExecutionError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'ACTION_NOT_CONFIRMABLE'
    | 'ACTION_EXPIRED'
    | 'ACTION_STALE'
    | 'ACTION_MUTATION_INVALID';

  constructor(
    code:
      | 'ACTION_NOT_CONFIRMABLE'
      | 'ACTION_EXPIRED'
      | 'ACTION_STALE'
      | 'ACTION_MUTATION_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ActionExecutionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function valueKey(value: unknown): string {
  return JSON.stringify(value);
}

interface ActionAuthorizationContext {
  mode: ActionExecutionMode;
  actor: string;
  actorRole?: string;
  automationPolicyId?: string;
  automationPolicyVersion?: number;
}

function sourceRefFor(
  proposal: ActionProposal,
  authorization: ActionAuthorizationContext
): KnowledgeSourceRef {
  return {
    sourceType: 'USER',
    sourceId: 'confirmed-company-state',
    sourceVersionId: proposal.id,
    sourceVersionLabel: 'action ' + proposal.id,
    sourceName:
      authorization.mode === 'AUTOMATION_POLICY'
        ? 'Policy-authorized business action'
        : 'Confirmed business action',
    excerpt: proposal.instruction,
  };
}

export class ActionExecutionService {
  private runDownstreamDiscovery(params: {
    accountId: string;
    proposal: ActionProposal;
    now: number;
  }): {
    runIds: string[];
    warnings: string[];
  } {
    const datasetIds = new Set<string>();

    for (const entityId of params.proposal.targetEntityIds) {
      const entity = companyKnowledgeStore.getEntity(
        params.accountId,
        entityId
      );
      for (const source of entity?.sourceRefs || []) {
        if (source.sourceType === 'DATASET') {
          datasetIds.add(source.sourceId);
        }
      }
    }

    for (const precondition of params.proposal.preconditions) {
      if (!precondition.effectiveClaimId) continue;
      const claim = companyKnowledgeStore.getClaim(
        params.accountId,
        precondition.effectiveClaimId
      );
      if (claim?.sourceRef.sourceType === 'DATASET') {
        datasetIds.add(claim.sourceRef.sourceId);
      }
    }

    const runIds: string[] = [];
    const warnings: string[] = [];

    for (const datasetId of datasetIds) {
      try {
        const result = discoveryService.analyzeDataset({
          accountId: params.accountId,
          datasetId,
          referenceTime: params.now,
        });
        runIds.push(result.run.id);
      } catch (error: any) {
        warnings.push(
          'Discovery refresh failed for dataset ' +
            datasetId +
            ': ' +
            (error?.message || 'unknown error')
        );
      }
    }

    return { runIds, warnings };
  }

  private recoverAppliedProposal(params: {
    accountId: string;
    proposal: ActionProposal;
    now: number;
    authorization: ActionAuthorizationContext;
  }): ActionExecution | null {
    const recoveredClaimIds: string[] = [];

    for (const mutation of params.proposal.mutations) {
      const matching = companyKnowledgeStore
        .listClaims({
          accountId: params.accountId,
          entityId: mutation.entityId,
          predicate: mutation.predicate,
          currentOnly: false,
          limit: 500,
        })
        .find(
          (claim) =>
            claim.sourceRef.sourceType === 'USER' &&
            claim.sourceRef.sourceId === 'confirmed-company-state' &&
            claim.sourceRef.sourceVersionId === params.proposal.id &&
            valueKey(claim.value) === valueKey(mutation.afterValue)
        );

      if (!matching) return null;
      recoveredClaimIds.push(matching.id);
    }

    const matchingEvents = companyKnowledgeStore
      .listEvents({
        accountId: params.accountId,
        limit: 1000,
      })
      .filter(
        (event) =>
          event.sourceRef.sourceType === 'USER' &&
          event.sourceRef.sourceId === 'confirmed-company-state' &&
          event.sourceRef.sourceVersionId === params.proposal.id
      );

    if (matchingEvents.length === 0) return null;

    const downstream = this.runDownstreamDiscovery({
      accountId: params.accountId,
      proposal: params.proposal,
      now: params.now,
    });

    const execution = actionStore.saveExecution({
      id: 'exe_' + crypto.randomBytes(10).toString('hex'),
      accountId: params.accountId,
      proposalId: params.proposal.id,
      intent: params.proposal.intent,
      executionMode: params.authorization.mode,
      authorizedBy: params.authorization.actor,
      authorizedByRole: params.authorization.actorRole,
      automationPolicyId: params.authorization.automationPolicyId,
      automationPolicyVersion:
        params.authorization.automationPolicyVersion,
      claimIds: recoveredClaimIds,
      eventIds: matchingEvents.map((event) => event.id),
      downstreamAnalysisRunIds: downstream.runIds,
      downstreamWarnings: downstream.warnings,
      executedAt:
        Math.min(
          ...matchingEvents.map((event) => event.recordedAt),
          params.now
        ),
    });

    actionStore.transitionProposal({
      accountId: params.accountId,
      proposalId: params.proposal.id,
      status: 'CONFIRMED',
      detail:
        'Recovered an already-applied idempotent company-state write and finalized the action audit record. Authorization mode: ' +
        params.authorization.mode +
        '; actor: ' +
        params.authorization.actor +
        '.',
      executionId: execution.id,
    });

    return execution;
  }

  public confirm(params: {
    accountId: string;
    proposalId: string;
    now?: number;
    authorization?: {
      mode: ActionExecutionMode;
      actor: string;
      actorRole?: string;
      automationPolicyId?: string;
      automationPolicyVersion?: number;
    };
  }): {
    proposal: ActionProposal;
    execution: ActionExecution;
  } {
    const existingExecution = actionStore.getExecutionByProposal(
      params.accountId,
      params.proposalId
    );
    if (existingExecution) {
      return {
        proposal: actionStore.requireProposal(
          params.accountId,
          params.proposalId
        ),
        execution: existingExecution,
      };
    }

    const proposal = actionStore.requireProposal(
      params.accountId,
      params.proposalId
    );
    const now = params.now ?? Date.now();
    const authorization: ActionAuthorizationContext =
      params.authorization || {
        mode: 'MANUAL_CONFIRMATION',
        actor: 'user:explicit-confirmation',
      };

    if (proposal.status === 'PROPOSED') {
      const recovered = this.recoverAppliedProposal({
        accountId: params.accountId,
        proposal,
        now,
        authorization,
      });
      if (recovered) {
        return {
          proposal: actionStore.requireProposal(
            params.accountId,
            proposal.id
          ),
          execution: recovered,
        };
      }
    }

    if (proposal.status !== 'PROPOSED') {
      throw new ActionExecutionError(
        'ACTION_NOT_CONFIRMABLE',
        409,
        `Action proposal is ${proposal.status} and cannot be confirmed.`
      );
    }

    if (proposal.expiresAt <= now) {
      const stale = actionStore.transitionProposal({
        accountId: params.accountId,
        proposalId: proposal.id,
        status: 'STALE',
        detail: 'Proposal expired before confirmation.',
      });
      throw new ActionExecutionError(
        'ACTION_EXPIRED',
        409,
        `Action proposal expired at ${new Date(stale.expiresAt).toISOString()}.`
      );
    }

    for (const precondition of proposal.preconditions) {
      const current = effectiveCompanyStateService.resolve(
        params.accountId,
        precondition.entityId,
        precondition.predicate
      );

      const same =
        precondition.effectiveClaimId === undefined
          ? current.status === 'MISSING' &&
            precondition.effectiveValue === null
          : current.status === 'RESOLVED' &&
            current.effectiveClaim.id === precondition.effectiveClaimId &&
            valueKey(current.value) === valueKey(precondition.effectiveValue);

      if (!same) {
        actionStore.transitionProposal({
          accountId: params.accountId,
          proposalId: proposal.id,
          status: 'STALE',
          detail:
            'Effective state changed after the proposal was created: ' +
            precondition.predicate +
            '. A new proposal is required.',
        });
        throw new ActionExecutionError(
          'ACTION_STALE',
          409,
          `Current ${precondition.predicate} changed after this proposal was created. Review a fresh proposal before writing.`
        );
      }
    }

    for (const mutation of proposal.mutations) {
      const entity = companyKnowledgeStore.requireEntity(
        params.accountId,
        mutation.entityId
      );
      if (entity.type !== mutation.entityType) {
        throw new ActionExecutionError(
          'ACTION_MUTATION_INVALID',
          422,
          'Action target entity type no longer matches the validated proposal.'
        );
      }
      if (mutation.operation !== 'SET') {
        throw new ActionExecutionError(
          'ACTION_MUTATION_INVALID',
          422,
          'Unsupported mutation operation.'
        );
      }
    }

    const claimIds: string[] = [];
    const eventIds: string[] = [];
    const sourceRef = sourceRefFor(proposal, authorization);

    companyKnowledgeStore.withBatch(() => {
      for (const mutation of proposal.mutations) {
        const claim = companyKnowledgeStore.recordClaim({
          accountId: params.accountId,
          subjectEntityId: mutation.entityId,
          predicate: mutation.predicate,
          value: mutation.afterValue,
          claimKind: 'FACT',
          authority: { ...SOURCE_AUTHORITIES.USER_CONFIRMED },
          sourceRef,
          observedAt: now,
          validFrom: now,
        });
        claimIds.push(claim.id);
      }

      const event = companyKnowledgeStore.recordEvent({
        accountId: params.accountId,
        type: proposal.eventType || 'BUSINESS_ACTION_CONFIRMED',
        subjectEntityIds: proposal.targetEntityIds,
        data: {
          ...proposal.eventData,
          proposalId: proposal.id,
        },
        sourceRef,
        occurredAt:
          typeof proposal.eventData.occurredAt === 'number'
            ? proposal.eventData.occurredAt
            : now,
        recordedAt: now,
        fingerprintParts: [proposal.id],
      });
      eventIds.push(event.id);
    });

    const downstream = this.runDownstreamDiscovery({
      accountId: params.accountId,
      proposal,
      now,
    });

    const execution = actionStore.saveExecution({
      id: 'exe_' + crypto.randomBytes(10).toString('hex'),
      accountId: params.accountId,
      proposalId: proposal.id,
      intent: proposal.intent,
      executionMode: authorization.mode,
      authorizedBy: authorization.actor,
      authorizedByRole: authorization.actorRole,
      automationPolicyId: authorization.automationPolicyId,
      automationPolicyVersion: authorization.automationPolicyVersion,
      claimIds,
      eventIds,
      downstreamAnalysisRunIds: downstream.runIds,
      downstreamWarnings: downstream.warnings,
      executedAt: now,
    });

    const confirmed = actionStore.transitionProposal({
      accountId: params.accountId,
      proposalId: proposal.id,
      status: 'CONFIRMED',
      detail:
        (authorization.mode === 'AUTOMATION_POLICY'
          ? 'Automation policy authorized this proposal without a manual confirm click. '
          : 'User explicitly confirmed the proposal. ') +
        'Authorization actor: ' +
        authorization.actor +
        (authorization.automationPolicyVersion
          ? '; policy version: ' +
            String(authorization.automationPolicyVersion)
          : '') +
        '. USER_CONFIRMED company-state claims and audit events were written. Downstream discovery refreshes: ' +
        String(execution.downstreamAnalysisRunIds?.length || 0) +
        (execution.downstreamWarnings?.length
          ? '; warnings: ' + execution.downstreamWarnings.join(' | ')
          : '.'),
      executionId: execution.id,
    });

    return {
      proposal: confirmed,
      execution,
    };
  }

  public cancel(params: {
    accountId: string;
    proposalId: string;
  }): ActionProposal {
    const proposal = actionStore.requireProposal(
      params.accountId,
      params.proposalId
    );

    if (proposal.status === 'CONFIRMED') {
      throw new ActionExecutionError(
        'ACTION_NOT_CONFIRMABLE',
        409,
        'A confirmed action cannot be cancelled. A compensating action is required.'
      );
    }

    if (proposal.status === 'CANCELLED') return proposal;

    return actionStore.transitionProposal({
      accountId: params.accountId,
      proposalId: params.proposalId,
      status: 'CANCELLED',
      detail: 'User cancelled the proposed change before execution.',
    });
  }
}

export const actionExecutionService = new ActionExecutionService();
