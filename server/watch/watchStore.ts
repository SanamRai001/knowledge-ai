import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  WatchAlert,
  WatchAlertStatus,
  WatchEvaluation,
  WatchRule,
  WatchRuleStatus,
  WatchDraft,
  WatchJob,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const WATCH_FILE = path.join(DATA_DIR, 'watch.json');

type PersistedWatchState = {
  rules: WatchRule[];
  evaluations: WatchEvaluation[];
  alerts: WatchAlert[];
  drafts: WatchDraft[];
  jobs: WatchJob[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

export class WatchAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code:
    | 'WATCH_RULE_NOT_FOUND'
    | 'WATCH_DRAFT_NOT_FOUND'
    | 'WATCH_JOB_NOT_FOUND'
    | 'WATCH_EVALUATION_NOT_FOUND'
    | 'WATCH_ALERT_NOT_FOUND';

  constructor(
    code:
      | 'WATCH_RULE_NOT_FOUND'
      | 'WATCH_DRAFT_NOT_FOUND'
      | 'WATCH_JOB_NOT_FOUND'
      | 'WATCH_EVALUATION_NOT_FOUND'
      | 'WATCH_ALERT_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'WatchAccessError';
    this.code = code;
  }
}

export class WatchStateError extends Error {
  public readonly statusCode = 409;
  public readonly code:
    | 'WATCH_RULE_ARCHIVED'
    | 'WATCH_ALERT_NOT_ACTIONABLE';

  constructor(
    code: 'WATCH_RULE_ARCHIVED' | 'WATCH_ALERT_NOT_ACTIONABLE',
    message: string
  ) {
    super(message);
    this.name = 'WatchStateError';
    this.code = code;
  }
}

export class WatchStore {
  private rules = new Map<string, WatchRule>();
  private evaluations = new Map<string, WatchEvaluation>();
  private alerts = new Map<string, WatchAlert>();
  private drafts = new Map<string, WatchDraft>();
  private jobs = new Map<string, WatchJob>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(WATCH_FILE)) return;

      const parsed = JSON.parse(
        fs.readFileSync(WATCH_FILE, 'utf8')
      ) as Partial<PersistedWatchState>;

      for (const rule of parsed.rules || []) {
        this.rules.set(rule.id, rule);
      }
      for (const evaluation of parsed.evaluations || []) {
        this.evaluations.set(evaluation.id, evaluation);
      }
      for (const alert of parsed.alerts || []) {
        this.alerts.set(alert.id, alert);
      }
      for (const draft of parsed.drafts || []) {
        this.drafts.set(draft.id, draft);
      }
      for (const job of parsed.jobs || []) {
        this.jobs.set(job.id, job);
      }
    } catch (error) {
      console.warn(
        'Could not load watch runtime state; starting empty:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedWatchState = {
      rules: Array.from(this.rules.values()).slice(-5000),
      evaluations: Array.from(this.evaluations.values()).slice(-25000),
      alerts: Array.from(this.alerts.values()).slice(-10000),
      drafts: Array.from(this.drafts.values()).slice(-5000),
      jobs: Array.from(this.jobs.values()).slice(-25000),
    };

    const temporary = WATCH_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, WATCH_FILE);
  }

  public createDraft(
    input: Omit<WatchDraft, 'id' | 'createdAt' | 'updatedAt'>
  ): WatchDraft {
    const now = Date.now();
    const draft: WatchDraft = {
      ...clone(input),
      id: id('wdr'),
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.set(draft.id, draft);
    this.save();
    return clone(draft);
  }

  public getDraft(
    accountId: string,
    draftId: string
  ): WatchDraft | null {
    const draft = this.drafts.get(draftId);
    if (!draft || draft.accountId !== accountId) return null;
    return clone(draft);
  }

  public requireDraft(
    accountId: string,
    draftId: string
  ): WatchDraft {
    const draft = this.getDraft(accountId, draftId);
    if (!draft) {
      throw new WatchAccessError(
        'WATCH_DRAFT_NOT_FOUND',
        'Watch draft not found in the current account scope.'
      );
    }
    return draft;
  }

  public updateDraft(
    accountId: string,
    draftId: string,
    updates: Partial<WatchDraft>
  ): WatchDraft {
    const current = this.requireDraft(accountId, draftId);
    const updated: WatchDraft = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      updatedAt: Date.now(),
    };
    this.drafts.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public listDrafts(params: {
    accountId: string;
    limit?: number;
  }): WatchDraft[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 500));
    return Array.from(this.drafts.values())
      .filter((draft) => draft.accountId === params.accountId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(clone);
  }

  public ensureJob(params: {
    accountId: string;
    watchRuleId: string;
    ruleVersion: number;
    scheduledFor: number;
    maxAttempts?: number;
  }): WatchJob {
    const fingerprint = [
      params.accountId,
      params.watchRuleId,
      params.ruleVersion,
      params.scheduledFor,
    ].join(':');

    const existing = Array.from(this.jobs.values()).find(
      (job) =>
        job.accountId === params.accountId &&
        job.fingerprint === fingerprint
    );
    if (existing) return clone(existing);

    const now = Date.now();
    const job: WatchJob = {
      id: id('wjob'),
      fingerprint,
      accountId: params.accountId,
      watchRuleId: params.watchRuleId,
      ruleVersion: params.ruleVersion,
      scheduledFor: params.scheduledFor,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: Math.max(1, Math.min(params.maxAttempts || 3, 10)),
      nextAttemptAt: params.scheduledFor,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.save();
    return clone(job);
  }

  public getJob(accountId: string, jobId: string): WatchJob | null {
    const job = this.jobs.get(jobId);
    if (!job || job.accountId !== accountId) return null;
    return clone(job);
  }

  public listJobs(params: {
    accountId?: string;
    watchRuleId?: string;
    status?: WatchJob['status'];
    readyAt?: number;
    limit?: number;
  }): WatchJob[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    return Array.from(this.jobs.values())
      .filter(
        (job) =>
          (!params.accountId || job.accountId === params.accountId) &&
          (!params.watchRuleId ||
            job.watchRuleId === params.watchRuleId) &&
          (!params.status || job.status === params.status) &&
          (params.readyAt === undefined ||
            job.nextAttemptAt <= params.readyAt)
      )
      .sort(
        (a, b) =>
          a.nextAttemptAt - b.nextAttemptAt ||
          a.createdAt - b.createdAt
      )
      .slice(0, limit)
      .map(clone);
  }

  public updateJob(
    jobId: string,
    updates: Partial<WatchJob>
  ): WatchJob {
    const current = this.jobs.get(jobId);
    if (!current) {
      throw new WatchAccessError(
        'WATCH_JOB_NOT_FOUND',
        'Watch job not found in the current account scope.'
      );
    }
    const updated: WatchJob = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      fingerprint: current.fingerprint,
      updatedAt: Date.now(),
    };
    this.jobs.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public listDueIntervalRules(now: number): WatchRule[] {
    return Array.from(this.rules.values())
      .filter(
        (rule) =>
          rule.status === 'ACTIVE' &&
          rule.evaluationMode === 'INTERVAL' &&
          typeof rule.nextEvaluationAt === 'number' &&
          rule.nextEvaluationAt <= now
      )
      .sort(
        (a, b) =>
          (a.nextEvaluationAt || 0) - (b.nextEvaluationAt || 0)
      )
      .map(clone);
  }

  public requeueStaleRunningJobs(params: {
    now: number;
    leaseMs: number;
  }): WatchJob[] {
    const recovered: WatchJob[] = [];
    for (const job of this.jobs.values()) {
      if (
        job.status !== 'RUNNING' ||
        !job.startedAt ||
        job.startedAt + params.leaseMs > params.now
      ) {
        continue;
      }

      const updated: WatchJob = {
        ...job,
        status: 'PENDING',
        nextAttemptAt: params.now,
        startedAt: undefined,
        lastError:
          'Recovered stale RUNNING job after worker restart/lease expiry.',
        updatedAt: Date.now(),
      };
      this.jobs.set(updated.id, updated);
      recovered.push(clone(updated));
    }
    if (recovered.length > 0) this.save();
    return recovered;
  }

  public createRule(
    input: Omit<
      WatchRule,
      'id' | 'version' | 'currentState' | 'createdAt' | 'updatedAt'
    >
  ): WatchRule {
    const now = Date.now();
    const rule: WatchRule = {
      ...clone(input),
      id: id('wat'),
      version: 1,
      currentState: 'UNKNOWN',
      createdAt: now,
      updatedAt: now,
    };

    this.rules.set(rule.id, rule);
    this.save();
    return clone(rule);
  }

  public getRule(
    accountId: string,
    ruleId: string
  ): WatchRule | null {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.accountId !== accountId) return null;
    return clone(rule);
  }

  public requireRule(
    accountId: string,
    ruleId: string
  ): WatchRule {
    const rule = this.getRule(accountId, ruleId);
    if (!rule) {
      throw new WatchAccessError(
        'WATCH_RULE_NOT_FOUND',
        'Watch rule not found in the current account scope.'
      );
    }
    return rule;
  }

  public updateRule(
    accountId: string,
    ruleId: string,
    updates: Partial<
      Pick<
        WatchRule,
        | 'name'
        | 'description'
        | 'status'
        | 'condition'
        | 'evaluationMode'
        | 'intervalMinutes'
        | 'currentState'
        | 'lastEvaluationAt'
        | 'lastTriggeredAt'
        | 'nextEvaluationAt'
      >
    >,
    options?: { bumpVersion?: boolean }
  ): WatchRule {
    const current = this.requireRule(accountId, ruleId);

    if (
      current.status === 'ARCHIVED' &&
      updates.status !== 'ARCHIVED'
    ) {
      throw new WatchStateError(
        'WATCH_RULE_ARCHIVED',
        'Archived watch rules cannot be reactivated.'
      );
    }

    const updated: WatchRule = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      version: options?.bumpVersion
        ? current.version + 1
        : current.version,
      updatedAt: Date.now(),
    };

    this.rules.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public setRuleStatus(
    accountId: string,
    ruleId: string,
    status: WatchRuleStatus
  ): WatchRule {
    return this.updateRule(
      accountId,
      ruleId,
      { status },
      { bumpVersion: status !== this.requireRule(accountId, ruleId).status }
    );
  }

  public listRules(params: {
    accountId: string;
    status?: WatchRuleStatus;
    limit?: number;
  }): WatchRule[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 500));

    return Array.from(this.rules.values())
      .filter(
        (rule) =>
          rule.accountId === params.accountId &&
          (!params.status || rule.status === params.status)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(clone);
  }

  public saveEvaluation(
    evaluation: WatchEvaluation
  ): WatchEvaluation {
    this.evaluations.set(evaluation.id, clone(evaluation));
    this.save();
    return clone(evaluation);
  }

  public createEvaluation(
    input: Omit<WatchEvaluation, 'id'>
  ): WatchEvaluation {
    return this.saveEvaluation({
      ...clone(input),
      id: id('wev'),
    });
  }

  public getEvaluation(
    accountId: string,
    evaluationId: string
  ): WatchEvaluation | null {
    const evaluation = this.evaluations.get(evaluationId);
    if (!evaluation || evaluation.accountId !== accountId) return null;
    return clone(evaluation);
  }

  public listEvaluations(params: {
    accountId: string;
    watchRuleId?: string;
    limit?: number;
  }): WatchEvaluation[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));

    if (params.watchRuleId) {
      this.requireRule(params.accountId, params.watchRuleId);
    }

    return Array.from(this.evaluations.values())
      .filter(
        (evaluation) =>
          evaluation.accountId === params.accountId &&
          (!params.watchRuleId ||
            evaluation.watchRuleId === params.watchRuleId)
      )
      .sort((a, b) => b.evaluatedAt - a.evaluatedAt)
      .slice(0, limit)
      .map(clone);
  }

  public getActiveAlertForRule(
    accountId: string,
    watchRuleId: string
  ): WatchAlert | null {
    this.requireRule(accountId, watchRuleId);

    const alert = Array.from(this.alerts.values())
      .filter(
        (item) =>
          item.accountId === accountId &&
          item.watchRuleId === watchRuleId &&
          item.status !== 'RESOLVED'
      )
      .sort((a, b) => b.lastTriggeredAt - a.lastTriggeredAt)[0];

    return alert ? clone(alert) : null;
  }

  public createAlert(
    input: Omit<
      WatchAlert,
      'id' | 'episodeKey' | 'createdAt' | 'updatedAt'
    >
  ): WatchAlert {
    const now = Date.now();
    const alertId = id('wal');
    const alert: WatchAlert = {
      ...clone(input),
      id: alertId,
      episodeKey:
        input.watchRuleId +
        ':' +
        input.firstTriggeredAt +
        ':' +
        alertId,
      createdAt: now,
      updatedAt: now,
    };
    this.alerts.set(alert.id, alert);
    this.save();
    return clone(alert);
  }

  public recordRepeatedTrigger(params: {
    accountId: string;
    alertId: string;
    evaluationId: string;
    triggeredAt: number;
    evidence: WatchAlert['evidence'];
  }): WatchAlert {
    const current = this.requireAlert(params.accountId, params.alertId);
    if (current.status === 'RESOLVED') {
      throw new WatchStateError(
        'WATCH_ALERT_NOT_ACTIONABLE',
        'Resolved alert episodes cannot receive another trigger.'
      );
    }

    const evaluationIds = current.evaluationIds.includes(
      params.evaluationId
    )
      ? current.evaluationIds
      : [...current.evaluationIds, params.evaluationId];

    const updated: WatchAlert = {
      ...current,
      lastTriggeredAt: Math.max(
        current.lastTriggeredAt,
        params.triggeredAt
      ),
      occurrenceCount:
        current.occurrenceCount +
        (current.evaluationIds.includes(params.evaluationId) ? 0 : 1),
      evaluationIds,
      lastEvaluationId: params.evaluationId,
      evidence: clone(params.evidence),
      updatedAt: Date.now(),
    };
    this.alerts.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public getAlert(
    accountId: string,
    alertId: string
  ): WatchAlert | null {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.accountId !== accountId) return null;
    return clone(alert);
  }

  public requireAlert(
    accountId: string,
    alertId: string
  ): WatchAlert {
    const alert = this.getAlert(accountId, alertId);
    if (!alert) {
      throw new WatchAccessError(
        'WATCH_ALERT_NOT_FOUND',
        'Watch alert not found in the current account scope.'
      );
    }
    return alert;
  }

  public listAlerts(params: {
    accountId: string;
    watchRuleId?: string;
    status?: WatchAlertStatus;
    limit?: number;
  }): WatchAlert[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));

    if (params.watchRuleId) {
      this.requireRule(params.accountId, params.watchRuleId);
    }

    return Array.from(this.alerts.values())
      .filter(
        (alert) =>
          alert.accountId === params.accountId &&
          (!params.watchRuleId ||
            alert.watchRuleId === params.watchRuleId) &&
          (!params.status || alert.status === params.status)
      )
      .sort(
        (a, b) =>
          b.lastTriggeredAt - a.lastTriggeredAt ||
          b.createdAt - a.createdAt
      )
      .slice(0, limit)
      .map(clone);
  }

  public updateAlertStatus(params: {
    accountId: string;
    alertId: string;
    status: WatchAlertStatus;
    snoozedUntil?: number;
    at?: number;
  }): WatchAlert {
    const current = this.requireAlert(
      params.accountId,
      params.alertId
    );
    const at = params.at ?? Date.now();

    if (
      current.status === 'RESOLVED' &&
      params.status !== 'RESOLVED'
    ) {
      throw new WatchStateError(
        'WATCH_ALERT_NOT_ACTIONABLE',
        'Resolved alert episodes cannot be reopened. A later false→true watch transition creates a new episode.'
      );
    }

    const updated: WatchAlert = {
      ...current,
      status: params.status,
      acknowledgedAt:
        params.status === 'ACKNOWLEDGED'
          ? current.acknowledgedAt || at
          : current.acknowledgedAt,
      resolvedAt:
        params.status === 'RESOLVED'
          ? current.resolvedAt || at
          : current.resolvedAt,
      snoozedUntil:
        params.status === 'SNOOZED'
          ? params.snoozedUntil
          : params.status === 'RESOLVED'
            ? undefined
            : current.snoozedUntil,
      updatedAt: Date.now(),
    };

    this.alerts.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public resolveActiveAlertForRule(params: {
    accountId: string;
    watchRuleId: string;
    at?: number;
  }): WatchAlert | null {
    const active = this.getActiveAlertForRule(
      params.accountId,
      params.watchRuleId
    );
    if (!active) return null;

    return this.updateAlertStatus({
      accountId: params.accountId,
      alertId: active.id,
      status: 'RESOLVED',
      at: params.at,
    });
  }
}

export const watchStore = new WatchStore();
