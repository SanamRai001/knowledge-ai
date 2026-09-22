import crypto from 'crypto';
import type {
  KnowledgeDocument,
} from '../../src/types.js';
import {
  sha256Bytes,
  verifySourceIntegrity,
  type SourceByteStorage,
} from './sourceByteStorage.js';
import {
  sourceByteStorageRuntime,
} from './sourceByteStorageRuntime.js';
import {
  postgresDocumentDerivedPayloadRepository,
} from './postgresDocumentDerivedPayloadRepository.js';
import type {
  DocumentDerivedPayloadRecord,
  DocumentDerivedPayloadRepository,
  DurableDocumentPayload,
} from './documentDerivedPayloadTypes.js';

export const DOCUMENT_DERIVATION_VERSION =
  'pdf-parse-v1';

const SAFE_SEGMENT =
  /^[A-Za-z0-9_-]+$/;

function safeSegment(
  value: string,
  label: string
): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    !SAFE_SEGMENT.test(trimmed)
  ) {
    throw new Error(
      label +
        ' must contain only letters, numbers, underscore, or hyphen.'
    );
  }
  return trimmed;
}

function id(prefix: string): string {
  return (
    prefix +
    crypto.randomBytes(12).toString('hex')
  );
}

export function buildDerivedDocumentPayloadKey(
  input: {
    accountId: string;
    workspaceId: string;
    documentId: string;
    derivationVersion: string;
    writeId: string;
  }
): string {
  const accountId = safeSegment(
    input.accountId,
    'accountId'
  );
  const workspaceId = safeSegment(
    input.workspaceId,
    'workspaceId'
  );
  const documentId = safeSegment(
    input.documentId,
    'documentId'
  );
  const derivationVersion =
    safeSegment(
      input.derivationVersion,
      'derivationVersion'
    );
  const writeId = safeSegment(
    input.writeId,
    'writeId'
  );

  return (
    'accounts/' +
    accountId +
    '/workspaces/' +
    workspaceId +
    '/documents/' +
    documentId +
    '/derived/' +
    derivationVersion +
    '/' +
    writeId +
    '.json'
  );
}

interface StoredDocumentEnvelope {
  schemaVersion: 1;
  derivationVersion: string;
  document: KnowledgeDocument;
}

function serializeDocument(
  document: KnowledgeDocument,
  derivationVersion: string
): Buffer {
  const envelope: StoredDocumentEnvelope = {
    schemaVersion: 1,
    derivationVersion,
    document,
  };
  return Buffer.from(
    JSON.stringify(envelope),
    'utf8'
  );
}

function parseEnvelope(
  bytes: Buffer,
  record: DocumentDerivedPayloadRecord
): KnowledgeDocument {
  let parsed: any;
  try {
    parsed = JSON.parse(
      bytes.toString('utf8')
    );
  } catch {
    throw new Error(
      'Durable document payload is not valid JSON.'
    );
  }

  if (
    parsed?.schemaVersion !== 1 ||
    parsed?.derivationVersion !==
      record.derivationVersion ||
    !parsed?.document ||
    parsed.document.id !==
      record.documentId ||
    parsed.document.sourceVersionId !==
      record.sourceVersionId
  ) {
    throw new Error(
      'Durable document payload identity does not match relational metadata.'
    );
  }

  return parsed.document as KnowledgeDocument;
}

export class DocumentDerivedPayloadService {
  constructor(
    private readonly repository:
      DocumentDerivedPayloadRepository =
        postgresDocumentDerivedPayloadRepository,
    private readonly storageProvider: () =>
      SourceByteStorage =
        sourceByteStorageRuntime
  ) {}

