import crypto from 'crypto';
import { workspaceRuntimeService } from './workspaceRuntimeService.js';
import { answerQuestionWithGroundedDocs } from './geminiService.js';
import { ApiSource, Citation, ChatMessage, KnowledgeDocument, ExperienceSource } from '../src/types.js';
import { memoryRetrievalService } from './memoryRetrievalService.js';
import { memoryStore } from './memoryStore.js';
import { documentDerivedPayloadService } from './storage/documentDerivedPayloadService.js';

export class SpecializedAIError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'SpecializedAIError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface SpecializedAIAnswerParams {
  aiId: string;
  message: string;
  conversationId?: string;
  accountId?: string;
  versionTag?: string;
  chatHistory?: ChatMessage[];
  source?: ExperienceSource;
  requestId?: string;
}

export interface SpecializedAIAnswerResult {
  id: string;
  aiId: string;
  conversationId?: string;
  answer: string;
  grounded: boolean;
  refused: boolean;
  conflictDetected: boolean;
  knowledgeVersion: string;
  sources: ApiSource[];
  rawCitations: Citation[];
  engineUsed: string;
  memoryUsed: boolean;
  memoryCount: number;
  experienceRecorded: boolean;
  experienceId?: string;
  retrievalDebug?: any;
}

// In-memory conversation-to-account/ai mapping for tenant isolation validation
const conversationOwnership = new Map<string, { accountId: string; aiId: string }>();

export class SpecializedAIService {
  /**
   * Unified grounding & answering method used by Web UI, REST API, and Evaluation Runner.
   */
  async answer(params: SpecializedAIAnswerParams): Promise<SpecializedAIAnswerResult> {
    const { aiId, message, conversationId, accountId, versionTag, chatHistory = [], source = 'WEB', requestId } = params;

    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new SpecializedAIError('INVALID_REQUEST', 400, 'The message field is required.');
    }

    if (message.length > 5000) {
      throw new SpecializedAIError(
        'INVALID_REQUEST',
        400,
        'Message length exceeds maximum allowable limit (5000 characters).'
      );
    }

    // 1. Resolve Specialized AI and Knowledge Base.
    // PostgreSQL mode requires explicit account scope; file mode preserves
    // the legacy default-account development behavior.
    const effectiveAccountId =
      accountId ||
      (workspaceRuntimeService.usesPostgres()
        ? undefined
        : 'acc_default');

    if (!effectiveAccountId) {
      throw new SpecializedAIError(
        'FORBIDDEN',
        403,
        'Account-scoped identity is required to resolve a Specialized AI in production.'
      );
    }

    const lookup =
      await workspaceRuntimeService
        .getSpecializedAIById(
          effectiveAccountId,
          aiId
        );
    if (!lookup) {
      throw new SpecializedAIError(
        'AI_NOT_FOUND',
        404,
        `Specialized AI with id "${aiId}" was not found in the current account scope.`
      );
    }

    const { ai, kb } = lookup;
    const kbAccountId =
      kb.accountId ||
      effectiveAccountId;

    // 2. Tenant & Account Isolation
    if (kbAccountId !== effectiveAccountId) {
      throw new SpecializedAIError(
        'FORBIDDEN',
        403,
        'Access denied: You are not authorized to access this Specialized AI.'
      );
    }

    // 3. Conversation Scope Validation (if conversationId is provided)
    if (conversationId) {
      const existingConv = conversationOwnership.get(conversationId);
      if (existingConv) {
        if (existingConv.accountId !== effectiveAccountId) {
          throw new SpecializedAIError(
            'FORBIDDEN',
            403,
            'Access denied: Conversation belongs to another authorized scope.'
          );
        }
        if (existingConv.aiId !== aiId) {
          throw new SpecializedAIError(
            'FORBIDDEN',
            403,
            'Access denied: Conversation is tied to a different Specialized AI.'
          );
        }
      } else {
        // Register conversation ownership
        conversationOwnership.set(conversationId, {
          accountId: effectiveAccountId,
          aiId,
        });
      }
    }

    // 4. Resolve Knowledge Version and Documents
    let activeDocs: KnowledgeDocument[] = kb.documents || [];
    let resolvedVersion = kb.currentVersion || 'v1.0';

    if (versionTag && kb.versions && kb.versions.length > 0) {
      const targetedVersion = kb.versions.find((v) => v.versionTag === versionTag || v.id === versionTag);
      if (targetedVersion) {
        if (
          targetedVersion.documentRefs !==
          undefined
        ) {
          const durableDocuments =
            targetedVersion.documentRefs
              .length > 0
              ? await documentDerivedPayloadService
                  .loadDocumentsByRefs({
                    accountId:
                      effectiveAccountId,
                    workspaceId: kb.id,
                    payloadIds:
                      targetedVersion.documentRefs.map(
                        (ref) =>
                          ref.derivedPayloadId
                      ),
                  })
              : [];
          activeDocs = [
            ...(targetedVersion.documents ||
              []),
            ...durableDocuments,
          ];
        } else {
          activeDocs =
            targetedVersion.documents &&
            targetedVersion.documents.length >
              0
              ? targetedVersion.documents
              : kb.documents || [];
        }
        resolvedVersion =
          targetedVersion.versionTag;
      }
    }

