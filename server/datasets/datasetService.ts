import crypto from 'crypto';
import path from 'path';
import { parseCsvBuffer } from './csvParser.js';
import {
  coerceRowsToSchema,
  inferDatasetSchema,
} from './schemaInference.js';
import { datasetStore } from './datasetStore.js';
import {
  DatasetImportRun,
  DatasetPreview,
  DatasetSource,
  DatasetTable,
  ParsedDatasetTable,
} from './types.js';

const PREVIEW_ROWS = 20;

export class DatasetImportError extends Error {
  public readonly code:
    | 'UNSUPPORTED_FORMAT'
    | 'INVALID_FILENAME'
    | 'IMPORT_FAILED';

  constructor(
    code: 'UNSUPPORTED_FORMAT' | 'INVALID_FILENAME' | 'IMPORT_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'DatasetImportError';
    this.code = code;
  }
}

function sourceFor(
  buffer: Buffer,
  filename: string,
  mimeType: string
): DatasetSource {
  return {
    filename,
    mimeType,
    sizeBytes: buffer.byteLength,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    format: 'CSV',
  };
}

function tableFromParsed(parsed: ParsedDatasetTable): DatasetTable {
  const columns = inferDatasetSchema(parsed.headers, parsed.rows);
  const rows = coerceRowsToSchema(parsed.rows, columns);

  return {
    id: 'dst_' + crypto.randomBytes(8).toString('hex'),
    name: parsed.name,
    columns,
    rows,
    rowCount: rows.length,
    duplicateRowCount: parsed.duplicateRowCount,
  };
}

function datasetNameFromFilename(filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext).trim();
  return base || 'Imported Dataset';
}

function assertCsvFilename(filename: string): void {
  if (!filename || filename.includes('\0')) {
    throw new DatasetImportError('INVALID_FILENAME', 'Invalid dataset filename.');
  }
  if (!filename.toLowerCase().endsWith('.csv')) {
    throw new DatasetImportError(
      'UNSUPPORTED_FORMAT',
      'Phase 1A currently supports CSV imports. XLSX support is scheduled for Phase 1B.'
    );
  }
}

export class DatasetService {
  public previewCsv(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
  }): DatasetPreview {
    assertCsvFilename(params.filename);

    const importRun: DatasetImportRun = {
      id: 'imp_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      status: 'PREVIEWED',
      createdAt: Date.now(),
      completedAt: Date.now(),
      filename: params.filename,
      format: 'CSV',
      warnings: [],
    };

    try {
      const parsed = parseCsvBuffer(
        params.buffer,
        datasetNameFromFilename(params.filename)
      );
      const table = tableFromParsed(parsed);
      const source = sourceFor(
        params.buffer,
        params.filename,
        params.mimeType || 'text/csv'
      );

      if (table.duplicateRowCount > 0) {
        importRun.warnings.push(
          `${table.duplicateRowCount} duplicate row(s) detected. They are preserved in the preview and import.`
        );
      }
      for (const column of table.columns) {
        if (column.nullable) {
          importRun.warnings.push(
            `Column "${column.name}" contains ${column.missingCount} missing value(s).`
          );
        }
      }

      datasetStore.recordImportRun(importRun);

      return {
        importRun,
        source,
        tables: [
          {
            name: table.name,
            rowCount: table.rowCount,
            duplicateRowCount: table.duplicateRowCount,
            columns: table.columns,
            previewRows: table.rows.slice(0, PREVIEW_ROWS),
          },
        ],
      };
    } catch (error: any) {
      importRun.status = 'FAILED';
      importRun.error = error?.message || 'CSV preview failed.';
      importRun.completedAt = Date.now();
      datasetStore.recordImportRun(importRun);
      throw error;
    }
  }

  public importCsv(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    datasetName?: string;
    description?: string;
    existingDatasetId?: string;
  }) {
    assertCsvFilename(params.filename);

    const importRun: DatasetImportRun = {
      id: 'imp_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      status: 'IMPORTED',
      createdAt: Date.now(),
      completedAt: Date.now(),
      filename: params.filename,
      format: 'CSV',
      warnings: [],
    };

    try {
      const parsed = parseCsvBuffer(
        params.buffer,
        datasetNameFromFilename(params.filename)
      );
      const table = tableFromParsed(parsed);
      const source = sourceFor(
        params.buffer,
        params.filename,
        params.mimeType || 'text/csv'
      );

      if (table.duplicateRowCount > 0) {
        importRun.warnings.push(
          `${table.duplicateRowCount} duplicate row(s) were preserved.`
        );
      }

      const result = params.existingDatasetId
        ? datasetStore.addVersion({
            accountId: params.accountId,
            datasetId: params.existingDatasetId,
            source,
            tables: [table],
            importRunId: importRun.id,
          })
        : datasetStore.createDataset({
            accountId: params.accountId,
            name:
              params.datasetName?.trim() ||
              datasetNameFromFilename(params.filename),
            description: params.description,
            source,
            tables: [table],
            importRunId: importRun.id,
          });

      datasetStore.recordImportRun(importRun);

      return {
        ...result,
        importRun,
      };
    } catch (error: any) {
      importRun.status = 'FAILED';
      importRun.error = error?.message || 'CSV import failed.';
      importRun.completedAt = Date.now();
      datasetStore.recordImportRun(importRun);
      throw error;
    }
  }

  public listDatasets(accountId: string) {
    return datasetStore.listDatasets(accountId);
  }

  public getDataset(accountId: string, datasetId: string) {
    const dataset = datasetStore.requireDataset(accountId, datasetId);
    const currentVersion = datasetStore.getCurrentVersion(
      accountId,
      datasetId
    );
    return { dataset, currentVersion };
  }

  public getDatasetVersion(
    accountId: string,
    datasetId: string,
    versionId: string
  ) {
    const version = datasetStore.getVersion(
      accountId,
      datasetId,
      versionId
    );
    if (!version) {
      datasetStore.requireDataset(accountId, datasetId);
      throw new Error('Dataset version not found.');
    }
    return version;
  }
}

export const datasetService = new DatasetService();
