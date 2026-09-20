import crypto from 'crypto';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import {
  postgresActionRepository,
} from '../persistence/a3PostgresRepositories.js';
import { postgresAccountRepository } from '../persistence/postgresRepositories.js';
import {
  ActionAccessError,
  actionStore,
} from './actionStore.js';
import type {
  ActionAuditEntry,
  ActionExecution,
  ActionProposal,
  ActionProposalStatus,
} from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

export class ActionPersistence {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  public async createProposal(
    proposal: Omit<ActionProposal, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ActionProposal> {
    if (!this.usesPostgres()) {
      return actionStore.createProposal(proposal);
    }

    await postgresAccountRepository.ensureAccount(
      proposal.accountId
    );

    const now = Date.now();
    const created: ActionProposal = {
      ...clone(proposal),
      id: id('act'),
      createdAt: now,
      updatedAt: now,
    };

    const audit: ActionAuditEntry = {
      id: id('aud'),
      accountId: created.accountId,
      proposalId: created.id,
      action:
        created.status === 'NEEDS_INPUT'
          ? 'NEEDS_INPUT'
          : 'PROPOSED',
      timestamp: now,
      detail:
        created.status === 'NEEDS_INPUT'
          ? created.needsInputReason ||
            'More information is required.'
          : 'Action proposal created and awaiting explicit confirmation.',
    };

    await postgresActionRepository.createProposalWithAudit(
      created,
      audit
    );
    return created;
  }

  public async getProposal(
    accountId: string,
    proposalId: string
  ): Promise<ActionProposal | null> {
    if (!this.usesPostgres()) {
      return actionStore.getProposal(accountId, proposalId);
    }
    return postgresActionRepository.getProposal(
      accountId,
      proposalId
    );
  }

  public async requireProposal(
    accountId: string,
    proposalId: string
  ): Promise<ActionProposal> {
    const proposal = await this.getProposal(
      accountId,
      proposalId
    );
    if (!proposal) {
      throw new ActionAccessError(
        'ACTION_PROPOSAL_NOT_FOUND',
        'Action proposal not found in the current account scope.'
      );
    }
    return proposal;
  }

  public async listProposals(params: {
    accountId: string;
    status?: ActionProposalStatus;
    limit?: number;
  }): Promise<ActionProposal[]> {
    if (!this.usesPostgres()) {
      return actionStore.listProposals(params);
    }
    return postgresActionRepository.listProposals(params);
  }

  public async transitionProposal(params: {
    accountId: string;
    proposalId: string;
    status: ActionProposalStatus;
    detail: string;
    executionId?: string;
    failureReason?: string;
  }): Promise<ActionProposal> {
    if (!this.usesPostgres()) {
      return actionStore.transitionProposal({
        accountId: params.accountId,
        proposalId: params.proposalId,
        status: params.status,
        detail: params.detail,
        executionId: params.executionId,
        updates: params.failureReason
          ? { failureReason: params.failureReason }
          : undefined,
      });
    }

    return postgresActionRepository.transitionProposalWithAudit({
      accountId: params.accountId,
      proposalId: params.proposalId,
      status: params.status,
      timestamp: Date.now(),
      detail: params.detail,
      auditEntryId: id('aud'),
      executionId: params.executionId,
      failureReason: params.failureReason,
    });
  }

  public async getExecutionByProposal(
    accountId: string,
    proposalId: string
  ): Promise<ActionExecution | null> {
    if (!this.usesPostgres()) {
      return actionStore.getExecutionByProposal(
        accountId,
        proposalId
      );
    }
    return postgresActionRepository.getExecutionByProposal(
      accountId,
      proposalId
    );
  }

  public async listAudit(params: {
    accountId: string;
    proposalId?: string;
    limit?: number;
  }): Promise<ActionAuditEntry[]> {
    if (!this.usesPostgres()) {
      return actionStore.listAudit(params);
    }
    return postgresActionRepository.listAudit(params);
  }
}

export const actionPersistence = new ActionPersistence();
