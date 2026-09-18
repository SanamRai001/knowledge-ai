import crypto from 'crypto';
import { datasetStore } from '../datasets/datasetStore.js';
import { effectiveDatasetOverlayService } from '../companyKnowledge/effectiveDatasetOverlayService.js';
import { workspaceAccessService } from '../workspaceAccessService.js';
import { detectOutstandingBalances } from './balanceDetector.js';
import { detectCustomerConcentration } from './concentrationDetector.js';
import { detectDataQuality } from './dataQualityDetector.js';
import { detectTrendAnomalies } from './anomalyDetector.js';
import { detectDocumentDeadlines } from './documentDeadlineDetector.js';
import { discoveryStore } from './discoveryStore.js';
import { detectInventoryThresholds } from './inventoryDetector.js';
import { detectMarginOpportunities } from './marginOpportunityDetector.js';
import { detectTrendChanges } from './trendDetector.js';
import { detectVersionChanges } from './versionChangeDetector.js';
import { prioritizeInsight } from './prioritization.js';
import { AnalysisRun, Insight, InsightStatus } from './types.js';

export const PHASE_2A_DETECTOR_IDS = [
  'trend.change.v1',
  'balance.outstanding.v1',
  'inventory.threshold.v1',
  'data-quality.v1',
  'version.change.v1',
  'trend.anomaly.v1',
  'customer.concentration.v1',
  'margin.opportunity.v1',
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
      sourceType: 'DATASET',
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
      const effectiveView = effectiveDatasetOverlayService.apply({
        accountId: params.accountId,
        datasetId: params.datasetId,
        version,
      });
      const effectiveVersion = effectiveView.version;

      const context = {
        accountId: params.accountId,
        datasetId: params.datasetId,
        analysisRunId: run.id,
        referenceTime,
        companyStateOverlay: effectiveView.overlays,
      };

      const dataset = datasetStore.requireDataset(
        params.accountId,
        params.datasetId
      );
      const currentVersionIndex = dataset.versionIds.indexOf(version.id);
      const previousVersionId =
        currentVersionIndex > 0
          ? dataset.versionIds[currentVersionIndex - 1]
          : undefined;
      const previousVersion = previousVersionId
        ? datasetStore.getVersion(
            params.accountId,
            params.datasetId,
            previousVersionId
          )
        : null;

      const candidates = [
        ...detectTrendChanges(context, effectiveVersion),
        ...detectOutstandingBalances(context, effectiveVersion),
        ...detectInventoryThresholds(context, effectiveVersion),
        ...detectDataQuality(context, effectiveVersion),
        ...detectTrendAnomalies(context, effectiveVersion),
        ...detectCustomerConcentration(context, effectiveVersion),
        ...detectMarginOpportunities(context, effectiveVersion),
        ...(previousVersion
          ? detectVersionChanges(context, previousVersion, version)
          : []),
      ].map(prioritizeInsight);

      const insights = discoveryStore.saveInsights(candidates);

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

  public analyzeKnowledgeBase(params: {
    accountId: string;
    knowledgeBaseId: string;
    referenceTime?: number;
  }): { run: AnalysisRun; insights: Insight[] } {
    const kb = workspaceAccessService.requireKB(
      params.accountId,
      params.knowledgeBaseId
    );
    const referenceTime = params.referenceTime || Date.now();

    const run: AnalysisRun = {
      id: 'anr_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      sourceType: 'DOCUMENT',
      knowledgeBaseId: kb.id,
      knowledgeVersionTag: kb.currentVersion,
      status: 'RUNNING',
      startedAt: Date.now(),
      referenceTime,
      detectorIds: ['document.deadline.v1'],
      insightIds: [],
    };
    discoveryStore.saveRun(run);

    try {
      const insights = discoveryStore.saveInsights(
        detectDocumentDeadlines(
          {
            accountId: params.accountId,
            knowledgeBaseId: kb.id,
            knowledgeVersionTag: kb.currentVersion,
            analysisRunId: run.id,
            referenceTime,
          },
          kb
        )
      );

      const completed: AnalysisRun = {
        ...run,
        status: 'COMPLETED',
        completedAt: Date.now(),
        insightIds: insights.map((insight) => insight.id),
      };
      discoveryStore.saveRun(completed);
      return { run: completed, insights };
    } catch (error: any) {
      const failed: AnalysisRun = {
        ...run,
        status: 'FAILED',
        completedAt: Date.now(),
        error: error?.message || 'Document discovery analysis failed.',
      };
      discoveryStore.saveRun(failed);
      throw error;
    }
  }

  public listRuns(
    accountId: string,
    datasetId?: string,
    knowledgeBaseId?: string
  ): AnalysisRun[] {
    if (datasetId) datasetStore.requireDataset(accountId, datasetId);
    if (knowledgeBaseId) {
      workspaceAccessService.requireKB(accountId, knowledgeBaseId);
    }
    return discoveryStore.listRuns(accountId, datasetId, knowledgeBaseId);
  }

  public listInsights(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    runId?: string;
    status?: InsightStatus;
    latestRunOnly?: boolean;
    limit?: number;
  }): Insight[] {
    if (params.datasetId) {
      datasetStore.requireDataset(params.accountId, params.datasetId);
    }
    if (params.knowledgeBaseId) {
      workspaceAccessService.requireKB(
        params.accountId,
        params.knowledgeBaseId
      );
    }

    let insights: Insight[];

    if (params.runId) {
      const run = discoveryStore.requireRun(params.accountId, params.runId);
      insights = run.insightIds
        .map((id) => discoveryStore.getInsight(params.accountId, id))
        .filter((insight): insight is Insight => Boolean(insight))
        .filter(
          (insight) =>
            (!params.datasetId || insight.datasetId === params.datasetId) &&
            (!params.knowledgeBaseId ||
              insight.knowledgeBaseId === params.knowledgeBaseId) &&
            (!params.status || insight.status === params.status)
        )
        .sort(
          (a, b) =>
            b.priorityScore - a.priorityScore ||
            b.lastSeenAt - a.lastSeenAt
        );
    } else if (
      params.latestRunOnly !== false &&
      (params.datasetId || params.knowledgeBaseId)
    ) {
      const latestRun = discoveryStore.listRuns(
        params.accountId,
        params.datasetId,
        params.knowledgeBaseId
      )[0];
      if (!latestRun) return [];
      insights = latestRun.insightIds
        .map((id) => discoveryStore.getInsight(params.accountId, id))
        .filter((insight): insight is Insight => Boolean(insight))
        .filter((insight) => !params.status || insight.status === params.status)
        .sort(
          (a, b) =>
            b.priorityScore - a.priorityScore ||
            b.lastSeenAt - a.lastSeenAt
        );
    } else {
      insights = discoveryStore.listInsights({
        accountId: params.accountId,
        datasetId: params.datasetId,
        knowledgeBaseId: params.knowledgeBaseId,
        status: params.status,
      });
    }

    const limit = Math.max(1, Math.min(params.limit || 20, 100));
    return insights.slice(0, limit);
  }

  public updateInsightStatus(
    accountId: string,
    insightId: string,
    status: InsightStatus
  ): Insight {
    return discoveryStore.updateInsightStatus(accountId, insightId, status);
  }

  public getInsight(accountId: string, insightId: string): Insight {
    return discoveryStore.requireInsight(accountId, insightId);
  }
}

export const discoveryService = new DiscoveryService();
