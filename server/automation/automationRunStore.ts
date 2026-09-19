import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AutomationRun } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const RUN_FILE = path.join(
  DATA_DIR,
  'automation-runs.json'
);

type PersistedRunState = {
  runs: AutomationRun[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function runId(): string {
  return 'autorun_' + crypto.randomBytes(10).toString('hex');
}

export class AutomationRunAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code = 'AUTOMATION_RUN_NOT_FOUND';

  constructor() {
    super('Automation run not found in the current account scope.');
    this.name = 'AutomationRunAccessError';
  }
}

export class AutomationRunStore {
  private runs = new Map<string, AutomationRun>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(RUN_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(RUN_FILE, 'utf8')
      ) as Partial<PersistedRunState>;
      for (const run of parsed.runs || []) {
        this.runs.set(run.id, run);
      }
    } catch (error) {
      console.warn(
        'Could not load automation run state; starting empty:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const state: PersistedRunState = {
      runs: Array.from(this.runs.values()).slice(-25000),
    };
    const temporary = RUN_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, RUN_FILE);
  }

  public create(
    params: Omit<
      AutomationRun,
      'id' | 'startedAt' | 'updatedAt'
    >
  ): AutomationRun {
    const now = Date.now();
    const run: AutomationRun = {
      ...clone(params),
      id: runId(),
      startedAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    this.save();
    return clone(run);
  }

  public get(
    accountId: string,
    id: string
  ): AutomationRun | null {
    const run = this.runs.get(id);
    if (!run || run.accountId !== accountId) return null;
    return clone(run);
  }

  public require(
    accountId: string,
    id: string
  ): AutomationRun {
    const run = this.get(accountId, id);
    if (!run) throw new AutomationRunAccessError();
    return run;
  }

  public update(
    accountId: string,
    id: string,
    updates: Partial<AutomationRun>
  ): AutomationRun {
    const current = this.require(accountId, id);
    const updated: AutomationRun = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      proposalId: current.proposalId,
      updatedAt: Date.now(),
    };
    this.runs.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public setFeedback(params: {
    accountId: string;
    runId: string;
    feedback: import('./types.js').AutomationRunFeedback;
    actor: string;
    note?: string;
  }): AutomationRun {
    return this.update(params.accountId, params.runId, {
      feedback: params.feedback,
      feedbackAt: Date.now(),
      feedbackBy: params.actor,
      feedbackNote: params.note?.trim() || undefined,
    });
  }

  public listAll(accountId: string): AutomationRun[] {
    return Array.from(this.runs.values())
      .filter((run) => run.accountId === accountId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(clone);
  }

  public list(params: {
    accountId: string;
    proposalId?: string;
    status?: AutomationRun['status'];
    limit?: number;
  }): AutomationRun[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    return Array.from(this.runs.values())
      .filter(
        (run) =>
          run.accountId === params.accountId &&
          (!params.proposalId ||
            run.proposalId === params.proposalId) &&
          (!params.status || run.status === params.status)
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map(clone);
  }
}

export const automationRunStore =
  new AutomationRunStore();
