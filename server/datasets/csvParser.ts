import { DatasetCell, ParsedDatasetTable } from './types.js';

export const CSV_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 100,
  maxCellCharacters: 10_000,
} as const;

const DELIMITER_CANDIDATES = [',', '\t', ';', '|'] as const;

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

function sampleLogicalLines(text: string, maxLines = 20): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length && lines.length < maxLines; i++) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      if (current.trim()) lines.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim() && lines.length < maxLines) lines.push(current);
  return lines;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count += 1;
  }

  return count;
}

export function detectCsvDelimiter(text: string): string {
  const lines = sampleLogicalLines(text);
  if (lines.length === 0) return ',';

  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter));
    const positive = counts.filter((count) => count > 0);
    if (positive.length === 0) continue;

    const average = positive.reduce((sum, count) => sum + count, 0) / positive.length;
    const variance =
      positive.reduce((sum, count) => sum + Math.abs(count - average), 0) /
      positive.length;
    const consistency = positive.length / lines.length;
    const score = average * consistency - variance * 0.25;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    if (cell.length > CSV_LIMITS.maxCellCharacters) {
      throw new CsvParseError(
        `CSV cell exceeds ${CSV_LIMITS.maxCellCharacters} characters.`
      );
    }
    row.push(cell);
    cell = '';
  };

  const pushRow = () => {
    pushCell();
    const isBlank = row.every((value) => value.trim() === '');
    if (!isBlank) {
      if (row.length > CSV_LIMITS.maxColumns) {
        throw new CsvParseError(
          `CSV exceeds the ${CSV_LIMITS.maxColumns}-column safety limit.`
        );
      }
      rows.push(row);
      if (rows.length > CSV_LIMITS.maxRows + 1) {
        throw new CsvParseError(
          `CSV exceeds the ${CSV_LIMITS.maxRows}-row safety limit.`
        );
      }
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      pushCell();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      pushRow();
      continue;
    }

    if (inQuotes && char === '\r' && text[i + 1] === '\n') {
      cell += '\n';
      i += 1;
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    throw new CsvParseError('Malformed CSV: unclosed quoted field.');
  }

  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function looksNumeric(value: string): boolean {
  const normalized = value.trim().replace(/,/g, '');
  return /^[-+]?\d+(?:\.\d+)?$/.test(normalized);
}

function looksBoolean(value: string): boolean {
  return /^(true|false|yes|no)$/i.test(value.trim());
}

function looksDate(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]+)?$/.test(trimmed) ||
    /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(trimmed)
  );
}

function isLikelyHeader(first: string[], second?: string[]): boolean {
  const cleaned = first.map((value) => value.trim());
  const nonEmpty = cleaned.filter(Boolean);
  if (nonEmpty.length === 0) return false;

  const unique = new Set(cleaned.map((value) => value.toLowerCase()));
  if (unique.size !== cleaned.length) return false;

  const firstLooksLikeLabels = cleaned.filter(
    (value) =>
      /[A-Za-z_]/.test(value) &&
      !looksNumeric(value) &&
      !looksDate(value) &&
      !looksBoolean(value)
  ).length;

  if (firstLooksLikeLabels / cleaned.length >= 0.7) return true;
  if (!second) return false;

  const secondLooksTyped = second.filter(
    (value) => looksNumeric(value) || looksDate(value) || looksBoolean(value)
  ).length;

  return secondLooksTyped > firstLooksLikeLabels;
}

function normalizeHeaders(headers: string[], width: number): string[] {
  const seen = new Map<string, number>();

  return Array.from({ length: width }, (_, index) => {
    const raw = (headers[index] || '').trim() || `Column ${index + 1}`;
    const count = seen.get(raw.toLowerCase()) || 0;
    seen.set(raw.toLowerCase(), count + 1);
    return count === 0 ? raw : `${raw} (${count + 1})`;
  });
}

function normalizeRows(rows: string[][], width: number): DatasetCell[][] {
  return rows.map((row) =>
    Array.from({ length: width }, (_, index) => {
      const value = row[index] ?? '';
      return value.trim() === '' ? null : value.trim();
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

export function parseCsvBuffer(
  buffer: Buffer,
  tableName = 'CSV Import'
): ParsedDatasetTable {
  if (buffer.byteLength === 0) {
    throw new CsvParseError('CSV file is empty.');
  }
  if (buffer.byteLength > CSV_LIMITS.maxFileBytes) {
    throw new CsvParseError(
      `CSV exceeds the ${Math.round(CSV_LIMITS.maxFileBytes / 1024 / 1024)} MB safety limit.`
    );
  }

  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const delimiter = detectCsvDelimiter(text);
  const rawRows = parseRows(text, delimiter);

  if (rawRows.length === 0) {
    throw new CsvParseError('CSV contains no data rows.');
  }

  const hasHeader = isLikelyHeader(rawRows[0], rawRows[1]);
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  const width = Math.max(...rawRows.map((row) => row.length));

  if (width > CSV_LIMITS.maxColumns) {
    throw new CsvParseError(
      `CSV exceeds the ${CSV_LIMITS.maxColumns}-column safety limit.`
    );
  }

  if (dataRows.length > CSV_LIMITS.maxRows) {
    throw new CsvParseError(
      `CSV exceeds the ${CSV_LIMITS.maxRows}-row safety limit.`
    );
  }

  const generatedHeaders = Array.from(
    { length: width },
    (_, index) => `Column ${index + 1}`
  );
  const headers = normalizeHeaders(
    hasHeader ? rawRows[0] : generatedHeaders,
    width
  );
  const rows = normalizeRows(dataRows, width);

  return {
    name: tableName,
    headers,
    rows,
    duplicateRowCount: countDuplicateRows(rows),
  };
}
