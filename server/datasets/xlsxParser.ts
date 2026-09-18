import ExcelJS from '@ayocore/exceljs';
import { DatasetCell, ParsedDatasetTable } from './types.js';

export const XLSX_LIMITS = {
  maxFileBytes: 15 * 1024 * 1024,
  maxSheets: 20,
  maxRowsPerSheet: 50_000,
  maxTotalRows: 100_000,
  maxColumns: 100,
  maxCellCharacters: 10_000,
} as const;

export class XlsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxParseError';
  }
}

function isBlank(value: DatasetCell): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function cellTextLength(value: DatasetCell): number {
  return typeof value === 'string' ? value.length : String(value ?? '').length;
}

function scalarFromValue(value: any): DatasetCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;

  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }

  if (typeof value === 'object') {
    // Formula cells are never evaluated here. Only a workbook's cached result
    // is imported when it is already present as a scalar value.
    if ('result' in value) {
      return scalarFromValue(value.result);
    }

    if (Array.isArray(value.richText)) {
      const text = value.richText
        .map((part: any) => String(part?.text ?? ''))
        .join('')
        .trim();
      return text || null;
    }

    if (typeof value.text === 'string') {
      return value.text.trim() || null;
    }

    if (typeof value.hyperlink === 'string') {
      return String(value.text || value.hyperlink).trim() || null;
    }

    if (typeof value.error === 'string') {
      return null;
    }
  }

  const fallback = String(value).trim();
  return fallback && fallback !== '[object Object]' ? fallback : null;
}

function looksTyped(value: DatasetCell): boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (
    /^[-+]?\d+(?:\.\d+)?$/.test(text.replace(/,/g, '')) ||
    /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) ||
    /^(true|false|yes|no)$/i.test(text)
  );
}

function isLikelyHeader(
  first: DatasetCell[],
  second?: DatasetCell[]
): boolean {
  const cleaned = first.map((value) => String(value ?? '').trim());
  const nonEmpty = cleaned.filter(Boolean);
  if (nonEmpty.length === 0) return false;

  const unique = new Set(cleaned.map((value) => value.toLowerCase()));
  if (unique.size !== cleaned.length) return false;

  const labelCount = cleaned.filter(
    (value) => value !== '' && /[A-Za-z_]/.test(value) && !looksTyped(value)
  ).length;

  if (labelCount / cleaned.length >= 0.7) return true;
  if (!second) return false;

  const secondTyped = second.filter(looksTyped).length;
  return secondTyped > labelCount;
}

function normalizeHeaders(
  values: DatasetCell[],
  width: number
): string[] {
  const seen = new Map<string, number>();

  return Array.from({ length: width }, (_, index) => {
    const raw = String(values[index] ?? '').trim() || `Column ${index + 1}`;
    const key = raw.toLowerCase();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count === 0 ? raw : `${raw} (${count + 1})`;
  });
}

function normalizeRows(
  rows: DatasetCell[][],
  width: number
): DatasetCell[][] {
  return rows.map((row) =>
    Array.from({ length: width }, (_, index) => {
      const value = row[index] ?? null;
      return isBlank(value) ? null : value;
    })
  );
}

function countDuplicateRows(rows: DatasetCell[][]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

function worksheetToTable(worksheet: any): ParsedDatasetTable | null {
  if (worksheet.actualRowCount > XLSX_LIMITS.maxRowsPerSheet) {
    throw new XlsxParseError(
      `Worksheet "${worksheet.name}" exceeds the ${XLSX_LIMITS.maxRowsPerSheet}-row safety limit.`
    );
  }
  if (worksheet.actualColumnCount > XLSX_LIMITS.maxColumns) {
    throw new XlsxParseError(
      `Worksheet "${worksheet.name}" exceeds the ${XLSX_LIMITS.maxColumns}-column safety limit.`
    );
  }

  const rawRows: DatasetCell[][] = [];

  worksheet.eachRow({ includeEmpty: false }, (row: any) => {
    const values: DatasetCell[] = [];
    row.eachCell({ includeEmpty: true }, (cell: any, columnNumber: number) => {
      const value = scalarFromValue(cell.value);
      if (cellTextLength(value) > XLSX_LIMITS.maxCellCharacters) {
        throw new XlsxParseError(
          `Worksheet "${worksheet.name}" contains a cell exceeding ${XLSX_LIMITS.maxCellCharacters} characters.`
        );
      }
      values[columnNumber - 1] = value;
    });

    while (values.length > 0 && isBlank(values[values.length - 1])) {
      values.pop();
    }

    if (values.some((value) => !isBlank(value))) {
      rawRows.push(values);
    }
  });

  if (rawRows.length === 0) return null;

  const width = Math.max(...rawRows.map((row) => row.length));
  if (width > XLSX_LIMITS.maxColumns) {
    throw new XlsxParseError(
      `Worksheet "${worksheet.name}" exceeds the ${XLSX_LIMITS.maxColumns}-column safety limit.`
    );
  }

  const hasHeader = isLikelyHeader(rawRows[0], rawRows[1]);
  const headers = normalizeHeaders(
    hasHeader
      ? rawRows[0]
      : Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
    width
  );
  const rows = normalizeRows(hasHeader ? rawRows.slice(1) : rawRows, width);

  return {
    name: worksheet.name || 'Sheet',
    headers,
    rows,
    duplicateRowCount: countDuplicateRows(rows),
  };
}

export async function parseXlsxBuffer(
  buffer: Buffer
): Promise<ParsedDatasetTable[]> {
  if (buffer.byteLength === 0) {
    throw new XlsxParseError('XLSX file is empty.');
  }
  if (buffer.byteLength > XLSX_LIMITS.maxFileBytes) {
    throw new XlsxParseError(
      `XLSX exceeds the ${Math.round(XLSX_LIMITS.maxFileBytes / 1024 / 1024)} MB safety limit.`
    );
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as any);
  } catch (error: any) {
    throw new XlsxParseError(
      `Could not parse XLSX workbook: ${error?.message || 'invalid workbook'}`
    );
  }

  if (workbook.worksheets.length > XLSX_LIMITS.maxSheets) {
    throw new XlsxParseError(
      `Workbook exceeds the ${XLSX_LIMITS.maxSheets}-sheet safety limit.`
    );
  }

  const tables: ParsedDatasetTable[] = [];
  let totalRows = 0;

  for (const worksheet of workbook.worksheets) {
    const table = worksheetToTable(worksheet);
    if (!table) continue;

    totalRows += table.rows.length;
    if (totalRows > XLSX_LIMITS.maxTotalRows) {
      throw new XlsxParseError(
        `Workbook exceeds the ${XLSX_LIMITS.maxTotalRows}-row total safety limit.`
      );
    }
    tables.push(table);
  }

  if (tables.length === 0) {
    throw new XlsxParseError('Workbook contains no non-empty worksheets.');
  }

  return tables;
}
