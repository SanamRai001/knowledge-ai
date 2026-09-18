import express from 'express';
import { DatasetAccessError } from '../datasets/datasetStore.js';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import { DiscoveryAccessError } from './discoveryStore.js';
import { discoveryService } from './discoveryService.js';
import { InsightStatus } from './types.js';

export const discoveryRouter = express.Router();

discoveryRouter.use((req, res, next) => {
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

function handleError(res: express.Response, error: any): void {
  if (
    error instanceof RequestIdentityError ||
    error instanceof DatasetAccessError ||
    error instanceof DiscoveryAccessError
  ) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  res.status(500).json({
    error: error?.message || 'Discovery request failed.',
  });
}

function parseStatus(value: unknown): InsightStatus | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === 'OPEN' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'RESOLVED'
  ) {
    return normalized;
  }
  return undefined;
}

discoveryRouter.post('/analyze', (req, res) => {
  try {
    const { accountId } = identity(res);
    const datasetId =
      typeof req.body?.datasetId === 'string' && req.body.datasetId.trim()
        ? req.body.datasetId.trim()
        : undefined;
    const knowledgeBaseId =
      typeof req.body?.knowledgeBaseId === 'string' &&
      req.body.knowledgeBaseId.trim()
        ? req.body.knowledgeBaseId.trim()
        : undefined;

    if ((!datasetId && !knowledgeBaseId) || (datasetId && knowledgeBaseId)) {
      res.status(400).json({
        error: 'Provide exactly one of datasetId or knowledgeBaseId.',
        code: 'DISCOVERY_SOURCE_REQUIRED',
      });
      return;
    }

    const result = datasetId
      ? discoveryService.analyzeDataset({
          accountId,
          datasetId,
          versionId:
            typeof req.body?.versionId === 'string' && req.body.versionId.trim()
              ? req.body.versionId.trim()
              : undefined,
        })
      : discoveryService.analyzeKnowledgeBase({
          accountId,
          knowledgeBaseId: knowledgeBaseId!,
        });

    res.status(201).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

discoveryRouter.get('/runs', (req, res) => {
  try {
    const { accountId } = identity(res);
    const datasetId =
      typeof req.query.datasetId === 'string' && req.query.datasetId.trim()
        ? req.query.datasetId.trim()
        : undefined;

    const knowledgeBaseId =
      typeof req.query.knowledgeBaseId === 'string' &&
      req.query.knowledgeBaseId.trim()
        ? req.query.knowledgeBaseId.trim()
        : undefined;

    res.json({
      runs: discoveryService.listRuns(
        accountId,
        datasetId,
        knowledgeBaseId
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

discoveryRouter.get('/', (req, res) => {
  try {
    const { accountId } = identity(res);
    const datasetId =
      typeof req.query.datasetId === 'string' && req.query.datasetId.trim()
        ? req.query.datasetId.trim()
        : undefined;
    const knowledgeBaseId =
      typeof req.query.knowledgeBaseId === 'string' &&
      req.query.knowledgeBaseId.trim()
        ? req.query.knowledgeBaseId.trim()
        : undefined;
    const runId =
      typeof req.query.runId === 'string' && req.query.runId.trim()
        ? req.query.runId.trim()
        : undefined;
    const latestRunOnly = req.query.latestRunOnly !== 'false';
    const requestedLimit =
      typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;

    res.json({
      insights: discoveryService.listInsights({
        accountId,
        datasetId,
        knowledgeBaseId,
        runId,
        status: parseStatus(req.query.status),
        latestRunOnly,
        limit:
          requestedLimit !== undefined && Number.isFinite(requestedLimit)
            ? requestedLimit
            : undefined,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

discoveryRouter.patch('/:id/status', (req, res) => {
  try {
    const { accountId } = identity(res);
    const status = parseStatus(req.body?.status);
    if (!status) {
      res.status(400).json({
        error: 'status must be OPEN, ACKNOWLEDGED, or RESOLVED.',
        code: 'INVALID_INSIGHT_STATUS',
      });
      return;
    }

    res.json({
      insight: discoveryService.updateInsightStatus(
        accountId,
        req.params.id,
        status
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

discoveryRouter.get('/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      insight: discoveryService.getInsight(accountId, req.params.id),
    });
  } catch (error) {
    handleError(res, error);
  }
});
