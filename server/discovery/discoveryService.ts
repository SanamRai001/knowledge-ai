import crypto from 'crypto';
import { datasetStore } from '../datasets/datasetStore.js';
import { detectOutstandingBalances } from './balanceDetector.js';
import { detectDataQuality } from './dataQualityDetector.js';
import { discoveryStore } from './discoveryStore.js';
import { detectInventoryThresholds } from './inventoryDetector.js';
import { detectTrendChanges } from './trendDetector.js';
import { AnalysisRun, Insight, InsightStatus } from './types.js';

export const PHASE_2A_DETECTOR_IDS = [
  'trend.change.v1',
  'balance.outstanding.v1',
  'inventory.threshold.v1',
  'data-quality.v1',
];

export class DiscoveryService {
  public analyzeDataset(params: {
    accountId: string;
    datasetId: string;
    versionId?: string;
    referenceTime?: number;
  }): { run: AnalysisRun; insights: Insight[] } {
    const version = params.versionId
      ? datasetStore.getVersion(
          params.accountId,
          params.datasetId,
          params.versionId
        )
      : datasetStore.getCurrentVersion(params.accountId, params.datasetId);

    if (!version) {
      datasetStore.requireDataset(params.accountId, params.datasetId);
      throw new Error('Dataset version not found.');
    }

    const referenceTime = params.referenceTime || Date.now();
    const run: AnalysisRun = {
      id: 'anr_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      datasetId: params.datasetId,
      datasetVersionId: version.id,
      status: 'RUNNING',
      startedAt: Date.now(),
      referenceTime,
      detectorIds: [...PHASE_2A_DETECTOR_IDS],
      insightIds: [],
    };
    discoveryStore.saveRun(run);

    try {
      const context = {
        accountId: params.accountId,
        datasetId: params.datasetId,
        analysisRunId: run.id,
        referenceTime,
      };

      const insights = [
        ...detectTrendChanges(context, version),
        ...detectOutstandingBalances(context, version),
        ...detectInventoryThresholds(context, version),
        ...detectDataQuality(context, version),
      ];

      discoveryStore.saveInsights(insights);

      const completed: AnalysisRun = {
        ...run,
        status: 'COMPLETED',
        completedAt: Date.now(),
        insightIds: insights.map((insight) => insight.id),
      };
      discoveryStore.saveRun(completed);

      return {
        run: completed,
        insights,
      };
    } catch (error: any) {
      const failed: AnalysisRun = {
        ...run,
        status: 'FAILED',
        completedAt: Date.now(),
        error: error?.message || 'Discovery analysis failed.',
      };
      discoveryStore.saveRun(failed);
      throw error;
    }
  }

  public listRuns(accountId: string, datasetId?: string): AnalysisRun[] {
    if (datasetId) datasetStore.requireDataset(accountId, datasetId);
    return discoveryStore.listRuns(accountId, datasetId);
  }

  public listInsights(params: {
    accountId: string;
    datasetId?: string;
    runId?: string;
    status?: InsightStatus;
    latestRunOnly?: boolean;
  }): Insight[] {
    if (params.datasetId) {
      datasetStore.requireDataset(params.accountId, params.datasetId);
    }

    let runId = params.runId;
    if (runId) discoveryStore.requireRun(params.accountId, runId);

    if (!runId && params.latestRunOnly !== false && params.datasetId) {
      runId = discoveryStore.listRuns(params.accountId, params.datasetId)[0]?.id;
    }

    if (params.datasetId && !runId && params.latestRunOnly !== false) {
      return [];
    }

    return discoveryStore.listInsights({
      accountId: params.accountId,
      datasetId: params.datasetId,
      runId,
      status: params.status,
    });
  }

  public getInsight(accountId: string, insightId: string): Insight {
    return discoveryStore.requireInsight(accountId, insightId);
  }
}

export const discoveryService = new DiscoveryService();
