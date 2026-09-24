import crypto from 'crypto';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import { postgresWatchRepository } from '../persistence/a4PostgresRepositories.js';
import type {
  WatchJobEvaluationCommitInput,
  WatchJobEvaluationCommitResult,
  WatchJobTerminalFailureCommitInput,
  WatchJobTerminalFailureCommitResult,
} from '../persistence/a4Types.js';
import { postgresAccountRepository } from '../persistence/postgresRepositories.js';
import {
  WatchAccessError,
  WatchStateError,
  watchStore,
} from './watchStore.js';
import type {
  WatchAlert,
  WatchAlertStatus,
  WatchDraft,
  WatchEvaluation,
  WatchJob,
  WatchRule,
  WatchRuleStatus,
} from './types.js';

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class WatchPersistence {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  public async createDraft(
    input: Omit<WatchDraft, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<WatchDraft> {
    if (!this.usesPostgres()) {
      return watchStore.createDraft(input);
    }
    await postgresAccountRepository.ensureAccount(input.accountId);
    const now = Date.now();
    const draft: WatchDraft = {
      ...clone(input),
      id: id('wdr'),
      createdAt: now,
      updatedAt: now,
    };
    await postgresWatchRepository.saveDraft(draft);
    return draft;
  }

  public async getDraft(
    accountId: string,
    draftId: string
  ): Promise<WatchDraft | null> {
    if (!this.usesPostgres()) {
      return watchStore.getDraft(accountId, draftId);
    }
    return postgresWatchRepository.getDraft(accountId, draftId);
  }

  public async requireDraft(
    accountId: string,
    draftId: string
  ): Promise<WatchDraft> {
    const draft = await this.getDraft(accountId, draftId);
    if (!draft) {
      throw new WatchAccessError(
        'WATCH_DRAFT_NOT_FOUND',
        'Watch draft not found in the current account scope.'
      );
    }
    return draft;
  }

  public async updateDraft(
    accountId: string,
    draftId: string,
    updates: Partial<WatchDraft>
  ): Promise<WatchDraft> {
    if (!this.usesPostgres()) {
      return watchStore.updateDraft(accountId, draftId, updates);
    }
    const current = await this.requireDraft(accountId, draftId);
    const updated: WatchDraft = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      updatedAt: Date.now(),
    };
    await postgresWatchRepository.saveDraft(updated);
    return updated;
  }

  public async listDrafts(params: {
    accountId: string;
    limit?: number;
  }): Promise<WatchDraft[]> {
    if (!this.usesPostgres()) {
      return watchStore.listDrafts(params);
    }
    return postgresWatchRepository.listDrafts(params);
  }

  public async createRule(
    input: Omit<
      WatchRule,
      'id' | 'version' | 'currentState' | 'createdAt' | 'updatedAt'
    >
  ): Promise<WatchRule> {
    if (!this.usesPostgres()) {
      return watchStore.createRule(input);
    }
    await postgresAccountRepository.ensureAccount(input.accountId);
    const now = Date.now();
    const rule: WatchRule = {
      ...clone(input),
      id: id('wat'),
      version: 1,
      currentState: 'UNKNOWN',
      createdAt: now,
      updatedAt: now,
    };
    await postgresWatchRepository.saveRule(rule);
    return rule;
  }

  public async getRule(
    accountId: string,
    ruleId: string
  ): Promise<WatchRule | null> {
    if (!this.usesPostgres()) {
      return watchStore.getRule(accountId, ruleId);
    }
    return postgresWatchRepository.getRule(accountId, ruleId);
  }

  public async requireRule(
    accountId: string,
    ruleId: string
  ): Promise<WatchRule> {
    const rule = await this.getRule(accountId, ruleId);
    if (!rule) {
      throw new WatchAccessError(
        'WATCH_RULE_NOT_FOUND',
        'Watch rule not found in the current account scope.'
      );
    }
    return rule;
  }

  public async updateRule(
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
  ): Promise<WatchRule> {
    if (!this.usesPostgres()) {
      return watchStore.updateRule(
        accountId,
        ruleId,
        updates,
        options
      );
    }

    const current = await this.requireRule(accountId, ruleId);
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
    await postgresWatchRepository.saveRule(updated);
    return updated;
  }

  public async setRuleStatus(
    accountId: string,
    ruleId: string,
    status: WatchRuleStatus
  ): Promise<WatchRule> {
    if (!this.usesPostgres()) {
      return watchStore.setRuleStatus(accountId, ruleId, status);
    }
    const current = await this.requireRule(accountId, ruleId);
    return this.updateRule(
      accountId,
      ruleId,
      { status },
      { bumpVersion: status !== current.status }
    );
  }

  public async listRules(params: {
    accountId: string;
    status?: WatchRuleStatus;
    limit?: number;
  }): Promise<WatchRule[]> {
    if (!this.usesPostgres()) {
      return watchStore.listRules(params);
    }
    return postgresWatchRepository.listRules(params);
  }

  public async createEvaluation(
    input: Omit<WatchEvaluation, 'id'>
  ): Promise<WatchEvaluation> {
    const evaluation: WatchEvaluation = {
      ...clone(input),
      id: id('wev'),
    };
    if (!this.usesPostgres()) {
      return watchStore.saveEvaluation(evaluation);
    }
    await postgresWatchRepository.saveEvaluation(evaluation);
    return evaluation;
  }

  public async getEvaluation(
    accountId: string,
    evaluationId: string
  ): Promise<WatchEvaluation | null> {
    if (!this.usesPostgres()) {
      return watchStore.getEvaluation(accountId, evaluationId);
    }
    return postgresWatchRepository.getEvaluation(
      accountId,
      evaluationId
    );
  }

  public async listEvaluations(params: {
    accountId: string;
    watchRuleId?: string;
    limit?: number;
  }): Promise<WatchEvaluation[]> {
    if (!this.usesPostgres()) {
      return watchStore.listEvaluations(params);
    }
    if (params.watchRuleId) {
      await this.requireRule(params.accountId, params.watchRuleId);
    }
    return postgresWatchRepository.listEvaluations(params);
  }

  public async getAlert(
    accountId: string,
    alertId: string
  ): Promise<WatchAlert | null> {
    if (!this.usesPostgres()) {
      return watchStore.getAlert(accountId, alertId);
    }
    return postgresWatchRepository.getAlert(accountId, alertId);
  }

  public async requireAlert(
    accountId: string,
    alertId: string
  ): Promise<WatchAlert> {
    const alert = await this.getAlert(accountId, alertId);
    if (!alert) {
      throw new WatchAccessError(
        'WATCH_ALERT_NOT_FOUND',
        'Watch alert not found in the current account scope.'
      );
    }
    return alert;
  }

  public async listAlerts(params: {
    accountId: string;
    watchRuleId?: string;
    status?: WatchAlertStatus;
    limit?: number;
  }): Promise<WatchAlert[]> {
    if (!this.usesPostgres()) {
      return watchStore.listAlerts(params);
    }
    if (params.watchRuleId) {
      await this.requireRule(params.accountId, params.watchRuleId);
    }
    return postgresWatchRepository.listAlerts(params);
  }

  public async getActiveAlertForRule(
    accountId: string,
    watchRuleId: string
  ): Promise<WatchAlert | null> {
    if (!this.usesPostgres()) {
      return watchStore.getActiveAlertForRule(
        accountId,
        watchRuleId
      );
    }
    await this.requireRule(accountId, watchRuleId);
    return postgresWatchRepository.getActiveAlertForRule(
      accountId,
      watchRuleId
    );
  }

  public async createAlert(
    input: Omit<
      WatchAlert,
      'id' | 'episodeKey' | 'createdAt' | 'updatedAt'
    >
  ): Promise<WatchAlert> {
    if (!this.usesPostgres()) {
      return watchStore.createAlert(input);
    }

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
    await postgresWatchRepository.saveAlert(alert);
    return alert;
  }

  public async recordRepeatedTrigger(params: {
    accountId: string;
    alertId: string;
    evaluationId: string;
    triggeredAt: number;
    evidence: WatchAlert['evidence'];
  }): Promise<WatchAlert> {
    if (!this.usesPostgres()) {
      return watchStore.recordRepeatedTrigger(params);
    }

    const current = await this.requireAlert(
      params.accountId,
      params.alertId
    );
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

    const snoozeExpired =
      current.status === 'SNOOZED' &&
      typeof current.snoozedUntil === 'number' &&
      current.snoozedUntil <= params.triggeredAt;

    const updated: WatchAlert = {
      ...current,
      status: snoozeExpired ? 'OPEN' : current.status,
      snoozedUntil: snoozeExpired
        ? undefined
        : current.snoozedUntil,
      lastTriggeredAt: Math.max(
        current.lastTriggeredAt,
        params.triggeredAt
      ),
      occurrenceCount:
        current.occurrenceCount +
        (current.evaluationIds.includes(params.evaluationId)
          ? 0
          : 1),
      evaluationIds,
      lastEvaluationId: params.evaluationId,
      evidence: clone(params.evidence),
      updatedAt: Date.now(),
    };
    await postgresWatchRepository.saveAlert(updated);
    return updated;
  }

  public async updateAlertStatus(params: {
    accountId: string;
    alertId: string;
    status: WatchAlertStatus;
    snoozedUntil?: number;
    resolutionReason?: 'CONDITION_CLEARED' | 'USER_RESOLVED';
    at?: number;
  }): Promise<WatchAlert> {
    if (!this.usesPostgres()) {
      return watchStore.updateAlertStatus(params);
    }

    const current = await this.requireAlert(
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
      resolutionReason:
        params.status === 'RESOLVED'
          ? params.resolutionReason ||
            current.resolutionReason
          : current.resolutionReason,
      snoozedUntil:
        params.status === 'SNOOZED'
          ? params.snoozedUntil
          : params.status === 'RESOLVED'
            ? undefined
            : current.snoozedUntil,
      updatedAt: Date.now(),
    };
    await postgresWatchRepository.saveAlert(updated);
    return updated;
  }

  public async resolveActiveAlertForRule(params: {
    accountId: string;
    watchRuleId: string;
    at?: number;
  }): Promise<WatchAlert | null> {
    const active = await this.getActiveAlertForRule(
      params.accountId,
      params.watchRuleId
    );
    if (!active) return null;
    return this.updateAlertStatus({
      accountId: params.accountId,
      alertId: active.id,
      status: 'RESOLVED',
      resolutionReason: 'CONDITION_CLEARED',
      at: params.at,
    });
  }

  public async ensureJob(params: {
    accountId: string;
    watchRuleId: string;
    ruleVersion: number;
    scheduledFor: number;
    maxAttempts?: number;
  }): Promise<WatchJob> {
    if (!this.usesPostgres()) {
      return watchStore.ensureJob(params);
    }

    const now = Date.now();
    const job: WatchJob = {
      id: id('wjob'),
      fingerprint: [
        params.accountId,
        params.watchRuleId,
        params.ruleVersion,
        params.scheduledFor,
      ].join(':'),
      accountId: params.accountId,
      watchRuleId: params.watchRuleId,
      ruleVersion: params.ruleVersion,
      scheduledFor: params.scheduledFor,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: Math.max(
        1,
        Math.min(params.maxAttempts || 3, 10)
      ),
      nextAttemptAt: params.scheduledFor,
      createdAt: now,
      updatedAt: now,
    };
    return postgresWatchRepository.ensureJob(job);
  }

  public async getJob(
    accountId: string,
    jobId: string
  ): Promise<WatchJob | null> {
    if (!this.usesPostgres()) {
      return watchStore.getJob(accountId, jobId);
    }
    return postgresWatchRepository.getJob(accountId, jobId);
  }

  public async updateJob(
    accountId: string,
    jobId: string,
    updates: Partial<WatchJob>
  ): Promise<WatchJob> {
    if (!this.usesPostgres()) {
      const current = watchStore.getJob(accountId, jobId);
      if (!current) {
        throw new WatchAccessError(
          'WATCH_JOB_NOT_FOUND',
          'Watch job not found in the current account scope.'
        );
      }
      return watchStore.updateJob(jobId, updates);
    }

    const current = await this.getJob(accountId, jobId);
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
    await postgresWatchRepository.saveJob(updated);
    return updated;
  }

  public async listJobs(params: {
    accountId: string;
    watchRuleId?: string;
    status?: WatchJob['status'];
    limit?: number;
  }): Promise<WatchJob[]> {
    if (!this.usesPostgres()) {
      return watchStore.listJobs(params);
    }
    return postgresWatchRepository.listJobs(params);
  }

  public async listDueIntervalRules(
    now: number
  ): Promise<WatchRule[]> {
    if (!this.usesPostgres()) {
      return watchStore.listDueIntervalRules(now);
    }
    return postgresWatchRepository.listDueIntervalRules({
      now,
      limit: 5000,
    });
  }

  public async requeueStaleRunningJobs(params: {
    now: number;
    leaseMs: number;
  }): Promise<WatchJob[]> {
    if (!this.usesPostgres()) {
      return watchStore.requeueStaleRunningJobs(params);
    }
    return postgresWatchRepository.requeueStaleRunningJobs(params);
  }

  public async claimReadyJob(params: {
    now: number;
    leaseStartedAt: number;
  }): Promise<WatchJob | null> {
    if (!this.usesPostgres()) {
      const ready = watchStore.listJobs({
        status: 'PENDING',
        readyAt: params.now,
        limit: 1,
      })[0];
      if (!ready) return null;
      return watchStore.updateJob(ready.id, {
        status: 'RUNNING',
        attemptCount: ready.attemptCount + 1,
        startedAt: params.leaseStartedAt,
        completedAt: undefined,
        lastError: undefined,
        skipReason: undefined,
      });
    }
    return postgresWatchRepository.claimReadyJob(params);
  }

  public async commitClaimedJobEvaluation(
    input: WatchJobEvaluationCommitInput
  ): Promise<WatchJobEvaluationCommitResult> {
    if (!this.usesPostgres()) {
      throw new Error(
        'Claimed Watch job evaluation transactions require PostgreSQL persistence.'
      );
    }
    return postgresWatchRepository
      .commitClaimedJobEvaluation(input);
  }

  public async commitClaimedJobTerminalFailure(
    input: WatchJobTerminalFailureCommitInput
  ): Promise<WatchJobTerminalFailureCommitResult> {
    if (!this.usesPostgres()) {
      throw new Error(
        'Claimed Watch job failure transactions require PostgreSQL persistence.'
      );
    }
    return postgresWatchRepository
      .commitClaimedJobTerminalFailure(input);
  }
}

export const watchPersistence = new WatchPersistence();