    // 5. Readiness & Document Guards
    if (activeDocs.length === 0) {
      throw new SpecializedAIError(
        'KNOWLEDGE_NOT_READY',
        400,
        'No documents in knowledge base. Please upload and process documents before querying.'
      );
    }

    const hasProcessing = activeDocs.some(
      (d) => d.processingStatus === 'processing' || d.processingStatus === 'pending'
    );
    if (hasProcessing) {
      throw new SpecializedAIError(
        'KNOWLEDGE_NOT_READY',
        400,
        'Documents in this knowledge base are still processing. Please wait until processing completes.'
      );
    }

    // 6. Retrieve Eligible Verified Memory (Phase 4 Governed Memory Subsystem)
    const retrievedMemory = memoryRetrievalService.retrieveRelevantMemories({
      query: message.trim(),
      aiId: ai.id,
      accountId: effectiveAccountId,
      specializedAi: ai,
      documents: activeDocs,
      includeCandidates: source === 'SANDBOX',
    });

    // 7. Execute Grounded AI Engine (with AI Persona, response style, strict refusal guards & verified memory)
    const groundedResult = await answerQuestionWithGroundedDocs(
      message.trim(),
      activeDocs,
      chatHistory,
      ai,
      retrievedMemory.memoryContextString,
      effectiveAccountId,
      kb.id,
      requestId
    );

    // 8. Refusal & Grounding Semantics
    const answerText = groundedResult.answer || '';
    const textLower = answerText.toLowerCase();

    // Machine-readable negative refusal detection
    const isExplicitRefusal =
      !groundedResult.isFoundInDocuments ||
      textLower.includes("couldn't find enough information") ||
      textLower.includes("could not find enough information") ||
      textLower.includes('not found in the uploaded documents') ||
      textLower.includes('outside the scope of the provided documents');

    const isGrounded = groundedResult.isFoundInDocuments && !isExplicitRefusal;
    const isRefused = isExplicitRefusal;

    // 9. Conflict Detection
    const hasConflict =
      retrievedMemory.conflictDetected ||
      textLower.includes('conflict') ||
      textLower.includes('contradiction') ||
      textLower.includes('discrepancy between documents');

    // 10. Format structured sources (Authoritative knowledge vs verified memory)
    const knowledgeSources: ApiSource[] = isRefused
      ? []
      : groundedResult.sources.map((src) => ({
          document_id: src.documentId,
          document_name: src.documentName,
          page: typeof src.pageNumber === 'number' ? src.pageNumber : parseInt(String(src.pageNumber), 10) || undefined,
          section: src.sectionHeading || undefined,
          excerpt: src.snippet || undefined,
          source_type: 'knowledge',
        }));

    const memoryUsed = isGrounded && retrievedMemory.memories.length > 0;
    const allSources: ApiSource[] = isRefused
      ? []
      : [...knowledgeSources, ...(memoryUsed ? retrievedMemory.memorySources : [])];

    const allRawCitations: Citation[] = isRefused
      ? []
      : [...groundedResult.sources, ...(memoryUsed ? retrievedMemory.rawMemoryCitations : [])];

    const responseId = 'res_' + crypto.randomBytes(8).toString('hex');

    // 11. Governed Experience Recording (Phase 4)
    let recordedExpId: string | undefined;
    try {
      const exp = memoryStore.recordExperience({
        accountId: effectiveAccountId,
        aiId: ai.id,
        knowledgeVersionId: resolvedVersion,
        conversationId,
        source,
        situation: message.substring(0, 500),
        action: answerText.substring(0, 500),
        outcome: isRefused ? 'REFUSED_OUT_OF_DOMAIN' : (hasConflict ? 'CONFLICT_DETECTED' : 'ANSWERED_GROUNDED'),
        expectedOutcome: 'Grounded document response with verified memory integration.',
        actualOutcome: isGrounded ? 'Grounded response generated.' : 'Negative refusal triggered.',
        evidence: allSources.map((s) => s.document_name).slice(0, 5),
        status: 'RECORDED',
        requestId,
      });
      recordedExpId = exp.id;
    } catch (expErr) {
      console.warn('Failed to record experience:', expErr);
    }

    return {
      id: responseId,
      aiId: ai.id,
      conversationId,
      answer: answerText,
      grounded: isGrounded,
      refused: isRefused,
      conflictDetected: hasConflict,
      knowledgeVersion: resolvedVersion,
      sources: allSources,
      rawCitations: allRawCitations,
      engineUsed: groundedResult.engineUsed,
      memoryUsed,
      memoryCount: memoryUsed ? retrievedMemory.memories.length : 0,
      experienceRecorded: Boolean(recordedExpId),
      experienceId: recordedExpId,
      retrievalDebug: groundedResult.diagnosticTrace,
    };
  }
}

export const specializedAIService = new SpecializedAIService();
