import crypto from 'crypto';
import { companyKnowledgeStore } from '../companyKnowledge/companyKnowledgeStore.js';
import { SOURCE_AUTHORITIES } from '../companyKnowledge/sourceAuthority.js';
import { KnowledgeSourceRef } from '../companyKnowledge/types.js';
import { actionStore } from './actionStore.js';
import { effectiveCompanyStateService } from './effectiveCompanyStateService.js';
import { ActionExecution, ActionProposal } from './types.js';

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

function sourceRefFor(proposal: ActionProposal): KnowledgeSourceRef {
  return {
    sourceType: 'USER',
    sourceId: 'confirmed-company-state',
    sourceVersionId: proposal.id,
    sourceVersionLabel: 'action ' + proposal.id,
    sourceName: 'Confirmed business action',
    excerpt: proposal.instruction,
  };
}

export class ActionExecutionService {
  public confirm(params: {
    accountId: string;
    proposalId: string;
    now?: number;
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
    const sourceRef = sourceRefFor(proposal);

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

    const execution = actionStore.saveExecution({
      id: 'exe_' + crypto.randomBytes(10).toString('hex'),
      accountId: params.accountId,
      proposalId: proposal.id,
      intent: proposal.intent,
      claimIds,
      eventIds,
      executedAt: now,
    });

    const confirmed = actionStore.transitionProposal({
      accountId: params.accountId,
      proposalId: proposal.id,
      status: 'CONFIRMED',
      detail:
        'User explicitly confirmed the proposal. USER_CONFIRMED company-state claims and audit events were written.',
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
