import { DatasetVersion } from '../datasets/types.js';
import {
  AnalyticalAggregate,
  AnalyticalFilter,
  AnalyticalQueryPlan,
  PeriodComparisonPlan,
} from '../datasets/queryTypes.js';
import { providerRouter } from '../providers/providerRouter.js';
import { LLMGenerateResult } from '../providers/types.js';
import {
  AnalyticalPlanEnvelope,
  ProviderPlanningTrace,
} from './types.js';
import {
  AnalyticalPlanningError,
  planDeterministicAnalyticalQuestion,
} from './deterministicAnalyticalPlanner.js';

const ALLOWED_FILTERS = new Set([
  'EQ',
  'NEQ',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'CONTAINS',
  'IN',
]);
const ALLOWED_AGGREGATES = new Set([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'DISTINCT_COUNT',
]);

type PlannedResult = {
  envelope: AnalyticalPlanEnvelope;
  source: 'DETERMINISTIC' | 'LLM' | 'NONE';
  providerPlanning?: ProviderPlanningTrace;
};

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function assertStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string')
  ) {
    throw new AnalyticalPlanningError(
      'INVALID_LLM_PLAN',
      `${field} must be a string array.`
    );
  }
  return value;
}

function normalizeFilters(value: unknown): AnalyticalFilter[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AnalyticalPlanningError(
      'INVALID_LLM_PLAN',
      'filters must be an array.'
    );
  }

  return value.map((item: any) => {
    if (
      !item ||
      typeof item.column !== 'string' ||
      !ALLOWED_FILTERS.has(item.operator)
    ) {
      throw new AnalyticalPlanningError(
        'INVALID_LLM_PLAN',
        'Invalid analytical filter.'
      );
    }
    return {
      column: item.column,
      operator: item.operator,
      value: item.value,
    } as AnalyticalFilter;
  });
}

function normalizeAggregates(
  value: unknown
): AnalyticalAggregate[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AnalyticalPlanningError(
      'INVALID_LLM_PLAN',
      'aggregates must be an array.'
    );
  }

  return value.map((item: any) => {
    if (!item || !ALLOWED_AGGREGATES.has(item.operator)) {
      throw new AnalyticalPlanningError(
        'INVALID_LLM_PLAN',
        'Invalid analytical aggregate.'
      );
    }
    if (item.column !== undefined && typeof item.column !== 'string') {
      throw new AnalyticalPlanningError(
        'INVALID_LLM_PLAN',
        'Aggregate column must be a string.'
      );
    }
    if (item.alias !== undefined && typeof item.alias !== 'string') {
      throw new AnalyticalPlanningError(
        'INVALID_LLM_PLAN',
        'Aggregate alias must be a string.'
      );
    }
    return {
      operator: item.operator,
      column: item.column,
      alias: item.alias,
    } as AnalyticalAggregate;
  });
}

function normalizeQueryPlan(raw: any): AnalyticalQueryPlan {
  if (!raw || typeof raw.tableName !== 'string') {
    throw new AnalyticalPlanningError(
      'INVALID_LLM_PLAN',
      'LLM query plan requires tableName.'
    );
  }

  const sort =
    raw.sort === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(raw.sort)) {
            throw new AnalyticalPlanningError(
              'INVALID_LLM_PLAN',
              'sort must be an array.'
            );
          }
          return raw.sort.map((item: any) => {
            if (
              !item ||
              typeof item.key !== 'string' ||
              !['ASC', 'DESC'].includes(item.direction)
            ) {
              throw new AnalyticalPlanningError(
                'INVALID_LLM_PLAN',
                'Invalid sort instruction.'
              );
            }
            return {
              key: item.key,
              direction: item.direction as 'ASC' | 'DESC',
            };
          });
        })();

  return {
    tableName: raw.tableName,
    filters: normalizeFilters(raw.filters),
    select: assertStringArray(raw.select, 'select'),
    groupBy: assertStringArray(raw.groupBy, 'groupBy'),
    aggregates: normalizeAggregates(raw.aggregates),
    sort,
    limit: raw.limit === undefined ? undefined : Number(raw.limit),
  };
}

function normalizePeriodPlan(raw: any): PeriodComparisonPlan {
  if (
    !raw ||
    typeof raw.tableName !== 'string' ||
    typeof raw.dateColumn !== 'string' ||
    !raw.metric ||
    !raw.firstPeriod ||
    !raw.secondPeriod
  ) {
    throw new AnalyticalPlanningError(
      'INVALID_LLM_PLAN',
      'Invalid period comparison plan.'
    );
  }

  const metric = normalizeAggregates([raw.metric])?.[0];
  if (!metric || !['COUNT', 'SUM', 'AVG'].includes(metric.operator)) {
    throw new AnalyticalPlanningError(
      'INVALID_LLM_PLAN',
      'Period metric must be COUNT, SUM, or AVG.'
    );
  }

  const normalizePeriod = (period: any) => {
    if (
      !period ||
      typeof period.label !== 'string' ||
      typeof period.start !== 'string' ||
      typeof period.end !== 'string'
    ) {
      throw new AnalyticalPlanningError(
        'INVALID_LLM_PLAN',
        'Invalid period range.'
      );
    }
    return {
      label: period.label,
      start: period.start,
      end: period.end,
    };
  };

  return {
    tableName: raw.tableName,
    dateColumn: raw.dateColumn,
    metric,
    filters: normalizeFilters(raw.filters),
    firstPeriod: normalizePeriod(raw.firstPeriod),
    secondPeriod: normalizePeriod(raw.secondPeriod),
  };
}

