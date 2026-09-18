import {
  DatasetCell,
  DatasetColumnSchema,
  DatasetTable,
  DatasetVersion,
} from './types.js';
import { datasetStore } from './datasetStore.js';
import {
  AggregateOperator,
  AnalyticalAggregate,
  AnalyticalFilter,
  AnalyticalProvenance,
  AnalyticalQueryPlan,
  AnalyticalQueryResult,
  PeriodComparisonPlan,
  PeriodComparisonResult,
} from './queryTypes.js';

const MAX_FILTERS = 20;
const MAX_GROUP_COLUMNS = 3;
const MAX_AGGREGATES = 10;
const MAX_SORTS = 3;
const MAX_RESULT_ROWS = 1000;
const DEFAULT_LIMIT = 100;
const MAX_EXECUTION_MS = 2000;

export class AnalyticalQueryError extends Error {
  public readonly statusCode = 400;
  public readonly code:
    | 'INVALID_QUERY_PLAN'
    | 'TABLE_NOT_FOUND'
    | 'COLUMN_NOT_FOUND'
    | 'TYPE_MISMATCH'
    | 'QUERY_LIMIT_EXCEEDED'
    | 'QUERY_TIMEOUT';

  constructor(
    code:
      | 'INVALID_QUERY_PLAN'
      | 'TABLE_NOT_FOUND'
      | 'COLUMN_NOT_FOUND'
      | 'TYPE_MISMATCH'
      | 'QUERY_LIMIT_EXCEEDED'
      | 'QUERY_TIMEOUT',
    message: string
  ) {
    super(message);
    this.name = 'AnalyticalQueryError';
    this.code = code;
  }
}

type TableContext = {
  version: DatasetVersion;
  table: DatasetTable;
  columns: Map<string, { schema: DatasetColumnSchema; index: number }>;
};

function assertBudget(started: number): void {
  if (Date.now() - started > MAX_EXECUTION_MS) {
    throw new AnalyticalQueryError(
      'QUERY_TIMEOUT',
      `Analytical query exceeded the ${MAX_EXECUTION_MS}ms execution limit.`
    );
  }
}

function keyFor(value: string): string {
  return value.trim().toLowerCase();
}

function resolveTable(
  version: DatasetVersion,
  tableName: string
): DatasetTable {
  const wanted = keyFor(tableName);
  const table = version.tables.find((item) => keyFor(item.name) === wanted);
  if (!table) {
    throw new AnalyticalQueryError(
      'TABLE_NOT_FOUND',
      `Dataset table/sheet "${tableName}" was not found in version ${version.versionNumber}.`
    );
  }
  return table;
}

function buildColumnMap(
  table: DatasetTable
): Map<string, { schema: DatasetColumnSchema; index: number }> {
  const map = new Map<
    string,
    { schema: DatasetColumnSchema; index: number }
  >();

  table.columns.forEach((schema, index) => {
    map.set(keyFor(schema.name), { schema, index });
    map.set(keyFor(schema.normalizedName), { schema, index });
  });

  return map;
}

function requireColumn(
  columns: TableContext['columns'],
  name: string
): { schema: DatasetColumnSchema; index: number } {
  const column = columns.get(keyFor(name));
  if (!column) {
    throw new AnalyticalQueryError(
      'COLUMN_NOT_FOUND',
      `Column "${name}" was not found in the selected table.`
    );
  }
  return column;
}

