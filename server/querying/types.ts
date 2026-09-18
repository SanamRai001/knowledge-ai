import {
  AnalyticalQueryPlan,
  AnalyticalQueryResult,
  PeriodComparisonPlan,
  PeriodComparisonResult,
} from '../datasets/queryTypes.js';
import { LLMUsageMetadata } from '../providers/types.js';

export type UnifiedQueryRoute =
  | 'DATASET_ANALYTICS'
  | 'DOCUMENT_KNOWLEDGE';

export type AnalyticalPlanSource =
  | 'DETERMINISTIC'
  | 'LLM'
  | 'NONE';

export type AnalyticalPlanEnvelope =
  | {
      kind: 'QUERY';
      plan: AnalyticalQueryPlan;
    }
  | {
      kind: 'PERIOD_COMPARISON';
      plan: PeriodComparisonPlan;
    }
  | {
      kind: 'UNSUPPORTED';
      reason: string;
    };

export interface ProviderPlanningTrace {
  attempted: boolean;
  providerId?: string;
  modelId?: string;
  latencyMs: number | null;
  usage: LLMUsageMetadata;
  failureCategory?: string;
}

export interface AnalyticalQuestionResult {
  route: 'DATASET_ANALYTICS';
  question: string;
  planSource: AnalyticalPlanSource;
  plan: Exclude<AnalyticalPlanEnvelope, { kind: 'UNSUPPORTED' }>;
  answer: string;
  explanation?: string;
  result: AnalyticalQueryResult | PeriodComparisonResult;
  providerPlanning?: ProviderPlanningTrace;
  providerExplanation?: ProviderPlanningTrace;
}

export interface DocumentQuestionResult {
  route: 'DOCUMENT_KNOWLEDGE';
  question: string;
  answer: string;
  grounded: boolean;
  refused: boolean;
  engineUsed: string;
  sources: unknown[];
  knowledgeBaseId: string;
}

export type UnifiedQuestionResult =
  | AnalyticalQuestionResult
  | DocumentQuestionResult;
