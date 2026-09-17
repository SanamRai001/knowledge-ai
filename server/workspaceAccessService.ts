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
 *
 * Raw kbStore methods remain available to benchmark/migration tooling, but user-facing
 * routes should use this service so a KB id is never sufficient authority by itself.
 */
export class WorkspaceAccessService {
  private activeKbByAccount = new Map<string, string>();

  private normalizeAccountId(accountId?: string): string {
    return accountId?.trim() || 'acc_default';
  }

  private owns(kb: KnowledgeBase | undefined, accountId: string): kb is KnowledgeBase {
    if (!kb) return false;
    return (kb.accountId || 'acc_default') === this.normalizeAccountId(accountId);
  }

  requireKB(accountId: string, kbId: string): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const kb = kbStore.getKB(kbId);

    // Deliberately return the same not-found shape for missing and foreign resources
    // so raw ids cannot be used to enumerate another account's KBs.
    if (!this.owns(kb, normalizedAccountId)) {
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
      const remembered = kbStore.getKB(rememberedId);
      if (this.owns(remembered, normalizedAccountId)) return remembered;
      this.activeKbByAccount.delete(normalizedAccountId);
    }

    const firstOwned = kbStore
      .getAll()
      .find((kb) => (kb.accountId || 'acc_default') === normalizedAccountId);

    if (!firstOwned) {
      throw new WorkspaceAccessError(
        'KNOWLEDGE_BASE_NOT_FOUND',
        404,
        'No knowledge base exists in the current account scope.'
      );
    }

    this.activeKbByAccount.set(normalizedAccountId, firstOwned.id);
    return firstOwned;
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
    this.requireKB(accountId, kbId);
    const updated = kbStore.updateKB(kbId, updates);
    if (!updated) {
      throw new WorkspaceAccessError('KNOWLEDGE_BASE_NOT_FOUND', 404, 'Knowledge base not found.');
    }
    return updated;
  }

  deleteKB(accountId: string, kbId: string): void {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    this.requireKB(normalizedAccountId, kbId);
    const owned = kbStore.getAll().filter((kb) => (kb.accountId || 'acc_default') === normalizedAccountId);
    if (owned.length <= 1) {
      throw new WorkspaceAccessError('LAST_KB', 400, 'Cannot delete the last knowledge base in an account.');
    }

    const deleted = kbStore.deleteKB(kbId);
    if (!deleted) {
      throw new WorkspaceAccessError('KNOWLEDGE_BASE_NOT_FOUND', 404, 'Knowledge base not found.');
    }

    if (this.activeKbByAccount.get(normalizedAccountId) === kbId) {
      const replacement = kbStore
        .getAll()
        .find((kb) => (kb.accountId || 'acc_default') === normalizedAccountId);
      if (replacement) this.activeKbByAccount.set(normalizedAccountId, replacement.id);
      else this.activeKbByAccount.delete(normalizedAccountId);
    }
  }

  setActiveKB(accountId: string, kbId: string): KnowledgeBase {
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const kb = this.requireKB(normalizedAccountId, kbId);
    this.activeKbByAccount.set(normalizedAccountId, kb.id);
    return kb;
  }

  getSpecializedAI(accountId: string, kbId: string): SpecializedAI {
    return this.requireKB(accountId, kbId).specializedAi;
  }

  updateSpecializedAI(accountId: string, kbId: string, updates: Partial<SpecializedAI>): SpecializedAI {
    this.requireKB(accountId, kbId);
    const updated = kbStore.updateSpecializedAI(kbId, updates);
    if (!updated) {
      throw new WorkspaceAccessError('KNOWLEDGE_BASE_NOT_FOUND', 404, 'Knowledge base not found.');
    }
    return updated;
  }

  createVersionSnapshot(accountId: string, kbId: string, label: string): KnowledgeVersion {
    this.requireKB(accountId, kbId);
    return kbStore.createVersionSnapshot(kbId, label);
  }

  rollbackToVersion(accountId: string, kbId: string, versionId: string): KnowledgeBase {
    this.requireKB(accountId, kbId);
    return kbStore.rollbackToVersion(kbId, versionId);
  }

  addDocument(accountId: string, kbId: string, doc: KnowledgeDocument): void {
    this.requireKB(accountId, kbId);
    kbStore.addDocument(kbId, doc);
  }

  removeDocument(accountId: string, kbId: string, docId: string): boolean {
    this.requireKB(accountId, kbId);
    return kbStore.removeDocument(kbId, docId);
  }

  updateDocumentStatus(
    accountId: string,
    kbId: string,
    docId: string,
    status: KnowledgeDocument['processingStatus'],
    errorMessage?: string
  ): void {
    this.requireKB(accountId, kbId);
    kbStore.updateDocumentStatus(kbId, docId, status, errorMessage);
  }

  addChatMessage(accountId: string, kbId: string, message: ChatMessage): void {
    this.requireKB(accountId, kbId);
    kbStore.addChatMessage(kbId, message);
  }

  clearChat(accountId: string, kbId: string): void {
    this.requireKB(accountId, kbId);
    kbStore.clearChat(kbId);
  }

  addTestCase(
    accountId: string,
    kbId: string,
    testCase: Omit<EvaluationTestCase, 'id' | 'kbId'>
  ): EvaluationTestCase {
    this.requireKB(accountId, kbId);
    return kbStore.addTestCase(kbId, testCase);
  }

  removeTestCase(accountId: string, kbId: string, testCaseId: string): boolean {
    this.requireKB(accountId, kbId);
    return kbStore.removeTestCase(kbId, testCaseId);
  }

  recordEvaluationRun(accountId: string, kbId: string, run: EvaluationRun): void {
    this.requireKB(accountId, kbId);
    kbStore.recordEvaluationRun(kbId, run);
  }

  getSpecializedAIById(accountId: string, aiId: string): { ai: SpecializedAI; kb: KnowledgeBase } | null {
    const lookup = kbStore.getSpecializedAIById(aiId);
    if (!lookup) return null;
    if (!this.owns(lookup.kb, accountId)) return null;
    return lookup;
  }
}

export const workspaceAccessService = new WorkspaceAccessService();
