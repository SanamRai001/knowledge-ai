import crypto from 'crypto';
import {
  DatasetCell,
  DatasetColumnSchema,
  DatasetTable,
  DatasetVersion,
} from '../datasets/types.js';
import {
  DetectorContext,
  Insight,
  InsightEvidence,
  InsightSeverity,
  InsightType,
} from './types.js';

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ');
}

export function isNumeric(column: DatasetColumnSchema): boolean {
  return ['INTEGER', 'DECIMAL', 'CURRENCY'].includes(column.inferredType);
}

export function isDate(column: DatasetColumnSchema): boolean {
  return ['DATE', 'DATETIME'].includes(column.inferredType);
}

export function bestColumn(
  table: DatasetTable,
  terms: string[],
  predicate: (column: DatasetColumnSchema) => boolean = () => true
): DatasetColumnSchema | null {
  const scored = table.columns
    .filter(predicate)
    .map((column) => {
      const name = normalizeName(column.normalizedName || column.name);
      const score = terms.reduce((total, term, index) => {
        if (name === term) return total + 100 - index;
        if (name.includes(term)) return total + 45 - index;
        return total;
      }, 0);
      return { column, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.column || null;
}

export function columnIndex(
  table: DatasetTable,
  column: DatasetColumnSchema
): number {
  return table.columns.findIndex((item) => item.name === column.name);
}

export function numberValue(value: DatasetCell): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDate(value: DatasetCell): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const iso = Date.parse(text.length === 10 ? text + 'T00:00:00Z' : text);
  if (!Number.isNaN(iso)) return iso;

  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!local) return null;
  const timestamp = Date.UTC(
    Number(local[3]),
    Number(local[2]) - 1,
    Number(local[1])
  );
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    String(date.getUTCFullYear()) +
    '-' +
    String(date.getUTCMonth() + 1).padStart(2, '0')
  );
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value);
}

export function severityForPercent(changePercent: number): InsightSeverity {
  const magnitude = Math.abs(changePercent);
  if (magnitude >= 50) return 'HIGH';
  if (magnitude >= 25) return 'MEDIUM';
  return 'LOW';
}

export function entityColumn(table: DatasetTable): DatasetColumnSchema | null {
  return bestColumn(
    table,
    [
      'customer name',
      'customer',
      'client name',
      'client',
      'product name',
      'product',
      'item name',
      'item',
      'name',
    ],
    (column) => !isNumeric(column) && !isDate(column)
  );
}

export function insightFor(params: {
  context: DetectorContext;
  version: DatasetVersion;
  table: DatasetTable;
  detectorId: string;
  detectorVersion: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  summary: string;
  confidence: number;
  calculation: string;
  values: InsightEvidence['values'];
  rowReferences?: InsightEvidence['rowReferences'];
  fingerprintParts: Array<string | number | boolean | null>;
}): Insight {
  const fingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        params.detectorId,
        params.detectorVersion,
        params.version.id,
        params.table.id,
        ...params.fingerprintParts,
      ])
    )
    .digest('hex');

  const evidence: InsightEvidence = {
    datasetId: params.version.datasetId,
    datasetVersionId: params.version.id,
    datasetVersionNumber: params.version.versionNumber,
    sourceFilename: params.version.source.filename,
    sourceSha256: params.version.source.sha256,
    tableId: params.table.id,
    tableName: params.table.name,
    detectorId: params.detectorId,
    detectorVersion: params.detectorVersion,
    calculation: params.calculation,
    values: params.values,
    rowReferences: params.rowReferences,
  };

  return {
    id: 'ins_' + crypto.randomBytes(8).toString('hex'),
    fingerprint,
    accountId: params.context.accountId,
    datasetId: params.context.datasetId,
    datasetVersionId: params.version.id,
    analysisRunId: params.context.analysisRunId,
    type: params.type,
    severity: params.severity,
    status: 'OPEN',
    title: params.title,
    summary: params.summary,
    confidence: Math.max(0, Math.min(1, params.confidence)),
    detectorId: params.detectorId,
    detectorVersion: params.detectorVersion,
    evidence,
    createdAt: params.context.referenceTime,
  };
}
