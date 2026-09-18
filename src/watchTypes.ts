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

export type WatchCondition =
  | {
      kind: 'ENTITY_NUMERIC_THRESHOLD';
      entityId: string;
      predicate: string;
      operator: WatchComparisonOperator;
      threshold: number;
    }
  | {
      kind: 'DATASET_AGGREGATE_THRESHOLD';
      datasetId: string;
      tableName: string;
      aggregate: {
        operator: string;
        column?: string;
      };
      filters?: Array<{
        column: string;
        operator: string;
        value: string | number | boolean | null | Array<string | number | boolean | null>;
      }>;
      operator: WatchComparisonOperator;
      threshold: number;
    }
  | {
      kind: 'ENTITY_DATE_WINDOW';
      entityId: string;
      predicate: string;
      daysBefore: number;
    }
  | {
      kind: 'TIME_REACHED';
      triggerAt: number;
      timezone?: string;
    };

export interface WatchRule {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  status: WatchRuleStatus;
  origin: 'MANUAL' | 'NATURAL_LANGUAGE' | 'INSIGHT' | 'SYSTEM';
  version: number;
  condition: WatchCondition;
  evaluationMode: 'MANUAL' | 'INTERVAL' | 'EVENT';
  intervalMinutes?: number;
  currentState: WatchConditionState;
  lastEvaluationAt?: number;
  lastTriggeredAt?: number;
  nextEvaluationAt?: number;
  createdAt: number;
  updatedAt: number;
}

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
  status: 'PROPOSED' | 'NEEDS_INPUT' | 'SAVED' | 'CANCELLED' | 'INVALID';
  parserSource: 'DETERMINISTIC' | 'LLM_ASSISTED';
  proposedName: string;
  condition?: WatchCondition;
  candidates?: WatchDraftCandidate[];
  needsInputReason?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  savedRuleId?: string;
}

export type WatchEvidence =
  | {
      sourceType: 'ENTITY';
      entityId: string;
      entityLabel: string;
      predicate: string;
      effectiveClaimId: string;
      effectiveValue: string | number | boolean | null;
      authorityLevel: string;
      sourceName: string;
      sourceVersionId?: string;
    }
  | {
      sourceType: 'DATASET';
      datasetId: string;
      datasetVersionId: string;
      datasetVersionNumber: number;
      sourceFilename: string;
      sourceSha256: string;
      tableId: string;
      tableName: string;
      aggregateOperator: string;
      aggregateColumn?: string;
      filters: unknown[];
      matchedRowCount: number;
      observedValue: number;
      companyStateOverlay?: {
        applied: boolean;
        applicationCount: number;
        claimIds: string[];
        authorityLevels: string[];
      };
    }
  | {
      sourceType: 'ENTITY_DATE';
      entityId: string;
      entityLabel: string;
      predicate: string;
      effectiveClaimId: string;
      dateValue: string;
      targetAt: number;
      evaluatedAt: number;
      daysUntil: number;
      authorityLevel: string;
      sourceName: string;
      sourceVersionId?: string;
    }
  | {
      sourceType: 'TIME';
      triggerAt: number;
      evaluatedAt: number;
      timezone?: string;
    };

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
  resolutionReason?: 'CONDITION_CLEARED' | 'USER_RESOLVED';
  snoozedUntil?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WatchJob {
  id: string;
  fingerprint: string;
  accountId: string;
  watchRuleId: string;
  ruleVersion: number;
  scheduledFor: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
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
