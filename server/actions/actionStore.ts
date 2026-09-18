import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ActionAuditEntry,
  ActionExecution,
  ActionProposal,
  ActionProposalStatus,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const ACTION_FILE = path.join(DATA_DIR, 'company-actions.json');

type PersistedActionState = {
  proposals: ActionProposal[];
  executions: ActionExecution[];
  auditEntries: ActionAuditEntry[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ActionAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code:
    | 'ACTION_PROPOSAL_NOT_FOUND'
    | 'ACTION_EXECUTION_NOT_FOUND';

  constructor(
    code: 'ACTION_PROPOSAL_NOT_FOUND' | 'ACTION_EXECUTION_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'ActionAccessError';
    this.code = code;
  }
}

export class ActionStore {
  private proposals = new Map<string, ActionProposal>();
  private executions = new Map<string, ActionExecution>();
  private auditEntries = new Map<string, ActionAuditEntry>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(ACTION_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(ACTION_FILE, 'utf8')
      ) as Partial<PersistedActionState>;

      for (const proposal of parsed.proposals || []) {
        this.proposals.set(proposal.id, proposal);
      }
      for (const execution of parsed.executions || []) {
        this.executions.set(execution.id, execution);
      }
      for (const audit of parsed.auditEntries || []) {
        this.auditEntries.set(audit.id, audit);
      }
    } catch (error) {
      console.warn('Could not load company-action state; starting empty:', error);
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedActionState = {
      proposals: Array.from(this.proposals.values()).slice(-5000),
      executions: Array.from(this.executions.values()).slice(-5000),
      auditEntries: Array.from(this.auditEntries.values()).slice(-15000),
    };

    const temporary = ACTION_FILE + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporary, ACTION_FILE);
  }

  public createProposal(
    proposal: Omit<ActionProposal, 'id' | 'createdAt' | 'updatedAt'>
  ): ActionProposal {
    const now = Date.now();
    const created: ActionProposal = {
      ...clone(proposal),
      id: 'act_' + crypto.randomBytes(10).toString('hex'),
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.set(created.id, created);
    this.appendAudit({
      accountId: created.accountId,
      proposalId: created.id,
      action:
        created.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'PROPOSED',
      detail:
        created.status === 'NEEDS_INPUT'
          ? created.needsInputReason || 'More information is required.'
          : 'Action proposal created and awaiting explicit confirmation.',
    });
    this.save();
    return clone(created);
  }

  public getProposal(
    accountId: string,
    proposalId: string
  ): ActionProposal | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.accountId !== accountId) return null;
    return clone(proposal);
  }

  public requireProposal(
    accountId: string,
    proposalId: string
  ): ActionProposal {
    const proposal = this.getProposal(accountId, proposalId);
    if (!proposal) {
      throw new ActionAccessError(
        'ACTION_PROPOSAL_NOT_FOUND',
        'Action proposal not found in the current account scope.'
      );
    }
    return proposal;
  }

  public updateProposal(
    accountId: string,
    proposalId: string,
    updates: Partial<ActionProposal>
  ): ActionProposal {
    const current = this.requireProposal(accountId, proposalId);
    const updated: ActionProposal = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      updatedAt: Date.now(),
    };
    this.proposals.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public transitionProposal(params: {
    accountId: string;
    proposalId: string;
    status: ActionProposalStatus;
    detail: string;
    updates?: Partial<ActionProposal>;
    executionId?: string;
  }): ActionProposal {
    const timestamp = Date.now();
    const statusFields: Partial<ActionProposal> = {};
    if (params.status === 'CONFIRMED') statusFields.confirmedAt = timestamp;
    if (params.status === 'CANCELLED') statusFields.cancelledAt = timestamp;
    if (params.status === 'STALE') statusFields.staleAt = timestamp;
    if (params.status === 'FAILED') statusFields.failedAt = timestamp;

    const updated = this.updateProposal(
      params.accountId,
      params.proposalId,
      {
        ...params.updates,
        ...statusFields,
        status: params.status,
        executionId:
          params.executionId ??
          params.updates?.executionId,
      }
    );

    this.appendAudit({
      accountId: params.accountId,
      proposalId: params.proposalId,
      action: params.status,
      detail: params.detail,
      executionId: params.executionId,
    });
    return updated;
  }

  public saveExecution(execution: ActionExecution): ActionExecution {
    const existing = Array.from(this.executions.values()).find(
      (item) =>
        item.accountId === execution.accountId &&
        item.proposalId === execution.proposalId
    );
    if (existing) return clone(existing);

    this.executions.set(execution.id, clone(execution));
    this.save();
    return clone(execution);
  }

  public getExecutionByProposal(
    accountId: string,
    proposalId: string
  ): ActionExecution | null {
    const execution = Array.from(this.executions.values()).find(
      (item) =>
        item.accountId === accountId &&
        item.proposalId === proposalId
    );
    return execution ? clone(execution) : null;
  }

  public listProposals(params: {
    accountId: string;
    status?: ActionProposalStatus;
    limit?: number;
  }): ActionProposal[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 500));
    return Array.from(this.proposals.values())
      .filter(
        (proposal) =>
          proposal.accountId === params.accountId &&
          (!params.status || proposal.status === params.status)
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(clone);
  }

  public listAudit(params: {
    accountId: string;
    proposalId?: string;
    limit?: number;
  }): ActionAuditEntry[] {
    const limit = Math.max(1, Math.min(params.limit || 200, 1000));
    return Array.from(this.auditEntries.values())
      .filter(
        (entry) =>
          entry.accountId === params.accountId &&
          (!params.proposalId || entry.proposalId === params.proposalId)
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map(clone);
  }

  private appendAudit(params: {
    accountId: string;
    proposalId: string;
    action: ActionAuditEntry['action'];
    detail: string;
    executionId?: string;
  }): ActionAuditEntry {
    const entry: ActionAuditEntry = {
      id: 'aud_' + crypto.randomBytes(10).toString('hex'),
      accountId: params.accountId,
      proposalId: params.proposalId,
      action: params.action,
      timestamp: Date.now(),
      detail: params.detail,
      executionId: params.executionId,
    };
    this.auditEntries.set(entry.id, entry);
    this.save();
    return clone(entry);
  }
}

export const actionStore = new ActionStore();
