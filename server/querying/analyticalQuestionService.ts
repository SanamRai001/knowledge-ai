import crypto from 'crypto';
import { datasetStore } from '../datasets/datasetStore.js';
import {
  AnalyticalQueryResult,
  PeriodComparisonResult,
} from '../datasets/queryTypes.js';
import { structuredAnalyticsEngine } from '../datasets/structuredAnalyticsEngine.js';
import { quotaAndBillingService } from '../mediator/quotaAndBillingService.js';
import { providerRouter } from '../providers/providerRouter.js';
import { LLMGenerateResult } from '../providers/types.js';
import { analyticalQuestionPlanner } from './analyticalQuestionPlanner.js';
import { AnalyticalPlanningError } from './deterministicAnalyticalPlanner.js';
import {
  AnalyticalPlanEnvelope,
  AnalyticalQuestionResult,
  ProviderPlanningTrace,
} from './types.js';

export class AnalyticalQuestionError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'QUESTION_REQUIRED'
    | 'QUESTION_TOO_LONG'
    | 'ANALYTICAL_QUESTION_UNSUPPORTED';

  constructor(
    code:
      | 'QUESTION_REQUIRED'
      | 'QUESTION_TOO_LONG'
      | 'ANALYTICAL_QUESTION_UNSUPPORTED',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AnalyticalQuestionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function traceFromGeneration(
  generation: LLMGenerateResult
): ProviderPlanningTrace {
  return {
    attempted: true,
    providerId: generation.providerId,
    modelId: generation.modelId,
    latencyMs: generation.latencyMs,
    usage: generation.usage,
    failureCategory: generation.failure?.category,
  };
}

function recordProviderUsage(params: {
  accountId: string;
  requestId: string;
  trace?: ProviderPlanningTrace;
}): void {
  const trace = params.trace;
  if (!trace?.attempted) return;

  quotaAndBillingService.recordUsage({
    tenantId: params.accountId,
    requestId: params.requestId,
    providerId: trace.providerId,
    modelId: trace.modelId,
    metric: 'provider_call',
    quantity: 1,
    unit: 'call',
    source: 'MEASURED',
  });

  const totalTokens =
    trace.usage.totalTokens ??
    (trace.usage.inputTokens !== null && trace.usage.outputTokens !== null
      ? trace.usage.inputTokens + trace.usage.outputTokens
      : null);

  if (trace.usage.source === 'MEASURED' && totalTokens !== null) {
    quotaAndBillingService.recordUsage({
      tenantId: params.accountId,
      requestId: params.requestId,
      providerId: trace.providerId,
      modelId: trace.modelId,
      metric: 'tokens',
      quantity: totalTokens,
      unit: 'token',
      source: 'MEASURED',
    });
  }
}

function displayNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value);
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function deterministicQueryAnswer(
  result: AnalyticalQueryResult
): string {
  if (result.rows.length === 0) {
    return 'No matching records were found for that analytical question.';
  }

  if (result.rows.length === 1) {
    const row = result.rows[0];
    const entries = Object.entries(row);

    if (entries.length === 1) {
      const [key, value] = entries[0];
      return `${titleCase(key)}: ${
        typeof value === 'number' ? displayNumber(value) : String(value ?? '—')
      }.`;
    }

    const text = entries
      .map(([key, value]) => {
        const formatted =
          typeof value === 'number'
            ? displayNumber(value)
            : String(value ?? '—');
        return `${titleCase(key)}: ${formatted}`;
      })
      .join('; ');
    return `${text}.`;
  }

  const first = result.rows[0];
  const firstSummary = Object.entries(first)
    .map(([key, value]) => {
      const formatted =
        typeof value === 'number'
          ? displayNumber(value)
          : String(value ?? '—');
      return `${titleCase(key)}: ${formatted}`;
    })
    .join('; ');

  return `Found ${result.provenance.matchedRowCount} matching record(s). First result: ${firstSummary}.`;
}

function deterministicComparisonAnswer(
  result: PeriodComparisonResult
): string {
  const first = displayNumber(result.firstPeriod.value);
  const second = displayNumber(result.secondPeriod.value);
  const change = displayNumber(result.absoluteChange);
  const percent =
    result.percentChange === null
      ? 'percentage change unavailable because the first period is zero'
      : `${displayNumber(result.percentChange)}%`;

  const direction =
    result.absoluteChange > 0
      ? 'increased'
      : result.absoluteChange < 0
        ? 'decreased'
        : 'did not change';

  return `${titleCase(result.metricAlias)} ${direction} from ${first} in ${result.firstPeriod.range.label} to ${second} in ${result.secondPeriod.range.label}. Absolute change: ${change}; change: ${percent}.`;
}

function deterministicAnswer(
  result: AnalyticalQueryResult | PeriodComparisonResult
): string {
  return 'firstPeriod' in result
    ? deterministicComparisonAnswer(result)
    : deterministicQueryAnswer(result);
}

function numberTokens(value: unknown): Set<string> {
  const text = JSON.stringify(value);
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  return new Set(
    matches.map((token) => {
      const number = Number(token.replace(/,/g, ''));
      return Number.isFinite(number) ? String(number) : token;
    })
  );
}

