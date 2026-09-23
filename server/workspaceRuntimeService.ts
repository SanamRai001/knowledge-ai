import crypto from 'crypto';
import type {
  ChatMessage,
  EvaluationRun,
  EvaluationTestCase,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeVersion,
  SpecializedAI,
} from '../src/types.js';
import { kbStore } from './kbStore.js';
import {
  WorkspaceAccessError,
  workspaceAccessService,
} from './workspaceAccessService.js';
import { postgresPersistenceEnabled } from './persistence/postgres.js';
import {
  postgresAccountRepository,
  postgresWorkspaceMetadataRepository,
} from './persistence/postgresRepositories.js';
import type { WorkspaceMetadata } from './persistence/types.js';
import { documentDerivedPayloadService } from './storage/documentDerivedPayloadService.js';
import { workspaceStructuredStateService } from './workspaceState/workspaceStructuredStateService.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(): string {
  return 'kb_' + crypto.randomBytes(8).toString('hex');
}

function processingStatusForDocuments(
  documents: KnowledgeDocument[]
): KnowledgeBase['processingStatus'] {
  if (documents.length === 0) {
    return 'empty';
  }
  if (
    documents.some(
      (doc) =>
        doc.processingStatus ===
          'processing' ||
        doc.processingStatus ===
          'pending'
    )
  ) {
    return 'processing';
  }
  if (
    documents.some(
      (doc) =>
        doc.processingStatus ===
        'failed'
    ) &&
    !documents.some(
      (doc) =>
        doc.processingStatus ===
        'processed'
    )
  ) {
    return 'error';
  }
  return 'ready';
}

function projectDocumentsForVersion(
  documents: KnowledgeDocument[]
): Pick<
  KnowledgeVersion,
  'documents' | 'documentRefs'
> {
  const legacyDocuments:
    KnowledgeDocument[] = [];
  const documentRefs:
    NonNullable<
      KnowledgeVersion['documentRefs']
    > = [];

  for (const document of documents) {
    if (
      document.sourceVersionId &&
      document.derivedPayloadId
    ) {
      documentRefs.push({
        documentId: document.id,
        filename: document.filename,
        sourceVersionId:
          document.sourceVersionId,
        derivedPayloadId:
          document.derivedPayloadId,
      });
    } else {
      legacyDocuments.push(
        clone(document)
      );
    }
  }

  return {
    documents: legacyDocuments,
    documentRefs,
  };
}

function metadataFromKb(kb: KnowledgeBase): WorkspaceMetadata {
  return {
    id: kb.id,
    accountId: kb.accountId || 'acc_default',
    name: kb.name,
    description: kb.description,
    processingStatus: kb.processingStatus,
    currentVersionTag: kb.currentVersion,
    createdAt: kb.createdDate,
    updatedAt: kb.updatedAt || kb.createdDate,
  };
}

export class WorkspaceRuntimeError extends Error {
  public readonly statusCode: number;
  public readonly code: 'WORKSPACE_PAYLOAD_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceRuntimeError';
    this.code = 'WORKSPACE_PAYLOAD_UNAVAILABLE';
    this.statusCode = 503;
  }
}

