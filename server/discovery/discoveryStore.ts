import fs from 'fs';
import path from 'path';
import { AnalysisRun, Insight, InsightStatus } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DISCOVERY_FILE = path.join(DATA_DIR, 'discovery.json');

type PersistedDiscoveryState = {
  runs: AnalysisRun[];
  insights: Insight[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DiscoveryAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code: 'INSIGHT_NOT_FOUND' | 'ANALYSIS_RUN_NOT_FOUND';

  constructor(
    code: 'INSIGHT_NOT_FOUND' | 'ANALYSIS_RUN_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'DiscoveryAccessError';
    this.code = code;
  }
}

export class DiscoveryStore {
  private runs = new Map<string, AnalysisRun>();
  private insights = new Map<string, Insight>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(DISCOVERY_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(DISCOVERY_FILE, 'utf8')
      ) as Partial<PersistedDiscoveryState>;

      for (const run of parsed.runs || []) this.runs.set(run.id, run);
      for (const insight of parsed.insights || []) {
        const normalized: Insight = {
          ...insight,
          priorityScore: insight.priorityScore ?? 0,
          priorityReasons: insight.priorityReasons || [],
          firstSeenAt: insight.firstSeenAt ?? insight.createdAt,
          lastSeenAt: insight.lastSeenAt ?? insight.createdAt,
          occurrenceCount: insight.occurrenceCount ?? 1,
        };
        this.insights.set(normalized.id, normalized);
      }
    } catch (error) {
      console.warn(
        'Could not load discovery runtime state; starting with an empty discovery store:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedDiscoveryState = {
      runs: Array.from(this.runs.values()).slice(-500),
      insights: Array.from(this.insights.values()).slice(-5000),
    };
    const temporary = DISCOVERY_FILE + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporary, DISCOVERY_FILE);
  }

  public saveRun(run: AnalysisRun): AnalysisRun {
    this.runs.set(run.id, clone(run));
    this.save();
    return clone(run);
  }

  public saveInsights(insights: Insight[]): Insight[] {
    const persisted: Insight[] = [];

    for (const insight of insights) {
      const existing = Array.from(this.insights.values()).find(
        (candidate) =>
          candidate.accountId === insight.accountId &&
          candidate.fingerprint === insight.fingerprint
      );

      if (existing) {
        const updated: Insight = {
          ...insight,
          id: existing.id,
          status: existing.status,
          statusUpdatedAt: existing.statusUpdatedAt,
          createdAt: existing.createdAt,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: insight.lastSeenAt,
          occurrenceCount: existing.occurrenceCount + 1,
        };
        this.insights.set(updated.id, clone(updated));
        persisted.push(updated);
      } else {
        this.insights.set(insight.id, clone(insight));
        persisted.push(insight);
      }
    }

    this.save();
    return persisted.map(clone);
  }

  public listRuns(accountId: string, datasetId?: string): AnalysisRun[] {
    return Array.from(this.runs.values())
      .filter(
        (run) =>
          run.accountId === accountId &&
          (!datasetId || run.datasetId === datasetId)
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(clone);
  }

  public getRun(accountId: string, runId: string): AnalysisRun | null {
    const run = this.runs.get(runId);
    if (!run || run.accountId !== accountId) return null;
    return clone(run);
  }

  public requireRun(accountId: string, runId: string): AnalysisRun {
    const run = this.getRun(accountId, runId);
    if (!run) {
      throw new DiscoveryAccessError(
        'ANALYSIS_RUN_NOT_FOUND',
        'Analysis run not found in the current account scope.'
      );
    }
    return run;
  }

  public listInsights(params: {
    accountId: string;
    datasetId?: string;
    runId?: string;
    status?: InsightStatus;
  }): Insight[] {
    return Array.from(this.insights.values())
      .filter(
        (insight) =>
          insight.accountId === params.accountId &&
          (!params.datasetId || insight.datasetId === params.datasetId) &&
          (!params.runId || insight.analysisRunId === params.runId) &&
          (!params.status || insight.status === params.status)
      )
      .sort(
        (a, b) =>
          b.priorityScore - a.priorityScore ||
          b.lastSeenAt - a.lastSeenAt
      )
      .map(clone);
  }

  public updateInsightStatus(
    accountId: string,
    insightId: string,
    status: InsightStatus
  ): Insight {
    const insight = this.requireInsight(accountId, insightId);
    const updated: Insight = {
      ...insight,
      status,
      statusUpdatedAt: Date.now(),
    };
    this.insights.set(updated.id, clone(updated));
    this.save();
    return clone(updated);
  }

  public getInsight(accountId: string, insightId: string): Insight | null {
    const insight = this.insights.get(insightId);
    if (!insight || insight.accountId !== accountId) return null;
    return clone(insight);
  }

  public requireInsight(accountId: string, insightId: string): Insight {
    const insight = this.getInsight(accountId, insightId);
    if (!insight) {
      throw new DiscoveryAccessError(
        'INSIGHT_NOT_FOUND',
        'Insight not found in the current account scope.'
      );
    }
    return insight;
  }
}

export const discoveryStore = new DiscoveryStore();
