import express from 'express';
import { DatasetAccessError } from '../datasets/datasetStore.js';
import { AnalyticalQueryError } from '../datasets/structuredAnalyticsEngine.js';
import {
  RequestIdentity,
  RequestIdentityError,
} from '../requestIdentity.js';
import { applicationIdentityMiddleware } from '../requestIdentityMiddleware.js';
import { SpecializedAIError } from '../specializedAIService.js';
import { WorkspaceAccessError } from '../workspaceAccessService.js';
import { WorkspaceRuntimeError } from '../workspaceRuntimeService.js';
import {
  AnalyticalQuestionError,
  AnalyticalPlanningError,
} from './analyticalQuestionService.js';
import {
  currentOperationalContext,
} from '../operations/operationalTelemetry.js';
import {
  UnifiedQueryError,
  unifiedQueryService,
} from './unifiedQueryService.js';

export const queryRouter = express.Router();

queryRouter.use(applicationIdentityMiddleware);

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function handleError(res: express.Response, error: any): void {
  if (
    error instanceof RequestIdentityError ||
    error instanceof WorkspaceAccessError ||
    error instanceof WorkspaceRuntimeError ||
    error instanceof SpecializedAIError ||
    error instanceof DatasetAccessError ||
    error instanceof AnalyticalQueryError ||
    error instanceof AnalyticalQuestionError ||
    error instanceof UnifiedQueryError
  ) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  if (error instanceof AnalyticalPlanningError) {
    res.status(422).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  res.status(500).json({
    error: error?.message || 'Failed to answer question.',
  });
}

queryRouter.post('/ask', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const result = await unifiedQueryService.answer({
      accountId,
      question:
        typeof req.body?.question === 'string' ? req.body.question : '',
      datasetId:
        typeof req.body?.datasetId === 'string' && req.body.datasetId.trim()
          ? req.body.datasetId.trim()
          : undefined,
      datasetVersionId:
        typeof req.body?.datasetVersionId === 'string' &&
        req.body.datasetVersionId.trim()
          ? req.body.datasetVersionId.trim()
          : undefined,
      knowledgeBaseId:
        typeof req.body?.knowledgeBaseId === 'string' &&
        req.body.knowledgeBaseId.trim()
          ? req.body.knowledgeBaseId.trim()
          : undefined,
      allowLlmPlanning: req.body?.allowLlmPlanning !== false,
      allowLlmExplanation: req.body?.allowLlmExplanation !== false,
      requestId:
        currentOperationalContext()
          ?.requestId,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});
