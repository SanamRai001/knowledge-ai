import { DatasetColumnSchema, DatasetTable, DatasetVersion } from '../datasets/types.js';
import {
  AnalyticalAggregate,
  AnalyticalFilter,
  AnalyticalQueryPlan,
  PeriodComparisonPlan,
} from '../datasets/queryTypes.js';

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

export class AnalyticalPlanningError extends Error {
  public readonly code:
    | 'ANALYTICAL_QUESTION_UNSUPPORTED'
    | 'INVALID_LLM_PLAN';

  constructor(
    code: 'ANALYTICAL_QUESTION_UNSUPPORTED' | 'INVALID_LLM_PLAN',
    message: string
  ) {
    super(message);
    this.name = 'AnalyticalPlanningError';
    this.code = code;
  }
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function columnName(column: DatasetColumnSchema): string {
  return normalize(column.normalizedName || column.name).replace(/_/g, ' ');
}

function isNumeric(column: DatasetColumnSchema): boolean {
  return ['INTEGER', 'DECIMAL', 'CURRENCY'].includes(column.inferredType);
}

function isDateColumn(column: DatasetColumnSchema): boolean {
  return ['DATE', 'DATETIME'].includes(column.inferredType);
}

function scoreName(name: string, terms: string[]): number {
  const normalized = normalize(name).replace(/_/g, ' ');
  return terms.reduce((score, term, index) => {
    if (normalized === term) return score + 100 - index;
    if (normalized.includes(term)) return score + 40 - index;
    return score;
  }, 0);
}

function bestColumn(
  table: DatasetTable,
  terms: string[],
  predicate: (column: DatasetColumnSchema) => boolean = () => true
): DatasetColumnSchema | null {
  const candidates = table.columns
    .filter(predicate)
    .map((column) => ({
      column,
      score: scoreName(columnName(column), terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.column || null;
}

function latestYear(
  table: DatasetTable,
  dateColumn: DatasetColumnSchema
): number | null {
  const index = table.columns.findIndex(
    (column) => column.name === dateColumn.name
  );
  if (index < 0) return null;

  let latest: number | null = null;
  for (const row of table.rows) {
    const value = row[index];
    if (typeof value !== 'string') continue;
    const timestamp = Date.parse(
      value.length === 10 ? value + 'T00:00:00Z' : value
    );
    if (!Number.isNaN(timestamp) && (latest === null || timestamp > latest)) {
      latest = timestamp;
    }
  }

  return latest === null ? null : new Date(latest).getUTCFullYear();
}

function monthRange(month: number, year: number, label: string) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return {
    label,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function explicitMonths(
  question: string
): Array<{ name: string; month: number }> {
  const lower = normalize(question);
  const matches: Array<{
    name: string;
    month: number;
    index: number;
  }> = [];

  for (const [name, month] of Object.entries(MONTHS)) {
    const match = new RegExp('\\b' + name + '\\b', 'i').exec(lower);
    if (match) matches.push({ name, month, index: match.index });
  }

  matches.sort((a, b) => a.index - b.index);
  const deduped: Array<{ name: string; month: number }> = [];
  for (const match of matches) {
    if (!deduped.some((item) => item.month === match.month)) {
      deduped.push({ name: match.name, month: match.month });
    }
  }
  return deduped;
}

function resolveYear(
  question: string,
  table: DatasetTable,
  dateColumn: DatasetColumnSchema,
  now: Date
): number {
  const explicit = question.match(/\b(20\d{2})\b/);
  if (explicit) return Number(explicit[1]);
  return latestYear(table, dateColumn) ?? now.getUTCFullYear();
}

function dateFilters(
  question: string,
  table: DatasetTable,
  dateColumn: DatasetColumnSchema,
  now: Date
): AnalyticalFilter[] {
  const lower = normalize(question);
  let range: { start: string; end: string } | null = null;

  if (/\blast month\b/.test(lower)) {
    const currentMonth = now.getUTCMonth();
    const year =
      currentMonth === 0
        ? now.getUTCFullYear() - 1
        : now.getUTCFullYear();
    const month = currentMonth === 0 ? 11 : currentMonth - 1;
    range = monthRange(month, year, 'last month');
  } else if (/\b(this|current) month\b/.test(lower)) {
    range = monthRange(
      now.getUTCMonth(),
      now.getUTCFullYear(),
      'this month'
    );
  } else {
    const months = explicitMonths(lower);
    if (months.length === 1) {
      const year = resolveYear(question, table, dateColumn, now);
      range = monthRange(months[0].month, year, months[0].name);
    }
  }

  if (!range) return [];
  return [
    {
      column: dateColumn.name,
      operator: 'GTE',
      value: range.start,
    },
    {
      column: dateColumn.name,
      operator: 'LTE',
      value: range.end,
    },
  ];
}

function chooseTable(
  question: string,
  version: DatasetVersion
): DatasetTable {
  if (version.tables.length === 1) return version.tables[0];

  const lower = normalize(question);
  const scored = version.tables
    .map((table) => {
      let score = lower.includes(normalize(table.name)) ? 100 : 0;
      for (const column of table.columns) {
        const name = columnName(column);
        if (name.length >= 3 && lower.includes(name)) score += 10;
      }
      return { table, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.table || version.tables[0];
}

function measureColumn(
  question: string,
  table: DatasetTable
): DatasetColumnSchema | null {
  const lower = normalize(question);

  if (/\b(owe|owes|owed|due|outstanding|balance|remaining)\b/.test(lower)) {
    return bestColumn(
      table,
      [
        'outstanding balance',
        'balance due',
        'amount due',
        'remaining balance',
        'remaining',
        'due',
        'balance',
      ],
      isNumeric
    );
  }

  if (/\b(profit|margin)\b/.test(lower)) {
    return bestColumn(
      table,
      ['profit', 'margin', 'gross profit', 'net profit'],
      isNumeric
    );
  }

  if (/\b(quantity|qty|units|sold)\b/.test(lower)) {
    const quantity = bestColumn(
      table,
      ['quantity', 'qty', 'units sold', 'units', 'sold'],
      isNumeric
    );
    if (quantity) return quantity;
  }

  if (/\b(stock|inventory)\b/.test(lower)) {
    const stock = bestColumn(
      table,
      ['stock', 'quantity on hand', 'on hand', 'inventory'],
      isNumeric
    );
    if (stock) return stock;
  }

  return bestColumn(
    table,
    [
      'revenue',
      'net sales',
      'gross sales',
      'sales amount',
      'amount',
      'grand total',
      'total',
      'value',
      'price',
    ],
    isNumeric
  );
}

function dimensionColumn(
  question: string,
  table: DatasetTable
): DatasetColumnSchema | null {
  const lower = normalize(question);
  const choices: Array<{ regex: RegExp; terms: string[] }> = [
    {
      regex: /\b(product|products|item|items)\b/,
      terms: ['product name', 'product', 'item name', 'item', 'sku'],
    },
    {
      regex: /\b(customer|customers|client|clients|buyer|buyers|who)\b/,
      terms: [
        'customer name',
        'customer',
        'client name',
        'client',
        'buyer',
      ],
    },
    {
      regex: /\b(category|categories|type|types)\b/,
      terms: ['category', 'product category', 'type'],
    },
    {
      regex: /\b(branch|branches|location|locations|store|stores)\b/,
      terms: ['branch', 'location', 'store'],
    },
  ];

  for (const choice of choices) {
    if (choice.regex.test(lower)) {
      const found = bestColumn(
        table,
        choice.terms,
        (column) => !isNumeric(column) && !isDateColumn(column)
      );
      if (found) return found;
    }
  }
  return null;
}

function aggregateFor(
  question: string,
  measure: DatasetColumnSchema | null
): AnalyticalAggregate {
  const lower = normalize(question);

  if (/\b(average|avg|mean)\b/.test(lower)) {
    if (!measure) {
      throw new AnalyticalPlanningError(
        'ANALYTICAL_QUESTION_UNSUPPORTED',
        'No numeric measure column was found for an average.'
      );
    }
    return {
      operator: 'AVG',
      column: measure.name,
      alias: 'average',
    };
  }

  if (
    /\b(how many|number of|count)\b/.test(lower) &&
    !/\bamount\b/.test(lower)
  ) {
    return { operator: 'COUNT', alias: 'count' };
  }

  if (!measure) return { operator: 'COUNT', alias: 'count' };

  return {
    operator: 'SUM',
    column: measure.name,
    alias: /\b(revenue|sales)\b/.test(lower)
      ? 'revenue'
      : normalize(measure.name).replace(/\s+/g, '_'),
  };
}

export function planDeterministicAnalyticalQuestion(
  question: string,
  version: DatasetVersion,
  now = new Date()
):
  | { kind: 'QUERY'; plan: AnalyticalQueryPlan }
  | { kind: 'PERIOD_COMPARISON'; plan: PeriodComparisonPlan }
  | { kind: 'UNSUPPORTED'; reason: string } {
  const lower = normalize(question);
  const table = chooseTable(question, version);
  const dateColumn = table.columns.find(isDateColumn) || null;
  const measure = measureColumn(question, table);
  const dimension = dimensionColumn(question, table);

  const months = explicitMonths(question);
  if (
    dateColumn &&
    months.length >= 2 &&
    /\b(compare|comparison|versus|vs\.?|change|difference)\b/.test(lower)
  ) {
    const year = resolveYear(question, table, dateColumn, now);
    const metric = aggregateFor(question, measure);

    const plan: PeriodComparisonPlan = {
      tableName: table.name,
      dateColumn: dateColumn.name,
      metric,
      firstPeriod: monthRange(
        months[0].month,
        year,
        months[0].name
      ),
      secondPeriod: monthRange(
        months[1].month,
        year,
        months[1].name
      ),
    };
    return { kind: 'PERIOD_COMPARISON', plan };
  }

  const temporalFilters = dateColumn
    ? dateFilters(question, table, dateColumn, now)
    : [];

  const debtQuestion =
    /\b(owe|owes|owed|due|outstanding|unpaid|remaining balance)\b/.test(
      lower
    );

  if (debtQuestion && measure && dimension) {
    const limit = /\b(most|highest|largest|top)\b/.test(lower)
      ? 1
      : 100;

    return {
      kind: 'QUERY',
      plan: {
        tableName: table.name,
        filters: [
          ...temporalFilters,
          {
            column: measure.name,
            operator: 'GT',
            value: 0,
          },
        ],
        select: [dimension.name, measure.name],
        sort: [{ key: measure.name, direction: 'DESC' }],
        limit,
      },
    };
  }

  const rankingQuestion =
    /\b(most|highest|largest|top|best|least|lowest|smallest)\b/.test(
      lower
    );

  if (rankingQuestion && dimension) {
    const direction = /\b(least|lowest|smallest)\b/.test(lower)
      ? 'ASC'
      : 'DESC';
    const aggregate = aggregateFor(question, measure);
    const alias =
      aggregate.alias ||
      aggregate.operator.toLowerCase() +
        '_' +
        (aggregate.column || 'rows');

    return {
      kind: 'QUERY',
      plan: {
        tableName: table.name,
        filters: temporalFilters,
        groupBy: [dimension.name],
        aggregates: [aggregate],
        sort: [{ key: alias, direction }],
        limit: 1,
      },
    };
  }

  const analyticalSignal =
    /\b(revenue|sales|amount|total|average|avg|mean|count|how many|how much|profit|balance|stock|inventory|orders?|customers?|products?|sold|units|compare|change)\b/.test(
      lower
    );

  if (analyticalSignal) {
    return {
      kind: 'QUERY',
      plan: {
        tableName: table.name,
        filters: temporalFilters,
        aggregates: [aggregateFor(question, measure)],
      },
    };
  }

  return {
    kind: 'UNSUPPORTED',
    reason:
      'The question did not match a safe deterministic analytical pattern.',
  };
}
