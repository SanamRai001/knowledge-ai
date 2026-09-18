import {
  DatasetCell,
  DatasetColumnType,
} from './types.js';

export type FilterOperator =
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'CONTAINS'
  | 'IN';

export interface AnalyticalFilter {
  column: string;
  operator: FilterOperator;
  value: DatasetCell | DatasetCell[];
}

export type AggregateOperator =
  | 'COUNT'
  | 'SUM'
  | 'AVG'
  | 'MIN'
  | 'MAX'
  | 'DISTINCT_COUNT';

export interface AnalyticalAggregate {
  operator: AggregateOperator;
  column?: string;
  alias?: string;
}

export interface AnalyticalSort {
  key: string;
  direction: 'ASC' | 'DESC';
}

export interface AnalyticalQueryPlan {
  tableName: string;
  filters?: AnalyticalFilter[];
  select?: string[];
  groupBy?: string[];
  aggregates?: AnalyticalAggregate[];
  sort?: AnalyticalSort[];
  limit?: number;
}

export interface PeriodRange {
  label: string;
  start: string;
  end: string;
}

export interface PeriodComparisonPlan {
  tableName: string;
  dateColumn: string;
  metric: AnalyticalAggregate;
  filters?: AnalyticalFilter[];
  firstPeriod: PeriodRange;
  secondPeriod: PeriodRange;
}

export interface AnalyticalProvenance {
  datasetId: string;
  datasetVersionId: string;
  datasetVersionNumber: number;
  sourceFilename: string;
  sourceSha256: string;
  tableId: string;
  tableName: string;
  filters: AnalyticalFilter[];
  scannedRowCount: number;
  matchedRowCount: number;
  outputRowCount: number;
  groupBy: string[];
  aggregates: Array<{
    operator: AggregateOperator;
    column?: string;
    alias: string;
  }>;
  selectedColumns: string[];
  executionMs: number;
}

export interface AnalyticalQueryResult {
  columns: Array<{
    name: string;
    sourceType?: DatasetColumnType;
    derived: boolean;
  }>;
  rows: Record<string, DatasetCell>[];
  provenance: AnalyticalProvenance;
}

export interface PeriodComparisonResult {
  firstPeriod: {
    range: PeriodRange;
    value: number;
    matchedRowCount: number;
  };
  secondPeriod: {
    range: PeriodRange;
    value: number;
    matchedRowCount: number;
  };
  absoluteChange: number;
  percentChange: number | null;
  metricAlias: string;
  provenance: Omit<
    AnalyticalProvenance,
    'matchedRowCount' | 'outputRowCount'
  > & {
    firstPeriodMatchedRowCount: number;
    secondPeriodMatchedRowCount: number;
    outputRowCount: 2;
  };
}
