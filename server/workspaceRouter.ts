import express from 'express';
import multer from 'multer';
import { ChatMessage } from '../src/types.js';
import { parsePdfBuffer, createKnowledgeDocument } from './documentService.js';
import { generateSampleDocs } from './sampleDocs.js';
import { runEvaluationSuite } from './evaluationService.js';
import { runFullTestSuite } from './testRunner.js';
import { specializedAIService, SpecializedAIError } from './specializedAIService.js';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from './requestIdentity.js';
import {
  WorkspaceAccessError,
  workspaceAccessService,
} from './workspaceAccessService.js';

export const workspaceRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    const isPdfMime =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/x-pdf';
    const isPdfExt = file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdfMime || isPdfExt) {
      cb(null, true);
      return;
    }
    cb(
      new Error(
        `Unsupported file type: "${file.originalname}". Only PDF documents are supported.`
      )
    );
  },
});

workspaceRouter.use((req, res, next) => {
  try {
    res.locals.requestIdentity = resolveRequestIdentity(req);
    next();
  } catch (error: any) {
    if (error instanceof RequestIdentityError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
      return;
    }
    res.status(500).json({ error: 'Failed to resolve request identity.' });
  }
});

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function handleError(
  res: express.Response,
  error: any,
  fallback: string,
  defaultStatus = 500
) {
  if (error instanceof WorkspaceAccessError || error instanceof RequestIdentityError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  if (error instanceof SpecializedAIError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  res.status(defaultStatus).json({ error: error?.message || fallback });
}

workspaceRouter.get('/', (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      kb: workspaceAccessService.getActiveKB(accountId),
      allKbs: workspaceAccessService.listKBs(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to retrieve knowledge base');
  }
});

workspaceRouter.post('/new', (req, res) => {
  try {
    const { accountId } = identity(res);
    const name =
      typeof req.body?.name === 'string' && req.body.name.trim()
        ? req.body.name.trim()
        : 'New Knowledge Base';
    const description =
      typeof req.body?.description === 'string'
        ? req.body.description.trim()
        : undefined;
    const kb = workspaceAccessService.createKB(accountId, name, description);
    res.json({
      message: 'Created new knowledge base',
      kb,
      allKbs: workspaceAccessService.listKBs(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to create knowledge base');
  }
});

workspaceRouter.patch('/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    const kb = workspaceAccessService.updateKB(accountId, req.params.id, {
      name:
        typeof req.body?.name === 'string' ? req.body.name.trim() : undefined,
      description:
        typeof req.body?.description === 'string'
          ? req.body.description.trim()
          : undefined,
    });
    res.json({
      message: 'Knowledge base updated',
      kb,
      allKbs: workspaceAccessService.listKBs(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to update knowledge base');
  }
});

workspaceRouter.delete('/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    workspaceAccessService.deleteKB(accountId, req.params.id);
    res.json({
      message: 'Knowledge base deleted',
      activeKb: workspaceAccessService.getActiveKB(accountId),
      allKbs: workspaceAccessService.listKBs(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to delete knowledge base', 400);
  }
});

workspaceRouter.post('/switch', (req, res) => {
  try {
    const { accountId } = identity(res);
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) {
      res.status(400).json({ error: 'Missing knowledge base id' });
      return;
    }
    const kb = workspaceAccessService.setActiveKB(accountId, id);
    res.json({
      message: 'Active knowledge base switched',
      kb,
      allKbs: workspaceAccessService.listKBs(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to switch knowledge base');
  }
});

workspaceRouter.get('/:id/ai', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      specializedAi: workspaceAccessService.getSpecializedAI(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error, 'Failed to get Specialized AI configuration');
  }
});

workspaceRouter.put('/:id/ai', (req, res) => {
  try {
    const { accountId } = identity(res);
    const specializedAi = workspaceAccessService.updateSpecializedAI(
      accountId,
      req.params.id,
      req.body || {}
    );
    res.json({
      message: 'Specialized AI configuration updated',
      specializedAi,
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to update Specialized AI configuration');
  }
});

workspaceRouter.get('/:id/versions', (req, res) => {
  try {
    const { accountId } = identity(res);
    const kb = workspaceAccessService.requireKB(accountId, req.params.id);
    res.json({
      currentVersion: kb.currentVersion,
      versions: kb.versions || [],
    });
  } catch (error) {
    handleError(res, error, 'Failed to get versions');
  }
});

workspaceRouter.post('/:id/versions/create', (req, res) => {
  try {
    const { accountId } = identity(res);
    const label =
      typeof req.body?.label === 'string' && req.body.label.trim()
        ? req.body.label.trim()
        : 'New Version Snapshot';
    const version = workspaceAccessService.createVersionSnapshot(
      accountId,
      req.params.id,
      label
    );
    res.json({
      message: `Created snapshot version ${version.versionTag}`,
      version,
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to create version snapshot');
  }
});

workspaceRouter.post('/:id/versions/:versionId/rollback', (req, res) => {
  try {
    const { accountId } = identity(res);
    const kb = workspaceAccessService.rollbackToVersion(
      accountId,
      req.params.id,
      req.params.versionId
    );
    res.json({
      message: `Knowledge base rolled back to version ${kb.currentVersion}`,
      kb,
    });
  } catch (error) {
    handleError(res, error, 'Failed to rollback version');
  }
});

workspaceRouter.post('/:id/evaluations/run', async (req, res) => {
  try {
    const { accountId } = identity(res);
    workspaceAccessService.requireKB(accountId, req.params.id);
    const run = await runEvaluationSuite(req.params.id, accountId);
    res.json({
      message: 'Evaluation suite completed',
      run,
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to execute evaluation suite');
  }
});

workspaceRouter.get('/:id/evaluations/history', (req, res) => {
  try {
    const { accountId } = identity(res);
    const kb = workspaceAccessService.requireKB(accountId, req.params.id);
    res.json({ evaluationRuns: kb.evaluationRuns || [] });
  } catch (error) {
    handleError(res, error, 'Failed to get evaluation history');
  }
});

workspaceRouter.post('/:id/evaluations/test-cases', (req, res) => {
  try {
    const { accountId } = identity(res);
    const {
      category,
      question,
      expectedBehavior,
      expectedKeywords,
      mustRefuse,
    } = req.body || {};

    if (typeof question !== 'string' || !question.trim()) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    const testCase = workspaceAccessService.addTestCase(
      accountId,
      req.params.id,
      {
        category: category || 'grounded',
        question: question.trim(),
        expectedBehavior:
          typeof expectedBehavior === 'string' && expectedBehavior.trim()
            ? expectedBehavior.trim()
            : 'Verified against uploaded documents',
        expectedKeywords: Array.isArray(expectedKeywords)
          ? expectedKeywords
          : undefined,
        mustRefuse: Boolean(mustRefuse),
      }
    );

    res.json({
      message: 'Evaluation test case added',
      testCase,
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to add test case');
  }
});

workspaceRouter.delete(
  '/:id/evaluations/test-cases/:tcId',
  (req, res) => {
    try {
      const { accountId } = identity(res);
      const deleted = workspaceAccessService.removeTestCase(
        accountId,
        req.params.id,
        req.params.tcId
      );
      res.json({
        message: deleted ? 'Test case removed' : 'Test case not found',
        kb: workspaceAccessService.getActiveKB(accountId),
      });
    } catch (error) {
      handleError(res, error, 'Failed to delete test case');
    }
  }
);

workspaceRouter.post(
  '/documents/upload',
  upload.array('files', 10),
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const activeKb = workspaceAccessService.getActiveKB(accountId);
      const files = (req.files as Express.Multer.File[]) || [];

      if (files.length === 0) {
        res.status(400).json({
          error: 'No PDF files were provided in the upload request.',
        });
        return;
      }

      const processed = [];
      const errors = [];

      for (const file of files) {
        try {
          const { pageCount, pages, summary } = await parsePdfBuffer(
            file.originalname,
            file.buffer
          );
          const doc = createKnowledgeDocument(
            file.originalname,
            file.buffer,
            pageCount,
            pages,
            summary
          );
          workspaceAccessService.addDocument(accountId, activeKb.id, doc);
          processed.push(doc);
        } catch (error: any) {
          errors.push({
            filename: file.originalname,
            error: error?.message || 'Document processing failed',
          });
        }
      }

      res.json({
        message: `Processed ${processed.length} document(s).`,
        processed,
        errors: errors.length > 0 ? errors : undefined,
        kb: workspaceAccessService.getActiveKB(accountId),
      });
    } catch (error) {
      handleError(res, error, 'Failed to process document upload');
    }
  }
);

workspaceRouter.post('/documents/sample', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    const activeKb = workspaceAccessService.getActiveKB(accountId);
    const samples = await generateSampleDocs();
    const added = [];

    for (const sample of samples) {
      const { pageCount, pages, summary } = await parsePdfBuffer(
        sample.filename,
        sample.buffer
      );
      const doc = createKnowledgeDocument(
        sample.filename,
        sample.buffer,
        pageCount,
        pages,
        summary
      );
      workspaceAccessService.addDocument(accountId, activeKb.id, doc);
      added.push(doc);
    }

    res.json({
      message: 'Sample documents loaded successfully',
      addedCount: added.length,
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to load sample documents');
  }
});

workspaceRouter.delete('/documents/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    const activeKb = workspaceAccessService.getActiveKB(accountId);
    const removed = workspaceAccessService.removeDocument(
      accountId,
      activeKb.id,
      req.params.id
    );

    if (!removed) {
      res.status(404).json({
        error: `Document with ID ${req.params.id} was not found in active knowledge base.`,
      });
      return;
    }

    res.json({
      message: 'Document removed successfully',
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to remove document');
  }
});

workspaceRouter.post('/documents/:id/retry', (req, res) => {
  try {
    const { accountId } = identity(res);
    const activeKb = workspaceAccessService.getActiveKB(accountId);
    const doc = activeKb.documents.find((item) => item.id === req.params.id);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    workspaceAccessService.updateDocumentStatus(
      accountId,
      activeKb.id,
      req.params.id,
      'processed'
    );

    res.json({
      message: 'Document status reset',
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to retry document');
  }
});

workspaceRouter.post('/chat', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const question =
      typeof req.body?.question === 'string' ? req.body.question.trim() : '';

    if (!question) {
      res.status(400).json({ error: 'Question cannot be empty' });
      return;
    }

    const activeKb = workspaceAccessService.getActiveKB(accountId);

    if (activeKb.documents.length === 0) {
      res.status(400).json({
        error:
          'No documents in knowledge base. Please upload one or more PDFs before asking questions.',
      });
      return;
    }

    if (
      activeKb.documents.some(
        (doc) =>
          doc.processingStatus === 'processing' ||
          doc.processingStatus === 'pending'
      )
    ) {
      res.status(400).json({
        error:
          'Your documents are still processing. Please wait until your documents finish processing.',
      });
      return;
    }

    const userMessage: ChatMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 10),
      role: 'user',
      content: question,
      timestamp: Date.now(),
    };
    workspaceAccessService.addChatMessage(
      accountId,
      activeKb.id,
      userMessage
    );

    const result = await specializedAIService.answer({
      aiId: activeKb.specializedAi.id,
      message: question,
      accountId,
      chatHistory: workspaceAccessService.getActiveKB(accountId).chatHistory,
      source: 'WEB',
    });

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

    workspaceAccessService.addChatMessage(
      accountId,
      activeKb.id,
      assistantMessage
    );

    res.json({
      message: assistantMessage,
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to generate grounded answer');
  }
});

workspaceRouter.delete('/chat', (_req, res) => {
  try {
    const { accountId } = identity(res);
    const activeKb = workspaceAccessService.getActiveKB(accountId);
    workspaceAccessService.clearChat(accountId, activeKb.id);
    res.json({
      message: 'Conversation cleared',
      kb: workspaceAccessService.getActiveKB(accountId),
    });
  } catch (error) {
    handleError(res, error, 'Failed to clear conversation');
  }
});

workspaceRouter.post('/run-tests', async (_req, res) => {
  try {
    identity(res);
    const results = await runFullTestSuite();
    res.json({ results, timestamp: Date.now() });
  } catch (error) {
    handleError(res, error, 'Test suite execution failed');
  }
});
