import { companyKnowledgeStore } from '../companyKnowledge/companyKnowledgeStore.js';
import { actionStore } from './actionStore.js';
import { actionProposalService } from './actionProposalService.js';
import { ActionProposal } from './types.js';

export class ActionRefinementError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'ACTION_NOT_REFINABLE'
    | 'ACTION_TARGET_NOT_OFFERED'
    | 'ACTION_TARGET_TYPE_INVALID';

  constructor(
    code:
      | 'ACTION_NOT_REFINABLE'
      | 'ACTION_TARGET_NOT_OFFERED'
      | 'ACTION_TARGET_TYPE_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ActionRefinementError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ActionRefinementService {
  public selectTarget(params: {
    accountId: string;
    proposalId: string;
    entityId: string;
  }): ActionProposal {
    const proposal = actionStore.requireProposal(
      params.accountId,
      params.proposalId
    );

    if (proposal.status !== 'NEEDS_INPUT') {
      throw new ActionRefinementError(
        'ACTION_NOT_REFINABLE',
        409,
        'Only a proposal waiting for target input can be refined.'
      );
    }

    const offered = proposal.targetCandidates?.some(
      (candidate) => candidate.entityId === params.entityId
    );
    if (!offered) {
      throw new ActionRefinementError(
        'ACTION_TARGET_NOT_OFFERED',
        422,
        'Selected entity was not one of the validated action candidates.'
      );
    }

    const entity = companyKnowledgeStore.requireEntity(
      params.accountId,
      params.entityId
    );
    const parsed = { ...proposal.parsedInput };

    if (proposal.intent === 'RECORD_PAYMENT') {
      if (entity.type === 'ORDER') {
        parsed.orderReference = entity.identityKey || entity.canonicalName;
        parsed.customerReference = undefined;
      } else if (entity.type === 'CUSTOMER') {
        parsed.customerReference = entity.canonicalName;
        parsed.orderReference = undefined;
      } else {
        throw new ActionRefinementError(
          'ACTION_TARGET_TYPE_INVALID',
          422,
          'Payment target must be an order or customer.'
        );
      }
    } else if (proposal.intent === 'RECEIVE_INVENTORY') {
      if (entity.type !== 'PRODUCT') {
        throw new ActionRefinementError(
          'ACTION_TARGET_TYPE_INVALID',
          422,
          'Inventory receipt target must be a product.'
        );
      }
      parsed.productReference = entity.identityKey || entity.canonicalName;
    } else if (proposal.intent === 'UPDATE_STATUS') {
      if (entity.type !== 'ORDER') {
        throw new ActionRefinementError(
          'ACTION_TARGET_TYPE_INVALID',
          422,
          'Order status target must be an order.'
        );
      }
      parsed.orderReference = entity.identityKey || entity.canonicalName;
    } else {
      throw new ActionRefinementError(
        'ACTION_TARGET_TYPE_INVALID',
        422,
        'This action type does not support target refinement.'
      );
    }

    const refined = actionProposalService.createFromParsed({
      accountId: params.accountId,
      instruction: proposal.instruction,
      parsed,
      parserSource: proposal.parserSource,
    });

    actionStore.transitionProposal({
      accountId: params.accountId,
      proposalId: proposal.id,
      status: 'CANCELLED',
      detail:
        'Superseded after explicit target selection by proposal ' +
        refined.id +
        '.',
    });

    return refined;
  }
}

export const actionRefinementService = new ActionRefinementService();
