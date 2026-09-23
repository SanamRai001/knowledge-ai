import crypto from 'crypto';
import path from 'path';
import { parseCsvBuffer } from './csvParser.js';
import {
  applySchemaOverrides,
  inferDatasetSchema,
} from './schemaInference.js';
import { datasetStore } from './datasetStore.js';
import {
  DatasetColumnType,
  DatasetImportRun,
  DatasetPreview,
  DatasetSource,
  DatasetTable,
  ParsedDatasetTable,
} from './types.js';
import { parseXlsxBuffer } from './xlsxParser.js';
import { datasetRuntimePersistence } from './datasetRuntimePersistence.js';
import { datasetSourceStorageService } from './datasetSourceStorageService.js';
import type { SourceObjectOrigin } from '../storage/sourceObjectTypes.js';
import { postgresAccountRepository } from '../persistence/postgresRepositories.js';

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
  mimeType: string,
  format: 'CSV' | 'XLSX'
): DatasetSource {
  return {
    filename,
    mimeType,
    sizeBytes: buffer.byteLength,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    format,
  };
}

function tableFromParsed(
  parsed: ParsedDatasetTable,
  overrides?: Record<string, DatasetColumnType>
): DatasetTable {
  const inferredColumns = inferDatasetSchema(parsed.headers, parsed.rows);
  const corrected = applySchemaOverrides(
    parsed.rows,
    inferredColumns,
    overrides
  );

  return {
    id: 'dst_' + crypto.randomBytes(8).toString('hex'),
    name: parsed.name,
    columns: corrected.columns,
    rows: corrected.rows,
    rowCount: corrected.rows.length,
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
    schemaOverrides?: Record<string, DatasetColumnType>;
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
      const table = tableFromParsed(parsed, params.schemaOverrides);
      const source = sourceFor(
        params.buffer,
        params.filename,
        params.mimeType || 'text/csv',
        'CSV'
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
    schemaOverrides?: Record<string, DatasetColumnType>;
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
      const table = tableFromParsed(parsed, params.schemaOverrides);
      const source = sourceFor(
        params.buffer,
        params.filename,
        params.mimeType || 'text/csv',
        'CSV'
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

  public async previewXlsx(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    schemaOverrides?: Record<string, Record<string, DatasetColumnType>>;
  }): Promise<DatasetPreview> {
    if (!params.filename.toLowerCase().endsWith('.xlsx')) {
      throw new DatasetImportError(
        'UNSUPPORTED_FORMAT',
        'Expected an .xlsx workbook.'
      );
    }

    const importRun: DatasetImportRun = {
      id: 'imp_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      status: 'PREVIEWED',
      createdAt: Date.now(),
      completedAt: Date.now(),
      filename: params.filename,
      format: 'XLSX',
      warnings: [],
    };

    try {
      const parsedTables = await parseXlsxBuffer(params.buffer);
      const tables = parsedTables.map((parsed) =>
        tableFromParsed(
          parsed,
          params.schemaOverrides?.[parsed.name]
        )
      );
      const source = sourceFor(
        params.buffer,
        params.filename,
        params.mimeType ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'XLSX'
      );

      for (const table of tables) {
        if (table.duplicateRowCount > 0) {
          importRun.warnings.push(
            `Sheet "${table.name}" contains ${table.duplicateRowCount} duplicate row(s).`
          );
        }
        for (const column of table.columns) {
          if (column.nullable) {
            importRun.warnings.push(
              `Sheet "${table.name}", column "${column.name}" contains ${column.missingCount} missing value(s).`
            );
          }
        }
      }

      datasetStore.recordImportRun(importRun);

      return {
        importRun,
        source,
        tables: tables.map((table) => ({
          name: table.name,
          rowCount: table.rowCount,
          duplicateRowCount: table.duplicateRowCount,
          columns: table.columns,
          previewRows: table.rows.slice(0, PREVIEW_ROWS),
        })),
      };
    } catch (error: any) {
      importRun.status = 'FAILED';
      importRun.error = error?.message || 'XLSX preview failed.';
      importRun.completedAt = Date.now();
      datasetStore.recordImportRun(importRun);
      throw error;
    }
  }

  public async importXlsx(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    datasetName?: string;
    description?: string;
    existingDatasetId?: string;
    schemaOverrides?: Record<string, Record<string, DatasetColumnType>>;
  }) {
    if (!params.filename.toLowerCase().endsWith('.xlsx')) {
      throw new DatasetImportError(
        'UNSUPPORTED_FORMAT',
        'Expected an .xlsx workbook.'
      );
    }

    const importRun: DatasetImportRun = {
      id: 'imp_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      status: 'IMPORTED',
      createdAt: Date.now(),
      completedAt: Date.now(),
      filename: params.filename,
      format: 'XLSX',
      warnings: [],
    };

    try {
      const parsedTables = await parseXlsxBuffer(params.buffer);
      const tables = parsedTables.map((parsed) =>
        tableFromParsed(
          parsed,
          params.schemaOverrides?.[parsed.name]
        )
      );
      const source = sourceFor(
        params.buffer,
        params.filename,
        params.mimeType ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'XLSX'
      );

      for (const table of tables) {
        if (table.duplicateRowCount > 0) {
          importRun.warnings.push(
            `Sheet "${table.name}" contains ${table.duplicateRowCount} duplicate row(s) that were preserved.`
          );
        }
      }

      const result = params.existingDatasetId
        ? datasetStore.addVersion({
            accountId: params.accountId,
            datasetId: params.existingDatasetId,
            source,
            tables,
            importRunId: importRun.id,
          })
        : datasetStore.createDataset({
            accountId: params.accountId,
            name:
              params.datasetName?.trim() ||
              datasetNameFromFilename(params.filename),
            description: params.description,
            source,
            tables,
            importRunId: importRun.id,
          });

      datasetStore.recordImportRun(importRun);

      return {
        ...result,
        importRun,
      };
    } catch (error: any) {
      importRun.status = 'FAILED';
      importRun.error = error?.message || 'XLSX import failed.';
      importRun.completedAt = Date.now();
      datasetStore.recordImportRun(importRun);
      throw error;
    }
  }

  private async previewFilePostgres(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    schemaOverrides?: Record<
      string,
      Record<string, DatasetColumnType>
    >;
  }): Promise<DatasetPreview> {
    const lower = params.filename.toLowerCase();
    const format: 'CSV' | 'XLSX' = lower.endsWith('.csv')
      ? 'CSV'
      : lower.endsWith('.xlsx')
        ? 'XLSX'
        : (() => {
            throw new DatasetImportError(
              'UNSUPPORTED_FORMAT',
              'Supported structured-data formats are .csv and .xlsx.'
            );
          })();

    const importRun: DatasetImportRun = {
      id: 'imp_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      status: 'PREVIEWED',
      createdAt: Date.now(),
      completedAt: Date.now(),
      filename: params.filename,
      format,
      warnings: [],
    };

    try {
      const parsedTables =
        format === 'CSV'
          ? [
              parseCsvBuffer(
                params.buffer,
                datasetNameFromFilename(params.filename)
              ),
            ]
          : await parseXlsxBuffer(params.buffer);

      const tables = parsedTables.map((parsed) =>
        tableFromParsed(
          parsed,
          params.schemaOverrides?.[parsed.name]
        )
      );
      const source = sourceFor(
        params.buffer,
        params.filename,
        params.mimeType ||
          (format === 'CSV'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        format
      );

      for (const table of tables) {
        if (table.duplicateRowCount > 0) {
          importRun.warnings.push(
            (format === 'XLSX' ? 'Sheet "' + table.name + '" contains ' : '') +
              String(table.duplicateRowCount) +
              ' duplicate row(s).'
          );
        }
        for (const column of table.columns) {
          if (column.nullable) {
            importRun.warnings.push(
              (format === 'XLSX'
                ? 'Sheet "' + table.name + '", '
                : '') +
                'column "' +
                column.name +
                '" contains ' +
                String(column.missingCount) +
                ' missing value(s).'
            );
          }
        }
      }

      await datasetRuntimePersistence.recordImportRun(
        importRun
      );

      return {
        importRun,
        source,
        tables: tables.map((table) => ({
          name: table.name,
          rowCount: table.rowCount,
          duplicateRowCount: table.duplicateRowCount,
          columns: table.columns,
          previewRows: table.rows.slice(0, PREVIEW_ROWS),
        })),
      };
    } catch (error: any) {
      importRun.status = 'FAILED';
      importRun.error =
        error?.message || 'Dataset preview failed.';
      importRun.completedAt = Date.now();
      await datasetRuntimePersistence
        .recordImportRun(importRun)
        .catch(() => undefined);
      throw error;
    }
  }

  private async importFilePostgres(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    datasetName?: string;
    description?: string;
    existingDatasetId?: string;
    sourceOrigin?: SourceObjectOrigin;
    externalConnectionId?: string;
    externalId?: string;
    externalVersion?: string;
    schemaOverrides?: Record<
      string,
      Record<string, DatasetColumnType>
    >;
  }) {
    const lower = params.filename.toLowerCase();
    const format: 'CSV' | 'XLSX' = lower.endsWith('.csv')
      ? 'CSV'
      : lower.endsWith('.xlsx')
        ? 'XLSX'
        : (() => {
            throw new DatasetImportError(
              'UNSUPPORTED_FORMAT',
              'Supported structured-data formats are .csv and .xlsx.'
            );
          })();
    const contentType =
      params.mimeType ||
      (format === 'CSV'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const importRun: DatasetImportRun = {
      id:
        'imp_' +
        crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      status: 'IMPORTED',
      createdAt: Date.now(),
      completedAt: Date.now(),
      filename: params.filename,
      format,
      warnings: [],
    };

    let storedSource:
      | Awaited<
          ReturnType<
            typeof datasetSourceStorageService.persistUploadedSource
          >
        >
      | null = null;

    try {
      await postgresAccountRepository
        .ensureAccount(
          params.accountId
        );

      storedSource =
        await datasetSourceStorageService
          .persistUploadedSource({
            accountId: params.accountId,
            filename: params.filename,
            contentType,
            bytes: params.buffer,
            origin:
              params.sourceOrigin,
            externalConnectionId:
              params.externalConnectionId,
            externalId:
              params.externalId,
            externalVersion:
              params.externalVersion,
          });

      const parsedTables =
        format === 'CSV'
          ? [
              parseCsvBuffer(
                params.buffer,
                datasetNameFromFilename(
                  params.filename
                )
              ),
            ]
          : await parseXlsxBuffer(
              params.buffer
            );

      const tables = parsedTables.map(
        (parsed) =>
          tableFromParsed(
            parsed,
            params.schemaOverrides?.[
              parsed.name
            ]
          )
      );
      const source = sourceFor(
        params.buffer,
        params.filename,
        contentType,
        format
      );

      if (
        source.sha256 !==
          storedSource.sourceVersion
            .sha256 ||
        source.sizeBytes !==
          storedSource.sourceVersion
            .sizeBytes
      ) {
        throw new Error(
          'Dataset source integrity metadata does not match the durable source version.'
        );
      }

      for (const table of tables) {
        if (
          table.duplicateRowCount > 0
        ) {
          importRun.warnings.push(
            (format === 'XLSX'
              ? 'Sheet "' +
                table.name +
                '" contains '
              : '') +
              String(
                table.duplicateRowCount
              ) +
              ' duplicate row(s) that were preserved.'
          );
        }
      }

      return await datasetRuntimePersistence
        .commitImportedDataset({
          accountId: params.accountId,
          name:
            params.datasetName?.trim() ||
            datasetNameFromFilename(
              params.filename
            ),
          description:
            params.description,
          source,
          sourceVersionId:
            storedSource.sourceVersion.id,
          tables,
          importRun,
          existingDatasetId:
            params.existingDatasetId,
        });
    } catch (error: any) {
      if (
        storedSource?.createdSourceVersion
      ) {
        await datasetSourceStorageService
          .compensate({
            accountId:
              params.accountId,
            sourceObjectId:
              storedSource.sourceObject.id,
            sourceVersionId:
              storedSource.sourceVersion.id,
            storageKey:
              storedSource.sourceVersion
                .storageKey,
            tombstoneSourceObject:
              storedSource
                .createdSourceObject,
          })
          .catch(() => undefined);
      }

      importRun.status = 'FAILED';
      importRun.error =
        error?.message ||
        'Dataset import failed.';
      importRun.completedAt = Date.now();
      await datasetRuntimePersistence
        .recordImportRun(importRun)
        .catch(() => undefined);
      throw error;
    }
  }

  public async previewFile(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    schemaOverrides?: Record<string, Record<string, DatasetColumnType>>;
  }): Promise<DatasetPreview> {
    if (datasetRuntimePersistence.usesPostgres()) {
      return this.previewFilePostgres(params);
    }

    const lower = params.filename.toLowerCase();
    if (lower.endsWith('.csv')) {
      const csvTableName = datasetNameFromFilename(params.filename);
      return this.previewCsv({
        accountId: params.accountId,
        buffer: params.buffer,
        filename: params.filename,
        mimeType: params.mimeType,
        schemaOverrides: params.schemaOverrides?.[csvTableName],
      });
    }
    if (lower.endsWith('.xlsx')) {
      return this.previewXlsx(params);
    }
    throw new DatasetImportError(
      'UNSUPPORTED_FORMAT',
      'Supported structured-data formats are .csv and .xlsx.'
    );
  }

  public async importFile(params: {
    accountId: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    datasetName?: string;
    description?: string;
    existingDatasetId?: string;
    sourceOrigin?: SourceObjectOrigin;
    externalConnectionId?: string;
    externalId?: string;
    externalVersion?: string;
    schemaOverrides?: Record<string, Record<string, DatasetColumnType>>;
  }) {
    if (datasetRuntimePersistence.usesPostgres()) {
      return this.importFilePostgres(params);
    }

    const lower = params.filename.toLowerCase();
    if (lower.endsWith('.csv')) {
      const csvTableName = datasetNameFromFilename(params.filename);
      return this.importCsv({
        accountId: params.accountId,
        buffer: params.buffer,
        filename: params.filename,
        mimeType: params.mimeType,
        datasetName: params.datasetName,
        description: params.description,
        existingDatasetId: params.existingDatasetId,
        schemaOverrides: params.schemaOverrides?.[csvTableName],
      });
    }
    if (lower.endsWith('.xlsx')) {
      return this.importXlsx(params);
    }
    throw new DatasetImportError(
      'UNSUPPORTED_FORMAT',
      'Supported structured-data formats are .csv and .xlsx.'
    );
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
