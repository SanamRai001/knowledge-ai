import crypto from 'crypto';
import { KnowledgeBase, KnowledgeDocument } from '../../src/types.js';
import { workspaceAccessService } from '../workspaceAccessService.js';
import { companyKnowledgeStore } from './companyKnowledgeStore.js';
import { documentSourceAuthority } from './sourceAuthority.js';
import {
  CompanyEntity,
  CompanyEntityType,
  KnowledgeClaimValue,
  KnowledgeProjectionRun,
  KnowledgeSourceRef,
} from './types.js';

function knowledgeBaseSnapshotId(kb: KnowledgeBase): string {
  const payload = kb.documents
    .map((document) => ({
      id: document.id,
      filename: document.filename,
      uploadTimestamp: document.uploadTimestamp,
      processingStatus: document.processingStatus,
      pages: (document.pages || []).map((page) => ({
        pageNumber: page.pageNumber,
        text: page.text,
      })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return (
    'kbs_' +
    crypto
      .createHash('sha256')
      .update(JSON.stringify([kb.currentVersion, payload]))
      .digest('hex')
      .slice(0, 24)
  );
}

const ENTITY_LABELS: Array<{
  label: string;
  type: CompanyEntityType;
}> = [
  { label: 'customer', type: 'CUSTOMER' },
  { label: 'client', type: 'CUSTOMER' },
  { label: 'product', type: 'PRODUCT' },
  { label: 'item', type: 'PRODUCT' },
  { label: 'supplier', type: 'SUPPLIER' },
  { label: 'vendor', type: 'SUPPLIER' },
  { label: 'order', type: 'ORDER' },
  { label: 'invoice', type: 'INVOICE' },
  { label: 'branch', type: 'BRANCH' },
  { label: 'location', type: 'LOCATION' },
  { label: 'contract', type: 'CONTRACT' },
  { label: 'project', type: 'PROJECT' },
  { label: 'employee', type: 'EMPLOYEE' },
  { label: 'organization', type: 'ORGANIZATION' },
  { label: 'organisation', type: 'ORGANIZATION' },
];

function cleanEntityText(value: string): string {
  return value
    .replace(/[.;,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseExplicitEntityLabel(
  line: string
): {
  type: CompanyEntityType;
  name: string;
  identityKey?: string;
} | null {
  for (const definition of ENTITY_LABELS) {
    const pattern = new RegExp(
      '^' +
        definition.label +
        '\\s*(?:name)?\\s*:\\s*(.+?)(?:\\s*\\(\\s*(?:id|code)\\s*:\\s*([^\\)]+)\\s*\\))?\\s*$',
      'i'
    );
    const match = line.match(pattern);
    if (!match) continue;

    const name = cleanEntityText(match[1]);
    const identityKey = match[2]
      ? cleanEntityText(match[2])
      : undefined;
    if (!name) return null;
    return {
      type: definition.type,
      name,
      identityKey,
    };
  }

  return null;
}

function sourceRefFor(params: {
  kb: KnowledgeBase;
  document: KnowledgeDocument;
  pageNumber: number;
  excerpt: string;
  snapshotId: string;
}): KnowledgeSourceRef {
  return {
    sourceType: 'DOCUMENT',
    sourceId: params.kb.id,
    sourceVersionId: params.snapshotId,
    sourceVersionLabel: params.kb.currentVersion,
    sourceName: params.document.filename,
    documentId: params.document.id,
    pageNumber: params.pageNumber,
    excerpt: params.excerpt,
  };
}

function upsertDocumentEntity(params: {
  accountId: string;
  kb: KnowledgeBase;
  document: KnowledgeDocument;
  pageNumber: number;
  excerpt: string;
  type: CompanyEntityType;
  name: string;
  identityKey?: string;
  observedAt: number;
  snapshotId: string;
}): CompanyEntity {
  return companyKnowledgeStore.upsertEntity({
    accountId: params.accountId,
    type: params.type,
    canonicalName: cleanEntityText(params.name),
    identityKey: params.identityKey
      ? cleanEntityText(params.identityKey)
      : undefined,
    sourceRef: sourceRefFor(params),
    observedAt: params.observedAt,
  });
}

function parseNumber(value: string): number | null {
  const normalized = value
    .replace(/\bNPR\b/gi, '')
    .replace(/\bRs\.?\b/gi, '')
    .replace(/,/g, '')
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function relationshipMatches(line: string): Array<{
  subjectType: CompanyEntityType;
  subjectName: string;
  predicate: string;
  objectType: CompanyEntityType;
  objectName: string;
}> {
  const output: Array<{
    subjectType: CompanyEntityType;
    subjectName: string;
    predicate: string;
    objectType: CompanyEntityType;
    objectName: string;
  }> = [];

  const placed = line.match(
    /^customer\s+(.+?)\s+placed\s+order\s+([A-Za-z0-9._\/-]+)(?:\.|$)/i
  );
  if (placed) {
    output.push({
      subjectType: 'CUSTOMER',
      subjectName: cleanEntityText(placed[1]),
      predicate: 'PLACED',
      objectType: 'ORDER',
      objectName: cleanEntityText(placed[2]),
    });
  }

  const contains = line.match(
    /^order\s+([A-Za-z0-9._\/-]+)\s+contains\s+product\s+(.+?)(?:\.|$)/i
  );
  if (contains) {
    output.push({
      subjectType: 'ORDER',
      subjectName: cleanEntityText(contains[1]),
      predicate: 'CONTAINS',
      objectType: 'PRODUCT',
      objectName: cleanEntityText(contains[2]),
    });
  }

  const supplied = line.match(
    /^product\s+(.+?)\s+is\s+supplied\s+by\s+(.+?)(?:\.|$)/i
  );
  if (supplied) {
    output.push({
      subjectType: 'PRODUCT',
      subjectName: cleanEntityText(supplied[1]),
      predicate: 'SUPPLIED_BY',
      objectType: 'SUPPLIER',
      objectName: cleanEntityText(supplied[2]),
    });
  }

  const branch = line.match(
    /^order\s+([A-Za-z0-9._\/-]+)\s+belongs\s+to\s+branch\s+(.+?)(?:\.|$)/i
  );
  if (branch) {
    output.push({
      subjectType: 'ORDER',
      subjectName: cleanEntityText(branch[1]),
      predicate: 'BELONGS_TO',
      objectType: 'BRANCH',
      objectName: cleanEntityText(branch[2]),
    });
  }

  const contract = line.match(
    /^contract\s+([A-Za-z0-9._\/-]+)\s+covers\s+product\s+(.+?)(?:\.|$)/i
  );
  if (contract) {
    output.push({
      subjectType: 'CONTRACT',
      subjectName: cleanEntityText(contract[1]),
      predicate: 'COVERS',
      objectType: 'PRODUCT',
      objectName: cleanEntityText(contract[2]),
    });
  }

  return output;
}

function claimMatch(line: string):
  | {
      subjectType: CompanyEntityType;
      subjectName: string;
      predicate: string;
      value: KnowledgeClaimValue;
    }
  | null {
  const orderBalance = line.match(
    /^order\s+([A-Za-z0-9._\/-]+)\s+balance\s+due\s+is\s+(.+?)(?:\.|$)/i
  );
  if (orderBalance) {
    const value = parseNumber(orderBalance[2]);
    if (value !== null) {
      return {
        subjectType: 'ORDER',
        subjectName: cleanEntityText(orderBalance[1]),
        predicate: 'BALANCE_DUE',
        value,
      };
    }
  }

  const orderStatus = line.match(
    /^order\s+([A-Za-z0-9._\/-]+)\s+status\s+is\s+(.+?)(?:\.|$)/i
  );
  if (orderStatus) {
    return {
      subjectType: 'ORDER',
      subjectName: cleanEntityText(orderStatus[1]),
      predicate: 'STATUS',
      value: cleanEntityText(orderStatus[2]),
    };
  }

  const invoiceStatus = line.match(
    /^invoice\s+([A-Za-z0-9._\/-]+)\s+status\s+is\s+(.+?)(?:\.|$)/i
  );
  if (invoiceStatus) {
    return {
      subjectType: 'INVOICE',
      subjectName: cleanEntityText(invoiceStatus[1]),
      predicate: 'STATUS',
      value: cleanEntityText(invoiceStatus[2]),
    };
  }

  const productStock = line.match(
    /^product\s+(.+?)\s+current\s+stock\s+is\s+(.+?)(?:\.|$)/i
  );
  if (productStock) {
    const value = parseNumber(productStock[2]);
    if (value !== null) {
      return {
        subjectType: 'PRODUCT',
        subjectName: cleanEntityText(productStock[1]),
        predicate: 'CURRENT_STOCK',
        value,
      };
    }
  }

  const productReorder = line.match(
    /^product\s+(.+?)\s+reorder\s+(?:level|point)\s+is\s+(.+?)(?:\.|$)/i
  );
  if (productReorder) {
    const value = parseNumber(productReorder[2]);
    if (value !== null) {
      return {
        subjectType: 'PRODUCT',
        subjectName: cleanEntityText(productReorder[1]),
        predicate: 'REORDER_LEVEL',
        value,
      };
    }
  }

  return null;
}

export class DocumentKnowledgeProjectionService {
  public projectKnowledgeBase(params: {
    accountId: string;
    knowledgeBaseId: string;
  }): KnowledgeProjectionRun {
    const kb = workspaceAccessService.requireKB(
      params.accountId,
      params.knowledgeBaseId
    );

    const snapshotId = knowledgeBaseSnapshotId(kb);

    const run: KnowledgeProjectionRun = {
      id: 'kpr_' + crypto.randomBytes(8).toString('hex'),
      accountId: params.accountId,
      sourceType: 'DOCUMENT',
      sourceId: kb.id,
      sourceVersionId: snapshotId,
      sourceVersionLabel: kb.currentVersion,
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
      const authority = documentSourceAuthority();
      const observedAt = kb.updatedAt || Date.now();

      companyKnowledgeStore.withBatch(() => {
        for (const document of kb.documents) {
          if (
            document.processingStatus !== 'processed' ||
            !document.pages
          ) {
            continue;
          }

          for (const page of document.pages) {
            const lines = page.text
              .split(/\n+|(?<=[.!?])\s+/)
              .map((line) => line.replace(/\s+/g, ' ').trim())
              .filter((line) => line.length >= 3);

            for (const line of lines) {
              const labeledEntity = parseExplicitEntityLabel(line);
              if (labeledEntity) {
                const entity = upsertDocumentEntity({
                  accountId: params.accountId,
                  kb,
                  document,
                  pageNumber: page.pageNumber,
                  excerpt: line,
                  type: labeledEntity.type,
                  name: labeledEntity.name,
                  identityKey: labeledEntity.identityKey,
                  observedAt,
                  snapshotId,
                });
                entityIds.add(entity.id);
              }

              for (const match of relationshipMatches(line)) {
                const subject = upsertDocumentEntity({
                  accountId: params.accountId,
                  kb,
                  document,
                  pageNumber: page.pageNumber,
                  excerpt: line,
                  type: match.subjectType,
                  name: match.subjectName,
                  identityKey:
                    match.subjectType === 'ORDER' ||
                    match.subjectType === 'INVOICE' ||
                    match.subjectType === 'CONTRACT'
                      ? match.subjectName
                      : undefined,
                  observedAt,
                  snapshotId,
                });
                const object = upsertDocumentEntity({
                  accountId: params.accountId,
                  kb,
                  document,
                  pageNumber: page.pageNumber,
                  excerpt: line,
                  type: match.objectType,
                  name: match.objectName,
                  identityKey:
                    match.objectType === 'ORDER' ||
                    match.objectType === 'INVOICE' ||
                    match.objectType === 'CONTRACT'
                      ? match.objectName
                      : undefined,
                  observedAt,
                  snapshotId,
                });
                entityIds.add(subject.id);
                entityIds.add(object.id);

                const relationship =
                  companyKnowledgeStore.upsertRelationship({
                    accountId: params.accountId,
                    subjectEntityId: subject.id,
                    predicate: match.predicate,
                    objectEntityId: object.id,
                    claimKind: 'OBSERVATION',
                    authority,
                    sourceRef: sourceRefFor({
                      kb,
                      document,
                      pageNumber: page.pageNumber,
                      excerpt: line,
                      snapshotId,
                    }),
                    observedAt,
                  });
                relationshipIds.add(relationship.id);
              }

              const claim = claimMatch(line);
              if (claim) {
                const subject = upsertDocumentEntity({
                  accountId: params.accountId,
                  kb,
                  document,
                  pageNumber: page.pageNumber,
                  excerpt: line,
                  type: claim.subjectType,
                  name: claim.subjectName,
                  identityKey:
                    claim.subjectType === 'ORDER' ||
                    claim.subjectType === 'INVOICE'
                      ? claim.subjectName
                      : undefined,
                  observedAt,
                  snapshotId,
                });
                entityIds.add(subject.id);

                const storedClaim = companyKnowledgeStore.recordClaim({
                  accountId: params.accountId,
                  subjectEntityId: subject.id,
                  predicate: claim.predicate,
                  value: claim.value,
                  claimKind: 'OBSERVATION',
                  authority,
                  sourceRef: sourceRefFor({
                    kb,
                    document,
                    pageNumber: page.pageNumber,
                    excerpt: line,
                  }),
                  observedAt,
                  snapshotId,
                });
                claimIds.add(storedClaim.id);
              }
            }
          }
        }

        const projectedEvent = companyKnowledgeStore.recordEvent({
          accountId: params.accountId,
          type: 'DOCUMENT_VERSION_PROJECTED',
          subjectEntityIds: [],
          data: {
            entityCount: entityIds.size,
            relationshipCount: relationshipIds.size,
            claimCount: claimIds.size,
          },
          sourceRef: {
            sourceType: 'DOCUMENT',
            sourceId: kb.id,
            sourceVersionId: snapshotId,
            sourceVersionLabel: kb.currentVersion,
            sourceName: kb.name,
          },
          recordedAt: Date.now(),
          projectionRunId: run.id,
          fingerprintParts: [kb.currentVersion],
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
        error: error?.message || 'Document knowledge projection failed.',
      };
      companyKnowledgeStore.saveProjectionRun(failed);
      throw error;
    }
  }
}

export const documentKnowledgeProjectionService =
  new DocumentKnowledgeProjectionService();
