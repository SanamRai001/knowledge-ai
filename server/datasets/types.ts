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
  sourceVersionId?: string;
  tables: DatasetTable[];
  importRunId: string;
}

export interface Dataset {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  currentVersionId: string;
  versionIds: string[];
}

export interface DatasetImportRun {
  id: string;
  accountId: string;
  status: 'PREVIEWED' | 'IMPORTED' | 'FAILED';
  createdAt: number;
  completedAt?: number;
  filename: string;
  format: 'CSV' | 'XLSX';
  warnings: string[];
  error?: string;
}

export interface ParsedDatasetTable {
  name: string;
  headers: string[];
  rows: DatasetCell[][];
  duplicateRowCount: number;
}

export interface DatasetPreviewTable {
  name: string;
  rowCount: number;
  duplicateRowCount: number;
  columns: DatasetColumnSchema[];
  previewRows: DatasetCell[][];
}

export interface DatasetPreview {
  importRun: DatasetImportRun;
  source: DatasetSource;
  tables: DatasetPreviewTable[];
}
