import crypto from 'crypto';
import { datasetStore } from '../datasets/datasetStore.js';
import {
  DatasetCell,
  DatasetColumnSchema,
  DatasetTable,
  DatasetVersion,
} from '../datasets/types.js';
import { structuredSourceAuthority } from './sourceAuthority.js';
import { companyKnowledgeStore } from './companyKnowledgeStore.js';
import {
  CompanyEntity,
  CompanyEntityType,
  KnowledgeClaimValue,
  KnowledgeProjectionRun,
  KnowledgeSourceRef,
} from './types.js';

type SemanticEntityRole = {
  type: CompanyEntityType;
  idTerms: string[];
  nameTerms: string[];
};

type ResolvedRole = SemanticEntityRole & {
  idColumn: DatasetColumnSchema | null;
  nameColumn: DatasetColumnSchema | null;
};

const ENTITY_ROLES: SemanticEntityRole[] = [
  {
    type: 'CUSTOMER',
    idTerms: ['customer id', 'client id', 'customer code', 'client code'],
    nameTerms: [
      'customer name',
      'client name',
      'customer',
      'client',
      'buyer',
    ],
  },
  {
    type: 'PRODUCT',
    idTerms: ['product id', 'item id', 'sku', 'product code', 'item code'],
    nameTerms: [
      'product name',
      'item name',
      'product',
      'item',
      'sku',
    ],
  },
  {
    type: 'SUPPLIER',
    idTerms: ['supplier id', 'vendor id', 'supplier code', 'vendor code'],
    nameTerms: [
      'supplier name',
      'vendor name',
      'supplier',
      'vendor',
    ],
  },
  {
    type: 'ORDER',
    idTerms: [
      'order id',
      'order number',
      'order no',
      'order code',
      'sales order id',
    ],
    nameTerms: [
      'order id',
      'order number',
      'order no',
      'order code',
      'sales order id',
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
    nameTerms: [
      'invoice id',
      'invoice number',
      'invoice no',
      'bill number',
      'bill no',
    ],
  },
  {
    type: 'BRANCH',
    idTerms: ['branch id', 'branch code', 'location code'],
    nameTerms: ['branch name', 'branch', 'location name', 'location'],
  },
];

const FACT_COLUMNS: Array<{
  predicate: string;
  terms: string[];
  numeric?: boolean;
  date?: boolean;
}> = [
  {
    predicate: 'TOTAL_AMOUNT',
    terms: [
      'grand total',
      'order total',
      'invoice total',
      'total amount',
      'net sales',
      'revenue',
      'amount',
      'total',
    ],
    numeric: true,
  },
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
    numeric: true,
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
    numeric: true,
  },
  {
    predicate: 'QUANTITY',
    terms: ['quantity', 'qty', 'units'],
    numeric: true,
  },
  {
    predicate: 'STATUS',
    terms: ['order status', 'invoice status', 'status'],
  },
  {
    predicate: 'PAYMENT_STATUS',
    terms: ['payment status', 'paid status'],
  },
  {
    predicate: 'ORDER_DATE',
    terms: ['order date', 'sale date', 'sales date'],
    date: true,
  },
  {
    predicate: 'DUE_DATE',
    terms: ['due date', 'payment due', 'payment deadline'],
    date: true,
  },
];

const PRODUCT_FACT_COLUMNS: Array<{
  predicate: string;
  terms: string[];
  numeric: boolean;
}> = [
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
    numeric: true,
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
    numeric: true,
  },
  {
    predicate: 'UNIT_PRICE',
    terms: ['unit price', 'selling price', 'sale price', 'price'],
    numeric: true,
  },
  {
    predicate: 'UNIT_COST',
    terms: ['unit cost', 'cost price', 'purchase price'],
    numeric: true,
  },
];

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function columnScore(column: DatasetColumnSchema, terms: string[]): number {
  const name = normalizeHeader(column.normalizedName || column.name);
  return terms.reduce((score, term, index) => {
    if (name === term) return Math.max(score, 100 - index);
    if (name.includes(term)) return Math.max(score, 45 - index);
    return score;
  }, 0);
}