  async persistDocument(input: {
    accountId: string;
    workspaceId: string;
    document: KnowledgeDocument;
    derivationVersion?: string;
  }): Promise<DurableDocumentPayload | null> {
    const sourceVersionId =
      input.document.sourceVersionId;
    if (!sourceVersionId) {
      return null;
    }

    const derivationVersion =
      input.derivationVersion ||
      DOCUMENT_DERIVATION_VERSION;
    const previous =
      await this.repository
        .getCurrentForDocument(
          input.accountId,
          input.workspaceId,
          input.document.id
        );

    const writeId = id('write_');
    const payloadKey =
      buildDerivedDocumentPayloadKey({
        accountId: input.accountId,
        workspaceId:
          input.workspaceId,
        documentId:
          input.document.id,
        derivationVersion,
        writeId,
      });

    const documentForStorage = {
      ...input.document,
      derivedPayloadId:
        previous?.id,
    };
    const bytes = serializeDocument(
      documentForStorage,
      derivationVersion
    );
    const payloadSha256 =
      sha256Bytes(bytes);
    const storage =
      this.storageProvider();

    const stored = await storage.put({
      key: payloadKey,
      bytes,
      contentType:
        'application/json',
      expectedSizeBytes:
        bytes.byteLength,
      expectedSha256:
        payloadSha256,
    });

    verifySourceIntegrity({
      bytes,
      expectedSizeBytes:
        stored.sizeBytes,
      expectedSha256:
        stored.sha256,
    });

    const recordId =
      previous?.id ||
      id('docpayload_');
    const now = Date.now();

    try {
      const record =
        await this.repository.upsert({
          id: recordId,
          accountId: input.accountId,
          workspaceId:
            input.workspaceId,
          documentId:
            input.document.id,
          sourceVersionId,
          derivationVersion,
          filename:
            input.document.filename,
          contentType:
            input.document.fileType,
          sourceSizeBytes:
            input.document.fileSize,
          processingStatus:
            input.document
              .processingStatus,
          errorMessage:
            input.document.errorMessage,
          pageCount:
            input.document.pageCount,
          payloadBackend:
            stored.backend,
          payloadKey:
            stored.key,
          payloadSizeBytes:
            stored.sizeBytes,
          payloadSha256:
            stored.sha256,
          isCurrent: true,
          createdAt:
            previous?.createdAt ??
            now,
          updatedAt: now,
        });

      const finalized: KnowledgeDocument = {
        ...input.document,
        derivedPayloadId:
          record.id,
      };

      if (
        previous &&
        previous.payloadKey !==
          record.payloadKey
      ) {
        await storage
          .delete(
            previous.payloadKey
          )
          .catch(() => undefined);
      }

      return {
        document: finalized,
        derivedPayloadId:
          record.id,
        derivationVersion:
          record.derivationVersion,
      };
    } catch (error) {
      await storage
        .delete(payloadKey)
        .catch(() => undefined);
      throw error;
    }
  }

  private async loadRecord(
    record: DocumentDerivedPayloadRecord
  ): Promise<KnowledgeDocument> {
    const storage =
      this.storageProvider();

    if (
      storage.backend !==
      record.payloadBackend
    ) {
      throw new Error(
        'Configured storage backend does not match durable document payload metadata.'
      );
    }

    const bytes = await storage.get(
      record.payloadKey
    );
    verifySourceIntegrity({
      bytes,
      expectedSizeBytes:
        record.payloadSizeBytes,
      expectedSha256:
        record.payloadSha256,
    });

    const document =
      parseEnvelope(bytes, record);

    return {
      ...document,
      derivedPayloadId:
        record.id,
    };
  }

  async listCurrentDocuments(input: {
    accountId: string;
    workspaceId: string;
  }): Promise<KnowledgeDocument[]> {
    const records =
      await this.repository
        .listCurrentForWorkspace(
          input.accountId,
          input.workspaceId
        );

    return Promise.all(
      records.map((record) =>
        this.loadRecord(record)
      )
    );
  }

  async loadDocumentsByRefs(input: {
    accountId: string;
    workspaceId: string;
    payloadIds: string[];
  }): Promise<KnowledgeDocument[]> {
    const documents:
      KnowledgeDocument[] = [];

    for (const payloadId of input.payloadIds) {
      const record =
        await this.repository.getById(
          input.accountId,
          input.workspaceId,
          payloadId
        );
      if (!record) {
        throw new Error(
          'Derived document payload reference was not found in the current account/workspace scope.'
        );
      }
      documents.push(
        await this.loadRecord(record)
      );
    }

    return documents;
  }

  async hasWorkspacePayloads(input: {
    accountId: string;
    workspaceId: string;
  }): Promise<boolean> {
    return this.repository
      .hasAnyForWorkspace(
        input.accountId,
        input.workspaceId
      );
  }

  async countCurrentDocuments(input: {
    accountId: string;
    workspaceId: string;
  }): Promise<number> {
    return this.repository
      .countCurrentForWorkspace(
        input.accountId,
        input.workspaceId
      );
  }

  async markDocumentInactive(input: {
    accountId: string;
    workspaceId: string;
    documentId: string;
  }): Promise<void> {
    await this.repository
      .markDocumentInactive(
        input.accountId,
        input.workspaceId,
        input.documentId
      );
  }

  async activatePayloadRefs(input: {
    accountId: string;
    workspaceId: string;
    payloadIds: string[];
  }): Promise<KnowledgeDocument[]> {
    await this.repository
      .setCurrentDocumentRefs(
        input.accountId,
        input.workspaceId,
        input.payloadIds
      );

    return this.loadDocumentsByRefs(
      input
    );
  }
}

export const documentDerivedPayloadService =
  new DocumentDerivedPayloadService();
