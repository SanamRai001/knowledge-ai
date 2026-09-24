import type {
  WatchAlert,
  WatchDraft,
  WatchEvaluation,
  WatchJob,
  WatchRule,
  WatchRuleStatus,
} from '../watch/types.js';
import type {
  ExternalImportState,
  IntegrationConnection,
  SyncRun,
} from '../integrations/types.js';

export interface WatchJobEvaluationCommitInput {
  accountId: string;
  jobId: string;
  expectedRuleVersion: number;
  completedAt: number;
  evaluation: WatchEvaluation;
  newAlert?: {
    id: string;
    episodeKey: string;
    title: string;
    summary: string;
  };
}

export interface WatchJobEvaluationCommitResult {
  job: WatchJob;
  rule: WatchRule;
  evaluation: WatchEvaluation;
  alert?: WatchAlert;
  idempotentReplay: boolean;
}

export interface WatchJobTerminalFailureCommitInput {
  accountId: string;
  jobId: string;
  expectedRuleVersion: number;
  failedAt: number;
  error: string;
}

export interface WatchJobTerminalFailureCommitResult {
  job: WatchJob;
  rule: WatchRule;
  idempotentReplay: boolean;
}

export interface WatchRepository {
  getRule(accountId: string, ruleId: string): Promise<WatchRule | null>;
  listRules(params: {
    accountId: string;
    status?: WatchRuleStatus;
    limit?: number;
  }): Promise<WatchRule[]>;
  saveRule(rule: WatchRule): Promise<void>;

  getDraft(accountId: string, draftId: string): Promise<WatchDraft | null>;
  listDrafts(params: {
    accountId: string;
    limit?: number;
  }): Promise<WatchDraft[]>;
  saveDraft(draft: WatchDraft): Promise<void>;

  getEvaluation(
    accountId: string,
    evaluationId: string
  ): Promise<WatchEvaluation | null>;
  saveEvaluation(evaluation: WatchEvaluation): Promise<void>;
  listEvaluations(params: {
    accountId: string;
    watchRuleId?: string;
    limit?: number;
  }): Promise<WatchEvaluation[]>;

  getAlert(accountId: string, alertId: string): Promise<WatchAlert | null>;
  listAlerts(params: {
    accountId: string;
    watchRuleId?: string;
    status?: WatchAlert['status'];
    limit?: number;
  }): Promise<WatchAlert[]>;
  getActiveAlertForRule(
    accountId: string,
    watchRuleId: string
  ): Promise<WatchAlert | null>;
  saveAlert(alert: WatchAlert): Promise<void>;

  getJob(accountId: string, jobId: string): Promise<WatchJob | null>;
  listJobs(params: {
    accountId: string;
    watchRuleId?: string;
    status?: WatchJob['status'];
    limit?: number;
  }): Promise<WatchJob[]>;
  saveJob(job: WatchJob): Promise<void>;
  ensureJob(job: WatchJob): Promise<WatchJob>;
  claimReadyJob(params: {
    now: number;
    leaseStartedAt: number;
  }): Promise<WatchJob | null>;
  listDueIntervalRules(params: {
    now: number;
    limit?: number;
  }): Promise<WatchRule[]>;
  requeueStaleRunningJobs(params: {
    now: number;
    leaseMs: number;
  }): Promise<WatchJob[]>;
  commitClaimedJobEvaluation(
    input: WatchJobEvaluationCommitInput
  ): Promise<WatchJobEvaluationCommitResult>;
  commitClaimedJobTerminalFailure(
    input: WatchJobTerminalFailureCommitInput
  ): Promise<WatchJobTerminalFailureCommitResult>;
}

export interface IntegrationRepository {
  getConnection(
    accountId: string,
    connectionId: string
  ): Promise<IntegrationConnection | null>;
  listConnections(accountId: string): Promise<IntegrationConnection[]>;
  saveConnection(connection: IntegrationConnection): Promise<void>;
  tryAcquireSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
    leaseExpiresAt: number;
    now: number;
  }): Promise<IntegrationConnection | null>;
  releaseSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
    now: number;
  }): Promise<IntegrationConnection | null>;

  getSyncRun(accountId: string, runId: string): Promise<SyncRun | null>;
  listSyncRuns(params: {
    accountId: string;
    connectionId?: string;
    limit?: number;
  }): Promise<SyncRun[]>;
  saveSyncRun(run: SyncRun): Promise<void>;

  getImport(
    accountId: string,
    importId: string
  ): Promise<ExternalImportState | null>;
  findExactImport(params: {
    accountId: string;
    connectionId: string;
    externalId: string;
    externalVersion: string;
  }): Promise<ExternalImportState | null>;
  listImports(params: {
    accountId: string;
    connectionId?: string;
    externalId?: string;
    limit?: number;
  }): Promise<ExternalImportState[]>;
  saveImport(importState: ExternalImportState): Promise<void>;
}

export interface IntegrationCheckpointCommitInput {
  accountId: string;
  connectionId: string;
  runId: string;
  expectedCursor?: string;
  nextCursor?: string;
  completedAt: number;
  imports: ExternalImportState[];
  run: SyncRun;
}

export interface IntegrationCheckpointCommitResult {
  connection: IntegrationConnection;
  run: SyncRun;
  imports: ExternalImportState[];
}

export interface IntegrationCheckpointRepository {
  commitSuccessfulCheckpoint(
    input: IntegrationCheckpointCommitInput
  ): Promise<IntegrationCheckpointCommitResult>;
}
