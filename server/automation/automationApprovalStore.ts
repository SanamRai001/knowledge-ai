import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  AutomationActorRole,
  AutomationApprovalRequest,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const APPROVAL_FILE = path.join(
  DATA_DIR,
  'automation-approvals.json'
);

type PersistedApprovalState = {
  approvals: AutomationApprovalRequest[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(): string {
  return 'autoapr_' + crypto.randomBytes(10).toString('hex');
}

export class AutomationApprovalAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code = 'AUTOMATION_APPROVAL_NOT_FOUND';

  constructor() {
    super(
      'Automation approval request not found in the current account scope.'
    );
    this.name = 'AutomationApprovalAccessError';
  }
}

export class AutomationApprovalStore {
  private approvals = new Map<string, AutomationApprovalRequest>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(APPROVAL_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(APPROVAL_FILE, 'utf8')
      ) as Partial<PersistedApprovalState>;
      for (const approval of parsed.approvals || []) {
        this.approvals.set(approval.id, approval);
      }
    } catch (error) {
      console.warn(
        'Could not load automation approval state; starting empty:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const state: PersistedApprovalState = {
      approvals: Array.from(this.approvals.values()).slice(-25000),
    };
    const temporary = APPROVAL_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, APPROVAL_FILE);
  }

  public ensureRequest(params: {
    accountId: string;
    proposalId: string;
    policyId: string;
    policyVersion: number;
    requestedBy: string;
    requestedByRole: AutomationActorRole;
    eligibleRoles: AutomationActorRole[];
    decisionReasonCodes: AutomationApprovalRequest['decisionReasonCodes'];
    decisionReasons: string[];
    expiresAt: number;
  }): AutomationApprovalRequest {
    const existing = Array.from(this.approvals.values())
      .filter(
        (item) =>
          item.accountId === params.accountId &&
          item.proposalId === params.proposalId &&
          item.policyId === params.policyId &&
          item.policyVersion === params.policyVersion
      )
      .sort((a, b) => b.requestedAt - a.requestedAt)[0];

    if (existing) return clone(existing);

    const approval: AutomationApprovalRequest = {
      id: id(),
      accountId: params.accountId,
      proposalId: params.proposalId,
      policyId: params.policyId,
      policyVersion: params.policyVersion,
      status: 'PENDING',
      requestedBy: params.requestedBy,
      requestedByRole: params.requestedByRole,
      eligibleRoles: clone(params.eligibleRoles),
      decisionReasonCodes: clone(params.decisionReasonCodes),
      decisionReasons: clone(params.decisionReasons),
      requestedAt: Date.now(),
      expiresAt: params.expiresAt,
    };

    this.approvals.set(approval.id, approval);
    this.save();
    return clone(approval);
  }

  public get(
    accountId: string,
    approvalId: string
  ): AutomationApprovalRequest | null {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.accountId !== accountId) return null;
    return clone(approval);
  }

  public require(
    accountId: string,
    approvalId: string
  ): AutomationApprovalRequest {
    const approval = this.get(accountId, approvalId);
    if (!approval) throw new AutomationApprovalAccessError();
    return approval;
  }

  public list(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationApprovalRequest['status'];
    limit?: number;
  }): AutomationApprovalRequest[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    return Array.from(this.approvals.values())
      .filter(
        (item) =>
          item.accountId === params.accountId &&
          (!params.proposalId ||
            item.proposalId === params.proposalId) &&
          (!params.status || item.status === params.status)
      )
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, limit)
      .map(clone);
  }

  public resolve(params: {
    accountId: string;
    approvalId: string;
    status: 'APPROVED' | 'REJECTED';
    resolvedBy: string;
    resolvedByRole: AutomationActorRole;
    resolutionNote?: string;
    now?: number;
  }): AutomationApprovalRequest {
    const current = this.require(
      params.accountId,
      params.approvalId
    );
    const now = params.now ?? Date.now();

    if (current.status !== 'PENDING') {
      return current;
    }

    const status =
      current.expiresAt <= now ? 'EXPIRED' : params.status;

    const updated: AutomationApprovalRequest = {
      ...current,
      status,
      resolvedAt: now,
      resolvedBy: params.resolvedBy,
      resolvedByRole: params.resolvedByRole,
      resolutionNote: params.resolutionNote,
    };

    this.approvals.set(updated.id, updated);
    this.save();
    return clone(updated);
  }
}

export const automationApprovalStore =
  new AutomationApprovalStore();
