import crypto from 'crypto';
import { datasetStore } from '../datasets/datasetStore.js';
import { effectiveDatasetOverlayService } from '../companyKnowledge/effectiveDatasetOverlayService.js';
import { workspaceAccessService } from '../workspaceAccessService.js';
import { detectOutstandingBalances } from './balanceDetector.js';
import { detectCustomerConcentration } from './concentrationDetector.js';
import { detectDataQuality } from './dataQualityDetector.js';
import { detectTrendAnomalies } from './anomalyDetector.js';
import { detectDocumentDeadlines } from './documentDeadlineDetector.js';
import { detectInventoryThresholds } from './inventoryDetector.js';
import { detectMarginOpportunities } from './marginOpportunityDetector.js';
import { detectTrendChanges } from './trendDetector.js';
import { detectVersionChanges } from './versionChangeDetector.js';
import { prioritizeInsight } from './prioritization.js';
import {
  DiscoveryAccessError,
} from './discoveryStore.js';
import { discoveryPersistence } from './discoveryPersistence.js';
import { PHASE_2A_DETECTOR_IDS } from './discoveryService.js';
import type {
  AnalysisRun,
  Insight,
  InsightStatus,
} from './types.js';

export class DiscoveryRuntimeService {
  public async analyzeDataset(params: {
    accountId: string;
    datasetId: string;
    versionId?: string;
    referenceTime?: number;
  }): Promise<{ run: AnalysisRun; insights: Insight[] }> {
    const version = params.versionId
      ? datasetStore.getVersion(
          params.accountId,
          params.datasetId,
          params.versionId
        )
      : datasetStore.getCurrentVersion(
          params.accountId,
          params.datasetId
        );

    if (!version) {
      datasetStore.requireDataset(
        params.accountId,
        params.datasetId
      );
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

    await discoveryPersistence.saveRun(run);

    try {
      const effectiveView =
        effectiveDatasetOverlayService.apply({
          accountId: params.accountId,
          datasetId: params.datasetId,
          version,
        });

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
      const currentVersionIndex =
        dataset.versionIds.indexOf(version.id);
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
        ...detectTrendChanges(
          context,
          effectiveView.version
        ),
        ...detectOutstandingBalances(
          context,
          effectiveView.version
        ),
        ...detectInventoryThresholds(
          context,
          effectiveView.version
        ),
        ...detectDataQuality(
          context,
          effectiveView.version
        ),
        ...detectTrendAnomalies(
          context,
          effectiveView.version
        ),
        ...detectCustomerConcentration(
          context,
          effectiveView.version
        ),
        ...detectMarginOpportunities(
          context,
          effectiveView.version
        ),
        ...(previousVersion
          ? detectVersionChanges(
              context,
              previousVersion,
              version
            )
          : []),
      ].map(prioritizeInsight);

      const insights =
        await discoveryPersistence.recordInsightsForRun(
          params.accountId,
          run.id,
          candidates
        );

      const completed: AnalysisRun = {
        ...run,
        status: 'COMPLETED',
        completedAt: Date.now(),
        insightIds: insights.map((item) => item.id),
      };
      await discoveryPersistence.saveRun(completed);

      return { run: completed, insights };
    } catch (error: any) {
      await discoveryPersistence.saveRun({
        ...run,
        status: 'FAILED',
        completedAt: Date.now(),
        error:
          error?.message || 'Discovery analysis failed.',
      });
      throw error;
    }
  }

