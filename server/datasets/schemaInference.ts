import {
  DatasetCell,
  DatasetColumnSchema,
  DatasetColumnType,
} from './types.js';

const IDENTIFIER_HINT =
  /(^|[_\s-])(id|uuid|code|sku|order\s*(?:id|no|number)|invoice\s*(?:id|no|number)|customer\s*id|product\s*id)([_\s-]|$)/i;
const CURRENCY_HINT =
  /(amount|price|cost|revenue|sales|balance|total|paid|due|profit|expense|income|salary|fee|charge)/i;

function normalizedName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function asString(value: DatasetCell): string {
  return String(value ?? '').trim();
}

function isInteger(value: string): boolean {
  return /^[-+]?\d+$/.test(value.replace(/,/g, ''));
}

function isDecimal(value: string): boolean {
  return /^[-+]?\d+(?:\.\d+)?$/.test(value.replace(/,/g, ''));
}

function currencyNumber(value: string): number | null {
  const trimmed = value.trim();
  const hasCurrency =
    /(?:^|\s)(?:USD|EUR|GBP|JPY|NPR|INR)(?:\s|$)/i.test(trimmed) ||
    /[$€£¥₹₨]/.test(trimmed);
  const cleaned = trimmed
    .replace(/(?:USD|EUR|GBP|JPY|NPR|INR)/gi, '')
    .replace(/[$€£¥₹₨,\s]/g, '');

  if (!/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBoolean(value: string): boolean {
  return /^(true|false|yes|no)$/i.test(value);
}

function booleanValue(value: string): boolean {
  return /^(true|yes)$/i.test(value);
}

function isDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(value)) {
    const parts = value.split(/[/-]/).map(Number);
    return parts.length === 3 && parts[0] >= 1 && parts[0] <= 31 && parts[1] >= 1 && parts[1] <= 12;
  }
  return false;
}

function isDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}[T ][0-9]{2}:[0-9]{2}/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function inferType(
  name: string,
  values: DatasetCell[],
  distinctCount: number
): { type: DatasetColumnType; confidence: number } {
  const nonNull = values
    .filter((value) => value !== null)
    .map(asString)
    .filter(Boolean);

  if (nonNull.length === 0) {
    return { type: 'TEXT', confidence: 0.5 };
  }

  const uniqueRatio = distinctCount / nonNull.length;

  if (IDENTIFIER_HINT.test(name) && uniqueRatio >= 0.8) {
    return { type: 'IDENTIFIER', confidence: 0.98 };
  }

  if (nonNull.every(isBoolean)) {
    return { type: 'BOOLEAN', confidence: 1 };
  }

  if (nonNull.every(isDateTime)) {
    return { type: 'DATETIME', confidence: 1 };
  }

  if (nonNull.every(isDate)) {
    return { type: 'DATE', confidence: 1 };
  }

  const currencyValues = nonNull.map(currencyNumber);
  const allCurrencyNumeric = currencyValues.every((value) => value !== null);
  const explicitCurrency = nonNull.some((value) =>
    /(?:USD|EUR|GBP|JPY|NPR|INR|[$€£¥₹₨])/i.test(value)
  );

  if (
    allCurrencyNumeric &&
    (explicitCurrency || CURRENCY_HINT.test(name))
  ) {
    return { type: 'CURRENCY', confidence: explicitCurrency ? 1 : 0.95 };
  }

  if (nonNull.every(isInteger)) {
    return { type: 'INTEGER', confidence: 1 };
  }

  if (nonNull.every(isDecimal)) {
    return { type: 'DECIMAL', confidence: 1 };
  }

  if (
    nonNull.length >= 5 &&
    uniqueRatio <= 0.4 &&
    distinctCount <= 50
  ) {
    return { type: 'CATEGORICAL', confidence: 0.9 };
  }

  return { type: 'TEXT', confidence: 0.9 };
}

export function inferDatasetSchema(
  headers: string[],
  rows: DatasetCell[][]
): DatasetColumnSchema[] {
  return headers.map((name, columnIndex) => {
    const values = rows.map((row) => row[columnIndex] ?? null);
    const nonNullValues = values.filter(
      (value) => value !== null && asString(value) !== ''
    );
    const distinct = new Set(nonNullValues.map((value) => asString(value)));
    const missingCount = values.length - nonNullValues.length;
    const inferred = inferType(name, values, distinct.size);

    return {
      name,
      normalizedName: normalizedName(name) || `column_${columnIndex + 1}`,
      inferredType: inferred.type,
      nullable: missingCount > 0,
      missingCount,
      distinctCount: distinct.size,
      uniqueRatio:
        nonNullValues.length > 0 ? distinct.size / nonNullValues.length : 0,
      confidence: inferred.confidence,
      sampleValues: nonNullValues.slice(0, 5),
    };
  });
}

function coerceCell(
  value: DatasetCell,
  type: DatasetColumnType
): DatasetCell {
  if (value === null) return null;
  const text = asString(value);
  if (!text) return null;

  switch (type) {
    case 'BOOLEAN':
      return booleanValue(text);
    case 'INTEGER': {
      const number = Number(text.replace(/,/g, ''));
      return Number.isSafeInteger(number) ? number : text;
    }
    case 'DECIMAL': {
      const number = Number(text.replace(/,/g, ''));
      return Number.isFinite(number) ? number : text;
    }
    case 'CURRENCY': {
      const number = currencyNumber(text);
      return number ?? text;
    }
    case 'DATE':
    case 'DATETIME':
    case 'IDENTIFIER':
    case 'CATEGORICAL':
    case 'TEXT':
    default:
      return text;
  }
}

export function coerceRowsToSchema(
  rows: DatasetCell[][],
  columns: DatasetColumnSchema[]
): DatasetCell[][] {
  return rows.map((row) =>
    columns.map((column, index) =>
      coerceCell(row[index] ?? null, column.inferredType)
    )
  );
}
