import express from 'express';
import path from 'path';
import multer from 'multer';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { kbStore } from './server/kbStore.js';
import { parsePdfBuffer, createKnowledgeDocument } from './server/documentService.js';
import { generateSampleDocs } from './server/sampleDocs.js';
import { answerQuestionWithGroundedDocs } from './server/geminiService.js';
import { runFullTestSuite } from './server/testRunner.js';
import { runEvaluationSuite } from './server/evaluationService.js';
import { apiKeyStore } from './server/apiKeyStore.js';
import { apiKeyRuntimeService } from './server/apiKeyRuntimeService.js';
import { specializedAIService, SpecializedAIError } from './server/specializedAIService.js';
import { memoryStore } from './server/memoryStore.js';
import { memoryRetrievalService } from './server/memoryRetrievalService.js';
import { sandboxService } from './server/sandboxService.js';
import { learningService } from './server/learningService.js';
import { apiManagementService } from './server/mediator/apiManagementService.js';
import { realProviderAdapter } from './server/mediator/realProviderAdapter.js';
import { systemReadinessService } from './server/mediator/systemReadinessService.js';
import { getProductionLimitations } from './server/mediator/limitationsRegister.js';
import { ChatMessage, ApiChatRequest, ApiChatResponse, ApiErrorResponse, MemoryStatus, MemoryType, ExperienceSource } from './src/types.js';
import { workspaceRouter } from './server/workspaceRouter.js';
import { datasetRouter } from './server/datasets/datasetRouter.js';
import { datasetRuntimePersistence } from './server/datasets/datasetRuntimePersistence.js';
import { queryRouter } from './server/querying/queryRouter.js';
import { discoveryRouter } from './server/discovery/discoveryRouter.js';
import { companyKnowledgeRouter } from './server/companyKnowledge/companyKnowledgeRouter.js';
import { actionRouter } from './server/actions/actionRouter.js';
import { watchRouter } from './server/watch/watchRouter.js';
import { backgroundRuntime } from './server/runtime/backgroundRuntime.js';
import {
  assertWebEntrypointRole,
  resolveProcessRole,
} from './server/runtime/processRole.js';
import { integrationRouter } from './server/integrations/integrationRouter.js';
import { automationRouter } from './server/automation/automationRouter.js';
import { platformApiRouter } from './server/platform/platformApiRouter.js';
import { platformManagementRouter } from './server/platform/platformManagementRouter.js';
import { legacyDeveloperRouteClosureRouter } from './server/platform/legacyDeveloperRouteClosureRouter.js';
import { legacyPrototypeRouteQuarantineMiddleware } from './server/legacyRouteQuarantine.js';
import { authRouter } from './server/identity/authRouter.js';
import crypto from 'crypto';
import {
  operationalHttpMiddleware,
} from './server/operations/httpObservabilityMiddleware.js';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(
  operationalHttpMiddleware
);

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer memory storage for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf' || file.mimetype === 'application/x-pdf';
    const isPdfExt = file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdfMime || isPdfExt) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: "${file.originalname}". Only PDF documents are supported.`));
    }
  },
});

// B2B1 human authentication surface. Product routers are intentionally not
// cut over to HUMAN_SESSION until B2B2/B2C.
app.use('/api/auth', authRouter);

// Authoritative account-scoped workspace API. This router is mounted before
// the legacy handlers below so normal /api/kb/* traffic cannot bypass
// request identity and workspace ownership checks.
app.use('/api/kb', workspaceRouter);
app.use('/api/datasets', datasetRouter);
app.use('/api/query', queryRouter);
app.use('/api/insights', discoveryRouter);
app.use('/api/company-knowledge', companyKnowledgeRouter);
app.use('/api/actions', actionRouter);
app.use('/api/watch', watchRouter);
app.use('/api/integrations', integrationRouter);
app.use('/api/automation', automationRouter);
app.use('/api/platform/v1', platformApiRouter);
app.use('/api/platform-management', platformManagementRouter);
app.use('/api/v1/developer', legacyDeveloperRouteClosureRouter);

// Production quarantine boundary for inline legacy/prototype routes below.
// Modern routers and the explicit retired developer route get first chance;
// any matching legacy family that reaches this point is blocked unless
// explicit non-production compatibility is enabled.
app.use(legacyPrototypeRouteQuarantineMiddleware);

// --- API ROUTES ---

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 2. Get active Knowledge Base
app.get('/api/kb', (req, res) => {
  try {
    const activeKb = kbStore.getActiveKB();
    res.json({
      kb: activeKb,
      allKbs: kbStore.listKBs(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve knowledge base' });
  }
});

// 3. Create new Knowledge Base
app.post('/api/kb/new', (req, res) => {
  try {
    const name = req.body.name || 'New Knowledge Base';
    const description = req.body.description;
    const newKb = kbStore.createKB(name, description);
    res.json({
      message: 'Created new knowledge base',
      kb: newKb,
      allKbs: kbStore.listKBs(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create knowledge base' });
  }
});

// 3b. Update Knowledge Base Details
app.patch('/api/kb/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const updated = kbStore.updateKB(id, { name, description });
    if (!updated) return res.status(404).json({ error: 'Knowledge base not found' });
    res.json({
      message: 'Knowledge base updated',
      kb: updated,
      allKbs: kbStore.listKBs(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update knowledge base' });
  }
});

// 3c. Delete Knowledge Base
app.delete('/api/kb/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = kbStore.deleteKB(id);
    if (!deleted) return res.status(404).json({ error: 'Knowledge base not found' });
    res.json({
      message: 'Knowledge base deleted',
      activeKb: kbStore.getActiveKB(),
      allKbs: kbStore.listKBs(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete knowledge base' });
  }
});

// 4. Switch active Knowledge Base
app.post('/api/kb/switch', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing knowledge base id' });
    const success = kbStore.setActiveKB(id);
    if (!success) return res.status(404).json({ error: 'Knowledge base not found' });
    res.json({
      message: 'Active knowledge base switched',
      kb: kbStore.getActiveKB(),
      allKbs: kbStore.listKBs(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to switch knowledge base' });
  }
});

// --- SPECIALIZED AI CONFIGURATION ROUTES ---

// Get Specialized AI configuration
app.get('/api/kb/:id/ai', (req, res) => {
  try {
    const { id } = req.params;
    const kb = kbStore.getKB(id);
    if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
    res.json({ specializedAi: kb.specializedAi });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get Specialized AI configuration' });
  }
});

// Update Specialized AI configuration
app.put('/api/kb/:id/ai', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updatedAi = kbStore.updateSpecializedAI(id, updates);
    if (!updatedAi) return res.status(404).json({ error: 'Knowledge base not found' });
    res.json({
      message: 'Specialized AI configuration updated',
      specializedAi: updatedAi,
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update Specialized AI configuration' });
  }
});

// --- KNOWLEDGE VERSIONING ROUTES ---

// List versions for KB
app.get('/api/kb/:id/versions', (req, res) => {
  try {
    const { id } = req.params;
    const kb = kbStore.getKB(id);
    if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
    res.json({
      currentVersion: kb.currentVersion,
      versions: kb.versions || [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get versions' });
  }
});

// Create new version snapshot
app.post('/api/kb/:id/versions/create', (req, res) => {
  try {
    const { id } = req.params;
    const label = req.body.label || 'New Version Snapshot';
    const newVersion = kbStore.createVersionSnapshot(id, label);
    res.json({
      message: `Created snapshot version ${newVersion.versionTag}`,
      version: newVersion,
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create version snapshot' });
  }
});

// Rollback to a specific version
app.post('/api/kb/:id/versions/:versionId/rollback', (req, res) => {
  try {
    const { id, versionId } = req.params;
    const restoredKb = kbStore.rollbackToVersion(id, versionId);
    res.json({
      message: `Knowledge base rolled back to version ${restoredKb.currentVersion}`,
      kb: restoredKb,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to rollback version' });
  }
});

// --- EVALUATION & TEST SUITE ROUTES ---

// Run automated evaluation suite
app.post('/api/kb/:id/evaluations/run', async (req, res) => {
  try {
    const { id } = req.params;
    const runResult = await runEvaluationSuite(id);
    res.json({
      message: 'Evaluation suite completed',
      run: runResult,
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    console.error('Evaluation run error:', err);
    res.status(500).json({ error: err.message || 'Failed to execute evaluation suite' });
  }
});

// Get evaluation history
app.get('/api/kb/:id/evaluations/history', (req, res) => {
  try {
    const { id } = req.params;
    const kb = kbStore.getKB(id);
    if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
    res.json({
      evaluationRuns: kb.evaluationRuns || [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get evaluation history' });
  }
});

// Add custom evaluation test case
app.post('/api/kb/:id/evaluations/test-cases', (req, res) => {
  try {
    const { id } = req.params;
    const { category, question, expectedBehavior, expectedKeywords, mustRefuse } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }
    const createdCase = kbStore.addTestCase(id, {
      category: category || 'grounded',
      question: question.trim(),
      expectedBehavior: expectedBehavior?.trim() || 'Verified against uploaded documents',
      expectedKeywords: Array.isArray(expectedKeywords) ? expectedKeywords : undefined,
      mustRefuse: Boolean(mustRefuse),
    });
    res.json({
      message: 'Evaluation test case added',
      testCase: createdCase,
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to add test case' });
  }
});

// Delete custom evaluation test case
app.delete('/api/kb/:id/evaluations/test-cases/:tcId', (req, res) => {
  try {
    const { id, tcId } = req.params;
    const deleted = kbStore.removeTestCase(id, tcId);
    res.json({
      message: deleted ? 'Test case removed' : 'Test case not found',
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete test case' });
  }
});

// 5. Upload PDF documents
app.post('/api/kb/documents/upload', upload.array('files', 10), async (req, res) => {
  try {
    const activeKb = kbStore.getActiveKB();
    const files = (req.files as Express.Multer.File[]) || [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No PDF files were provided in the upload request.' });
    }

    const processedDocs = [];
    const errors = [];

    for (const file of files) {
      try {
        const { pageCount, pages, summary } = await parsePdfBuffer(file.originalname, file.buffer);
        const doc = createKnowledgeDocument(file.originalname, file.buffer, pageCount, pages, summary);
        kbStore.addDocument(activeKb.id, doc);
        processedDocs.push(doc);
      } catch (docErr: any) {
        errors.push({ filename: file.originalname, error: docErr.message });
      }
    }

    res.json({
      message: `Processed ${processedDocs.length} document(s).`,
      processed: processedDocs,
      errors: errors.length > 0 ? errors : undefined,
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    console.error('Upload handler error:', err);
    res.status(500).json({ error: err.message || 'Failed to process document upload' });
  }
});

// 6. Load sample documents for instant testing
app.post('/api/kb/documents/sample', async (req, res) => {
  try {
    const activeKb = kbStore.getActiveKB();
    const samples = await generateSampleDocs();

    const addedDocs = [];
    for (const s of samples) {
      const { pageCount, pages, summary } = await parsePdfBuffer(s.filename, s.buffer);
      const doc = createKnowledgeDocument(s.filename, s.buffer, pageCount, pages, summary);
      kbStore.addDocument(activeKb.id, doc);
      addedDocs.push(doc);
    }

    res.json({
      message: 'Sample documents loaded successfully',
      addedCount: addedDocs.length,
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    console.error('Sample docs error:', err);
    res.status(500).json({ error: err.message || 'Failed to load sample documents' });
  }
});

// 7. Remove a document
app.delete('/api/kb/documents/:id', (req, res) => {
  try {
    const { id } = req.params;
    const activeKb = kbStore.getActiveKB();
    const removed = kbStore.removeDocument(activeKb.id, id);
    if (!removed) {
      return res.status(404).json({ error: `Document with ID ${id} was not found in active knowledge base.` });
    }
    res.json({
      message: 'Document removed successfully',
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to remove document' });
  }
});

// 8. Retry a failed document
app.post('/api/kb/documents/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    const activeKb = kbStore.getActiveKB();
    const doc = activeKb.documents.find((d) => d.id === id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    kbStore.updateDocumentStatus(activeKb.id, id, 'processed');
    res.json({
      message: 'Document status reset',
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retry document' });
  }
});

// 9. Ask a question (Document-grounded Chat with Specialized AI - Shared Core Service)
app.post('/api/kb/chat', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Question cannot be empty' });
    }

    const activeKb = kbStore.getActiveKB();

    if (activeKb.documents.length === 0) {
      return res.status(400).json({
        error: 'No documents in knowledge base. Please upload one or more PDFs before asking questions.',
      });
    }

    if (activeKb.documents.some((d) => d.processingStatus === 'processing' || d.processingStatus === 'pending')) {
      return res.status(400).json({
        error: 'Your documents are still processing. Please wait until your documents finish processing.',
      });
    }

    // Add user message to history
    const userMessage: ChatMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 10),
      role: 'user',
      content: question.trim(),
      timestamp: Date.now(),
    };
    kbStore.addChatMessage(activeKb.id, userMessage);

    // Call unified Specialized AI service
    const result = await specializedAIService.answer({
      aiId: activeKb.specializedAi.id,
      message: question.trim(),
      accountId: activeKb.accountId || 'acc_default',
      chatHistory: activeKb.chatHistory,
      source: 'WEB',
    });

    // Add assistant message to history
    const assistantMessage: ChatMessage = {
      id: result.id,
      role: 'assistant',
      content: result.answer,
      timestamp: Date.now(),
      citations: result.rawCitations,
      isFoundInDocuments: result.grounded,
      memoryUsed: result.memoryUsed,
      memoryCount: result.memoryCount,
      experienceRecorded: result.experienceRecorded,
      experienceId: result.experienceId,
    };
    kbStore.addChatMessage(activeKb.id, assistantMessage);

    res.json({
      message: assistantMessage,
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    console.error('Chat error:', err.message);
    const statusCode = err instanceof SpecializedAIError ? err.statusCode : 500;
    res.status(statusCode).json({ error: err.message || 'Failed to generate grounded answer' });
  }
});

// 10. Clear chat conversation
app.delete('/api/kb/chat', (req, res) => {
  try {
    const activeKb = kbStore.getActiveKB();
    kbStore.clearChat(activeKb.id);
    res.json({
      message: 'Conversation cleared',
      kb: kbStore.getActiveKB(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to clear conversation' });
  }
});

// 11. Run Phase 1 Acceptance Test suite
app.post('/api/kb/run-tests', async (req, res) => {
  try {
    const testResults = await runFullTestSuite();
    res.json({
      results: testResults,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error('Test suite error:', err);
    res.status(500).json({ error: err.message || 'Test suite execution failed' });
  }
});

// ==========================================
// --- PHASE 3: REST API (v1) ENDPOINTS ---
// ==========================================

// Helper: Extract & validate Bearer token
function authenticateApiRequest(req: express.Request, res: express.Response, requestId: string): any {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing API key. Provide token in "Authorization: Bearer <API_KEY>" header.',
      },
      request_id: requestId,
    });
    return null;
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid Authorization header format. Expected "Bearer <API_KEY>".',
      },
      request_id: requestId,
    });
    return null;
  }

  const rawKey = parts[1];
  const validation = apiKeyStore.validateApiKey(rawKey);
  if (!validation.valid || !validation.apiKey) {
    const isRevoked = validation.error?.includes('revoked');
    const statusCode = isRevoked ? 403 : 401;
    const errorCode = isRevoked ? 'FORBIDDEN' : 'UNAUTHORIZED';
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: validation.error || 'Invalid API key.',
      },
      request_id: requestId,
    });
    return null;
  }

  // Check rate limit: 100 requests per minute
  const rateLimit = apiKeyStore.checkRateLimit(validation.apiKey.id, 100);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.resetSeconds));
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded. Please try again later.',
      },
      request_id: requestId,
    });
    return null;
  }

  apiKeyRuntimeService.noteValidatedKey(validation.apiKey);
  return validation.apiKey;
}

// 1. Health Endpoint
app.get('/api/v1/health', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);
  res.json({
    status: 'ok',
    version: 'v1',
    request_id: requestId,
  });
});

// 2. Primary Chat Endpoint: POST /api/v1/chat
app.post('/api/v1/chat', async (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);
  const startTime = Date.now();

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id, message, conversation_id } = req.body || {};

  if (!ai_id || typeof ai_id !== 'string' || !ai_id.trim()) {
    await apiKeyRuntimeService.recordUsage({
      requestId,
      apiKeyId: apiKey.id,
      accountId: apiKey.accountId,
      aiId: ai_id || 'unknown',
      endpoint: '/api/v1/chat',
      timestamp: Date.now(),
      status: 400,
      latencyMs: Date.now() - startTime,
      refused: false,
      grounded: false,
      errorCode: 'INVALID_REQUEST',
    });
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The ai_id field is required.',
      },
      request_id: requestId,
    });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    await apiKeyRuntimeService.recordUsage({
      requestId,
      apiKeyId: apiKey.id,
      accountId: apiKey.accountId,
      aiId: ai_id.trim(),
      endpoint: '/api/v1/chat',
      timestamp: Date.now(),
      status: 400,
      latencyMs: Date.now() - startTime,
      refused: false,
      grounded: false,
      errorCode: 'INVALID_REQUEST',
    });
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The message field is required.',
      },
      request_id: requestId,
    });
  }

  try {
    const result = await specializedAIService.answer({
      aiId: ai_id.trim(),
      message: message.trim(),
      conversationId: conversation_id ? String(conversation_id).trim() : undefined,
      accountId: apiKey.accountId,
      source: 'API',
      requestId,
    });

    const latencyMs = Date.now() - startTime;

    // Record usage
    await apiKeyRuntimeService.recordUsage({
      requestId,
      apiKeyId: apiKey.id,
      accountId: apiKey.accountId,
      aiId: result.aiId,
      endpoint: '/api/v1/chat',
      timestamp: Date.now(),
      status: 200,
      latencyMs,
      refused: result.refused,
      grounded: result.grounded,
    });

    const response: ApiChatResponse = {
      id: result.id,
      request_id: requestId,
      ai_id: result.aiId,
      conversation_id: result.conversationId,
      answer: result.answer,
      grounded: result.grounded,
      refused: result.refused,
      conflict_detected: result.conflictDetected,
      knowledge_version: result.knowledgeVersion,
      sources: result.sources,
      memory_used: result.memoryUsed,
      memory_count: result.memoryCount,
      experience_recorded: result.experienceRecorded,
    };

    res.json(response);
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const statusCode = err instanceof SpecializedAIError ? err.statusCode : 500;
    const errorCode = err instanceof SpecializedAIError ? err.code : 'INTERNAL_ERROR';

    await apiKeyRuntimeService.recordUsage({
      requestId,
      apiKeyId: apiKey.id,
      accountId: apiKey.accountId,
      aiId: ai_id.trim(),
      endpoint: '/api/v1/chat',
      timestamp: Date.now(),
      status: statusCode,
      latencyMs,
      refused: false,
      grounded: false,
      errorCode,
    });

    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: err.message || 'An error occurred while processing the request.',
      },
      request_id: requestId,
    });
  }
});

// 3. AI Status Endpoint: GET /api/v1/ai/:ai_id
app.get('/api/v1/ai/:ai_id', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const lookup = kbStore.getSpecializedAIById(ai_id);

  if (!lookup) {
    return res.status(404).json({
      error: {
        code: 'AI_NOT_FOUND',
        message: `Specialized AI with id "${ai_id}" was not found.`,
      },
      request_id: requestId,
    });
  }

  const { ai, kb } = lookup;
  if (kb.accountId && kb.accountId !== apiKey.accountId) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: You are not authorized to view this Specialized AI.',
      },
      request_id: requestId,
    });
  }

  const isReady =
    kb.documents.length > 0 &&
    kb.processingStatus === 'ready' &&
    !kb.documents.some((d) => d.processingStatus === 'processing' || d.processingStatus === 'pending');

  res.json({
    id: ai.id,
    name: ai.name,
    description: ai.description,
    status: isReady ? 'ready' : 'not_ready',
    knowledge_version: kb.currentVersion || 'v1.0',
    request_id: requestId,
  });
});

// 4. Knowledge Status Endpoint: GET /api/v1/ai/:ai_id/knowledge
app.get('/api/v1/ai/:ai_id/knowledge', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const lookup = kbStore.getSpecializedAIById(ai_id);

  if (!lookup) {
    return res.status(404).json({
      error: {
        code: 'AI_NOT_FOUND',
        message: `Specialized AI with id "${ai_id}" was not found.`,
      },
      request_id: requestId,
    });
  }

  const { ai, kb } = lookup;
  if (kb.accountId && kb.accountId !== apiKey.accountId) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: You are not authorized to view this Knowledge Base.',
      },
      request_id: requestId,
    });
  }

  const isReady =
    kb.documents.length > 0 &&
    kb.processingStatus === 'ready' &&
    !kb.documents.some((d) => d.processingStatus === 'processing' || d.processingStatus === 'pending');

  const totalPages = kb.documents.reduce((acc, d) => acc + (d.pageCount || 0), 0);

  res.json({
    ai_id: ai.id,
    status: isReady ? 'ready' : 'not_ready',
    active_version: kb.currentVersion || 'v1.0',
    documents: kb.documents.length,
    pages: totalPages,
    updated_at: new Date(kb.updatedAt || kb.createdDate).toISOString(),
    request_id: requestId,
  });
});

// --- LEGACY DEVELOPER PLATFORM ROUTES ---
// Retired in Production Hardening B2D2A. The explicit 410 closure router
// above prevents hard-coded acc_default administration and arbitrary-scope
// key creation through /api/v1/developer/*.

// B2D3B1: legacy HTTP acceptance-test execution retired.
// Test runners remain available to CLI/CI scripts.

// =========================================================================
// PHASE 4: MEMORY, EXPERIENCE & CONTROLLED LEARNING SANDBOX ROUTES
// =========================================================================

// B2D3B1: Phase 4 acceptance tests remain script-callable, not HTTP-exposed.

// B2D3B3A: prototype mediator HTTP test/execution surface retired.
// Mediator runners and orchestration services remain directly importable for
// internal scripts, CI, and any later supported integration.

// =========================================================================
// PHASE 7: SYSTEM INTEGRATION, STRESS TESTING & PRODUCTION READINESS
// =========================================================================

// B2D3B1: Phase 7 HTTP acceptance-test route retired; CI runner retained.

// System Health Endpoint: GET /api/v1/system/health
app.get('/api/v1/system/health', (req, res) => {
  try {
    const health = systemReadinessService.getSystemHealth();
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// System Readiness Gate Summary: GET /api/v1/system/readiness
app.get('/api/v1/system/readiness', async (req, res) => {
  try {
    const report = await systemReadinessService.generateProductionReadinessReport(false);
    res.json({
      status: report.overallStatus,
      criticalFailures: report.criticalFailures.length,
      warnings: report.warnings.length,
      summary: report.summary,
      timestamp: report.timestamp,
      buildVersion: report.buildVersion,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Full Production Readiness Report: GET /api/v1/system/readiness-report
app.get('/api/v1/system/readiness-report', async (req, res) => {
  try {
    const forceFresh = req.query.fresh === 'true';
    const report = await systemReadinessService.generateProductionReadinessReport(forceFresh);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Known Limitations Register: GET /api/v1/system/limitations
app.get('/api/v1/system/limitations', (req, res) => {
  try {
    const limitations = getProductionLimitations();
    res.json({ limitations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// B2D3B1: stress harness HTTP routes retired; stress service remains script-callable.

// =========================================================================
// PHASE 8: REAL-WORLD EVALUATION, OBSERVABILITY & OPERATIONAL HARDENING
// =========================================================================

// B2D3B1: Phase 8 HTTP acceptance-test route retired; CI runner retained.

// B2D3B2A: prototype operations and observability HTTP control surfaces retired.
// Operational/telemetry services remain directly importable for internal scripts and code.

// Provider Health Profiles: GET /api/v1/providers/health
app.get('/api/v1/providers/health', (req, res) => {
  try {
    const profiles = realProviderAdapter.getHealthProfiles();
    res.json({ profiles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// PHASE 9: MULTI-TENANCY, API GATEWAY, USAGE METERING & SAAS READINESS
// =========================================================================

// B2D3B1: Phase 9 HTTP acceptance-test route retired; CI runner retained.

// B2D3B2B: prototype tenant and SaaS HTTP administration retired.
// Tenancy, quota/billing, governance, webhook, and SaaS readiness services
// remain directly importable for internal scripts and later migration.

// OpenAPI Spec: GET /api/v1/api-docs/openapi
app.get('/api/v1/api-docs/openapi', (req, res) => {
  try {
    const spec = apiManagementService.getOpenApiSpec();
    res.json(spec);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- 2. AUTHENTICATED REST API ROUTES (/api/v1/ai/:ai_id/...) ---

// GET /api/v1/ai/:ai_id/memories
app.get('/api/v1/ai/:ai_id/memories', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { status, type } = req.query;

  try {
    const memories = memoryStore.listMemories({
      accountId: apiKey.accountId,
      aiId: ai_id,
      status: status as MemoryStatus | undefined,
      type: type as MemoryType | undefined,
    });
    res.json({ memories, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/memories
app.post('/api/v1/ai/:ai_id/memories', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { type, content, summary, tags, evidence, confidence, actor } = req.body || {};

  if (!content || !summary || !type) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Fields type, content, and summary are required.' },
      request_id: requestId,
    });
  }

  try {
    const memory = memoryStore.createMemory({
      accountId: apiKey.accountId,
      aiId: ai_id,
      type,
      content,
      summary,
      tags,
      evidence,
      confidence,
      actor: actor || apiKey.name,
      requestId,
    });
    res.status(201).json({ memory, request_id: requestId });
  } catch (err: any) {
    res.status(400).json({ error: { code: 'CREATION_FAILED', message: err.message }, request_id: requestId });
  }
});

// PATCH /api/v1/ai/:ai_id/memories/:memory_id/status
app.patch('/api/v1/ai/:ai_id/memories/:memory_id/status', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id, memory_id } = req.params;
  const { status, reason, reviewer } = req.body || {};

  const effectiveReviewer = reviewer || apiKey.name || 'API Authorized Reviewer';

  try {
    let updated;
    if (status === 'VERIFIED') {
      updated = memoryStore.verifyMemory(memory_id, apiKey.accountId, effectiveReviewer, requestId);
    } else if (status === 'REJECTED') {
      if (!reason) {
        return res.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'Rejection reason is required.' },
          request_id: requestId,
        });
      }
      updated = memoryStore.rejectMemory(memory_id, apiKey.accountId, effectiveReviewer, reason, requestId);
    } else if (status === 'ARCHIVED') {
      updated = memoryStore.archiveMemory(memory_id, apiKey.accountId, effectiveReviewer, requestId);
    } else {
      return res.status(400).json({
        error: { code: 'INVALID_STATUS', message: 'Target status must be VERIFIED, REJECTED, or ARCHIVED.' },
        request_id: requestId,
      });
    }
    res.json({ memory: updated, request_id: requestId });
  } catch (err: any) {
    const statusCode = err.message.includes('NOT_FOUND') ? 404 : 403;
    res.status(statusCode).json({ error: { code: 'STATUS_UPDATE_FAILED', message: err.message }, request_id: requestId });
  }
});

// GET /api/v1/ai/:ai_id/experiences
app.get('/api/v1/ai/:ai_id/experiences', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { source, status } = req.query;

  try {
    const experiences = memoryStore.listExperiences({
      accountId: apiKey.accountId,
      aiId: ai_id,
      source: source as ExperienceSource | undefined,
      status: status as any,
    });
    res.json({ experiences, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/experiences
app.post('/api/v1/ai/:ai_id/experiences', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { situation, action, outcome, expectedOutcome, actualOutcome, feedback, source, evidence } = req.body || {};

  if (!situation || !action || !outcome) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Fields situation, action, and outcome are required.' },
      request_id: requestId,
    });
  }

  try {
    const exp = memoryStore.recordExperience({
      accountId: apiKey.accountId,
      aiId: ai_id,
      knowledgeVersionId: 'v1.0',
      source: source || 'API',
      situation,
      action,
      outcome,
      expectedOutcome,
      actualOutcome,
      evidence,
      feedback,
      requestId,
    });
    res.status(201).json({ experience: exp, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'RECORD_FAILED', message: err.message }, request_id: requestId });
  }
});

// GET /api/v1/ai/:ai_id/sandbox/scenarios
app.get('/api/v1/ai/:ai_id/sandbox/scenarios', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  try {
    const scenarios = memoryStore.listScenarios(apiKey.accountId, ai_id);
    res.json({ scenarios, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/sandbox/scenarios
app.post('/api/v1/ai/:ai_id/sandbox/scenarios', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { name, description, userInput, expectedBehavior, expectedOutcome, evaluationCriteria, difficulty, tags } = req.body || {};

  if (!name || !userInput || !expectedBehavior) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Fields name, userInput, and expectedBehavior are required.' },
      request_id: requestId,
    });
  }

  try {
    const scenario = memoryStore.createScenario({
      accountId: apiKey.accountId,
      aiId: ai_id,
      name,
      description,
      userInput,
      expectedBehavior,
      expectedOutcome,
      evaluationCriteria,
      difficulty,
      tags,
      requestId,
    });
    res.status(201).json({ scenario, request_id: requestId });
  } catch (err: any) {
    res.status(400).json({ error: { code: 'CREATION_FAILED', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/sandbox/runs
app.post('/api/v1/ai/:ai_id/sandbox/runs', async (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { scenarioId, seed } = req.body || {};

  if (!scenarioId) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'The scenarioId field is required.' },
      request_id: requestId,
    });
  }

  try {
    const run = await sandboxService.runScenario({
      scenarioId,
      accountId: apiKey.accountId,
      aiId: ai_id,
      seed,
      requestId,
    });
    res.json({ run, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'RUN_FAILED', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/sandbox/batch
app.post('/api/v1/ai/:ai_id/sandbox/batch', async (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { scenarioIds, repeatCount } = req.body || {};

  try {
    const batchResult = await sandboxService.runBatch({
      accountId: apiKey.accountId,
      aiId: ai_id,
      scenarioIds,
      repeatCount,
      requestId,
    });
    res.json({ batchResult, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'BATCH_FAILED', message: err.message }, request_id: requestId });
  }
});

// GET /api/v1/ai/:ai_id/sandbox/runs
app.get('/api/v1/ai/:ai_id/sandbox/runs', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  try {
    const runs = memoryStore.listRuns(apiKey.accountId, ai_id);
    res.json({ runs, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// GET /api/v1/ai/:ai_id/learning
app.get('/api/v1/ai/:ai_id/learning', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  try {
    const candidates = memoryStore.listLearningCandidates(apiKey.accountId, ai_id);
    res.json({ candidates, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/learning/generate
app.post('/api/v1/ai/:ai_id/learning/generate', async (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { focusArea } = req.body || {};

  try {
    const candidate = await learningService.generateCandidateFromExperiences({
      accountId: apiKey.accountId,
      aiId: ai_id,
      focusArea,
      requestId,
    });
    res.status(201).json({ candidate, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'GENERATE_FAILED', message: err.message }, request_id: requestId });
  }
});

// GET /api/v1/ai/:ai_id/improvements
app.get('/api/v1/ai/:ai_id/improvements', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  try {
    const proposals = memoryStore.listImprovementProposals(apiKey.accountId, ai_id);
    res.json({ proposals, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/improvements/propose
app.post('/api/v1/ai/:ai_id/improvements/propose', async (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  const { candidateIds, title } = req.body || {};

  if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'candidateIds array is required.' },
      request_id: requestId,
    });
  }

  try {
    const proposal = await learningService.evaluateCandidatesAndBuildScorecard({
      accountId: apiKey.accountId,
      aiId: ai_id,
      candidateIds,
      title,
      requestId,
    });
    res.status(201).json({ proposal, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'PROPOSAL_FAILED', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/improvements/:id/approve
app.post('/api/v1/ai/:ai_id/improvements/:id/approve', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { id } = req.params;
  const { reviewer } = req.body || {};
  const approver = reviewer || apiKey.name || 'Authorized Lead Engineer';

  try {
    const { proposal, newVersionTag } = memoryStore.approveImprovementProposal(
      id,
      apiKey.accountId,
      approver,
      requestId
    );
    res.json({
      proposal,
      newVersionTag,
      message: `Improvement proposal approved. Created immutable knowledge version ${newVersionTag}.`,
      request_id: requestId,
    });
  } catch (err: any) {
    const statusCode = err.message.includes('NOT_FOUND') ? 404 : 403;
    res.status(statusCode).json({ error: { code: 'APPROVAL_FAILED', message: err.message }, request_id: requestId });
  }
});

// POST /api/v1/ai/:ai_id/improvements/:id/reject
app.post('/api/v1/ai/:ai_id/improvements/:id/reject', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { id } = req.params;
  const { reason, reviewer } = req.body || {};

  if (!reason || !reason.trim()) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Rejection reason is required.' },
      request_id: requestId,
    });
  }

  try {
    const proposal = memoryStore.rejectImprovementProposal(
      id,
      apiKey.accountId,
      reviewer || apiKey.name,
      reason.trim(),
      requestId
    );
    res.json({ proposal, request_id: requestId });
  } catch (err: any) {
    res.status(400).json({ error: { code: 'REJECT_FAILED', message: err.message }, request_id: requestId });
  }
});

// GET /api/v1/ai/:ai_id/dashboard
app.get('/api/v1/ai/:ai_id/dashboard', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  try {
    const stats = memoryStore.getDashboardStats(apiKey.accountId, ai_id);
    res.json({ stats, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// GET /api/v1/ai/:ai_id/audit
app.get('/api/v1/ai/:ai_id/audit', (req, res) => {
  const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', requestId);

  const apiKey = authenticateApiRequest(req, res, requestId);
  if (!apiKey) return;

  const { ai_id } = req.params;
  try {
    const events = memoryStore.getAuditEvents(apiKey.accountId, ai_id, 50);
    res.json({ events, request_id: requestId });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId });
  }
});

// B2D3B3C: legacy /api/phase4/* Web UI convenience routes retired.
// Governed memory, sandbox, learning, and improvement services remain available
// through the authenticated /api/v1/ai/:ai_id/* compatibility surface and as
// directly importable internal modules.

// =========================================================================
// PHASE 5: MULTI-AGENT MEDIATOR & RELIABILITY ENDPOINTS
// =========================================================================

// B2D3B3A: prototype /api/v1/mediator/* HTTP registration retired.
// The underlying orchestration, planning, disagreement, verification, adaptive,
// and benchmark modules remain internal and directly importable.

// B2D3B3B: prototype /api/v1/rag/* and /api/v1/cognitive/* HTTP
// registration retired. RAG/Cognitive engines, telemetry, graph/index, and
// benchmark modules remain internal and directly importable. Supported product
// questions continue through the identity-aware /api/query/ask surface.

// --- VITE / STATIC SERVING ---
async function startServer() {
  const processRole =
    resolveProcessRole();
  assertWebEntrypointRole(
    processRole
  );

  await apiKeyRuntimeService.bootstrap();
  await datasetRuntimePersistence.bootstrap();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Knowledge AI server running on http://0.0.0.0:${PORT} (role=${processRole})`
    );
    backgroundRuntime.startForRole(
      processRole,
      {
        keepProcessAlive: false,
      }
    );
  });
}

startServer();

