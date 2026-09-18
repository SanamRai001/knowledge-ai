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

export type SourceAuthorityLevel =
  | 'SIGNED_OR_APPROVED'
  | 'USER_CONFIRMED'
  | 'AUTHORITATIVE_SYSTEM'
  | 'STRUCTURED_SOURCE'
  | 'DOCUMENT_SOURCE'
  | 'USER_OBSERVATION'
  | 'AI_INFERENCE';

export interface SourceAuthority {
  level: SourceAuthorityLevel;
  rank: number;
  reason: string;
}

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
  authority: SourceAuthority;
  sourceRefs: KnowledgeSourceRef[];
  firstObservedAt: number;
  lastObservedAt: number;
  occurrenceCount: number;
  createdAt: number;
  updatedAt: number;
}

export type KnowledgeClaimValue = string | number | boolean | null;

export interface KnowledgeClaim {
  id: string;
  fingerprint: string;
  accountId: string;
  subjectEntityId: string;
  predicate: string;
  value: KnowledgeClaimValue;
  valueType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'NULL';
  claimKind: KnowledgeClaimKind;
  authority: SourceAuthority;
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
  data: Record<string, KnowledgeClaimValue>;
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

export interface KnowledgeSnapshotCounts {
  entities: number;
  relationships: number;
  currentClaims: number;
  events: number;
}


export interface KnowledgeConflict {
  id: string;
  accountId: string;
  subjectEntityId: string;
  predicate: string;
  claimIds: string[];
  distinctValues: KnowledgeClaimValue[];
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
  previousValues: KnowledgeClaimValue[];
  currentValues: KnowledgeClaimValue[];
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

export interface KnowledgeChangesSince {
  accountId: string;
  since: number;
  projectionRunIds: string[];
  eventIds: string[];
  claimIds: string[];
  entityIdsObserved: string[];
}
