import fs from 'fs';
import path from 'path';
import type {
  WatchAlert,
  WatchDraft,
  WatchEvaluation,
  WatchJob,
  WatchRule,
} from '../watch/types.js';
import type {
  ExternalImportState,
  IntegrationConnection,
  SyncRun,
} from '../integrations/types.js';
import {
  postgresIntegrationRepository,
  postgresWatchRepository,
} from './a4PostgresRepositories.js';
import { postgresPool } from './postgres.js';

type LegacyWatchState = {
  rules?: WatchRule[];
  evaluations?: WatchEvaluation[];
  alerts?: WatchAlert[];
  drafts?: WatchDraft[];
  jobs?: WatchJob[];
};

type LegacyIntegrationState = {
  connections?: IntegrationConnection[];
  syncRuns?: SyncRun[];
  imports?: ExternalImportState[];
};

export interface LegacyA4Snapshot {
  dataDir: string;
  rules: WatchRule[];
  evaluations: WatchEvaluation[];
  alerts: WatchAlert[];
  drafts: WatchDraft[];
  jobs: WatchJob[];
  connections: IntegrationConnection[];
  syncRuns: SyncRun[];
  imports: ExternalImportState[];
}

export interface LegacyA4Conflict {
  kind:
    | 'ACCOUNT'
    | 'WATCH_RULE'
    | 'WATCH_EVALUATION'
    | 'WATCH_ALERT'
    | 'WATCH_DRAFT'
    | 'WATCH_JOB'
    | 'INTEGRATION_CONNECTION'
    | 'SYNC_RUN'
    | 'EXTERNAL_IMPORT';
  id: string;
  message: string;
}

type CounterKey =
  | 'rules'
  | 'evaluations'
  | 'alerts'
  | 'drafts'
  | 'jobs'
  | 'connections'
  | 'syncRuns'
  | 'imports';

export interface LegacyA4ImportReport {
  dryRun: boolean;
  sourceDataDir: string;
  counts: Record<CounterKey, number>;
  imported: Record<CounterKey, number>;
  skippedExisting: number;
  conflicts: LegacyA4Conflict[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function canonical(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)])
    );
  }
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function readLegacyA4Snapshot(
  dataDir = path.join(process.cwd(), 'data')
): LegacyA4Snapshot {
  const watch = readJson<LegacyWatchState>(
    path.join(dataDir, 'watch.json'),
    {}
  );
  const integrations = readJson<LegacyIntegrationState>(
    path.join(dataDir, 'integrations.json'),
    {}
  );

  return {
    dataDir,
    rules: (watch.rules || []).map(clone),
    evaluations: (watch.evaluations || []).map(clone),
    alerts: (watch.alerts || []).map(clone),
    drafts: (watch.drafts || []).map(clone),
    jobs: (watch.jobs || []).map(clone),
    connections: (integrations.connections || []).map(clone),
    syncRuns: (integrations.syncRuns || []).map(clone),
    imports: (integrations.imports || []).map(clone),
  };
}

function reportFor(
  snapshot: LegacyA4Snapshot,
  dryRun: boolean
): LegacyA4ImportReport {
  return {
    dryRun,
    sourceDataDir: snapshot.dataDir,
    counts: {
      rules: snapshot.rules.length,
      evaluations: snapshot.evaluations.length,
      alerts: snapshot.alerts.length,
      drafts: snapshot.drafts.length,
      jobs: snapshot.jobs.length,
      connections: snapshot.connections.length,
      syncRuns: snapshot.syncRuns.length,
      imports: snapshot.imports.length,
    },
    imported: {
      rules: 0,
      evaluations: 0,
      alerts: 0,
      drafts: 0,
      jobs: 0,
      connections: 0,
      syncRuns: 0,
      imports: 0,
    },
    skippedExisting: 0,
    conflicts: [],
  };
}

async function knownAccounts(
  snapshot: LegacyA4Snapshot
): Promise<Set<string>> {
  const accountIds = new Set<string>();
  for (const collection of [
    snapshot.rules,
    snapshot.evaluations,
    snapshot.alerts,
    snapshot.drafts,
    snapshot.jobs,
    snapshot.connections,
    snapshot.syncRuns,
    snapshot.imports,
  ]) {
    for (const item of collection as Array<{ accountId: string }>) {
      accountIds.add(item.accountId);
    }
  }

  const known = new Set<string>();
  for (const accountId of accountIds) {
    const result = await postgresPool().query(
      'SELECT 1 FROM accounts WHERE id = $1',
      [accountId]
    );
    if (result.rowCount) known.add(accountId);
  }
  return known;
}