function parseDateLike(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();

  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) {
    const parsed = Date.parse(text.length === 10 ? text + 'T00:00:00Z' : text);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const localDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (localDate) {
    const day = Number(localDate[1]);
    const month = Number(localDate[2]);
    const year = Number(localDate[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return timestamp;
    }
  }

  return null;
}

function normalizeFilterValue(
  value: DatasetCell,
  schema: DatasetColumnSchema
): string | number | boolean | null {
  if (value === null) return null;

  if (
    schema.inferredType === 'INTEGER' ||
    schema.inferredType === 'DECIMAL' ||
    schema.inferredType === 'CURRENCY'
  ) {
    const number =
      typeof value === 'number'
        ? value
        : Number(String(value).replace(/,/g, '').trim());
    if (!Number.isFinite(number)) {
      throw new AnalyticalQueryError(
        'TYPE_MISMATCH',
        `Filter value for "${schema.name}" must be numeric.`
      );
    }
    return number;
  }

  if (schema.inferredType === 'BOOLEAN') {
    if (typeof value === 'boolean') return value;
    if (/^(true|yes)$/i.test(String(value).trim())) return true;
    if (/^(false|no)$/i.test(String(value).trim())) return false;
    throw new AnalyticalQueryError(
      'TYPE_MISMATCH',
      `Filter value for "${schema.name}" must be boolean.`
    );
  }

  if (
    schema.inferredType === 'DATE' ||
    schema.inferredType === 'DATETIME'
  ) {
    const timestamp = parseDateLike(String(value));
    if (timestamp === null) {
      throw new AnalyticalQueryError(
        'TYPE_MISMATCH',
        `Filter value for "${schema.name}" must be a valid date/datetime.`
      );
    }
    return timestamp;
  }

  return String(value);
}

function comparableCell(
  value: DatasetCell,
  schema: DatasetColumnSchema
): string | number | boolean | null {
  if (value === null) return null;

  if (
    schema.inferredType === 'INTEGER' ||
    schema.inferredType === 'DECIMAL' ||
    schema.inferredType === 'CURRENCY'
  ) {
    return typeof value === 'number'
      ? value
      : Number(String(value).replace(/,/g, '').trim());
  }

  if (schema.inferredType === 'BOOLEAN') {
    if (typeof value === 'boolean') return value;
    return /^(true|yes)$/i.test(String(value).trim());
  }

  if (
    schema.inferredType === 'DATE' ||
    schema.inferredType === 'DATETIME'
  ) {
    return parseDateLike(String(value));
  }

  return String(value);
}

function comparePrimitive(
  left: string | number | boolean | null,
  right: string | number | boolean | null
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left === right ? 0 : left < right ? -1 : 1;
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return left === right ? 0 : left ? 1 : -1;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function rowMatchesFilters(
  row: DatasetCell[],
  filters: AnalyticalFilter[],
  context: TableContext
): boolean {
  return filters.every((filter) => {
    const column = requireColumn(context.columns, filter.column);
    const left = comparableCell(row[column.index] ?? null, column.schema);

    if (filter.operator === 'IN') {
      if (!Array.isArray(filter.value)) {
        throw new AnalyticalQueryError(
          'INVALID_QUERY_PLAN',
          `IN filter for "${filter.column}" requires an array value.`
        );
      }
      if (filter.value.length > 100) {
        throw new AnalyticalQueryError(
          'QUERY_LIMIT_EXCEEDED',
          'IN filters are limited to 100 values.'
        );
      }
      return filter.value.some((value) => {
        const right = normalizeFilterValue(value, column.schema);
        return comparePrimitive(left, right) === 0;
      });
    }

    if (Array.isArray(filter.value)) {
      throw new AnalyticalQueryError(
        'INVALID_QUERY_PLAN',
        `Filter "${filter.operator}" for "${filter.column}" requires a scalar value.`
      );
    }

    const right = normalizeFilterValue(filter.value, column.schema);

    if (filter.operator === 'CONTAINS') {
      if (
        !['TEXT', 'CATEGORICAL', 'IDENTIFIER'].includes(
          column.schema.inferredType
        )
      ) {
        throw new AnalyticalQueryError(
          'TYPE_MISMATCH',
          `CONTAINS is only valid for text-like columns; "${column.schema.name}" is ${column.schema.inferredType}.`
        );
      }
      if (left === null || right === null) return false;
      return String(left)
        .toLowerCase()
        .includes(String(right).toLowerCase());
    }

    const comparison = comparePrimitive(left, right);
    switch (filter.operator) {
      case 'EQ':
        return comparison === 0;
      case 'NEQ':
        return comparison !== 0;
      case 'GT':
        return left !== null && right !== null && comparison > 0;
      case 'GTE':
        return left !== null && right !== null && comparison >= 0;
      case 'LT':
        return left !== null && right !== null && comparison < 0;
      case 'LTE':
        return left !== null && right !== null && comparison <= 0;
      default:
        throw new AnalyticalQueryError(
          'INVALID_QUERY_PLAN',
          `Unsupported filter operator: ${String(filter.operator)}.`
        );
    }
  });
}

function aggregateAlias(aggregate: AnalyticalAggregate): string {
  return (
    aggregate.alias?.trim() ||
    `${aggregate.operator.toLowerCase()}_${
      aggregate.column?.trim() || 'rows'
    }`
  );
}

function numericValues(
  rows: DatasetCell[][],
  column: { schema: DatasetColumnSchema; index: number }
): number[] {
  if (
    !['INTEGER', 'DECIMAL', 'CURRENCY'].includes(column.schema.inferredType)
  ) {
    throw new AnalyticalQueryError(
      'TYPE_MISMATCH',
      `Column "${column.schema.name}" must be numeric for this aggregate; it is ${column.schema.inferredType}.`
    );
  }

  return rows
    .map((row) => row[column.index] ?? null)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function evaluateAggregate(
  rows: DatasetCell[][],
  aggregate: AnalyticalAggregate,
  context: TableContext
): number {
  if (aggregate.operator === 'COUNT' && !aggregate.column) {
    return rows.length;
  }

  if (!aggregate.column) {
    throw new AnalyticalQueryError(
      'INVALID_QUERY_PLAN',
      `${aggregate.operator} requires a column.`
    );
  }

  const column = requireColumn(context.columns, aggregate.column);

  if (aggregate.operator === 'COUNT') {
    return rows.filter((row) => (row[column.index] ?? null) !== null).length;
  }

  if (aggregate.operator === 'DISTINCT_COUNT') {
    return new Set(
      rows
        .map((row) => row[column.index] ?? null)
        .filter((value) => value !== null)
        .map((value) => JSON.stringify(value))
    ).size;
  }

  const values = numericValues(rows, column);
  if (values.length === 0) return 0;

  switch (aggregate.operator) {
    case 'SUM':
      return values.reduce((sum, value) => sum + value, 0);
    case 'AVG':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'MIN':
      return Math.min(...values);
    case 'MAX':
      return Math.max(...values);
    default:
      throw new AnalyticalQueryError(
        'INVALID_QUERY_PLAN',
        `Unsupported aggregate: ${String(aggregate.operator)}.`
      );
  }
}

function validatePlan(plan: AnalyticalQueryPlan): void {
  if (!plan || typeof plan !== 'object' || !plan.tableName?.trim()) {
    throw new AnalyticalQueryError(
      'INVALID_QUERY_PLAN',
      'A tableName is required.'
    );
  }

  if ((plan.filters?.length || 0) > MAX_FILTERS) {
    throw new AnalyticalQueryError(
      'QUERY_LIMIT_EXCEEDED',
      `A query may contain at most ${MAX_FILTERS} filters.`
    );
  }
  if ((plan.groupBy?.length || 0) > MAX_GROUP_COLUMNS) {
    throw new AnalyticalQueryError(
      'QUERY_LIMIT_EXCEEDED',
      `A query may group by at most ${MAX_GROUP_COLUMNS} columns.`
    );
  }
  if ((plan.aggregates?.length || 0) > MAX_AGGREGATES) {
    throw new AnalyticalQueryError(
      'QUERY_LIMIT_EXCEEDED',
      `A query may contain at most ${MAX_AGGREGATES} aggregates.`
    );
  }
  if ((plan.sort?.length || 0) > MAX_SORTS) {
    throw new AnalyticalQueryError(
      'QUERY_LIMIT_EXCEEDED',
      `A query may contain at most ${MAX_SORTS} sort keys.`
    );
  }

  if (
    plan.limit !== undefined &&
    (!Number.isInteger(plan.limit) ||
      plan.limit < 1 ||
      plan.limit > MAX_RESULT_ROWS)
  ) {
    throw new AnalyticalQueryError(
      'QUERY_LIMIT_EXCEEDED',
      `Result limit must be an integer between 1 and ${MAX_RESULT_ROWS}.`
    );
  }
}

function contextFor(
  accountId: string,
  datasetId: string,
  versionId: string | undefined,
  tableName: string
): TableContext {
  const version = versionId
    ? datasetStore.getVersion(accountId, datasetId, versionId)
    : datasetStore.getCurrentVersion(accountId, datasetId);

  if (!version) {
    datasetStore.requireDataset(accountId, datasetId);
    throw new AnalyticalQueryError(
      'INVALID_QUERY_PLAN',
      'Dataset version was not found.'
    );
  }

  const table = resolveTable(version, tableName);
  return {
    version,
    table,
    columns: buildColumnMap(table),
  };
}

function provenanceFor(params: {
  datasetId: string;
  context: TableContext;
  filters: AnalyticalFilter[];
  scannedRowCount: number;
  matchedRowCount: number;
  outputRowCount: number;
  groupBy: string[];
  aggregates: AnalyticalAggregate[];
  selectedColumns: string[];
  executionMs: number;
}): AnalyticalProvenance {
  return {
    datasetId: params.datasetId,
    datasetVersionId: params.context.version.id,
    datasetVersionNumber: params.context.version.versionNumber,
    sourceFilename: params.context.version.source.filename,
    sourceSha256: params.context.version.source.sha256,
    tableId: params.context.table.id,
    tableName: params.context.table.name,
    filters: params.filters,
    scannedRowCount: params.scannedRowCount,
    matchedRowCount: params.matchedRowCount,
    outputRowCount: params.outputRowCount,
    groupBy: params.groupBy,
    aggregates: params.aggregates.map((aggregate) => ({
      operator: aggregate.operator,
      column: aggregate.column,
      alias: aggregateAlias(aggregate),
    })),
    selectedColumns: params.selectedColumns,
    executionMs: params.executionMs,
  };
}

export class StructuredAnalyticsEngine {
  public execute(params: {
    accountId: string;
    datasetId: string;
    versionId?: string;
    plan: AnalyticalQueryPlan;
  }): AnalyticalQueryResult {
    const started = Date.now();
    validatePlan(params.plan);

    const context = contextFor(
      params.accountId,
      params.datasetId,
      params.versionId,
      params.plan.tableName
    );

    const filters = params.plan.filters || [];
    const groupBy = params.plan.groupBy || [];
    const aggregates = params.plan.aggregates || [];

    for (const name of groupBy) requireColumn(context.columns, name);
    for (const name of params.plan.select || []) {
      requireColumn(context.columns, name);
    }

    const matchedRows: DatasetCell[][] = [];
    for (let index = 0; index < context.table.rows.length; index++) {
      if (index % 500 === 0) assertBudget(started);
      const row = context.table.rows[index];
      if (rowMatchesFilters(row, filters, context)) matchedRows.push(row);
    }

    let outputRows: Record<string, DatasetCell>[] = [];
    const outputColumns: AnalyticalQueryResult['columns'] = [];

    if (aggregates.length > 0) {
      const groupDefinitions = groupBy.map((name) => ({
        requestedName: name,
        ...requireColumn(context.columns, name),
      }));

      for (const aggregate of aggregates) {
        if (aggregate.column) requireColumn(context.columns, aggregate.column);
      }

      const groups = new Map<
        string,
        { values: DatasetCell[]; rows: DatasetCell[][] }
      >();

      if (groupDefinitions.length === 0) {
        groups.set('__all__', { values: [], rows: matchedRows });
      } else {
        for (const row of matchedRows) {
          const values = groupDefinitions.map(
            (column) => row[column.index] ?? null
          );
          const key = JSON.stringify(values);
          const group = groups.get(key);
          if (group) group.rows.push(row);
          else groups.set(key, { values, rows: [row] });
        }
      }

      for (const group of groups.values()) {
        assertBudget(started);
        const output: Record<string, DatasetCell> = {};

        groupDefinitions.forEach((column, index) => {
          output[column.schema.name] = group.values[index] ?? null;
        });

        for (const aggregate of aggregates) {
          output[aggregateAlias(aggregate)] = evaluateAggregate(
            group.rows,
            aggregate,
            context
          );
        }

        outputRows.push(output);
      }

      for (const groupColumn of groupDefinitions) {
        outputColumns.push({
          name: groupColumn.schema.name,
          sourceType: groupColumn.schema.inferredType,
          derived: false,
        });
      }
      for (const aggregate of aggregates) {
        outputColumns.push({
          name: aggregateAlias(aggregate),
          sourceType:
            aggregate.operator === 'COUNT' ||
            aggregate.operator === 'DISTINCT_COUNT'
              ? 'INTEGER'
              : aggregate.column
                ? requireColumn(context.columns, aggregate.column).schema
                    .inferredType
                : 'INTEGER',
          derived: true,
        });
      }
    } else {
      const selected =
        params.plan.select && params.plan.select.length > 0
          ? params.plan.select.map((name) =>
              requireColumn(context.columns, name)
            )
          : context.table.columns.map((schema, index) => ({
              schema,
              index,
            }));

      outputRows = matchedRows.map((row) =>
        Object.fromEntries(
          selected.map((column) => [
            column.schema.name,
            row[column.index] ?? null,
          ])
        )
      );

      outputColumns.push(
        ...selected.map((column) => ({
          name: column.schema.name,
          sourceType: column.schema.inferredType,
          derived: false,
        }))
      );
    }

    for (const sort of [...(params.plan.sort || [])].reverse()) {
      const key = sort.key;
      const known = outputColumns.some(
        (column) => keyFor(column.name) === keyFor(key)
      );
      if (!known) {
        throw new AnalyticalQueryError(
          'COLUMN_NOT_FOUND',
          `Sort key "${key}" is not present in the query output.`
        );
      }

      const actualKey =
        outputColumns.find(
          (column) => keyFor(column.name) === keyFor(key)
        )?.name || key;

      outputRows.sort((a, b) => {
        const result = comparePrimitive(
          a[actualKey] ?? null,
          b[actualKey] ?? null
        );
        return sort.direction === 'DESC' ? -result : result;
      });
    }

    const limit = params.plan.limit || DEFAULT_LIMIT;
    outputRows = outputRows.slice(0, limit);
    const executionMs = Date.now() - started;

    return {
      columns: outputColumns,
      rows: outputRows,
      provenance: provenanceFor({
        datasetId: params.datasetId,
        context,
        filters,
        scannedRowCount: context.table.rows.length,
        matchedRowCount: matchedRows.length,
        outputRowCount: outputRows.length,
        groupBy,
        aggregates,
        selectedColumns: outputColumns
          .filter((column) => !column.derived)
          .map((column) => column.name),
        executionMs,
      }),
    };
  }

  public comparePeriods(params: {
    accountId: string;
    datasetId: string;
    versionId?: string;
    plan: PeriodComparisonPlan;
  }): PeriodComparisonResult {
    const started = Date.now();
    const context = contextFor(
      params.accountId,
      params.datasetId,
      params.versionId,
      params.plan.tableName
    );

    const dateColumn = requireColumn(
      context.columns,
      params.plan.dateColumn
    );
    if (
      !['DATE', 'DATETIME'].includes(dateColumn.schema.inferredType)
    ) {
      throw new AnalyticalQueryError(
        'TYPE_MISMATCH',
        `Period comparison requires a DATE/DATETIME column; "${dateColumn.schema.name}" is ${dateColumn.schema.inferredType}.`
      );
    }

    if (
      params.plan.metric.operator === 'MIN' ||
      params.plan.metric.operator === 'MAX' ||
      params.plan.metric.operator === 'DISTINCT_COUNT'
    ) {
      // These operations are deterministic, but change percentages on extrema
      // or cardinality are easy to misread as business-performance deltas.
      throw new AnalyticalQueryError(
        'INVALID_QUERY_PLAN',
        'Period comparison metric must be COUNT, SUM, or AVG.'
      );
    }

    const firstStart = parseDateLike(params.plan.firstPeriod.start);
    const firstEnd = parseDateLike(params.plan.firstPeriod.end);
    const secondStart = parseDateLike(params.plan.secondPeriod.start);
    const secondEnd = parseDateLike(params.plan.secondPeriod.end);

    if (
      firstStart === null ||
      firstEnd === null ||
      secondStart === null ||
      secondEnd === null ||
      firstStart > firstEnd ||
      secondStart > secondEnd
    ) {
      throw new AnalyticalQueryError(
        'INVALID_QUERY_PLAN',
        'Period ranges must contain valid start/end dates with start <= end.'
      );
    }

    const baseFilters = params.plan.filters || [];
    if (baseFilters.length > MAX_FILTERS) {
      throw new AnalyticalQueryError(
        'QUERY_LIMIT_EXCEEDED',
        `A comparison may contain at most ${MAX_FILTERS} base filters.`
      );
    }

    const firstRows: DatasetCell[][] = [];
    const secondRows: DatasetCell[][] = [];

    for (let index = 0; index < context.table.rows.length; index++) {
      if (index % 500 === 0) assertBudget(started);
      const row = context.table.rows[index];
      if (!rowMatchesFilters(row, baseFilters, context)) continue;

      const timestamp = comparableCell(
        row[dateColumn.index] ?? null,
        dateColumn.schema
      );
      if (typeof timestamp !== 'number') continue;

      if (timestamp >= firstStart && timestamp <= firstEnd) {
        firstRows.push(row);
      }
      if (timestamp >= secondStart && timestamp <= secondEnd) {
        secondRows.push(row);
      }
    }

    const firstValue = evaluateAggregate(
      firstRows,
      params.plan.metric,
      context
    );
    const secondValue = evaluateAggregate(
      secondRows,
      params.plan.metric,
      context
    );
    const absoluteChange = secondValue - firstValue;
    const percentChange =
      firstValue === 0 ? null : (absoluteChange / firstValue) * 100;
    const alias = aggregateAlias(params.plan.metric);
    const executionMs = Date.now() - started;

    return {
      firstPeriod: {
        range: params.plan.firstPeriod,
        value: firstValue,
        matchedRowCount: firstRows.length,
      },
      secondPeriod: {
        range: params.plan.secondPeriod,
        value: secondValue,
        matchedRowCount: secondRows.length,
      },
      absoluteChange,
      percentChange,
      metricAlias: alias,
      provenance: {
        ...provenanceFor({
          datasetId: params.datasetId,
          context,
          filters: baseFilters,
          scannedRowCount: context.table.rows.length,
          matchedRowCount: 0,
          outputRowCount: 2,
          groupBy: [],
          aggregates: [params.plan.metric],
          selectedColumns: [dateColumn.schema.name],
          executionMs,
        }),
        firstPeriodMatchedRowCount: firstRows.length,
        secondPeriodMatchedRowCount: secondRows.length,
        outputRowCount: 2,
        matchedRowCount: undefined as never,
      },
    };
  }
}

export const structuredAnalyticsEngine = new StructuredAnalyticsEngine();
