import type {
  DocumentProcessingStatus,
  KnowledgeDocument,
} from '../../src/types.js';

export interface DocumentDerivedPayloadRecord {
  id: string;
  accountId: string;
  workspaceId: string;
  documentId: string;
  sourceVersionId: string;
  derivationVersion: string;
  filename: string;
  contentType: string;
  sourceSizeBytes: number;
  processingStatus: DocumentProcessingStatus;
  errorMessage?: string;
  pageCount: number;
  payloadBackend: string;
  payloadKey: string;
  payloadSizeBytes: number;
  payloadSha256: string;
  isCurrent: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertDocumentDerivedPayload {
  id: string;
  accountId: string;
  workspaceId: string;
  documentId: string;
  sourceVersionId: string;
  derivationVersion: string;
  filename: string;
  contentType: string;
  sourceSizeBytes: number;
  processingStatus: DocumentProcessingStatus;
  errorMessage?: string;
  pageCount: number;
  payloadBackend: string;
  payloadKey: string;
  payloadSizeBytes: number;
  payloadSha256: string;
  isCurrent?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentDerivedPayloadRepository {
  upsert(
    input: UpsertDocumentDerivedPayload
  ): Promise<DocumentDerivedPayloadRecord>;

  getById(
    accountId: string,
    workspaceId: string,
    payloadId: string
  ): Promise<DocumentDerivedPayloadRecord | null>;

  getCurrentForDocument(
    accountId: string,
    workspaceId: string,
    documentId: string
  ): Promise<DocumentDerivedPayloadRecord | null>;

  listCurrentForWorkspace(
    accountId: string,
    workspaceId: string
  ): Promise<DocumentDerivedPayloadRecord[]>;

  markDocumentInactive(
    accountId: string,
    workspaceId: string,
    documentId: string,
    at?: number
  ): Promise<void>;

  setCurrentDocumentRefs(
    accountId: string,
    workspaceId: string,
    payloadIds: string[],
    at?: number
  ): Promise<void>;
}

export interface DurableDocumentPayload {
  document: KnowledgeDocument;
  derivedPayloadId: string;
  derivationVersion: string;
}
