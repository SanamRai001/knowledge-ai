import {
  DatasetCell,
  DatasetColumnSchema,
  DatasetTable,
  DatasetVersion,
} from '../datasets/types.js';
import { datasetStore } from '../datasets/datasetStore.js';
import {
  normalizeEntityName,
} from './companyKnowledgeStore.js';
import { companyKnowledgePersistence } from './companyKnowledgePersistence.js';
import { effectiveCompanyStateRuntimeService } from './effectiveCompanyStateRuntimeService.js';
import { CompanyEntity, CompanyEntityType } from './types.js';
import { SOURCE_AUTHORITIES } from './sourceAuthority.js';

export interface EffectiveDatasetOverlayApplication {
  tableId: string;
  tableName: string;
  rowIndex: number;
  columnName: string;
  predicate: string;
  entityId: string;
  claimId: string;
  authorityLevel: string;
  beforeValue: DatasetCell;
  afterValue: DatasetCell;
}

export interface EffectiveDatasetView {
  version: DatasetVersion;
  overlays: EffectiveDatasetOverlayApplication[];
}

type EntityRule = {
  type: CompanyEntityType;
  idTerms: string[];
  nameTerms: string[];
  fields: Array<{
    predicate: string;
    terms: string[];
  }>;
};

const RULES: EntityRule[] = [
  {
    type: 'ORDER',
    idTerms: [
      'order id',
      'order number',
      'order no',
      'order code',
      'sales order id',
    ],
    nameTerms: [],
    fields: [
      {
        predicate: 'BALANCE_DUE',
        terms: [
          'outstanding balance',
          'balance due',
          'amount due',
          'remaining balance',
          'remaining amount',
          'outstanding',
        ],
      },
      {
        predicate: 'PAID_AMOUNT',
        terms: [
          'amount paid',
          'paid amount',
          'total paid',
          'paid',
          'payment received',
        ],
      },
      {
        predicate: 'STATUS',
        terms: ['order status', 'status'],
      },
      {
        predicate: 'PAYMENT_STATUS',
        terms: ['payment status', 'paid status'],
      },
    ],
  },
  {
    type: 'INVOICE',
    idTerms: [
      'invoice id',
      'invoice number',
      'invoice no',
      'bill number',
      'bill no',
    ],
    nameTerms: [],
    fields: [
      {
        predicate: 'BALANCE_DUE',
        terms: [
          'outstanding balance',
          'balance due',
          'amount due',
          'remaining balance',
          'remaining amount',
          'outstanding',
        ],
      },
      {
        predicate: 'PAID_AMOUNT',
        terms: [
          'amount paid',
          'paid amount',
          'total paid',
          'paid',
          'payment received',
        ],
      },
      {
        predicate: 'STATUS',
        terms: ['invoice status', 'status'],
      },
      {
        predicate: 'PAYMENT_STATUS',
        terms: ['payment status', 'paid status'],
      },
    ],
  },
  {
    type: 'PRODUCT',
    idTerms: [
      'product id',
      'item id',
      'sku',
      'product code',
      'item code',
    ],
    nameTerms: [
      'product name',
      'item name',
      'product',
      'item',
      'sku',
    ],
    fields: [
      {
        predicate: 'CURRENT_STOCK',
        terms: [
          'current stock',
          'stock on hand',
          'quantity on hand',
          'on hand',
          'stock',
          'inventory',
        ],
      },
      {
        predicate: 'REORDER_LEVEL',
        terms: [
          'reorder level',
          'reorder point',
          'minimum stock',
          'min stock',
          'safety stock',
        ],
      },
      {
        predicate: 'UNIT_PRICE',
        terms: ['unit price', 'selling price', 'sale price', 'price'],
      },
      {
        predicate: 'UNIT_COST',
        terms: ['unit cost', 'cost price', 'purchase price'],
      },
    ],
  },
];

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function scoreColumn(column: DatasetColumnSchema, terms: string[]): number {
  const name = normalizeHeader(column.normalizedName || column.name);
  return terms.reduce((best, term, index) => {
    if (name === term) return Math.max(best, 100 - index);
    if (name.includes(term)) return Math.max(best, 40 - index);
    return best;
  }, 0);
}

