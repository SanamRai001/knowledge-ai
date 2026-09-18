import {
  AggregateOperator,
  AnalyticalFilter,
} from '../datasets/queryTypes.js';
import { KnowledgeClaimValue } from '../companyKnowledge/types.js';

export type WatchRuleStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'INVALID'
  | 'ARCHIVED';

export type WatchConditionState =
  | 'UNKNOWN'
  | 'FALSE'
  | 'TRUE'
  | 'ERROR';

export type WatchAlertStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'SNOOZED'
  | 'RESOLVED';

export type WatchComparisonOperator =
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'EQ'
  | 'NEQ';

export type WatchRuleOrigin =
  | 'MANUAL'
  | 'NATURAL_LANGUAGE'
  | 'INSIGHT'
  | 'SYSTEM';

export type WatchEvaluationMode =
  | 'MANUAL'
  | 'INTERVAL'
  | 'EVENT';

export interface EntityNumericThresholdCondition {
  kind: 'ENTITY_NUMERIC_THRESHOLD';
  entityId: string;
  predicate: string;
  operator: WatchComparisonOperator;
  threshold: number;
}

export interface DatasetAggregateThresholdCondition {
  kind: 'DATASET_AGGREGATE_THRESHOLD';
  datasetId: string;
  tableName: string;
  aggregate: {
    operator: AggregateOperator;
    column?: string;
  };
  filters?: AnalyticalFilter[];
  operator: WatchComparisonOperator;
  threshold: number;
}

export type WatchCondition =
  | EntityNumericThresholdCondition
  | DatasetAggregateThresholdCondition;

export interface WatchRule {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  status: WatchRuleStatus;
  origin: WatchRuleOrigin;
  version: number;
  condition: WatchCondition;
  evaluationMode: WatchEvaluationMode;
  intervalMinutes?: number;
  currentState: WatchConditionState;
  lastEvaluationAt?: number;
  lastTriggeredAt?: number;
  nextEvaluationAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WatchEntityEvidence {
  sourceType: 'ENTITY';
  entityId: string;
  entityLabel: string;
  predicate: string;
  effectiveClaimId: string;
  effectiveValue: KnowledgeClaimValue;
  authorityLevel: string;
  sourceName: string;
  sourceVersionId?: string;
}

export interface WatchDatasetEvidence {
  sourceType: 'DATASET';
  datasetId: string;
  datasetVersionId: string;
  datasetVersionNumber: number;
  sourceFilename: string;
  sourceSha256: string;
  tableId: string;
  tableName: string;
  aggregateOperator: AggregateOperator;
  aggregateColumn?: string;
  filters: AnalyticalFilter[];
  matchedRowCount: number;
  observedValue: number;
  companyStateOverlay?: {
    applied: boolean;
    applicationCount: number;
    claimIds: string[];
    authorityLevels: string[];
  };
}

export type WatchEvidence =
  | WatchEntityEvidence
  | WatchDatasetEvidence;

export interface WatchEvaluation {
  id: string;
  accountId: string;
  watchRuleId: string;
  ruleVersion: number;
  status: 'COMPLETED' | 'FAILED';
  conditionMatched?: boolean;
  observedValue?: number;
  comparisonOperator: WatchComparisonOperator;
  threshold: number;
  previousConditionState: WatchConditionState;
  nextConditionState: WatchConditionState;
  evidence?: WatchEvidence;
  evaluatedAt: number;
  error?: string;
}

export interface WatchAlert {
  id: string;
  episodeKey: string;
  accountId: string;
  watchRuleId: string;
  ruleVersion: number;
  status: WatchAlertStatus;
  title: string;
  summary: string;
  firstTriggeredAt: number;
  lastTriggeredAt: number;
  occurrenceCount: number;
  evaluationIds: string[];
  lastEvaluationId: string;
  evidence: WatchEvidence;
  acknowledgedAt?: number;
  resolvedAt?: number;
  snoozedUntil?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WatchEvaluationResult {
  rule: WatchRule;
  evaluation: WatchEvaluation;
  alert?: WatchAlert;
}


export type WatchDraftStatus =
  | 'PROPOSED'
  | 'NEEDS_INPUT'
  | 'SAVED'
  | 'CANCELLED'
  | 'INVALID';

export type WatchDraftParserSource =
  | 'DETERMINISTIC'
  | 'LLM_ASSISTED';

export interface WatchDraftCandidate {
  key: string;
  kind: 'ENTITY' | 'DATASET_TABLE';
  label: string;
  reason: string;
  entityId?: string;
  datasetId?: string;
  tableName?: string;
}

export interface WatchDraft {
  id: string;
  accountId: string;
  instruction: string;
  status: WatchDraftStatus;
  parserSource: WatchDraftParserSource;
  proposedName: string;
  parsedRequest?: ParsedWatchRequest;
  condition?: WatchCondition;
  candidates?: WatchDraftCandidate[];
  needsInputReason?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  savedRuleId?: string;
}


export type ParsedWatchRequest =
  | {
      kind: 'ENTITY_NUMERIC_THRESHOLD';
      entityType: 'PRODUCT' | 'ORDER' | 'INVOICE';
      entityReference: string;
      predicate: 'CURRENT_STOCK' | 'BALANCE_DUE';
      operator: WatchComparisonOperator;
      threshold: number;
    }
  | {
      kind: 'DATASET_AGGREGATE_THRESHOLD';
      semantic: 'OUTSTANDING_TOTAL';
      operator: WatchComparisonOperator;
      threshold: number;
    };


export type WatchJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export interface WatchJob {
  id: string;
  fingerprint: string;
  accountId: string;
  watchRuleId: string;
  ruleVersion: number;
  scheduledFor: number;
  status: WatchJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  evaluationId?: string;
  lastError?: string;
  skipReason?: string;
}
