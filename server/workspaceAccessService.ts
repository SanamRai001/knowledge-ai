import {
  ChatMessage,
  EvaluationRun,
  EvaluationTestCase,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeVersion,
  SpecializedAI,
} from '../src/types.js';
import { kbStore } from './kbStore.js';

export class WorkspaceAccessError extends Error {
  public code: 'KNOWLEDGE_BASE_NOT_FOUND' | 'FORBIDDEN' | 'LAST_KB';
  public statusCode: number;

  constructor(
    code: 'KNOWLEDGE_BASE_NOT_FOUND' | 'FORBIDDEN' | 'LAST_KB',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Authoritative account-scoped access layer for normal Knowledge AI application flows.
 * A raw KB id is never sufficient authority by itself.
 */
export class WorkspaceAccessService {
  private activeKbByAccount = new Map<string, string>();

  private normalizeAccountId(accountId?: string): string {
    return accountId?.trim() || 'acc_default';
  }

  requireKB(accountId: string, kbId: string): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const kb = kbStore.getKB(kbId, normalizedAccountId);

    if (!kb) {
      throw new WorkspaceAccessError(
        'KNOWLEDGE_BASE_NOT_FOUND',
        404,
        'Knowledge base not found in the current account scope.'
      );
    }

    return kb;
  }

  listKBs(accountId: string) {
    return kbStore.listKBs(this.normalizeAccountId(accountId));
  }

  getActiveKB(accountId: string): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const rememberedId = this.activeKbByAccount.get(normalizedAccountId);
    if (rememberedId) {
      const remembered = kbStore.getKB(rememberedId, normalizedAccountId);
      if (remembered) return remembered;
      this.activeKbByAccount.delete(normalizedAccountId);
    }

    const kb = kbStore.getActiveKB(normalizedAccountId);
    this.activeKbByAccount.set(normalizedAccountId, kb.id);
    return kb;
  }

  createKB(accountId: string, name: string, description?: string): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const kb = kbStore.createKB(name, description, normalizedAccountId);
    this.activeKbByAccount.set(normalizedAccountId, kb.id);
    return kb;
  }

  updateKB(
    accountId: string,
    kbId: string,
    updates: { name?: string; description?: string }
  ): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    const updated = kbStore.updateKB(kbId, updates, normalizedAccountId);
    if (!updated) throw new WorkspaceAccessError('KNOWLEDGE_BASE_NOT_FOUND', 404, 'Knowledge base not found.');
    return updated;
  }

  deleteKB(accountId: string, kbId: string): void {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    const owned = kbStore.listKBs(normalizedAccountId);
    if (owned.length <= 1) {
      throw new WorkspaceAccessError('LAST_KB', 400, 'Cannot delete the last knowledge base in an account.');
    }

    const deleted = kbStore.deleteKB(kbId, normalizedAccountId);
    if (!deleted) throw new WorkspaceAccessError('KNOWLEDGE_BASE_NOT_FOUND', 404, 'Knowledge base not found.');

    if (this.activeKbByAccount.get(normalizedAccountId) === kbId) {
      this.activeKbByAccount.delete(normalizedAccountId);
    }
  }

  setActiveKB(accountId: string, kbId: string): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const kb = this.requireKB(normalizedAccountId, kbId);
    if (!kbStore.setActiveKB(kbId, normalizedAccountId)) {
      throw new WorkspaceAccessError('KNOWLEDGE_BASE_NOT_FOUND', 404, 'Knowledge base not found.');
    }
    this.activeKbByAccount.set(normalizedAccountId, kb.id);
    return kb;
  }

  getSpecializedAI(accountId: string, kbId: string): SpecializedAI {
    return this.requireKB(accountId, kbId).specializedAi;
  }

  updateSpecializedAI(accountId: string, kbId: string, updates: Partial<SpecializedAI>): SpecializedAI {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    const updated = kbStore.updateSpecializedAI(kbId, updates, normalizedAccountId);
    if (!updated) throw new WorkspaceAccessError('KNOWLEDGE_BASE_NOT_FOUND', 404, 'Knowledge base not found.');
    return updated;
  }

  createVersionSnapshot(accountId: string, kbId: string, label: string): KnowledgeVersion {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    return kbStore.createVersionSnapshot(kbId, label, normalizedAccountId);
  }

  rollbackToVersion(accountId: string, kbId: string, versionId: string): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    return kbStore.rollbackToVersion(kbId, versionId, normalizedAccountId);
  }

  addDocument(accountId: string, kbId: string, doc: KnowledgeDocument): void {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    kbStore.addDocument(kbId, doc, normalizedAccountId);
  }

  removeDocument(accountId: string, kbId: string, docId: string): boolean {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    return kbStore.removeDocument(kbId, docId, normalizedAccountId);
  }

  updateDocumentStatus(
    accountId: string,
    kbId: string,
    docId: string,
    status: KnowledgeDocument['processingStatus'],
    errorMessage?: string
  ): void {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    kbStore.updateDocumentStatus(kbId, docId, status, errorMessage, normalizedAccountId);
  }

  addChatMessage(accountId: string, kbId: string, message: ChatMessage): void {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    kbStore.addChatMessage(kbId, message, normalizedAccountId);
  }

  clearChat(accountId: string, kbId: string): void {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    kbStore.clearChat(kbId, normalizedAccountId);
  }

  addTestCase(
    accountId: string,
    kbId: string,
    testCase: Omit<EvaluationTestCase, 'id' | 'kbId'>
  ): EvaluationTestCase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    return kbStore.addTestCase(kbId, testCase, normalizedAccountId);
  }

  removeTestCase(accountId: string, kbId: string, testCaseId: string): boolean {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    return kbStore.removeTestCase(kbId, testCaseId, normalizedAccountId);
  }

  recordEvaluationRun(accountId: string, kbId: string, run: EvaluationRun): void {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    kbStore.recordEvaluationRun(kbId, run, normalizedAccountId);
  }

  getSpecializedAIById(accountId: string, aiId: string): { ai: SpecializedAI; kb: KnowledgeBase } | null {
    return kbStore.getSpecializedAIById(aiId, this.normalizeAccountId(accountId));
  }
}

export const workspaceAccessService = new WorkspaceAccessService();