function normalizeEnvelope(raw: any): AnalyticalPlanEnvelope {
  if (!raw || typeof raw.kind !== 'string') {
    throw new AnalyticalPlanningError(
      'INVALID_LLM_PLAN',
      'LLM planner did not return a kind.'
    );
  }

  if (raw.kind === 'QUERY') {
    return { kind: 'QUERY', plan: normalizeQueryPlan(raw.plan) };
  }
  if (raw.kind === 'PERIOD_COMPARISON') {
    return {
      kind: 'PERIOD_COMPARISON',
      plan: normalizePeriodPlan(raw.plan),
    };
  }
  if (raw.kind === 'UNSUPPORTED') {
    return {
      kind: 'UNSUPPORTED',
      reason:
        typeof raw.reason === 'string'
          ? raw.reason
          : 'Unsupported analytical question.',
    };
  }

  throw new AnalyticalPlanningError(
    'INVALID_LLM_PLAN',
    `Unknown plan kind "${raw.kind}".`
  );
}

function providerTrace(
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

function schemaPrompt(version: DatasetVersion): string {
  return version.tables
    .map((table) => {
      const columns = table.columns
        .map(
          (column) =>
            `- ${column.name}: ${column.inferredType} (nullable=${column.nullable})`
        )
        .join('\n');
      return `TABLE: ${table.name}\n${columns}`;
    })
    .join('\n\n');
}

export class AnalyticalQuestionPlanner {
  public planDeterministically(
    question: string,
    version: DatasetVersion,
    now = new Date()
  ): AnalyticalPlanEnvelope {
    return planDeterministicAnalyticalQuestion(question, version, now);
  }

  public async plan(params: {
    question: string;
    version: DatasetVersion;
    now?: Date;
    allowLlm?: boolean;
  }): Promise<PlannedResult> {
    const deterministic = planDeterministicAnalyticalQuestion(
      params.question,
      params.version,
      params.now || new Date()
    );

    if (deterministic.kind !== 'UNSUPPORTED') {
      return {
        envelope: deterministic,
        source: 'DETERMINISTIC',
      };
    }

    if (params.allowLlm === false) {
      return {
        envelope: deterministic,
        source: 'NONE',
      };
    }

    const provider = providerRouter.getPrimaryProvider();
    if (!provider?.isConfigured()) {
      return {
        envelope: deterministic,
        source: 'NONE',
        providerPlanning: {
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

    const systemInstruction = [
      'You translate a business question into a SAFE structured analytical plan.',
      'Use only the provided table and column names.',
      'Never produce SQL, code, formulas, prose, or hidden reasoning.',
      'Return JSON only.',
      'Allowed kinds: QUERY, PERIOD_COMPARISON, UNSUPPORTED.',
      'Allowed filter operators: EQ, NEQ, GT, GTE, LT, LTE, CONTAINS, IN.',
      'Allowed aggregates: COUNT, SUM, AVG, MIN, MAX, DISTINCT_COUNT.',
      'Do not invent columns.',
      'Only describe the plan. Deterministic application code will calculate the result.',
    ].join('\n');

    const prompt = [
      'SCHEMA:',
      schemaPrompt(params.version),
      '',
      'QUESTION:',
      params.question,
      '',
      'Return one JSON object matching one of these shapes:',
      '{"kind":"QUERY","plan":{"tableName":"...","filters":[],"select":[],"groupBy":[],"aggregates":[],"sort":[],"limit":100}}',
      '{"kind":"PERIOD_COMPARISON","plan":{"tableName":"...","dateColumn":"...","metric":{"operator":"SUM","column":"...","alias":"..."},"filters":[],"firstPeriod":{"label":"...","start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"secondPeriod":{"label":"...","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}}}',
      '{"kind":"UNSUPPORTED","reason":"..."}',
    ].join('\n');

    const generation = await providerRouter.generate({
      model: 'gemini-3.8-flash',
      prompt,
      systemInstruction,
      responseFormat: 'json',
      temperature: 0,
    });

    const trace = providerTrace(generation);
    if (!generation.ok || !generation.text.trim()) {
      return {
        envelope: deterministic,
        source: 'NONE',
        providerPlanning: trace,
      };
    }

    try {
      const parsed = JSON.parse(stripCodeFence(generation.text));
      return {
        envelope: normalizeEnvelope(parsed),
        source: 'LLM',
        providerPlanning: trace,
      };
    } catch (error: any) {
      throw new AnalyticalPlanningError(
        'INVALID_LLM_PLAN',
        `LLM analytical plan was not valid safe JSON: ${error?.message || 'invalid response'}`
      );
    }
  }
}

export const analyticalQuestionPlanner = new AnalyticalQuestionPlanner();
