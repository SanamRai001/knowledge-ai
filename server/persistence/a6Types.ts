import type {
  AnalysisRun,
  Insight,
  InsightStatus,
} from '../discovery/types.js';

export interface DiscoveryRepository {
  getRun(
    accountId: string,
    runId: string
  ): Promise<AnalysisRun | null>;

  listRuns(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    limit?: number;
  }): Promise<AnalysisRun[]>;

  saveRun(run: AnalysisRun): Promise<void>;

  /**
   * Persists detector candidates using the authoritative recurrence rule:
   * one Insight identity per account/fingerprint while status/firstSeen/
   * createdAt remain stable and occurrence/lastSeen advance.
   *
   * The returned Insight IDs are also linked to this AnalysisRun so
   * historical run membership is preserved independently of an Insight's
   * latest analysisRunId.
   */
  recordInsightsForRun(
    accountId: string,
    runId: string,
    insights: Insight[]
  ): Promise<Insight[]>;

  /**
   * Exact snapshot write for legacy migration. This does not increment
   * recurrence counters.
   */
  saveInsightSnapshot(insight: Insight): Promise<void>;

  replaceRunInsightIds(
    accountId: string,
    runId: string,
    insightIds: string[]
  ): Promise<void>;

  getInsight(
    accountId: string,
    insightId: string
  ): Promise<Insight | null>;

  listInsights(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    runId?: string;
    status?: InsightStatus;
    limit?: number;
  }): Promise<Insight[]>;

  updateInsightStatus(
    accountId: string,
    insightId: string,
    status: InsightStatus,
    statusUpdatedAt?: number
  ): Promise<Insight>;
}
