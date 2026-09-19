import type { ActionIntent } from '../../actions/types.js';
import type { CompanyEntityType } from '../../companyKnowledge/types.js';
import type { InsightSeverity } from '../../discovery/types.js';
import type { WatchComparisonOperator } from '../../watch/types.js';

export interface DomainPackEntityVocabulary {
  entityType: CompanyEntityType;
  label: string;
  pluralLabel: string;
  description: string;
}

export interface DomainPackDetectorTemplate {
  id: string;
  name: string;
  description: string;
  detectorId: string;
  detectorVersion: string;
  defaultConfig: Record<
    string,
    string | number | boolean
  >;
  overridableConfigFields: string[];
}

export interface DomainPackWatchTemplate {
  id: string;
  name: string;
  description: string;
  activation: 'SUGGESTION_ONLY';
  entityType: CompanyEntityType;
  predicate: string;
  operator: WatchComparisonOperator;
  defaultThreshold: number;
  evaluationMode: 'INTERVAL';
  intervalMinutes: number;
}

export interface DomainPackActionTemplate {
  id: string;
  name: string;
  description: string;
  intent: ActionIntent;
  mode: 'PROPOSAL_ONLY';
  instructionTemplate: string;
  requiredFields: string[];
}

export interface DomainPackDescriptor {
  id: string;
  version: string;
  name: string;
  description: string;
  category: string;
  executionMode: 'DECLARATIVE';
  stability: 'STABLE';
  entityVocabulary: DomainPackEntityVocabulary[];
  detectorTemplates: DomainPackDetectorTemplate[];
  watchTemplates: DomainPackWatchTemplate[];
  actionTemplates: DomainPackActionTemplate[];
  ui: {
    iconKey: string;
    shortLabel: string;
    keywords: string[];
  };
}

export type DomainPackInstallationStatus =
  | 'ACTIVE'
  | 'REMOVED';

export interface DomainPackInstallation {
  id: string;
  accountId: string;
  packId: string;
  packVersion: string;
  status: DomainPackInstallationStatus;
  installedAt: number;
  updatedAt: number;
}

export interface DomainPackDetectorRunResult {
  installation: DomainPackInstallation;
  pack: DomainPackDescriptor;
  template: DomainPackDetectorTemplate;
  effectiveConfig: Record<
    string,
    string | number | boolean
  >;
  detectorRun: {
    runId: string;
    configHash: string;
    datasetId: string;
    datasetVersionId: string;
    insights: unknown[];
  };
}