function validateSnapshot(
  snapshot: LegacyA4Snapshot,
  known: Set<string>,
  report: LegacyA4ImportReport
): void {
  const rules = new Map(
    snapshot.rules.map((item) => [item.id, item])
  );
  const evaluations = new Map(
    snapshot.evaluations.map((item) => [item.id, item])
  );
  const connections = new Map(
    snapshot.connections.map((item) => [item.id, item])
  );

  const checkAccount = (
    kind: LegacyA4Conflict['kind'],
    item: { id: string; accountId: string }
  ) => {
    if (!known.has(item.accountId)) {
      report.conflicts.push({
        kind,
        id: item.id,
        message:
          'Account ' +
          item.accountId +
          ' must exist before A4 records are imported.',
      });
    }
  };

  for (const rule of snapshot.rules) checkAccount('WATCH_RULE', rule);

  for (const evaluation of snapshot.evaluations) {
    checkAccount('WATCH_EVALUATION', evaluation);
    const rule = rules.get(evaluation.watchRuleId);
    if (!rule || rule.accountId !== evaluation.accountId) {
      report.conflicts.push({
        kind: 'WATCH_EVALUATION',
        id: evaluation.id,
        message:
          'Watch evaluation rule must exist in the same account.',
      });
    }
  }

  for (const alert of snapshot.alerts) {
    checkAccount('WATCH_ALERT', alert);
    const rule = rules.get(alert.watchRuleId);
    const evaluation = evaluations.get(alert.lastEvaluationId);
    if (
      !rule ||
      rule.accountId !== alert.accountId ||
      !evaluation ||
      evaluation.accountId !== alert.accountId ||
      evaluation.watchRuleId !== alert.watchRuleId
    ) {
      report.conflicts.push({
        kind: 'WATCH_ALERT',
        id: alert.id,
        message:
          'Watch alert rule and last evaluation must exist in the same account.',
      });
    }
  }

  for (const draft of snapshot.drafts) {
    checkAccount('WATCH_DRAFT', draft);
    if (draft.savedRuleId) {
      const rule = rules.get(draft.savedRuleId);
      if (!rule || rule.accountId !== draft.accountId) {
        report.conflicts.push({
          kind: 'WATCH_DRAFT',
          id: draft.id,
          message:
            'Saved Watch draft rule must exist in the same account.',
        });
      }
    }
  }

  for (const job of snapshot.jobs) {
    checkAccount('WATCH_JOB', job);
    const rule = rules.get(job.watchRuleId);
    const evaluation = job.evaluationId
      ? evaluations.get(job.evaluationId)
      : undefined;
    if (!rule || rule.accountId !== job.accountId) {
      report.conflicts.push({
        kind: 'WATCH_JOB',
        id: job.id,
        message: 'Watch job rule must exist in the same account.',
      });
    }
    if (
      job.evaluationId &&
      (!evaluation || evaluation.accountId !== job.accountId)
    ) {
      report.conflicts.push({
        kind: 'WATCH_JOB',
        id: job.id,
        message:
          'Watch job evaluation must exist in the same account.',
      });
    }
  }

  for (const connection of snapshot.connections) {
    checkAccount('INTEGRATION_CONNECTION', connection);
  }

  for (const run of snapshot.syncRuns) {
    checkAccount('SYNC_RUN', run);
    const connection = connections.get(run.connectionId);
    if (
      !connection ||
      connection.accountId !== run.accountId ||
      connection.provider !== run.provider
    ) {
      report.conflicts.push({
        kind: 'SYNC_RUN',
        id: run.id,
        message:
          'SyncRun connection/provider must exist in the same account.',
      });
    }
  }

  for (const imported of snapshot.imports) {
    checkAccount('EXTERNAL_IMPORT', imported);
    const connection = connections.get(imported.connectionId);
    if (
      !connection ||
      connection.accountId !== imported.accountId ||
      connection.provider !== imported.provider
    ) {
      report.conflicts.push({
        kind: 'EXTERNAL_IMPORT',
        id: imported.id,
        message:
          'External import connection/provider must exist in the same account.',
      });
    }
  }
}

