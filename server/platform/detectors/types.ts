import type { DatasetVersion } from '../../datasets/types.js';
import type {
  DetectorContext,
  Insight,
  InsightSeverity,
} from '../../discovery/types.js';

export type RegisteredDetectorSourceType = 'DATASET';

export type DetectorConfigScalarType =
  | 'string'
  | 'number'
  | 'boolean';

export interface DetectorConfigPropertySchema {
  type: DetectorConfigScalarType;
  description: string;
  enum?: Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface DetectorConfigSchema {
  type: 'object';
  properties: Record<string, DetectorConfigPropertySchema>;
  required: string[];
  additionalProperties: false;
}

export interface RegisteredDetectorDescriptor {
  id: string;
  version: string;
  name: string;
  description: string;
  sourceType: RegisteredDetectorSourceType;
  executionMode: 'TRUSTED_BUILT_IN';
  stability: 'STABLE';
  configSchema: DetectorConfigSchema;
  output: {
    kind: 'INSIGHT';
    supportedTypes: Array<
      | 'RISK'
      | 'OPPORTUNITY'
      | 'CHANGE'
      | 'DEADLINE'
      | 'ANOMALY'
      | 'DATA_QUALITY'
    >;
    severityModel: 'DETERMINISTIC';
    evidenceRequired: true;
  };
}

export interface RegisteredDetectorContext
  extends DetectorContext {
  detectorId: string;
  detectorVersion: string;
  configHash: string;
  normalizedConfig: Record<
    string,
    string | number | boolean
  >;
}

export type RegisteredDetectorHandler = (
  context: RegisteredDetectorContext,
  version: DatasetVersion,
  config: Record<string, string | number | boolean>
) => Insight[];

export interface RegisteredDetector {
  descriptor: RegisteredDetectorDescriptor;
  handler: RegisteredDetectorHandler;
}

export interface DetectorExecutionResult {
  runId: string;
  detector: RegisteredDetectorDescriptor;
  configHash: string;
  normalizedConfig: Record<
    string,
    string | number | boolean
  >;
  datasetId: string;
  datasetVersionId: string;
  insights: Insight[];
}

export interface FixedThresholdDetectorConfig {
  stockColumn: string;
  threshold: number;
  entityColumn?: string;
  severity?: InsightSeverity;
}
