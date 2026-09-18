export type DatasetColumnType =
  | 'TEXT'
  | 'INTEGER'
  | 'DECIMAL'
  | 'CURRENCY'
  | 'DATE'
  | 'DATETIME'
  | 'BOOLEAN'
  | 'CATEGORICAL'
  | 'IDENTIFIER';

export type DatasetCell = string | number | boolean | null;

export interface DatasetSource {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  format: 'CSV' | 'XLSX';
}

export interface DatasetColumnSchema {
  name: string;
  normalizedName: string;
  inferredType: DatasetColumnType;
  typeSource: 'INFERRED' | 'USER_OVERRIDE';
  nullable: boolean;
  missingCount: number;
  distinctCount: number;
  uniqueRatio: number;
  confidence: number;
  sampleValues: DatasetCell[];
}

export interface DatasetPreviewTable {
  name: string;
  rowCount: number;
  duplicateRowCount: number;
  columns: DatasetColumnSchema[];
  previewRows: DatasetCell[][];
}

export interface DatasetPreview {
  importRun: {
    id: string;
    status: 'PREVIEWED' | 'IMPORTED' | 'FAILED';
    warnings: string[];
  };
  source: DatasetSource;
  tables: DatasetPreviewTable[];
}

export interface DatasetSummary {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  currentVersionId: string;
  versionIds: string[];
}

export interface DatasetTable {
  id: string;
  name: string;
  columns: DatasetColumnSchema[];
  rows: DatasetCell[][];
  rowCount: number;
  duplicateRowCount: number;
}

export interface DatasetVersion {
  id: string;
  datasetId: string;
  versionNumber: number;
  createdAt: number;
  source: DatasetSource;
  tables: DatasetTable[];
  importRunId: string;
}

export interface DatasetDetail {
  dataset: DatasetSummary;
  currentVersion: DatasetVersion;
}

export interface AnalyticalProvenance {
  datasetId: string;
  datasetVersionId: string;
  datasetVersionNumber: number;
  sourceFilename: string;
  sourceSha256: string;
  tableId: string;
  tableName: string;
  scannedRowCount: number;
  matchedRowCount?: number;
  outputRowCount: number;
  executionMs: number;
  filters: unknown[];
  groupBy: string[];
  aggregates: Array<{
    operator: string;
    column?: string;
    alias: string;
  }>;
  selectedColumns: string[];
  firstPeriodMatchedRowCount?: number;
  secondPeriodMatchedRowCount?: number;
  companyStateOverlay?: {
    applied: boolean;
    applicationCount: number;
    claimIds: string[];
    authorityLevels: string[];
  };
}

export interface UnifiedAnalyticsResponse {
  route: 'DATASET_ANALYTICS';
  question: string;
  planSource: 'DETERMINISTIC' | 'LLM' | 'NONE';
  answer: string;
  explanation?: string;
  result: {
    rows?: Record<string, DatasetCell>[];
    columns?: Array<{
      name: string;
      sourceType?: DatasetColumnType;
      derived: boolean;
    }>;
    firstPeriod?: {
      range: { label: string; start: string; end: string };
      value: number;
      matchedRowCount: number;
    };
    secondPeriod?: {
      range: { label: string; start: string; end: string };
      value: number;
      matchedRowCount: number;
    };
    absoluteChange?: number;
    percentChange?: number | null;
    metricAlias?: string;
    provenance: AnalyticalProvenance;
  };
}

export interface UnifiedDocumentResponse {
  route: 'DOCUMENT_KNOWLEDGE';
  question: string;
  answer: string;
  grounded: boolean;
  refused: boolean;
  engineUsed: string;
  sources: Array<{
    document_id?: string;
    document_name: string;
    page?: number;
    section?: string;
    excerpt?: string;
  }>;
  knowledgeBaseId: string;
}

export type UnifiedQueryResponse =
  | UnifiedAnalyticsResponse
  | UnifiedDocumentResponse;


export interface DatasetVersionSummary {
  id: string;
  datasetId: string;
  versionNumber: number;
  createdAt: number;
  source: DatasetSource;
  importRunId: string;
  tables: Array<{
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
  }>;
}
