import crypto from 'crypto';
import { datasetStore } from '../datasets/datasetStore.js';
import { specializedAIService } from '../specializedAIService.js';
import { workspaceRuntimeService } from '../workspaceRuntimeService.js';
import { analyticalQuestionPlanner } from './analyticalQuestionPlanner.js';
import { analyticalQuestionService } from './analyticalQuestionService.js';
import {
  UnifiedQueryRoute,
  UnifiedQuestionResult,
} from './types.js';

export class UnifiedQueryError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'QUESTION_REQUIRED'
    | 'QUESTION_TOO_LONG'
    | 'SOURCE_REQUIRED';

  constructor(
    code: 'QUESTION_REQUIRED' | 'QUESTION_TOO_LONG' | 'SOURCE_REQUIRED',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'UnifiedQueryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const ANALYTICAL_SIGNALS =
  /\b(revenue|sales|amount|total|average|avg|mean|count|how many|how much|profit|margin|balance|due|outstanding|unpaid|stock|inventory|orders?|customers?|products?|sold|units|most|highest|lowest|top|compare|comparison|versus|change|difference|august|september|october|november|december|january|february|march|april|june|july|last month|this month)\b/i;

const DOCUMENT_SIGNALS =
  /\b(policy|policies|contract|contracts|handbook|manual|clause|document|documents|pdf|according to|what does .* say|procedure|procedures|guideline|guidelines|terms|warranty|requirement|requirements|rule|rules)\b/i;

export class UnifiedQueryService {
  public chooseRoute(params: {
    accountId: string;
    question: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    now?: Date;
  }): UnifiedQueryRoute {
    const question = params.question.trim();

    if (params.datasetId) {
      const version = datasetStore.getCurrentVersion(
        params.accountId,
        params.datasetId
      );
      const deterministic = analyticalQuestionPlanner.planDeterministically(
        question,
        version,
        params.now || new Date()
      );
      if (deterministic.kind !== 'UNSUPPORTED') {
        return 'DATASET_ANALYTICS';
      }
    }

    if (
      params.knowledgeBaseId &&
      DOCUMENT_SIGNALS.test(question) &&
      !ANALYTICAL_SIGNALS.test(question)
    ) {
      return 'DOCUMENT_KNOWLEDGE';
    }

    if (params.datasetId && !params.knowledgeBaseId) {
      return 'DATASET_ANALYTICS';
    }

    if (params.knowledgeBaseId && !params.datasetId) {
      return 'DOCUMENT_KNOWLEDGE';
    }

    if (params.datasetId && ANALYTICAL_SIGNALS.test(question)) {
      return 'DATASET_ANALYTICS';
    }

    if (params.knowledgeBaseId) {
      return 'DOCUMENT_KNOWLEDGE';
    }

    throw new UnifiedQueryError(
      'SOURCE_REQUIRED',
      400,
      'Provide datasetId for structured analytics, knowledgeBaseId for document knowledge, or both for automatic routing.'
    );
  }

  public async answer(params: {
    accountId: string;
    question: string;
    datasetId?: string;
    datasetVersionId?: string;
    knowledgeBaseId?: string;
    allowLlmPlanning?: boolean;
    allowLlmExplanation?: boolean;
    now?: Date;
    requestId?: string;
  }): Promise<UnifiedQuestionResult> {
    const question = params.question?.trim();
    if (!question) {
      throw new UnifiedQueryError(
        'QUESTION_REQUIRED',
        400,
        'Question is required.'
      );
    }
    if (question.length > 5000) {
      throw new UnifiedQueryError(
        'QUESTION_TOO_LONG',
        400,
        'Question length exceeds 5000 characters.'
      );
    }

    const requestId =
      params.requestId || `query_req_${crypto.randomUUID().slice(0, 8)}`;
    const route = this.chooseRoute({
      accountId: params.accountId,
      question,
      datasetId: params.datasetId,
      knowledgeBaseId: params.knowledgeBaseId,
      now: params.now,
    });

    if (route === 'DATASET_ANALYTICS') {
      if (!params.datasetId) {
        throw new UnifiedQueryError(
          'SOURCE_REQUIRED',
          400,
          'datasetId is required for structured analytics.'
        );
      }
      return analyticalQuestionService.answer({
        accountId: params.accountId,
        datasetId: params.datasetId,
        versionId: params.datasetVersionId,
        question,
        allowLlmPlanning: params.allowLlmPlanning,
        allowLlmExplanation: params.allowLlmExplanation,
        now: params.now,
        requestId,
      });
    }

    if (!params.knowledgeBaseId) {
      throw new UnifiedQueryError(
        'SOURCE_REQUIRED',
        400,
        'knowledgeBaseId is required for document knowledge questions.'
      );
    }

    const kb =
      await workspaceRuntimeService.requireKB(
        params.accountId,
        params.knowledgeBaseId
      );
    const result = await specializedAIService.answer({
      aiId: kb.specializedAi.id,
      message: question,
      accountId: params.accountId,
      chatHistory: kb.chatHistory,
      source: 'WEB',
      requestId,
    });

    return {
      route: 'DOCUMENT_KNOWLEDGE',
      question,
      answer: result.answer,
      grounded: result.grounded,
      refused: result.refused,
      engineUsed: result.engineUsed,
      sources: result.sources,
      knowledgeBaseId: kb.id,
    };
  }
}

export const unifiedQueryService = new UnifiedQueryService();
