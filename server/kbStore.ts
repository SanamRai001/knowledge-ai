import fs from 'fs';
import path from 'path';
import {
  KnowledgeBase,
  KnowledgeDocument,
  ChatMessage,
  SpecializedAI,
  KnowledgeVersion,
  KnowledgeVersionDocumentRef,
  EvaluationTestCase,
  EvaluationRun,
} from '../src/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'knowledge_bases.json');
const DEFAULT_ACCOUNT_ID = 'acc_default';

function createDefaultSpecializedAI(kbId: string, kbName: string): SpecializedAI {
  return {
    id: 'ai_' + Math.random().toString(36).substring(2, 10),
    kbId,
    name: `${kbName} Specialist`,
    description: `Specialized AI grounded exclusively in the knowledge base "${kbName}".`,
    roleDefinition: `You are an expert domain specialist and advisor for ${kbName}. Provide rigorous, document-grounded answers based exclusively on the provided reference materials.`,
    systemPromptModifier: `Maintain strict accuracy and professional tone. Always prioritize safety standards, technical specifications, and explicit facts from the documents.`,
    responseStyle: 'detailed',
    citationMode: 'standard',
    strictRefusal: true,
    confidenceThreshold: 85,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createDefaultTestCases(kbId: string): EvaluationTestCase[] {
  return [
    {
      id: 'tc_1',
      kbId,
      category: 'grounded',
      question: 'What pressure does the machine operate at under nominal conditions?',
      expectedBehavior: 'Must cite exact grounded operating pressure (50 PSI) from equipment manual.',
      expectedKeywords: ['50 PSI', 'PSI'],
      mustRefuse: false,
    },
    {
      id: 'tc_2',
      kbId,
      category: 'grounded',
      question: 'Who is authorized and responsible for maintaining the system?',
      expectedBehavior: 'Must identify the Facility Chief Engineer and authorized technicians.',
      expectedKeywords: ['Chief Engineer', 'engineer'],
      mustRefuse: false,
    },
    {
      id: 'tc_3',
      kbId,
      category: 'cross-document',
      question: 'According to both the manual and the safety protocols, what checklist steps must be verified before initial startup?',
      expectedBehavior: 'Must synthesize items from both manual and safety documents (e.g. couplings, ventilation, eye protection, electrical grounding).',
      expectedKeywords: ['ventilation', 'couplings', 'inspection', 'safety'],
      mustRefuse: false,
    },
    {
      id: 'tc_4',
      kbId,
      category: 'negative-refusal',
      question: 'What is the current population of Nepal?',
      expectedBehavior: 'Must strictly refuse because general world knowledge is outside the uploaded documents.',
      mustRefuse: true,
    },
    {
      id: 'tc_5',
      kbId,
      category: 'negative-refusal',
      question: 'What was the third-quarter corporate EBITDA for 2024?',
      expectedBehavior: 'Must explicitly state that financial metrics are not present in the uploaded documents.',
      mustRefuse: true,
    },
  ];
}

export class KnowledgeBaseStore {
  private kbs: Map<string, KnowledgeBase> = new Map();
  private activeKbId: string = 'kb_default';

  private versionProjection(
    documents: KnowledgeDocument[]
  ): {
    documents: KnowledgeDocument[];
    documentRefs: KnowledgeVersionDocumentRef[];
  } {
    const durableRefs:
      KnowledgeVersionDocumentRef[] = [];
    const legacyDocuments:
      KnowledgeDocument[] = [];

    for (const document of documents) {
      if (
        document.sourceVersionId &&
        document.derivedPayloadId
      ) {
        durableRefs.push({
          documentId: document.id,
          filename: document.filename,
          sourceVersionId:
            document.sourceVersionId,
          derivedPayloadId:
            document.derivedPayloadId,
        });
      } else {
        legacyDocuments.push(
          JSON.parse(
            JSON.stringify(document)
          )
        );
      }
    }

    return {
      documents: legacyDocuments,
      documentRefs: durableRefs,
    };
  }

  constructor() {
    this.loadFromDisk();
  }

  private normalizeAccountId(accountId?: string): string {
    return accountId?.trim() || DEFAULT_ACCOUNT_ID;
  }

  private accountOf(kb: KnowledgeBase): string {
    return kb.accountId || DEFAULT_ACCOUNT_ID;
  }

  private ownedKB(id: string, accountId: string = DEFAULT_ACCOUNT_ID): KnowledgeBase | undefined {
    const kb = this.kbs.get(id);
    if (!kb) return undefined;
    return this.accountOf(kb) === this.normalizeAccountId(accountId) ? kb : undefined;
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.kbs)) {
          for (const kb of parsed.kbs) {
            this.ensurePhase2Schema(kb);
            this.kbs.set(kb.id, kb);
          }
          if (parsed.activeKbId && this.kbs.has(parsed.activeKbId)) {
            this.activeKbId = parsed.activeKbId;
          }
        }
      }
    } catch (err) {
      console.warn('Could not load persistent KB data, starting fresh:', err);
    }

    if (this.kbs.size === 0) {
      const defaultKbId = 'kb_default';
      const defaultKb: KnowledgeBase = {
        id: defaultKbId,
        accountId: DEFAULT_ACCOUNT_ID,
        name: 'Default Knowledge Base',
        description: 'Core repository for operational specifications, technical manuals, and safety protocols.',
        createdDate: Date.now(),
        updatedAt: Date.now(),
        currentVersion: 'v1.0',
        versions: [
          {
            id: 'ver_' + Math.random().toString(36).substring(2, 8),
            versionNumber: 1,
            versionTag: 'v1.0',
            label: 'Initial Knowledge Base setup',
            timestamp: Date.now(),
            documentCount: 0,
            totalPages: 0,
            documents: [],
            isCurrent: true,
          },
        ],
        documents: [],
        processingStatus: 'empty',
        chatHistory: [],
        specializedAi: createDefaultSpecializedAI(defaultKbId, 'Default Knowledge Base'),
        testCases: createDefaultTestCases(defaultKbId),
        evaluationRuns: [],
      };
      this.kbs.set(defaultKb.id, defaultKb);
      this.activeKbId = defaultKb.id;
      this.saveToDisk();
    }
  }

  private ensurePhase2Schema(kb: any): void {
    if (!kb.specializedAi) kb.specializedAi = createDefaultSpecializedAI(kb.id, kb.name);
    if (!kb.currentVersion) kb.currentVersion = 'v1.0';
    if (!Array.isArray(kb.versions) || kb.versions.length === 0) {
      kb.versions = [
        {
          id: 'ver_' + Math.random().toString(36).substring(2, 8),
          versionNumber: 1,
          versionTag: kb.currentVersion || 'v1.0',
          label: 'Baseline Version',
          timestamp: kb.createdDate || Date.now(),
          documentCount: kb.documents?.length || 0,
          totalPages: (kb.documents || []).reduce((acc: number, d: any) => acc + (d.pageCount || 0), 0),
          documents: kb.documents || [],
          isCurrent: true,
        },
      ];
    }
    if (!Array.isArray(kb.testCases)) kb.testCases = createDefaultTestCases(kb.id);
    if (!Array.isArray(kb.evaluationRuns)) kb.evaluationRuns = [];
    if (!kb.updatedAt) kb.updatedAt = kb.createdDate || Date.now();
    if (!kb.accountId) kb.accountId = DEFAULT_ACCOUNT_ID;
  }

  private saveToDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const data = {
        activeKbId: this.activeKbId,
        kbs: Array.from(this.kbs.values()),
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save KB store to disk:', err);
    }
  }

  /**
   * Returns the active KB only when it belongs to the requested account.
   * If the persisted/global active id belongs to another account, the first owned KB is used.
   */
  getActiveKB(accountId: string = DEFAULT_ACCOUNT_ID): KnowledgeBase {
    const normalized = this.normalizeAccountId(accountId);
    const active = this.kbs.get(this.activeKbId);
    if (active && this.accountOf(active) === normalized) return active;

    const owned = Array.from(this.kbs.values()).find((kb) => this.accountOf(kb) === normalized);
    if (!owned) throw new Error(`No knowledge base found for account ${normalized}`);
    return owned;
  }

  /** Account-scoped lookup used by user-facing code. */
  getKB(id: string, accountId: string = DEFAULT_ACCOUNT_ID): KnowledgeBase | undefined {
    return this.ownedKB(id, accountId);
  }

  /** Explicit internal lookup for migration/test tooling that already performs its own authorization. */
  getRawKB(id: string): KnowledgeBase | undefined {
    return this.kbs.get(id);
  }

  getKBByAiId(aiId: string, accountId?: string): KnowledgeBase | undefined {
    for (const kb of this.kbs.values()) {
      if (kb.specializedAi?.id !== aiId) continue;
      if (accountId && this.accountOf(kb) !== this.normalizeAccountId(accountId)) continue;
      return kb;
    }
    return undefined;
  }

  getSpecializedAIById(aiId: string, accountId?: string): { ai: SpecializedAI; kb: KnowledgeBase } | null {
    for (const kb of this.kbs.values()) {
      if (kb.specializedAi?.id !== aiId) continue;
      if (accountId && this.accountOf(kb) !== this.normalizeAccountId(accountId)) continue;
      return { ai: kb.specializedAi, kb };
    }
    return null;
  }

  listKBs(accountId: string = DEFAULT_ACCOUNT_ID): {
    id: string;
    name: string;
    description?: string;
    documentCount: number;
    currentVersion: string;
    aiName: string;
    createdDate: number;
    updatedAt: number;
    accountId?: string;
  }[] {
    const normalized = this.normalizeAccountId(accountId);
    return Array.from(this.kbs.values())
      .filter((kb) => this.accountOf(kb) === normalized)
      .map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        documentCount: kb.documents.length,
        currentVersion: kb.currentVersion,
        aiName: kb.specializedAi?.name || `${kb.name} Specialist`,
        createdDate: kb.createdDate,
        updatedAt: kb.updatedAt || kb.createdDate,
        accountId: this.accountOf(kb),
      }));
  }

  /** Internal-only enumeration. User-facing routes must use listKBs(accountId). */
  getAll(): KnowledgeBase[] {
    return Array.from(this.kbs.values());
  }

  createKB(
    name: string,
    description?: string,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): KnowledgeBase {
    const id = 'kb_' + Math.random().toString(36).substring(2, 10);
    return this.createKBWithId(id, name, description, accountId);
  }

  createKBWithId(
    id: string,
    name: string,
    description?: string,
    accountId: string = DEFAULT_ACCOUNT_ID,
    persist: boolean = true
  ): KnowledgeBase {
    const normalized = this.normalizeAccountId(accountId);
    const cleanId = id.trim();
    if (!cleanId) throw new Error('Knowledge base id is required.');
    if (this.kbs.has(cleanId)) {
      throw new Error(`Knowledge base ${cleanId} already exists.`);
    }

    const cleanName = name.trim() || `Knowledge Base ${this.kbs.size + 1}`;
    const now = Date.now();
    const newKb: KnowledgeBase = {
      id: cleanId,
      accountId: normalized,
      name: cleanName,
      description:
        description?.trim() ||
        `Custom domain knowledge repository for ${cleanName}.`,
      createdDate: now,
      updatedAt: now,
      currentVersion: 'v1.0',
      versions: [
        {
          id: 'ver_' + Math.random().toString(36).substring(2, 8),
          versionNumber: 1,
          versionTag: 'v1.0',
          label: 'Initial Knowledge Base snapshot',
          timestamp: now,
          documentCount: 0,
          totalPages: 0,
          documents: [],
          isCurrent: true,
        },
      ],
      documents: [],
      processingStatus: 'empty',
      chatHistory: [],
      specializedAi: createDefaultSpecializedAI(cleanId, cleanName),
      testCases: createDefaultTestCases(cleanId),
      evaluationRuns: [],
    };

    this.kbs.set(cleanId, newKb);
    this.activeKbId = cleanId;
    if (persist) {
      this.saveToDisk();
    }
    return structuredClone(newKb);
  }

  updateKB(
    id: string,
    updates: { name?: string; description?: string },
    accountId: string = DEFAULT_ACCOUNT_ID
  ): KnowledgeBase | null {
    const kb = this.ownedKB(id, accountId);
    if (!kb) return null;
    if (updates.name && updates.name.trim()) kb.name = updates.name.trim();
    if (updates.description !== undefined) kb.description = updates.description.trim();
    kb.updatedAt = Date.now();
    this.saveToDisk();
    return kb;
  }

  deleteKB(id: string, accountId: string = DEFAULT_ACCOUNT_ID): boolean {
    const normalized = this.normalizeAccountId(accountId);
    const kb = this.ownedKB(id, normalized);
    if (!kb) return false;

    const ownedCount = Array.from(this.kbs.values()).filter((item) => this.accountOf(item) === normalized).length;
    if (ownedCount <= 1) throw new Error('Cannot delete the last remaining knowledge base for this account.');

    const deleted = this.kbs.delete(id);
    if (deleted) {
      if (this.activeKbId === id) {
        const replacement = Array.from(this.kbs.values()).find((item) => this.accountOf(item) === normalized);
        this.activeKbId = replacement?.id || Array.from(this.kbs.keys())[0] || 'kb_default';
      }
      this.saveToDisk();
    }
    return deleted;
  }

  hydrateKnowledgeBase(
    kb: KnowledgeBase
  ): KnowledgeBase {
    const hydrated =
      structuredClone(kb);
    hydrated.accountId =
      hydrated.accountId ||
      DEFAULT_ACCOUNT_ID;
    this.kbs.set(
      hydrated.id,
      hydrated
    );

    try {
      this.saveToDisk();
    } catch (error) {
      console.warn(
        'Failed to persist non-authoritative workspace compatibility mirror:',
        error
      );
    }

    return structuredClone(
      hydrated
    );
  }

  forgetKnowledgeBase(
    id: string,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): void {
    const existing =
      this.ownedKB(id, accountId);
    if (!existing) return;
    this.kbs.delete(id);
  }

  setActiveKB(id: string, accountId: string = DEFAULT_ACCOUNT_ID): boolean {
    if (!this.ownedKB(id, accountId)) return false;
    this.activeKbId = id;
    this.saveToDisk();
    return true;
  }

  updateSpecializedAI(
    kbId: string,
    updates: Partial<SpecializedAI>,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): SpecializedAI | null {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) return null;
    kb.specializedAi = { ...kb.specializedAi, ...updates, updatedAt: Date.now() };
    kb.updatedAt = Date.now();
    this.saveToDisk();
    return kb.specializedAi;
  }

  createVersion(
    kbId: string,
    label: string,
    customTag?: string,
    makeActive: boolean = false,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): KnowledgeVersion {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) throw new Error(`Knowledge base ${kbId} not found`);

    const nextNum = (kb.versions?.length || 0) + 1;
    const versionTag = customTag || `v1.${nextNum - 1}`;
    const totalPages = kb.documents.reduce((acc, d) => acc + (d.pageCount || 0), 0);
    if (makeActive) kb.versions.forEach((v) => (v.isCurrent = false));

    const projection =
      this.versionProjection(
        kb.documents
      );
    const newVersion: KnowledgeVersion = {
      id:
        'ver_' +
        Math.random()
          .toString(36)
          .substring(2, 8),
      versionNumber: nextNum,
      versionTag,
      label:
        label.trim() ||
        `Version ${versionTag}`,
      timestamp: Date.now(),
      documentCount:
        kb.documents.length,
      totalPages,
      documents:
        projection.documents,
      documentRefs:
        projection.documentRefs,
      isCurrent: makeActive,
    };

    if (makeActive) kb.currentVersion = versionTag;
    kb.versions.unshift(newVersion);
    kb.updatedAt = Date.now();
    this.saveToDisk();
    return newVersion;
  }

  createVersionSnapshot(
    kbId: string,
    label: string,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): KnowledgeVersion {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) throw new Error(`Knowledge base ${kbId} not found`);

    const nextNum = (kb.versions?.length || 0) + 1;
    const versionTag = `v${nextNum}.0`;
    const totalPages = kb.documents.reduce((acc, d) => acc + (d.pageCount || 0), 0);
    kb.versions.forEach((v) => (v.isCurrent = false));

    const projection =
      this.versionProjection(
        kb.documents
      );
    const newVersion: KnowledgeVersion = {
      id:
        'ver_' +
        Math.random()
          .toString(36)
          .substring(2, 8),
      versionNumber: nextNum,
      versionTag,
      label:
        label.trim() ||
        `Snapshot ${versionTag}`,
      timestamp: Date.now(),
      documentCount:
        kb.documents.length,
      totalPages,
      documents:
        projection.documents,
      documentRefs:
        projection.documentRefs,
      isCurrent: true,
    };

    kb.versions.unshift(newVersion);
    kb.currentVersion = versionTag;
    kb.updatedAt = Date.now();
    this.saveToDisk();
    return newVersion;
  }

  rollbackToVersion(
    kbId: string,
    versionId: string,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): KnowledgeBase {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) throw new Error(`Knowledge base ${kbId} not found`);

    const targetVersion = kb.versions.find((v) => v.id === versionId || v.versionTag === versionId);
    if (!targetVersion) throw new Error(`Target version ${versionId} not found`);

    kb.documents = JSON.parse(
      JSON.stringify(
        targetVersion.documents || []
      )
    );
    kb.versions.forEach((v) => (v.isCurrent = v.id === targetVersion.id));
    kb.currentVersion = targetVersion.versionTag;
    kb.updatedAt = Date.now();
    this.updateKBStatus(kb);
    this.saveToDisk();
    return kb;
  }

  addDocument(
    kbId: string,
    doc: KnowledgeDocument,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): void {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) throw new Error(`Knowledge base ${kbId} not found`);

    kb.documents = kb.documents.filter((d) => d.id !== doc.id && d.filename !== doc.filename);
    kb.documents.push(doc);

    const currentVer =
      kb.versions?.find(
        (v) =>
          v.versionTag ===
          kb.currentVersion
      );
    if (
      currentVer &&
      (!currentVer.documents ||
        currentVer.documents.length === 0) &&
      (!currentVer.documentRefs ||
        currentVer.documentRefs.length === 0)
    ) {
      const projection =
        this.versionProjection(
          kb.documents
        );
      currentVer.documents =
        projection.documents;
      currentVer.documentRefs =
        projection.documentRefs;
      currentVer.documentCount =
        kb.documents.length;
      currentVer.totalPages =
        kb.documents.reduce(
          (acc, d) =>
            acc +
            (d.pageCount || 0),
          0
        );
    }

    kb.updatedAt = Date.now();
    this.updateKBStatus(kb);
    this.saveToDisk();
  }

  replaceDocuments(
    kbId: string,
    documents: KnowledgeDocument[],
    accountId: string = DEFAULT_ACCOUNT_ID
  ): KnowledgeBase {
    const kb =
      this.ownedKB(
        kbId,
        accountId
      );
    if (!kb) {
      throw new Error(
        `Knowledge base ${kbId} not found`
      );
    }

    kb.documents =
      JSON.parse(
        JSON.stringify(documents)
      );
    kb.updatedAt = Date.now();
    this.updateKBStatus(kb);
    this.saveToDisk();
    return structuredClone(kb);
  }

  applyVersionRollback(
    kbId: string,
    versionId: string,
    documents: KnowledgeDocument[],
    accountId: string = DEFAULT_ACCOUNT_ID
  ): KnowledgeBase {
    const kb =
      this.ownedKB(
        kbId,
        accountId
      );
    if (!kb) {
      throw new Error(
        `Knowledge base ${kbId} not found`
      );
    }

    const targetVersion =
      kb.versions.find(
        (version) =>
          version.id === versionId ||
          version.versionTag ===
            versionId
      );
    if (!targetVersion) {
      throw new Error(
        `Target version ${versionId} not found`
      );
    }

    kb.documents =
      JSON.parse(
        JSON.stringify(documents)
      );
    kb.versions.forEach(
      (version) =>
        (version.isCurrent =
          version.id ===
          targetVersion.id)
    );
    kb.currentVersion =
      targetVersion.versionTag;
    kb.updatedAt = Date.now();
    this.updateKBStatus(kb);
    this.saveToDisk();
    return structuredClone(kb);
  }

  removeDocument(
    kbId: string,
    docId: string,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): boolean {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) return false;
    const initialLen = kb.documents.length;
    kb.documents = kb.documents.filter((d) => d.id !== docId);
    kb.updatedAt = Date.now();
    this.updateKBStatus(kb);
    this.saveToDisk();
    return kb.documents.length < initialLen;
  }

  updateDocumentStatus(
    kbId: string,
    docId: string,
    status: KnowledgeDocument['processingStatus'],
    errorMessage?: string,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): void {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) return;
    const doc = kb.documents.find((d) => d.id === docId);
    if (doc) {
      doc.processingStatus = status;
      if (errorMessage) doc.errorMessage = errorMessage;
      kb.updatedAt = Date.now();
      this.updateKBStatus(kb);
      this.saveToDisk();
    }
  }

  addChatMessage(
    kbId: string,
    message: ChatMessage,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): void {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) return;
    kb.chatHistory.push(message);
    this.saveToDisk();
  }

  clearChat(kbId: string, accountId: string = DEFAULT_ACCOUNT_ID): void {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) return;
    kb.chatHistory = [];
    this.saveToDisk();
  }

  addTestCase(
    kbId: string,
    testCase: Omit<EvaluationTestCase, 'id' | 'kbId'>,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): EvaluationTestCase {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) throw new Error(`Knowledge base ${kbId} not found`);
    if (!kb.testCases) kb.testCases = [];

    const newCase: EvaluationTestCase = {
      id: 'tc_' + Math.random().toString(36).substring(2, 10),
      kbId,
      ...testCase,
    };
    kb.testCases.push(newCase);
    kb.updatedAt = Date.now();
    this.saveToDisk();
    return newCase;
  }

  removeTestCase(
    kbId: string,
    testCaseId: string,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): boolean {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb || !kb.testCases) return false;
    const initialLen = kb.testCases.length;
    kb.testCases = kb.testCases.filter((tc) => tc.id !== testCaseId);
    kb.updatedAt = Date.now();
    this.saveToDisk();
    return kb.testCases.length < initialLen;
  }

  recordEvaluationRun(
    kbId: string,
    run: EvaluationRun,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): void {
    const kb = this.ownedKB(kbId, accountId);
    if (!kb) return;
    if (!kb.evaluationRuns) kb.evaluationRuns = [];
    kb.evaluationRuns.unshift(run);
    if (kb.evaluationRuns.length > 25) kb.evaluationRuns = kb.evaluationRuns.slice(0, 25);
    kb.updatedAt = Date.now();
    this.saveToDisk();
  }

  private updateKBStatus(kb: KnowledgeBase): void {
    if (kb.documents.length === 0) {
      kb.processingStatus = 'empty';
    } else if (kb.documents.some((d) => d.processingStatus === 'processing' || d.processingStatus === 'pending')) {
      kb.processingStatus = 'processing';
    } else if (
      kb.documents.some((d) => d.processingStatus === 'failed') &&
      !kb.documents.some((d) => d.processingStatus === 'processed')
    ) {
      kb.processingStatus = 'error';
    } else {
      kb.processingStatus = 'ready';
    }
  }
}

export const kbStore = new KnowledgeBaseStore();
