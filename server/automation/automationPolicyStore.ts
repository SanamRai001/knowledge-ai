import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AutomationPolicy,
  AutomationPolicyRevision,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const POLICY_FILE = path.join(DATA_DIR, 'automation-policies.json');

type PersistedAutomationState = {
  policies: AutomationPolicy[];
  revisions: AutomationPolicyRevision[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

export class AutomationPolicyStore {
  private policies = new Map<string, AutomationPolicy>();
  private revisions = new Map<string, AutomationPolicyRevision>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(POLICY_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(POLICY_FILE, 'utf8')
      ) as Partial<PersistedAutomationState>;

      for (const policy of parsed.policies || []) {
        this.policies.set(policy.accountId, policy);
      }
      for (const revision of parsed.revisions || []) {
        this.revisions.set(revision.id, revision);
      }
    } catch (error) {
      console.warn(
        'Could not load automation policy state; starting empty:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedAutomationState = {
      policies: Array.from(this.policies.values()).slice(-5000),
      revisions: Array.from(this.revisions.values()).slice(-25000),
    };

    const temporary = POLICY_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, POLICY_FILE);
  }

  public getPolicy(accountId: string): AutomationPolicy | null {
    const policy = this.policies.get(accountId);
    return policy ? clone(policy) : null;
  }

  public upsertPolicy(params: {
    accountId: string;
    actor: string;
    policy: Omit<
      AutomationPolicy,
      | 'id'
      | 'accountId'
      | 'version'
      | 'createdAt'
      | 'updatedAt'
      | 'createdBy'
      | 'updatedBy'
    >;
  }): AutomationPolicy {
    const current = this.policies.get(params.accountId);
    const now = Date.now();

    const next: AutomationPolicy = current
      ? {
          ...clone(params.policy),
          id: current.id,
          accountId: current.accountId,
          version: current.version + 1,
          createdAt: current.createdAt,
          updatedAt: now,
          createdBy: current.createdBy,
          updatedBy: params.actor,
        }
      : {
          ...clone(params.policy),
          id: id('autopol'),
          accountId: params.accountId,
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: params.actor,
          updatedBy: params.actor,
        };

    this.policies.set(params.accountId, next);

    const revision: AutomationPolicyRevision = {
      id: id('autopolrev'),
      accountId: params.accountId,
      policyId: next.id,
      version: next.version,
      snapshot: clone(next),
      changedAt: now,
      changedBy: params.actor,
      reason: current ? 'UPDATED' : 'CREATED',
    };
    this.revisions.set(revision.id, revision);
    this.save();

    return clone(next);
  }

  public listHistory(params: {
    accountId: string;
    limit?: number;
  }): AutomationPolicyRevision[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    return Array.from(this.revisions.values())
      .filter((revision) => revision.accountId === params.accountId)
      .sort((a, b) => b.changedAt - a.changedAt)
      .slice(0, limit)
      .map(clone);
  }
}

export const automationPolicyStore = new AutomationPolicyStore();