function explanationIsNumericallyGrounded(
  explanation: string,
  deterministicPayload: unknown
): boolean {
  const allowed = numberTokens(deterministicPayload);
  const tokens = explanation.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];

  return tokens.every((token) => {
    const number = Number(token.replace(/,/g, ''));
    const normalized = Number.isFinite(number) ? String(number) : token;
    return allowed.has(normalized);
  });
}

async function generateExplanation(params: {
  question: string;
  answer: string;
  result: AnalyticalQueryResult | PeriodComparisonResult;
}): Promise<{
  explanation?: string;
  trace?: ProviderPlanningTrace;
}> {
  const provider = providerRouter.getPrimaryProvider();
  if (!provider?.isConfigured()) {
    return {
      trace: {
        attempted: false,
        providerId: provider?.id,
        latencyMs: null,
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          source: 'UNAVAILABLE',
        },
        failureCategory: 'NOT_CONFIGURED',
      },
    };
  }

  const generation = await providerRouter.generate({
    model: 'gemini-3.8-flash',
    systemInstruction: [
      'You explain a deterministic business-analysis result.',
      'The supplied answer and result are authoritative.',
      'Do not recalculate, change, or invent any value.',
      'Do not introduce facts outside the supplied result/provenance.',
      'Return at most two concise sentences of useful interpretation.',
      'Do not mention internal implementation details.',
    ].join('\n'),
    prompt: [
      `Question: ${params.question}`,
      `Authoritative answer: ${params.answer}`,
      `Deterministic result and provenance: ${JSON.stringify(params.result)}`,
    ].join('\n\n'),
    responseFormat: 'text',
    temperature: 0.1,
  });

  const trace = traceFromGeneration(generation);
  if (!generation.ok || !generation.text.trim()) return { trace };

  const explanation = generation.text.trim();
  if (
    !explanationIsNumericallyGrounded(explanation, {
      answer: params.answer,
      result: params.result,
    })
  ) {
    return { trace };
  }

  return { explanation, trace };
}

export class AnalyticalQuestionService {
  public async answer(params: {
    accountId: string;
    datasetId: string;
    question: string;
    versionId?: string;
    allowLlmPlanning?: boolean;
    allowLlmExplanation?: boolean;
    now?: Date;
    requestId?: string;
  }): Promise<AnalyticalQuestionResult> {
    const question = params.question?.trim();
    if (!question) {
      throw new AnalyticalQuestionError(
        'QUESTION_REQUIRED',
        400,
        'Question is required.'
      );
    }
    if (question.length > 5000) {
      throw new AnalyticalQuestionError(
        'QUESTION_TOO_LONG',
        400,
        'Question length exceeds 5000 characters.'
      );
    }

    const requestId =
      params.requestId || `analytics_req_${crypto.randomUUID().slice(0, 8)}`;
    const version = params.versionId
      ? datasetStore.getVersion(
          params.accountId,
          params.datasetId,
          params.versionId
        )
      : datasetStore.getCurrentVersion(params.accountId, params.datasetId);

    if (!version) {
      datasetStore.requireDataset(params.accountId, params.datasetId);
      throw new AnalyticalQuestionError(
        'ANALYTICAL_QUESTION_UNSUPPORTED',
        404,
        'Dataset version was not found.'
      );
    }

    const planned = await analyticalQuestionPlanner.plan({
      question,
      version,
      now: params.now,
      allowLlm: params.allowLlmPlanning !== false,
    });
    recordProviderUsage({
      accountId: params.accountId,
      requestId,
      trace: planned.providerPlanning,
    });

    if (planned.envelope.kind === 'UNSUPPORTED') {
      throw new AnalyticalQuestionError(
        'ANALYTICAL_QUESTION_UNSUPPORTED',
        422,
        planned.envelope.reason
      );
    }

    let result: AnalyticalQueryResult | PeriodComparisonResult;
    if (planned.envelope.kind === 'PERIOD_COMPARISON') {
      result = structuredAnalyticsEngine.comparePeriods({
        accountId: params.accountId,
        datasetId: params.datasetId,
        versionId: version.id,
        plan: planned.envelope.plan,
      });
    } else {
      result = structuredAnalyticsEngine.execute({
        accountId: params.accountId,
        datasetId: params.datasetId,
        versionId: version.id,
        plan: planned.envelope.plan,
      });
    }

    const answer = deterministicAnswer(result);
    let explanation: string | undefined;
    let providerExplanation: ProviderPlanningTrace | undefined;

    if (params.allowLlmExplanation !== false) {
      const generated = await generateExplanation({
        question,
        answer,
        result,
      });
      explanation = generated.explanation;
      providerExplanation = generated.trace;
      recordProviderUsage({
        accountId: params.accountId,
        requestId,
        trace: providerExplanation,
      });
    }

    return {
      route: 'DATASET_ANALYTICS',
      question,
      planSource: planned.source,
      plan: planned.envelope as Exclude<
        AnalyticalPlanEnvelope,
        { kind: 'UNSUPPORTED' }
      >,
      answer,
      explanation,
      result,
      providerPlanning: planned.providerPlanning,
      providerExplanation,
    };
  }
}

export const analyticalQuestionService = new AnalyticalQuestionService();

export { AnalyticalPlanningError };
