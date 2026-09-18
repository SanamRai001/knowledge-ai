export type CompanyEntityType =
  | 'CUSTOMER'
  | 'PRODUCT'
  | 'SUPPLIER'
  | 'ORDER'
  | 'INVOICE'
  | 'BRANCH'
  | 'LOCATION'
  | 'CONTRACT'
  | 'PROJECT'
  | 'EMPLOYEE'
  | 'ORGANIZATION'
  | 'OTHER';

export type KnowledgeClaimKind = 'FACT' | 'OBSERVATION' | 'INFERENCE';

export interface KnowledgeSourceRef {
  sourceType: 'DATASET' | 'DOCUMENT' | 'USER' | 'SYSTEM';
  sourceId: string;
  sourceVersionId?: string;
  sourceVersionLabel?: string;
  sourceName: string;
  sourceHash?: string;
  tableId?: string;
  tableName?: string;
  rowIndex?: number;
  documentId?: string;
  pageNumber?: number;
  excerpt?: string;
}

export interface CompanyEntity {
  id: string;
  accountId: string;
  type: CompanyEntityType;
  canonicalName: string;
  normalizedName: string;
  identityKey: string;
  aliases: string[];
  sourceRefs: KnowledgeSourceRef[];
  createdAt: number;
  updatedAt: number;
  firstObservedAt: number;
  lastObservedAt: number;
}

export interface CompanyRelationship {
  id: string;
  fingerprint: string;
  accountId: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId: string;
  claimKind: KnowledgeClaimKind;
  authority: {
    level: string;
    rank: number;
    reason: string;
  };
  sourceRefs: KnowledgeSourceRef[];
  firstObservedAt: number;
  lastObservedAt: number;
  occurrenceCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeClaim {
  id: string;
  fingerprint: string;
  accountId: string;
  subjectEntityId: string;
  predicate: string;
  value: string | number | boolean | null;
  valueType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'NULL';
  claimKind: KnowledgeClaimKind;
  authority: {
    level: string;
    rank: number;
    reason: string;
  };
  sourceRef: KnowledgeSourceRef;
  observedAt: number;
  validFrom?: number;
  validTo?: number;
  isCurrent: boolean;
  supersedesClaimId?: string;
  createdAt: number;
}

export interface BusinessEvent {
  id: string;
  fingerprint: string;
  accountId: string;
  type: string;
  subjectEntityIds: string[];
  data: Record<string, string | number | boolean | null>;
  sourceRef: KnowledgeSourceRef;
  occurredAt?: number;
  recordedAt: number;
  projectionRunId?: string;
}

export interface KnowledgeProjectionRun {
  id: string;
  accountId: string;
  sourceType: 'DATASET' | 'DOCUMENT';
  sourceId: string;
  sourceVersionId?: string;
  sourceVersionLabel?: string;
  startedAt: number;
  completedAt?: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  entityIds: string[];
  relationshipIds: string[];
  claimIds: string[];
  eventIds: string[];
  error?: string;
}

export interface KnowledgeConflict {
  id: string;
  accountId: string;
  subjectEntityId: string;
  predicate: string;
  claimIds: string[];
  distinctValues: Array<string | number | boolean | null>;
  highestAuthorityRank: number;
  preferredClaimId?: string;
  resolution: 'HIGHER_AUTHORITY_AVAILABLE' | 'AUTHORITY_TIE';
}

export interface KnowledgeClaimChange {
  subjectEntityId: string;
  predicate: string;
  changeType: 'ADDED' | 'REMOVED' | 'CHANGED';
  previousClaimIds: string[];
  currentClaimIds: string[];
  previousValues: Array<string | number | boolean | null>;
  currentValues: Array<string | number | boolean | null>;
}

export interface KnowledgeChangeReport {
  accountId: string;
  sourceType: 'DATASET' | 'DOCUMENT';
  sourceId: string;
  fromRunId: string;
  toRunId: string;
  fromSourceVersionId?: string;
  toSourceVersionId?: string;
  fromSourceVersionLabel?: string;
  toSourceVersionLabel?: string;
  addedEntityIds: string[];
  removedEntityIds: string[];
  addedRelationshipIds: string[];
  removedRelationshipIds: string[];
  claimChanges: KnowledgeClaimChange[];
  newEventIds: string[];
  generatedAt: number;
}
