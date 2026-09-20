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

export interface WatchRepository {
  getRule(accountId: string, ruleId: string): Promise<WatchRule | null>;
  listRules(params: {
    accountId: string;
    status?: WatchRuleStatus;
    limit?: number;
  }): Promise<WatchRule[]>;
  saveRule(rule: WatchRule): Promise<void>;

  getDraft(accountId: string, draftId: string): Promise<WatchDraft | null>;
  saveDraft(draft: WatchDraft): Promise<void>;

  getEvaluation(
    accountId: string,
    evaluationId: string
  ): Promise<WatchEvaluation | null>;
  saveEvaluation(evaluation: WatchEvaluation): Promise<void>;

  getAlert(accountId: string, alertId: string): Promise<WatchAlert | null>;
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
