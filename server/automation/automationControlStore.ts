import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  AutomationControlRevision,
  AutomationControlState,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONTROL_FILE = path.join(
  DATA_DIR,
  'automation-control.json'
);

type PersistedControlState = {
  controls: AutomationControlState[];
  revisions: AutomationControlRevision[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function revisionId(): string {
  return 'autoctlrev_' + crypto.randomBytes(10).toString('hex');
}

export class AutomationControlStore {
  private controls = new Map<string, AutomationControlState>();
  private revisions = new Map<string, AutomationControlRevision>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(CONTROL_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(CONTROL_FILE, 'utf8')
      ) as Partial<PersistedControlState>;
      for (const control of parsed.controls || []) {
        this.controls.set(control.accountId, control);
      }
      for (const revision of parsed.revisions || []) {
        this.revisions.set(revision.id, revision);
      }
    } catch (error) {
      console.warn(
        'Could not load automation control state; starting enabled:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const state: PersistedControlState = {
      controls: Array.from(this.controls.values()).slice(-5000),
      revisions: Array.from(this.revisions.values()).slice(-25000),
    };
    const temporary = CONTROL_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, CONTROL_FILE);
  }

  public get(accountId: string): AutomationControlState {
    const existing = this.controls.get(accountId);
    if (existing) return clone(existing);
    return {
      accountId,
      version: 0,
      emergencyDisabled: false,
      updatedAt: 0,
      updatedBy: 'system:default',
    };
  }

  public set(params: {
    accountId: string;
    emergencyDisabled: boolean;
    actor: string;
    reason?: string;
  }): AutomationControlState {
    const current = this.controls.get(params.accountId);
    const now = Date.now();
    const next: AutomationControlState = {
      accountId: params.accountId,
      version: (current?.version || 0) + 1,
      emergencyDisabled: params.emergencyDisabled,
      reason: params.reason?.trim() || undefined,
      updatedAt: now,
      updatedBy: params.actor,
    };

    this.controls.set(params.accountId, next);
    const revision: AutomationControlRevision = {
      id: revisionId(),
      accountId: params.accountId,
      version: next.version,
      snapshot: clone(next),
      changedAt: now,
      changedBy: params.actor,
    };
    this.revisions.set(revision.id, revision);
    this.save();
    return clone(next);
  }

  public listHistory(params: {
    accountId: string;
    limit?: number;
  }): AutomationControlRevision[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    return Array.from(this.revisions.values())
      .filter((item) => item.accountId === params.accountId)
      .sort((a, b) => b.changedAt - a.changedAt)
      .slice(0, limit)
      .map(clone);
  }
}

export const automationControlStore =
  new AutomationControlStore();