async function importOne<T extends { id: string; accountId: string }>(params: {
  kind: LegacyA4Conflict['kind'];
  item: T;
  getExisting: () => Promise<T | null>;
  save: () => Promise<void>;
  report: LegacyA4ImportReport;
  counter: CounterKey;
}): Promise<void> {
  const existing = await params.getExisting();
  if (existing) {
    if (!same(existing, params.item)) {
      params.report.conflicts.push({
        kind: params.kind,
        id: params.item.id,
        message:
          params.kind +
          ' already exists with different persisted metadata.',
      });
    } else {
      params.report.skippedExisting += 1;
    }
    return;
  }

  await params.save();
  params.report.imported[params.counter] += 1;
}

export async function importLegacyA4(params: {
  dataDir?: string;
  dryRun?: boolean;
  snapshot?: LegacyA4Snapshot;
} = {}): Promise<LegacyA4ImportReport> {
  const snapshot =
    params.snapshot || readLegacyA4Snapshot(params.dataDir);
  const report = reportFor(snapshot, Boolean(params.dryRun));
  const accounts = await knownAccounts(snapshot);
  validateSnapshot(snapshot, accounts, report);

  if (params.dryRun || report.conflicts.length > 0) {
    return report;
  }

  for (const rule of snapshot.rules) {
    await importOne({
      kind: 'WATCH_RULE',
      item: rule,
      getExisting: () =>
        postgresWatchRepository.getRule(rule.accountId, rule.id),
      save: () => postgresWatchRepository.saveRule(rule),
      report,
      counter: 'rules',
    });
  }

  for (const evaluation of snapshot.evaluations) {
    await importOne({
      kind: 'WATCH_EVALUATION',
      item: evaluation,
      getExisting: () =>
        postgresWatchRepository.getEvaluation(
          evaluation.accountId,
          evaluation.id
        ),
      save: () =>
        postgresWatchRepository.saveEvaluation(evaluation),
      report,
      counter: 'evaluations',
    });
  }

  for (const alert of snapshot.alerts) {
    await importOne({
      kind: 'WATCH_ALERT',
      item: alert,
      getExisting: () =>
        postgresWatchRepository.getAlert(alert.accountId, alert.id),
      save: () => postgresWatchRepository.saveAlert(alert),
      report,
      counter: 'alerts',
    });
  }

  for (const draft of snapshot.drafts) {
    await importOne({
      kind: 'WATCH_DRAFT',
      item: draft,
      getExisting: () =>
        postgresWatchRepository.getDraft(draft.accountId, draft.id),
      save: () => postgresWatchRepository.saveDraft(draft),
      report,
      counter: 'drafts',
    });
  }

  for (const job of snapshot.jobs) {
    await importOne({
      kind: 'WATCH_JOB',
      item: job,
      getExisting: () =>
        postgresWatchRepository.getJob(job.accountId, job.id),
      save: () => postgresWatchRepository.saveJob(job),
      report,
      counter: 'jobs',
    });
  }

  for (const connection of snapshot.connections) {
    await importOne({
      kind: 'INTEGRATION_CONNECTION',
      item: connection,
      getExisting: () =>
        postgresIntegrationRepository.getConnection(
          connection.accountId,
          connection.id
        ),
      save: () =>
        postgresIntegrationRepository.saveConnection(connection),
      report,
      counter: 'connections',
    });
  }

  for (const run of snapshot.syncRuns) {
    await importOne({
      kind: 'SYNC_RUN',
      item: run,
      getExisting: () =>
        postgresIntegrationRepository.getSyncRun(
          run.accountId,
          run.id
        ),
      save: () => postgresIntegrationRepository.saveSyncRun(run),
      report,
      counter: 'syncRuns',
    });
  }

  for (const imported of snapshot.imports) {
    await importOne({
      kind: 'EXTERNAL_IMPORT',
      item: imported,
      getExisting: () =>
        postgresIntegrationRepository.getImport(
          imported.accountId,
          imported.id
        ),
      save: () =>
        postgresIntegrationRepository.saveImport(imported),
      report,
      counter: 'imports',
    });
  }

  return report;
}
