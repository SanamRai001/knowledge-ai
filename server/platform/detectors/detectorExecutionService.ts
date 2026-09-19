import crypto from 'crypto';
import { effectiveDatasetOverlayService } from '../../companyKnowledge/effectiveDatasetOverlayService.js';
import { datasetStore } from '../../datasets/datasetStore.js';
import { discoveryStore } from '../../discovery/discoveryStore.js';
import { prioritizeInsight } from '../../discovery/prioritization.js';
import type { AnalysisRun } from '../../discovery/types.js';
import './builtInDetectors.js';
import { validateDetectorConfig } from './detectorConfigValidator.js';
import { detectorRegistry } from './detectorRegistry.js';
import type {
  DetectorExecutionResult,
  RegisteredDetectorDescriptor,
} from './types.js';

function canonicalConfig(
  value: Record<string, string | number | boolean>
): string {
  const ordered: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(value).sort()) {
    ordered[key] = value[key];
  }
  return JSON.stringify(ordered);
}

function configHash(
  value: Record<string, string | number | boolean>
): string {
  return crypto
    .createHash('sha256')
    .update(canonicalConfig(value), 'utf8')
    .digest('hex');
}

export class DetectorExecutionService {
  public list(): RegisteredDetectorDescriptor[] {
    return detectorRegistry.list();
  }

  public run(params: {
    accountId: string;
    detectorId: string;
    datasetId: string;
    datasetVersionId?: string;
    config: unknown;
    referenceTime?: number;
  }): DetectorExecutionResult {
    const detector = detectorRegistry.require(params.detectorId);
    const normalizedConfig = validateDetectorConfig(
      detector.descriptor.configSchema,
      params.config
    );
    const hash = configHash(normalizedConfig);

    const version = params.datasetVersionId
      ? datasetStore.getVersion(
          params.accountId,
          params.datasetId,
          params.datasetVersionId
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

    const referenceTime = params.referenceTime ?? Date.now();
    const run: AnalysisRun = {
      id: 'anr_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      sourceType: 'DATASET',
      datasetId: params.datasetId,
      datasetVersionId: version.id,
      status: 'RUNNING',
      startedAt: Date.now(),
      referenceTime,
      detectorIds: [detector.descriptor.id],
      detectorRegistrations: [
        {
          detectorId: detector.descriptor.id,
          detectorVersion: detector.descriptor.version,
          configHash: hash,
          config: { ...normalizedConfig },
        },
      ],
      insightIds: [],
    };
    discoveryStore.saveRun(run);

    try {
      const effective = effectiveDatasetOverlayService.apply({
        accountId: params.accountId,
        datasetId: params.datasetId,
        version,
      });

      const candidates = detector.handler(
        {
          accountId: params.accountId,
          datasetId: params.datasetId,
          analysisRunId: run.id,
          referenceTime,
          companyStateOverlay: effective.overlays,
          detectorId: detector.descriptor.id,
          detectorVersion: detector.descriptor.version,
          configHash: hash,
          normalizedConfig: { ...normalizedConfig },
        },
        effective.version,
        normalizedConfig
      );

      const insights = discoveryStore.saveInsights(
        candidates.map(prioritizeInsight)
      );

      const completed: AnalysisRun = {
        ...run,
        status: 'COMPLETED',
        completedAt: Date.now(),
        insightIds: insights.map((item) => item.id),
      };
      discoveryStore.saveRun(completed);

      return {
        runId: completed.id,
        detector: structuredClone(detector.descriptor),
        configHash: hash,
        normalizedConfig: { ...normalizedConfig },
        datasetId: params.datasetId,
        datasetVersionId: version.id,
        insights,
      };
    } catch (error: any) {
      discoveryStore.saveRun({
        ...run,
        status: 'FAILED',
        completedAt: Date.now(),
        error:
          error?.message || 'Registered detector execution failed.',
      });
      throw error;
    }
  }
}

export const detectorExecutionService =
  new DetectorExecutionService();
