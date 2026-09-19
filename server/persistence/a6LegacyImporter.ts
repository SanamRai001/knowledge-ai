import fs from 'fs';
import path from 'path';
import type {
  AnalysisRun,
  Insight,
} from '../discovery/types.js';
import { postgresPool } from './postgres.js';
import { postgresDiscoveryRepository } from './a6PostgresRepositories.js';

export interface LegacyA6Snapshot {
  dataDir: string;
  runs: AnalysisRun[];
  insights: Insight[];
}

export interface LegacyA6Conflict {
  kind:
    | 'ANALYSIS_RUN'
    | 'INSIGHT'
    | 'RUN_INSIGHT_MEMBERSHIP';
  id: string;
  message: string;
}

export interface LegacyA6ImportReport {
  dryRun: boolean;
  sourceDataDir: string;
  counts: {
    runs: number;
    insights: number;
    memberships: number;
  };
  imported: {
    runs: number;
    insights: number;
    memberships: number;
  };
  skippedExisting: number;
  conflicts: LegacyA6Conflict[];
}

function normalizeInsight(insight: Insight): Insight {
  return {
    ...insight,
    priorityScore: insight.priorityScore ?? 0,
    priorityReasons: insight.priorityReasons || [],
    firstSeenAt: insight.firstSeenAt ?? insight.createdAt,
    lastSeenAt: insight.lastSeenAt ?? insight.createdAt,
    occurrenceCount: insight.occurrenceCount ?? 1,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(
      value as Record<string, unknown>
    )
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return (
      '{' +
      entries
        .map(
          ([key, item]) =>
            JSON.stringify(key) + ':' + canonical(item)
        )
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function same(
  left: unknown,
  right: unknown
): boolean {
  return canonical(left) === canonical(right);
}

function runCore(run: AnalysisRun): Omit<AnalysisRun, 'insightIds'> {
  const { insightIds: _insightIds, ...core } = run;
  return core;
}

export function readLegacyA6Snapshot(
  dataDir = path.join(process.cwd(), 'data')
): LegacyA6Snapshot {
  const file = path.join(dataDir, 'discovery.json');
  if (!fs.existsSync(file)) {
    return {
      dataDir,
      runs: [],
      insights: [],
    };
  }

  const parsed = JSON.parse(
    fs.readFileSync(file, 'utf8')
  ) as {
    runs?: AnalysisRun[];
    insights?: Insight[];
  };

  return {
    dataDir,
    runs: parsed.runs || [],
    insights: (parsed.insights || []).map(normalizeInsight),
  };
}

function reportFor(
  snapshot: LegacyA6Snapshot,
  dryRun: boolean
): LegacyA6ImportReport {
  return {
    dryRun,
    sourceDataDir: snapshot.dataDir,
    counts: {
      runs: snapshot.runs.length,
      insights: snapshot.insights.length,
      memberships: snapshot.runs.reduce(
        (total, run) => total + run.insightIds.length,
        0
      ),
    },
    imported: {
      runs: 0,
      insights: 0,
      memberships: 0,
    },
    skippedExisting: 0,
    conflicts: [],
  };
}

async function accountExists(accountId: string): Promise<boolean> {
  const result = await postgresPool().query(
    'SELECT 1 FROM accounts WHERE id = $1',
    [accountId]
  );
  return Boolean(result.rowCount);
}

async function validateRunSource(
  run: AnalysisRun
): Promise<string | null> {
  if (!(await accountExists(run.accountId))) {
    return 'AnalysisRun account must exist before A6 import.';
  }

  if (run.sourceType === 'DATASET') {
    if (!run.datasetId || !run.datasetVersionId) {
      return 'Dataset AnalysisRun requires datasetId and datasetVersionId.';
    }
    const result = await postgresPool().query(
      `SELECT 1
       FROM dataset_versions
       WHERE account_id = $1
         AND dataset_id = $2
         AND id = $3`,
      [run.accountId, run.datasetId, run.datasetVersionId]
    );
    return result.rowCount
      ? null
      : 'Dataset AnalysisRun source version must already exist in the same account.';
  }

  if (!run.knowledgeBaseId || !run.knowledgeVersionTag) {
    return 'Document AnalysisRun requires knowledgeBaseId and knowledgeVersionTag.';
  }

  const result = await postgresPool().query(
    `SELECT 1
     FROM workspaces
     WHERE account_id = $1 AND id = $2`,
    [run.accountId, run.knowledgeBaseId]
  );
  return result.rowCount
    ? null
    : 'Document AnalysisRun workspace must already exist in the same account.';
}

async function validateInsightSource(
  insight: Insight
): Promise<string | null> {
  if (!(await accountExists(insight.accountId))) {
    return 'Insight account must exist before A6 import.';
  }

  const run = await postgresPool().query(
    `SELECT 1
     FROM discovery_analysis_runs
     WHERE account_id = $1 AND id = $2`,
    [insight.accountId, insight.analysisRunId]
  );
  if (!run.rowCount) {
    return 'Insight latest AnalysisRun must exist in the same account.';
  }

  if (insight.datasetId || insight.datasetVersionId) {
    if (!insight.datasetId || !insight.datasetVersionId) {
      return 'Dataset Insight requires both datasetId and datasetVersionId.';
    }
    const result = await postgresPool().query(
      `SELECT 1
       FROM dataset_versions
       WHERE account_id = $1
         AND dataset_id = $2
         AND id = $3`,
      [
        insight.accountId,
        insight.datasetId,
        insight.datasetVersionId,
      ]
    );
    return result.rowCount
      ? null
      : 'Dataset Insight source version must exist in the same account.';
  }

  if (!insight.knowledgeBaseId) {
    return 'Document Insight requires knowledgeBaseId.';
  }

  const result = await postgresPool().query(
    `SELECT 1
     FROM workspaces
     WHERE account_id = $1 AND id = $2`,
    [insight.accountId, insight.knowledgeBaseId]
  );
  return result.rowCount
    ? null
    : 'Document Insight workspace must exist in the same account.';
}

async function validateSnapshot(
  snapshot: LegacyA6Snapshot,
  report: LegacyA6ImportReport
): Promise<void> {
  const runMap = new Map(
    snapshot.runs.map((run) => [
      run.accountId + ':' + run.id,
      run,
    ])
  );
  const insightMap = new Map(
    snapshot.insights.map((insight) => [
      insight.accountId + ':' + insight.id,
      insight,
    ])
  );
  const fingerprints = new Map<string, string>();

  for (const run of snapshot.runs) {
    const error = await validateRunSource(run);
    if (error) {
      report.conflicts.push({
        kind: 'ANALYSIS_RUN',
        id: run.id,
        message: error,
      });
    }

    for (const insightId of run.insightIds) {
      if (!insightMap.has(run.accountId + ':' + insightId)) {
        report.conflicts.push({
          kind: 'RUN_INSIGHT_MEMBERSHIP',
          id: run.id + ':' + insightId,
          message:
            'AnalysisRun references an Insight missing from the same legacy account snapshot.',
        });
      }
    }
  }

  for (const insight of snapshot.insights) {
    const ownerRun = runMap.get(
      insight.accountId + ':' + insight.analysisRunId
    );
    if (!ownerRun) {
      report.conflicts.push({
        kind: 'INSIGHT',
        id: insight.id,
        message:
          'Insight latest AnalysisRun must exist in the same legacy account snapshot.',
      });
    }

    const fingerprintKey =
      insight.accountId + ':' + insight.fingerprint;
    const priorId = fingerprints.get(fingerprintKey);
    if (priorId && priorId !== insight.id) {
      report.conflicts.push({
        kind: 'INSIGHT',
        id: insight.id,
        message:
          'Legacy snapshot contains duplicate Insight fingerprints for one account.',
      });
    } else {
      fingerprints.set(fingerprintKey, insight.id);
    }
  }
}

export async function importLegacyA6(params: {
  dataDir?: string;
  dryRun?: boolean;
  snapshot?: LegacyA6Snapshot;
} = {}): Promise<LegacyA6ImportReport> {
  const snapshot =
    params.snapshot ||
    readLegacyA6Snapshot(params.dataDir);
  const report = reportFor(
    snapshot,
    Boolean(params.dryRun)
  );

  await validateSnapshot(snapshot, report);
  if (report.conflicts.length > 0) return report;

  for (const run of snapshot.runs) {
    const existing = await postgresDiscoveryRepository.getRun(
      run.accountId,
      run.id
    );
    if (existing) {
      if (!same(runCore(existing), runCore(run))) {
        report.conflicts.push({
          kind: 'ANALYSIS_RUN',
          id: run.id,
          message:
            'AnalysisRun already exists with different persisted metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
    }
  }

  for (const insight of snapshot.insights) {
    const existing =
      await postgresDiscoveryRepository.getInsight(
        insight.accountId,
        insight.id
      );

    if (existing) {
      if (!same(existing, insight)) {
        report.conflicts.push({
          kind: 'INSIGHT',
          id: insight.id,
          message:
            'Insight already exists with different persisted metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
    }

    const fingerprintOwner = await postgresPool().query(
      `SELECT id
       FROM discovery_insights
       WHERE account_id = $1 AND fingerprint = $2`,
      [insight.accountId, insight.fingerprint]
    );
    if (
      fingerprintOwner.rowCount &&
      fingerprintOwner.rows[0].id !== insight.id
    ) {
      report.conflicts.push({
        kind: 'INSIGHT',
        id: insight.id,
        message:
          'Insight fingerprint already belongs to a different Insight ID in this account.',
      });
    }
  }

  if (report.conflicts.length > 0 || params.dryRun) {
    return report;
  }

  for (const run of snapshot.runs) {
    const existing = await postgresDiscoveryRepository.getRun(
      run.accountId,
      run.id
    );
    if (existing) continue;

    await postgresDiscoveryRepository.saveRun({
      ...run,
      insightIds: [],
    });
    report.imported.runs += 1;
  }

  for (const insight of snapshot.insights) {
    const error = await validateInsightSource(insight);
    if (error) {
      report.conflicts.push({
        kind: 'INSIGHT',
        id: insight.id,
        message: error,
      });
      continue;
    }

    const existing =
      await postgresDiscoveryRepository.getInsight(
        insight.accountId,
        insight.id
      );
    if (existing) continue;

    await postgresDiscoveryRepository.saveInsightSnapshot(
      insight
    );
    report.imported.insights += 1;
  }

  if (report.conflicts.length > 0) return report;

  for (const run of snapshot.runs) {
    const existing =
      await postgresDiscoveryRepository.getRun(
        run.accountId,
        run.id
      );
    const currentIds = existing?.insightIds || [];
    if (same(currentIds, run.insightIds)) {
      if (run.insightIds.length > 0) {
        report.skippedExisting += run.insightIds.length;
      }
      continue;
    }

    await postgresDiscoveryRepository.replaceRunInsightIds(
      run.accountId,
      run.id,
      run.insightIds
    );
    report.imported.memberships += run.insightIds.length;
  }

  return report;
}