function findColumn(
  table: DatasetTable,
  terms: string[],
  options?: { numeric?: boolean; date?: boolean; exclude?: string[] }
): DatasetColumnSchema | null {
  const excluded = new Set(options?.exclude || []);

  return (
    table.columns
      .filter((column) => {
        if (excluded.has(column.name)) return false;
        if (
          options?.numeric &&
          !['INTEGER', 'DECIMAL', 'CURRENCY'].includes(column.inferredType)
        ) {
          return false;
        }
        if (
          options?.date &&
          !['DATE', 'DATETIME'].includes(column.inferredType)
        ) {
          return false;
        }
        return true;
      })
      .map((column) => ({
        column,
        score: columnScore(column, terms),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.column || null
  );
}

function indexOfColumn(
  table: DatasetTable,
  column: DatasetColumnSchema | null
): number {
  if (!column) return -1;
  return table.columns.findIndex((candidate) => candidate.name === column.name);
}

function stringValue(value: DatasetCell): string | null {
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function numericValue(value: DatasetCell): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedDateValue(value: DatasetCell): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const parsed = Date.parse(text.length === 10 ? text + 'T00:00:00Z' : text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function dateTimestamp(value: DatasetCell): number | undefined {
  const normalized = normalizedDateValue(value);
  if (!normalized) return undefined;
  return Date.parse(normalized + 'T00:00:00Z');
}

function sourceRefFor(params: {
  datasetId: string;
  version: DatasetVersion;
  table: DatasetTable;
  rowIndex: number;
}): KnowledgeSourceRef {
  return {
    sourceType: 'DATASET',
    sourceId: params.datasetId,
    sourceVersionId: params.version.id,
    sourceVersionLabel: 'v' + String(params.version.versionNumber),
    sourceName: params.version.source.filename,
    sourceHash: params.version.source.sha256,
    tableId: params.table.id,
    tableName: params.table.name,
    // Physical source row: row 1 is the header.
    rowIndex: params.rowIndex + 2,
  };
}

function resolveRoles(table: DatasetTable): ResolvedRole[] {
  return ENTITY_ROLES.map((role) => {
    const idColumn = findColumn(table, role.idTerms);
    const nameColumn = findColumn(table, role.nameTerms, {
      exclude: idColumn ? [idColumn.name] : [],
    });

    return {
      ...role,
      idColumn,
      nameColumn:
        nameColumn ||
        (idColumn && role.type !== 'ORDER' && role.type !== 'INVOICE'
          ? null
          : idColumn),
    };
  });
}

function resolveEntityFromRow(params: {
  accountId: string;
  datasetId: string;
  version: DatasetVersion;
  table: DatasetTable;
  row: DatasetCell[];
  rowIndex: number;
  role: ResolvedRole;
  observedAt: number;
}): CompanyEntity | null {
  const idIndex = indexOfColumn(params.table, params.role.idColumn);
  const nameIndex = indexOfColumn(params.table, params.role.nameColumn);

  const identity =
    idIndex >= 0 ? stringValue(params.row[idIndex] ?? null) : null;
  const name =
    nameIndex >= 0 ? stringValue(params.row[nameIndex] ?? null) : null;

  if (!identity && !name) return null;

  const canonicalName = name || identity!;
  const aliases = [identity, name].filter(
    (value): value is string => Boolean(value && value !== canonicalName)
  );

  return companyKnowledgeStore.upsertEntity({
    accountId: params.accountId,
    type: params.role.type,
    canonicalName,
    identityKey: identity || name || canonicalName,
    aliases,
    sourceRef: sourceRefFor(params),
    observedAt: params.observedAt,
  });
}

function valueForColumn(
  row: DatasetCell[],
  table: DatasetTable,
  column: DatasetColumnSchema,
  options: { numeric?: boolean; date?: boolean }
): KnowledgeClaimValue | undefined {
  const index = indexOfColumn(table, column);
  if (index < 0) return undefined;
  const raw = row[index] ?? null;

  if (options.numeric) {
    const number = numericValue(raw);
    return number === null ? undefined : number;
  }
  if (options.date) {
    const date = normalizedDateValue(raw);
    return date || undefined;
  }
  return stringValue(raw) ?? undefined;
}

export class StructuredKnowledgeProjectionService {
  public projectDataset(params: {
    accountId: string;
    datasetId: string;
    versionId?: string;
  }): KnowledgeProjectionRun {
    const version = params.versionId
      ? datasetStore.getVersion(
          params.accountId,
          params.datasetId,
          params.versionId
        )
      : datasetStore.getCurrentVersion(params.accountId, params.datasetId);

    if (!version) {
      datasetStore.requireDataset(params.accountId, params.datasetId);
      throw new Error('Dataset version not found.');
    }

    const run: KnowledgeProjectionRun = {
      id: 'kpr_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      sourceType: 'DATASET',
      sourceId: params.datasetId,
      sourceVersionId: version.id,
      sourceVersionLabel: 'v' + String(version.versionNumber),
      startedAt: Date.now(),
      status: 'RUNNING',
      entityIds: [],
      relationshipIds: [],
      claimIds: [],
      eventIds: [],
    };

    companyKnowledgeStore.saveProjectionRun(run);

    try {
      const entityIds = new Set<string>();
      const relationshipIds = new Set<string>();
      const claimIds = new Set<string>();
      const eventIds = new Set<string>();
      const authority = structuredSourceAuthority();
      const observedAt = version.createdAt;

      companyKnowledgeStore.withBatch(() => {
        for (const table of version.tables) {
          const roles = resolveRoles(table);
          const resolvedFactColumns = FACT_COLUMNS.map((fact) => ({
            ...fact,
            column: findColumn(table, fact.terms, {
              numeric: fact.numeric,
              date: fact.date,
            }),
          })).filter(
            (
              fact
            ): fact is (typeof FACT_COLUMNS)[number] & {
              column: DatasetColumnSchema;
            } => Boolean(fact.column)
          );

          const resolvedProductFacts = PRODUCT_FACT_COLUMNS.map((fact) => ({
            ...fact,
            column: findColumn(table, fact.terms, {
              numeric: fact.numeric,
            }),
          })).filter(
            (
              fact
            ): fact is (typeof PRODUCT_FACT_COLUMNS)[number] & {
              column: DatasetColumnSchema;
            } => Boolean(fact.column)
          );

          const productRole = roles.find((role) => role.type === 'PRODUCT');
          const productIdentityCounts = new Map<string, number>();

          if (productRole) {
            const productIdIndex = indexOfColumn(table, productRole.idColumn);
            const productNameIndex = indexOfColumn(
              table,
              productRole.nameColumn
            );

            for (const row of table.rows) {
              const key =
                (productIdIndex >= 0
                  ? stringValue(row[productIdIndex] ?? null)
                  : null) ||
                (productNameIndex >= 0
                  ? stringValue(row[productNameIndex] ?? null)
                  : null);
              if (key) {
                productIdentityCounts.set(
                  key,
                  (productIdentityCounts.get(key) || 0) + 1
                );
              }
            }
          }

          table.rows.forEach((row, rowIndex) => {
            const entities = new Map<CompanyEntityType, CompanyEntity>();
            for (const role of roles) {
              const entity = resolveEntityFromRow({
                accountId: params.accountId,
                datasetId: params.datasetId,
                version,
                table,
                row,
                rowIndex,
                role,
                observedAt,
              });
              if (entity) {
                entities.set(role.type, entity);
                entityIds.add(entity.id);
              }
            }

            const sourceRef = sourceRefFor({
              datasetId: params.datasetId,
              version,
              table,
              rowIndex,
            });

            const addRelationship = (
              subjectType: CompanyEntityType,
              predicate: string,
              objectType: CompanyEntityType
            ) => {
              const subject = entities.get(subjectType);
              const object = entities.get(objectType);
              if (!subject || !object) return;

              const relationship =
                companyKnowledgeStore.upsertRelationship({
                  accountId: params.accountId,
                  subjectEntityId: subject.id,
                  predicate,
                  objectEntityId: object.id,
                  claimKind: 'OBSERVATION',
                  authority,
                  sourceRef,
                  observedAt,
                });
              relationshipIds.add(relationship.id);
            };

            addRelationship('CUSTOMER', 'PLACED', 'ORDER');
            addRelationship('ORDER', 'CONTAINS', 'PRODUCT');
            addRelationship('PRODUCT', 'SUPPLIED_BY', 'SUPPLIER');
            addRelationship('ORDER', 'BELONGS_TO', 'BRANCH');

            const primaryRecord =
              entities.get('ORDER') || entities.get('INVOICE');

            if (primaryRecord) {
              const eventData: Record<string, KnowledgeClaimValue> = {};
              let occurredAt: number | undefined;

              for (const fact of resolvedFactColumns) {
                const value = valueForColumn(
                  row,
                  table,
                  fact.column,
                  fact
                );
                if (value === undefined) continue;

                const claim = companyKnowledgeStore.recordClaim({
                  accountId: params.accountId,
                  subjectEntityId: primaryRecord.id,
                  predicate: fact.predicate,
                  value,
                  claimKind: 'OBSERVATION',
                  authority,
                  sourceRef,
                  observedAt,
                });
                claimIds.add(claim.id);
                eventData[fact.predicate] = value;

                if (fact.predicate === 'ORDER_DATE') {
                  occurredAt = dateTimestamp(
                    row[indexOfColumn(table, fact.column)] ?? null
                  );
                }
              }

              const event = companyKnowledgeStore.recordEvent({
                accountId: params.accountId,
                type:
                  primaryRecord.type === 'ORDER'
                    ? 'ORDER_OBSERVED'
                    : 'INVOICE_OBSERVED',
                subjectEntityIds: [
                  primaryRecord.id,
                  ...['CUSTOMER', 'PRODUCT', 'SUPPLIER', 'BRANCH']
                    .map((type) =>
                      entities.get(type as CompanyEntityType)?.id
                    )
                    .filter((id): id is string => Boolean(id)),
                ],
                data: eventData,
                sourceRef,
                occurredAt,
                recordedAt: observedAt,
                projectionRunId: run.id,
                fingerprintParts: [primaryRecord.id],
              });
              eventIds.add(event.id);
            }

            const product = entities.get('PRODUCT');
            if (product && productRole && resolvedProductFacts.length > 0) {
              const productIdIndex = indexOfColumn(
                table,
                productRole.idColumn
              );
              const productNameIndex = indexOfColumn(
                table,
                productRole.nameColumn
              );
              const productKey =
                (productIdIndex >= 0
                  ? stringValue(row[productIdIndex] ?? null)
                  : null) ||
                (productNameIndex >= 0
                  ? stringValue(row[productNameIndex] ?? null)
                  : null);

              // Product state facts are only promoted from tables where the
              // product appears once in the version. Transaction tables often
              // repeat products and must not silently overwrite product state.
              if (
                productKey &&
                productIdentityCounts.get(productKey) === 1
              ) {
                const inventoryEventData: Record<
                  string,
                  KnowledgeClaimValue
                > = {};

                for (const fact of resolvedProductFacts) {
                  const value = valueForColumn(
                    row,
                    table,
                    fact.column,
                    fact
                  );
                  if (value === undefined) continue;

                  const claim = companyKnowledgeStore.recordClaim({
                    accountId: params.accountId,
                    subjectEntityId: product.id,
                    predicate: fact.predicate,
                    value,
                    claimKind: 'OBSERVATION',
                    authority,
                    sourceRef,
                    observedAt,
                  });
                  claimIds.add(claim.id);
                  inventoryEventData[fact.predicate] = value;
                }

                if (
                  Object.prototype.hasOwnProperty.call(
                    inventoryEventData,
                    'CURRENT_STOCK'
                  )
                ) {
                  const event = companyKnowledgeStore.recordEvent({
                    accountId: params.accountId,
                    type: 'INVENTORY_STATE_OBSERVED',
                    subjectEntityIds: [product.id],
                    data: inventoryEventData,
                    sourceRef,
                    recordedAt: observedAt,
                    projectionRunId: run.id,
                    fingerprintParts: [product.id],
                  });
                  eventIds.add(event.id);
                }
              }
            }
          });
        }

        const projectedEvent = companyKnowledgeStore.recordEvent({
          accountId: params.accountId,
          type: 'DATASET_VERSION_PROJECTED',
          subjectEntityIds: [],
          data: {
            entityCount: entityIds.size,
            relationshipCount: relationshipIds.size,
            claimCount: claimIds.size,
          },
          sourceRef: {
            sourceType: 'DATASET',
            sourceId: params.datasetId,
            sourceVersionId: version.id,
            sourceVersionLabel: 'v' + String(version.versionNumber),
            sourceName: version.source.filename,
            sourceHash: version.source.sha256,
          },
          recordedAt: Date.now(),
          projectionRunId: run.id,
          fingerprintParts: [version.id],
        });
        eventIds.add(projectedEvent.id);
      });

      const completed: KnowledgeProjectionRun = {
        ...run,
        status: 'COMPLETED',
        completedAt: Date.now(),
        entityIds: Array.from(entityIds),
        relationshipIds: Array.from(relationshipIds),
        claimIds: Array.from(claimIds),
        eventIds: Array.from(eventIds),
      };

      companyKnowledgeStore.saveProjectionRun(completed);
      return completed;
    } catch (error: any) {
      const failed: KnowledgeProjectionRun = {
        ...run,
        status: 'FAILED',
        completedAt: Date.now(),
        error: error?.message || 'Structured knowledge projection failed.',
      };
      companyKnowledgeStore.saveProjectionRun(failed);
      throw error;
    }
  }
}

export const structuredKnowledgeProjectionService =
  new StructuredKnowledgeProjectionService();