function bestColumn(
  table: DatasetTable,
  terms: string[],
  exclude: Set<string> = new Set()
): DatasetColumnSchema | null {
  return (
    table.columns
      .filter((column) => !exclude.has(column.name))
      .map((column) => ({
        column,
        score: scoreColumn(column, terms),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.column || null
  );
}

function columnIndex(
  table: DatasetTable,
  column: DatasetColumnSchema | null
): number {
  if (!column) return -1;
  return table.columns.findIndex((item) => item.name === column.name);
}

function stringValue(value: DatasetCell): string | null {
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

async function exactEntity(
  accountId: string,
  type: CompanyEntityType,
  reference: string
): Promise<CompanyEntity | null> {
  const normalized = normalizeEntityName(reference);
  const matches = (
    await companyKnowledgePersistence.listEntities({
      accountId,
      type,
      search: reference,
      limit: 50,
    })
  ).filter(
    (entity) =>
      entity.identityKey === normalized ||
      entity.normalizedName === normalized ||
      entity.aliases.some(
        (alias) =>
          normalizeEntityName(alias) === normalized
      )
  );

  return matches.length === 1 ? matches[0] : null;
}

function compatibleValue(
  value: DatasetCell,
  column: DatasetColumnSchema
): DatasetCell | undefined {
  if (value === null) return null;

  if (
    ['INTEGER', 'DECIMAL', 'CURRENCY'].includes(column.inferredType)
  ) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  if (column.inferredType === 'BOOLEAN') {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (
    column.inferredType === 'DATE' ||
    column.inferredType === 'DATETIME' ||
    column.inferredType === 'TEXT' ||
    column.inferredType === 'CATEGORICAL' ||
    column.inferredType === 'IDENTIFIER'
  ) {
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

export class EffectiveDatasetOverlayRuntimeService {
  public async apply(params: {
    accountId: string;
    datasetId: string;
    version: DatasetVersion;
  }): Promise<EffectiveDatasetView> {
    const version = structuredClone(params.version);
    const overlays: EffectiveDatasetOverlayApplication[] = [];

    const dataset = datasetStore.requireDataset(
      params.accountId,
      params.datasetId
    );
    if (dataset.currentVersionId !== params.version.id) {
      return { version, overlays };
    }
    const minimumOverlayAuthority =
      SOURCE_AUTHORITIES.STRUCTURED_SOURCE.rank + 1;

    for (const table of version.tables) {
      for (const rule of RULES) {
        const idColumn = bestColumn(table, rule.idTerms);
        const nameColumn = bestColumn(
          table,
          rule.nameTerms,
          new Set(idColumn ? [idColumn.name] : [])
        );

        if (!idColumn && !nameColumn) continue;

        const idIndex = columnIndex(table, idColumn);
        const nameIndex = columnIndex(table, nameColumn);
        const fields = rule.fields
          .map((field) => ({
            ...field,
            column: bestColumn(table, field.terms),
          }))
          .filter(
            (
              field
            ): field is {
              predicate: string;
              terms: string[];
              column: DatasetColumnSchema;
            } => Boolean(field.column)
          );

        if (fields.length === 0) continue;

        for (const [rowIndex, row] of table.rows.entries()) {
          const reference =
            (idIndex >= 0 ? stringValue(row[idIndex] ?? null) : null) ||
            (nameIndex >= 0 ? stringValue(row[nameIndex] ?? null) : null);
          if (!reference) return;

          const entity = await exactEntity(
            params.accountId,
            rule.type,
            reference
          );
          if (!entity) return;

          for (const field of fields) {
            const resolution =
              await effectiveCompanyStateRuntimeService.resolve(
              params.accountId,
              entity.id,
              field.predicate
            );
            if (resolution.status !== 'RESOLVED') continue;
            if (
              resolution.effectiveClaim.authority.rank <
              minimumOverlayAuthority
            ) {
              continue;
            }

            const nextValue = compatibleValue(
              resolution.value,
              field.column
            );
            if (nextValue === undefined) continue;

            const fieldIndex = columnIndex(table, field.column);
            if (fieldIndex < 0) continue;
            const beforeValue = row[fieldIndex] ?? null;
            if (JSON.stringify(beforeValue) === JSON.stringify(nextValue)) {
              continue;
            }

            row[fieldIndex] = nextValue;
            overlays.push({
              tableId: table.id,
              tableName: table.name,
              rowIndex: rowIndex + 2,
              columnName: field.column.name,
              predicate: field.predicate,
              entityId: entity.id,
              claimId: resolution.effectiveClaim.id,
              authorityLevel: resolution.effectiveClaim.authority.level,
              beforeValue,
              afterValue: nextValue,
            });
          }
        }
      }
    }

    return { version, overlays };
  }
}

export const effectiveDatasetOverlayRuntimeService =
  new EffectiveDatasetOverlayRuntimeService();