  public async analyzeKnowledgeBase(params: {
    accountId: string;
    knowledgeBaseId: string;
    referenceTime?: number;
  }): Promise<{ run: AnalysisRun; insights: Insight[] }> {
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

    await discoveryPersistence.saveRun(run);

    try {
      const candidates = detectDocumentDeadlines(
        {
          accountId: params.accountId,
          knowledgeBaseId: kb.id,
          knowledgeVersionTag: kb.currentVersion,
          analysisRunId: run.id,
          referenceTime,
        },
        kb
      );

      const insights =
        await discoveryPersistence.recordInsightsForRun(
          params.accountId,
          run.id,
          candidates
        );

      const completed: AnalysisRun = {
        ...run,
        status: 'COMPLETED',
        completedAt: Date.now(),
        insightIds: insights.map((item) => item.id),
      };
      await discoveryPersistence.saveRun(completed);
      return { run: completed, insights };
    } catch (error: any) {
      await discoveryPersistence.saveRun({
        ...run,
        status: 'FAILED',
        completedAt: Date.now(),
        error:
          error?.message ||
          'Document discovery analysis failed.',
      });
      throw error;
    }
  }

  public async listRuns(
    accountId: string,
    datasetId?: string,
    knowledgeBaseId?: string
  ): Promise<AnalysisRun[]> {
    if (datasetId) {
      datasetStore.requireDataset(accountId, datasetId);
    }
    if (knowledgeBaseId) {
      workspaceAccessService.requireKB(
        accountId,
        knowledgeBaseId
      );
    }

    return discoveryPersistence.listRuns({
      accountId,
      datasetId,
      knowledgeBaseId,
      limit: 500,
    });
  }

  public async listInsights(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    runId?: string;
    status?: InsightStatus;
    latestRunOnly?: boolean;
    limit?: number;
  }): Promise<Insight[]> {
    if (params.datasetId) {
      datasetStore.requireDataset(
        params.accountId,
        params.datasetId
      );
    }
    if (params.knowledgeBaseId) {
      workspaceAccessService.requireKB(
        params.accountId,
        params.knowledgeBaseId
      );
    }

    const limit = Math.max(
      1,
      Math.min(params.limit || 20, 100)
    );

    if (params.runId) {
      const run = await discoveryPersistence.getRun(
        params.accountId,
        params.runId
      );
      if (!run) {
        throw new DiscoveryAccessError(
          'ANALYSIS_RUN_NOT_FOUND',
          'Analysis run not found in the current account scope.'
        );
      }
      return discoveryPersistence.listInsights({
        accountId: params.accountId,
        datasetId: params.datasetId,
        knowledgeBaseId: params.knowledgeBaseId,
        runId: params.runId,
        status: params.status,
        limit,
      });
    }

    if (
      params.latestRunOnly !== false &&
      (params.datasetId || params.knowledgeBaseId)
    ) {
      const latestRun = (
        await discoveryPersistence.listRuns({
          accountId: params.accountId,
          datasetId: params.datasetId,
          knowledgeBaseId: params.knowledgeBaseId,
          limit: 1,
        })
      )[0];

      if (!latestRun) return [];

      return discoveryPersistence.listInsights({
        accountId: params.accountId,
        datasetId: params.datasetId,
        knowledgeBaseId: params.knowledgeBaseId,
        runId: latestRun.id,
        status: params.status,
        limit,
      });
    }

    return discoveryPersistence.listInsights({
      accountId: params.accountId,
      datasetId: params.datasetId,
      knowledgeBaseId: params.knowledgeBaseId,
      status: params.status,
      limit,
    });
  }

  public async updateInsightStatus(
    accountId: string,
    insightId: string,
    status: InsightStatus
  ): Promise<Insight> {
    const insight =
      await discoveryPersistence.updateInsightStatus(
        accountId,
        insightId,
        status
      );
    if (!insight) {
      throw new DiscoveryAccessError(
        'INSIGHT_NOT_FOUND',
        'Insight not found in the current account scope.'
      );
    }
    return insight;
  }

  public async getInsight(
    accountId: string,
    insightId: string
  ): Promise<Insight> {
    const insight = await discoveryPersistence.getInsight(
      accountId,
      insightId
    );
    if (!insight) {
      throw new DiscoveryAccessError(
        'INSIGHT_NOT_FOUND',
        'Insight not found in the current account scope.'
      );
    }
    return insight;
  }
}

export const discoveryRuntimeService =
  new DiscoveryRuntimeService();