export class WorkspaceRuntimeService {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  private async materialize(
    metadata: WorkspaceMetadata
  ): Promise<KnowledgeBase> {
    const legacyPayload =
      kbStore.getKB(
        metadata.id,
        metadata.accountId
      );

    const structuredState =
      await workspaceStructuredStateService
        .ensureInitialized({
          accountId: metadata.accountId,
          workspaceId: metadata.id,
          legacyKnowledgeBase:
            legacyPayload,
        });

    if (!structuredState) {
      throw new WorkspaceRuntimeError(
        'Workspace metadata exists, but C7 structured state has not been initialized and no legacy compatibility payload is available for one-time migration.'
      );
    }

    const durableAuthority =
      await documentDerivedPayloadService
        .hasWorkspacePayloads({
          accountId: metadata.accountId,
          workspaceId: metadata.id,
        });

    const documents =
      durableAuthority
        ? await documentDerivedPayloadService
            .listCurrentDocuments({
              accountId:
                metadata.accountId,
              workspaceId:
                metadata.id,
            })
        : clone(
            legacyPayload?.documents ||
              []
          );

    const materialized:
      KnowledgeBase = {
      id: metadata.id,
      accountId: metadata.accountId,
      name: metadata.name,
      description:
        metadata.description,
      processingStatus:
        metadata.processingStatus,
      currentVersion:
        metadata.currentVersionTag,
      createdDate:
        metadata.createdAt,
      updatedAt:
        metadata.updatedAt,
      versions:
        clone(
          structuredState.versions
        ),
      documents,
      chatHistory:
        clone(
          structuredState.chatHistory
        ),
      specializedAi:
        clone(
          structuredState.specializedAi
        ),
      testCases:
        clone(
          structuredState.testCases
        ),
      evaluationRuns:
        clone(
          structuredState.evaluationRuns
        ),
    };

    kbStore.hydrateKnowledgeBase(
      materialized
    );

    return clone(materialized);
  }

  private async syncMetadata(kb: KnowledgeBase): Promise<void> {
    if (!this.usesPostgres()) return;
    const current =
      await postgresWorkspaceMetadataRepository.get(
        kb.accountId || 'acc_default',
        kb.id
      );
    if (!current) {
      throw new WorkspaceAccessError(
        'KNOWLEDGE_BASE_NOT_FOUND',
        404,
        'Workspace metadata not found in the current account scope.'
      );
    }
    const next = metadataFromKb(kb);
    await postgresWorkspaceMetadataRepository.update(
      next.accountId,
      next.id,
      {
        name: next.name,
        description: next.description,
        processingStatus: next.processingStatus,
        currentVersionTag: next.currentVersionTag,
        updatedAt: next.updatedAt,
      }
    );
  }

  public async listKBs(accountId: string) {
    if (!this.usesPostgres()) {
      return workspaceAccessService.listKBs(accountId);
    }

    const metadata =
      await postgresWorkspaceMetadataRepository.list(accountId);

    return Promise.all(
      metadata.map(async (item) => {
        const legacyPayload =
          kbStore.getKB(
            item.id,
            accountId
          );
        const structuredState =
          await workspaceStructuredStateService
            .ensureInitialized({
              accountId,
              workspaceId: item.id,
              legacyKnowledgeBase:
                legacyPayload,
            });
        const durableAuthority =
          await documentDerivedPayloadService
            .hasWorkspacePayloads({
              accountId,
              workspaceId: item.id,
            });
        const documentCount =
          durableAuthority
            ? await documentDerivedPayloadService
                .countCurrentDocuments({
                  accountId,
                  workspaceId: item.id,
                })
            : legacyPayload
                ?.documents.length ||
              0;

        return {
          id: item.id,
          name: item.name,
          description:
            item.description,
          documentCount,
          currentVersion:
            item.currentVersionTag,
          aiName:
            structuredState
              ?.specializedAi.name ||
            item.name +
              ' Specialist',
          createdDate:
            item.createdAt,
          updatedAt:
            item.updatedAt,
          accountId:
            item.accountId,
        };
      })
    );
  }

