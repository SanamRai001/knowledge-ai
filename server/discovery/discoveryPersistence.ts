import { discoveryStore } from './discoveryStore.js';
import type {
  AnalysisRun,
  Insight,
  InsightStatus,
} from './types.js';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import { postgresDiscoveryRepository } from '../persistence/a6PostgresRepositories.js';

export class DiscoveryPersistence {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  public async saveRun(run: AnalysisRun): Promise<void> {
    if (this.usesPostgres()) {
      await postgresDiscoveryRepository.saveRun(run);
      return;
    }
    discoveryStore.saveRun(run);
  }

  public async recordInsightsForRun(
    accountId: string,
    runId: string,
    insights: Insight[]
  ): Promise<Insight[]> {
    if (this.usesPostgres()) {
      return postgresDiscoveryRepository.recordInsightsForRun(
        accountId,
        runId,
        insights
      );
    }
    return discoveryStore.saveInsights(insights);
  }

  public async getRun(
    accountId: string,
    runId: string
  ): Promise<AnalysisRun | null> {
    if (this.usesPostgres()) {
      return postgresDiscoveryRepository.getRun(accountId, runId);
    }
    return discoveryStore.getRun(accountId, runId);
  }

  public async listRuns(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    limit?: number;
  }): Promise<AnalysisRun[]> {
    if (this.usesPostgres()) {
      return postgresDiscoveryRepository.listRuns(params);
    }
    return discoveryStore
      .listRuns(
        params.accountId,
        params.datasetId,
        params.knowledgeBaseId
      )
      .slice(
        0,
        Math.max(1, Math.min(params.limit || 100, 1000))
      );
  }

  public async getInsight(
    accountId: string,
    insightId: string
  ): Promise<Insight | null> {
    if (this.usesPostgres()) {
      return postgresDiscoveryRepository.getInsight(
        accountId,
        insightId
      );
    }
    return discoveryStore.getInsight(accountId, insightId);
  }

  public async listInsights(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    runId?: string;
    status?: InsightStatus;
    limit?: number;
  }): Promise<Insight[]> {
    if (this.usesPostgres()) {
      return postgresDiscoveryRepository.listInsights(params);
    }

    if (params.runId) {
      const run = discoveryStore.getRun(
        params.accountId,
        params.runId
      );
      if (!run) return [];
      return run.insightIds
        .map((id) =>
          discoveryStore.getInsight(params.accountId, id)
        )
        .filter((item): item is Insight => Boolean(item))
        .filter(
          (item) =>
            (!params.datasetId ||
              item.datasetId === params.datasetId) &&
            (!params.knowledgeBaseId ||
              item.knowledgeBaseId === params.knowledgeBaseId) &&
            (!params.status || item.status === params.status)
        )
        .sort(
          (left, right) =>
            right.priorityScore - left.priorityScore ||
            right.lastSeenAt - left.lastSeenAt
        )
        .slice(
          0,
          Math.max(1, Math.min(params.limit || 100, 1000))
        );
    }

    return discoveryStore
      .listInsights({
        accountId: params.accountId,
        datasetId: params.datasetId,
        knowledgeBaseId: params.knowledgeBaseId,
        status: params.status,
      })
      .slice(
        0,
        Math.max(1, Math.min(params.limit || 100, 1000))
      );
  }

  public async updateInsightStatus(
    accountId: string,
    insightId: string,
    status: InsightStatus
  ): Promise<Insight | null> {
    if (this.usesPostgres()) {
      const existing =
        await postgresDiscoveryRepository.getInsight(
          accountId,
          insightId
        );
      if (!existing) return null;
      return postgresDiscoveryRepository.updateInsightStatus(
        accountId,
        insightId,
        status
      );
    }

    const existing = discoveryStore.getInsight(
      accountId,
      insightId
    );
    if (!existing) return null;
    return discoveryStore.updateInsightStatus(
      accountId,
      insightId,
      status
    );
  }
}

export const discoveryPersistence =
  new DiscoveryPersistence();