  public async requireKB(
    accountId: string,
    kbId: string
  ): Promise<KnowledgeBase> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.requireKB(accountId, kbId);
    }

    const metadata =
      await postgresWorkspaceMetadataRepository.get(
        accountId,
        kbId
      );
    if (!metadata) {
      throw new WorkspaceAccessError(
        'KNOWLEDGE_BASE_NOT_FOUND',
        404,
        'Knowledge base not found in the current account scope.'
      );
    }
    return this.materialize(metadata);
  }

  public async getActiveKB(
    accountId: string
  ): Promise<KnowledgeBase> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.getActiveKB(accountId);
    }

    let activeId =
      await postgresWorkspaceMetadataRepository.getActive(
        accountId
      );

    if (!activeId) {
      const owned =
        await postgresWorkspaceMetadataRepository.list(
          accountId
        );
      const fallback = owned[0];
      if (!fallback) {
        throw new WorkspaceAccessError(
          'KNOWLEDGE_BASE_NOT_FOUND',
          404,
          'No workspace exists in the current account scope.'
        );
      }
      activeId = fallback.id;
      await postgresWorkspaceMetadataRepository.setActive(
        accountId,
        activeId
      );
    }

    return this.requireKB(accountId, activeId);
  }

  public async createKB(
    accountId: string,
    name: string,
    description?: string
  ): Promise<KnowledgeBase> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.createKB(
        accountId,
        name,
        description
      );
    }

    await postgresAccountRepository.ensureAccount(accountId);
    const kbId = id();
    const cleanName =
      name.trim() || 'New Knowledge Base';
    const now = Date.now();

    await postgresWorkspaceMetadataRepository.create({
      id: kbId,
      accountId,
      name: cleanName,
      description:
        description?.trim() ||
        'Custom domain knowledge repository for ' +
          cleanName +
          '.',
      processingStatus: 'empty',
      currentVersionTag: 'v1.0',
      createdAt: now,
      updatedAt: now,
    });

    try {
      kbStore.createKBWithId(
        kbId,
        cleanName,
        description,
        accountId
      );
      await postgresWorkspaceMetadataRepository.setActive(
        accountId,
        kbId
      );
      return this.requireKB(accountId, kbId);
    } catch (error) {
      await postgresWorkspaceMetadataRepository
        .delete(accountId, kbId)
        .catch(() => undefined);
      throw error;
    }
  }

  public async updateKB(
    accountId: string,
    kbId: string,
    updates: { name?: string; description?: string }
  ): Promise<KnowledgeBase> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.updateKB(
        accountId,
        kbId,
        updates
      );
    }

    const current = await this.requireKB(accountId, kbId);
    const metadata =
      await postgresWorkspaceMetadataRepository.update(
        accountId,
        kbId,
        {
          name:
            updates.name?.trim() || current.name,
          description:
            updates.description !== undefined
              ? updates.description.trim()
              : current.description,
          updatedAt: Date.now(),
        }
      );

    kbStore.updateKB(kbId, updates, accountId);
    return this.materialize(metadata);
  }

  public async deleteKB(
    accountId: string,
    kbId: string
  ): Promise<void> {
    if (!this.usesPostgres()) {
      workspaceAccessService.deleteKB(accountId, kbId);
      return;
    }

    await this.requireKB(accountId, kbId);
    const owned =
      await postgresWorkspaceMetadataRepository.list(accountId);
    if (owned.length <= 1) {
      throw new WorkspaceAccessError(
        'LAST_KB',
        400,
        'Cannot delete the last knowledge base in an account.'
      );
    }

    await postgresWorkspaceMetadataRepository.delete(
      accountId,
      kbId
    );

    if (kbStore.getKB(kbId, accountId)) {
      kbStore.deleteKB(kbId, accountId);
    }
  }

  public async setActiveKB(
    accountId: string,
    kbId: string
  ): Promise<KnowledgeBase> {
    const kb = await this.requireKB(accountId, kbId);
    if (!this.usesPostgres()) {
      return workspaceAccessService.setActiveKB(
        accountId,
        kbId
      );
    }

    await postgresWorkspaceMetadataRepository.setActive(
      accountId,
      kbId
    );
    return kb;
  }

  public async getSpecializedAI(
    accountId: string,
    kbId: string
  ): Promise<SpecializedAI> {
    return (await this.requireKB(accountId, kbId))
      .specializedAi;
  }

  public async updateSpecializedAI(
    accountId: string,
    kbId: string,
    updates: Partial<SpecializedAI>
  ): Promise<SpecializedAI> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.updateSpecializedAI(
        accountId,
        kbId,
        updates
      );
    }

    await this.requireKB(accountId, kbId);
    const updated = kbStore.updateSpecializedAI(
      kbId,
      updates,
      accountId
    );
    if (!updated) {
      throw new WorkspaceAccessError(
        'KNOWLEDGE_BASE_NOT_FOUND',
        404,
        'Knowledge base not found.'
      );
    }
    await this.syncMetadata(
      kbStore.getKB(kbId, accountId)!
    );
    return updated;
  }

  public async createVersionSnapshot(
    accountId: string,
    kbId: string,
    label: string
  ): Promise<KnowledgeVersion> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.createVersionSnapshot(
        accountId,
        kbId,
        label
      );
    }
    await this.requireKB(accountId, kbId);
    const version = kbStore.createVersionSnapshot(
      kbId,
      label,
      accountId
    );
    await this.syncMetadata(
      kbStore.getKB(kbId, accountId)!
    );
    return version;
  }

  public async rollbackToVersion(
    accountId: string,
    kbId: string,
    versionId: string
  ): Promise<KnowledgeBase> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.rollbackToVersion(
        accountId,
        kbId,
        versionId
      );
    }
    const current =
      await this.requireKB(
        accountId,
        kbId
      );
    const target =
      current.versions.find(
        (version) =>
          version.id === versionId ||
          version.versionTag ===
            versionId
      );

    if (!target) {
      throw new WorkspaceAccessError(
        'KNOWLEDGE_BASE_NOT_FOUND',
        404,
        'Target knowledge version was not found.'
      );
    }

    if (
      target.documentRefs !==
      undefined
    ) {
      const durableDocuments =
        await documentDerivedPayloadService
          .activatePayloadRefs({
            accountId,
            workspaceId: kbId,
            payloadIds:
              target.documentRefs.map(
                (ref) =>
                  ref.derivedPayloadId
              ),
          });

      const kb =
        kbStore.applyVersionRollback(
          kbId,
          versionId,
          [
            ...(target.documents ||
              []),
            ...durableDocuments,
          ],
          accountId
        );
      await this.syncMetadata(kb);
      return this.requireKB(
        accountId,
        kbId
      );
    }

    const kb =
      kbStore.rollbackToVersion(
        kbId,
        versionId,
        accountId
      );
    await this.syncMetadata(kb);
    return this.requireKB(
      accountId,
      kbId
    );
  }

  public async addDocument(
    accountId: string,
    kbId: string,
    doc: KnowledgeDocument
  ): Promise<KnowledgeDocument> {
    if (!this.usesPostgres()) {
      workspaceAccessService.addDocument(
        accountId,
        kbId,
        doc
      );
      return doc;
    }

    const current =
      await this.requireKB(
        accountId,
        kbId
      );
    const replaced =
      current.documents.find(
        (item) =>
          item.filename ===
            doc.filename &&
          item.id !== doc.id
      );

    const persisted =
      await documentDerivedPayloadService
        .persistDocument({
          accountId,
          workspaceId: kbId,
          document: doc,
        });
    const durableDocument =
      persisted?.document || doc;

    if (
      replaced?.derivedPayloadId
    ) {
      await documentDerivedPayloadService
        .markDocumentInactive({
          accountId,
          workspaceId: kbId,
          documentId:
            replaced.id,
        });
    }

    kbStore.addDocument(
      kbId,
      durableDocument,
      accountId
    );
    await this.syncMetadata(
      kbStore.getKB(
        kbId,
        accountId
      )!
    );
    return durableDocument;
  }

  public async removeDocument(
    accountId: string,
    kbId: string,
    docId: string
  ): Promise<boolean> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.removeDocument(
        accountId,
        kbId,
        docId
      );
    }
    const current =
      await this.requireKB(
        accountId,
        kbId
      );
    const existing =
      current.documents.find(
        (document) =>
          document.id === docId
      );

    if (
      existing?.derivedPayloadId
    ) {
      await documentDerivedPayloadService
        .markDocumentInactive({
          accountId,
          workspaceId: kbId,
          documentId: docId,
        });
    }

    const removed = kbStore.removeDocument(
      kbId,
      docId,
      accountId
    );
    if (removed) {
      await this.syncMetadata(
        kbStore.getKB(kbId, accountId)!
      );
    }
    return removed;
  }

  public async updateDocumentStatus(
    accountId: string,
    kbId: string,
    docId: string,
    status: KnowledgeDocument['processingStatus'],
    errorMessage?: string
  ): Promise<void> {
    if (!this.usesPostgres()) {
      workspaceAccessService.updateDocumentStatus(
        accountId,
        kbId,
        docId,
        status,
        errorMessage
      );
      return;
    }
    const current =
      await this.requireKB(
        accountId,
        kbId
      );
    const document =
      current.documents.find(
        (item) =>
          item.id === docId
      );

    if (!document) {
      throw new WorkspaceAccessError(
        'KNOWLEDGE_BASE_NOT_FOUND',
        404,
        'Document was not found in the current workspace.'
      );
    }

    const updatedDocument:
      KnowledgeDocument = {
        ...document,
        processingStatus: status,
        errorMessage,
      };

    const persisted =
      await documentDerivedPayloadService
        .persistDocument({
          accountId,
          workspaceId: kbId,
          document:
            updatedDocument,
        });

    kbStore.addDocument(
      kbId,
      persisted?.document ||
        updatedDocument,
      accountId
    );
    await this.syncMetadata(
      kbStore.getKB(
        kbId,
        accountId
      )!
    );
  }

  public async addChatMessage(
    accountId: string,
    kbId: string,
    message: ChatMessage
  ): Promise<void> {
    if (!this.usesPostgres()) {
      workspaceAccessService.addChatMessage(
        accountId,
        kbId,
        message
      );
      return;
    }
    await this.requireKB(accountId, kbId);
    kbStore.addChatMessage(kbId, message, accountId);
  }

  public async clearChat(
    accountId: string,
    kbId: string
  ): Promise<void> {
    if (!this.usesPostgres()) {
      workspaceAccessService.clearChat(accountId, kbId);
      return;
    }
    await this.requireKB(accountId, kbId);
    kbStore.clearChat(kbId, accountId);
  }

  public async addTestCase(
    accountId: string,
    kbId: string,
    testCase: Omit<EvaluationTestCase, 'id' | 'kbId'>
  ): Promise<EvaluationTestCase> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.addTestCase(
        accountId,
        kbId,
        testCase
      );
    }
    await this.requireKB(accountId, kbId);
    const created = kbStore.addTestCase(
      kbId,
      testCase,
      accountId
    );
    await this.syncMetadata(
      kbStore.getKB(kbId, accountId)!
    );
    return created;
  }

  public async removeTestCase(
    accountId: string,
    kbId: string,
    testCaseId: string
  ): Promise<boolean> {
    if (!this.usesPostgres()) {
      return workspaceAccessService.removeTestCase(
        accountId,
        kbId,
        testCaseId
      );
    }
    await this.requireKB(accountId, kbId);
    const removed = kbStore.removeTestCase(
      kbId,
      testCaseId,
      accountId
    );
    if (removed) {
      await this.syncMetadata(
        kbStore.getKB(kbId, accountId)!
      );
    }
    return removed;
  }

  public async recordEvaluationRun(
    accountId: string,
    kbId: string,
    run: EvaluationRun
  ): Promise<void> {
    if (!this.usesPostgres()) {
      workspaceAccessService.recordEvaluationRun(
        accountId,
        kbId,
        run
      );
      return;
    }
    await this.requireKB(accountId, kbId);
    kbStore.recordEvaluationRun(kbId, run, accountId);
    await this.syncMetadata(
      kbStore.getKB(kbId, accountId)!
    );
  }
}

export const workspaceRuntimeService =
  new WorkspaceRuntimeService();
