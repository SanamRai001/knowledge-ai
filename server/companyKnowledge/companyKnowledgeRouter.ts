import express from 'express';
import { DatasetAccessError } from '../datasets/datasetStore.js';
import { WorkspaceAccessError } from '../workspaceAccessService.js';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import {
  CompanyKnowledgeAccessError,
  companyKnowledgeStore,
} from './companyKnowledgeStore.js';
import { structuredKnowledgeProjectionService } from './structuredKnowledgeProjectionService.js';
import { documentKnowledgeProjectionService } from './documentKnowledgeProjectionService.js';
import { knowledgeConflictService } from './knowledgeConflictService.js';
import { CompanyEntityType } from './types.js';

export const companyKnowledgeRouter = express.Router();

companyKnowledgeRouter.use((req, res, next) => {
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
    res.status(500).json({
      error: 'Failed to resolve request identity.',
    });
  }
});

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function handleError(res: express.Response, error: any): void {
  if (
    error instanceof RequestIdentityError ||
    error instanceof DatasetAccessError ||
    error instanceof WorkspaceAccessError ||
    error instanceof CompanyKnowledgeAccessError
  ) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  res.status(500).json({
    error: error?.message || 'Company knowledge request failed.',
  });
}

function limitFrom(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function entityTypeFrom(value: unknown): CompanyEntityType | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed: CompanyEntityType[] = [
    'CUSTOMER',
    'PRODUCT',
    'SUPPLIER',
    'ORDER',
    'INVOICE',
    'BRANCH',
    'LOCATION',
    'CONTRACT',
    'PROJECT',
    'EMPLOYEE',
    'ORGANIZATION',
    'OTHER',
  ];
  return allowed.includes(normalized as CompanyEntityType)
    ? (normalized as CompanyEntityType)
    : undefined;
}

companyKnowledgeRouter.post('/project/dataset', (req, res) => {
  try {
    const { accountId } = identity(res);
    const datasetId =
      typeof req.body?.datasetId === 'string'
        ? req.body.datasetId.trim()
        : '';

    if (!datasetId) {
      res.status(400).json({
        error: 'datasetId is required.',
        code: 'DATASET_ID_REQUIRED',
      });
      return;
    }

    const run = structuredKnowledgeProjectionService.projectDataset({
      accountId,
      datasetId,
      versionId:
        typeof req.body?.versionId === 'string' && req.body.versionId.trim()
          ? req.body.versionId.trim()
          : undefined,
    });

    res.status(201).json({
      run,
      summary: companyKnowledgeStore.snapshotCounts(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.post('/project/documents', (req, res) => {
  try {
    const { accountId } = identity(res);
    const knowledgeBaseId =
      typeof req.body?.knowledgeBaseId === 'string'
        ? req.body.knowledgeBaseId.trim()
        : '';

    if (!knowledgeBaseId) {
      res.status(400).json({
        error: 'knowledgeBaseId is required.',
        code: 'KNOWLEDGE_BASE_ID_REQUIRED',
      });
      return;
    }

    const run = documentKnowledgeProjectionService.projectKnowledgeBase({
      accountId,
      knowledgeBaseId,
    });

    res.status(201).json({
      run,
      summary: companyKnowledgeStore.snapshotCounts(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/summary', (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      summary: companyKnowledgeStore.snapshotCounts(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/entities', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      entities: companyKnowledgeStore.listEntities({
        accountId,
        type: entityTypeFrom(req.query.type),
        search:
          typeof req.query.search === 'string'
            ? req.query.search
            : undefined,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/entities/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    const entity = companyKnowledgeStore.requireEntity(
      accountId,
      req.params.id
    );

    res.json({
      entity,
      relationships: companyKnowledgeStore.listRelationships({
        accountId,
        entityId: entity.id,
        limit: 100,
      }),
      claims: companyKnowledgeStore.listClaims({
        accountId,
        entityId: entity.id,
        currentOnly: false,
        limit: 300,
      }),
      events: companyKnowledgeStore.listEvents({
        accountId,
        entityId: entity.id,
        limit: 200,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/relationships', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      relationships: companyKnowledgeStore.listRelationships({
        accountId,
        entityId:
          typeof req.query.entityId === 'string'
            ? req.query.entityId
            : undefined,
        predicate:
          typeof req.query.predicate === 'string'
            ? req.query.predicate
            : undefined,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/claims', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      claims: companyKnowledgeStore.listClaims({
        accountId,
        entityId:
          typeof req.query.entityId === 'string'
            ? req.query.entityId
            : undefined,
        predicate:
          typeof req.query.predicate === 'string'
            ? req.query.predicate
            : undefined,
        currentOnly: req.query.currentOnly !== 'false',
        limit: limitFrom(req.query.limit, 200),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/conflicts', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      conflicts: knowledgeConflictService.listConflicts({
        accountId,
        entityId:
          typeof req.query.entityId === 'string'
            ? req.query.entityId
            : undefined,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/events', (req, res) => {
  try {
    const { accountId } = identity(res);
    const since =
      typeof req.query.since === 'string'
        ? Number(req.query.since)
        : undefined;

    res.json({
      events: companyKnowledgeStore.listEvents({
        accountId,
        entityId:
          typeof req.query.entityId === 'string'
            ? req.query.entityId
            : undefined,
        type:
          typeof req.query.type === 'string'
            ? req.query.type
            : undefined,
        since:
          since !== undefined && Number.isFinite(since)
            ? since
            : undefined,
        limit: limitFrom(req.query.limit, 200),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/projection-runs', (req, res) => {
  try {
    const { accountId } = identity(res);
    const sourceType =
      req.query.sourceType === 'DATASET' ||
      req.query.sourceType === 'DOCUMENT'
        ? req.query.sourceType
        : undefined;

    res.json({
      runs: companyKnowledgeStore.listProjectionRuns({
        accountId,
        sourceType,
        sourceId:
          typeof req.query.sourceId === 'string'
            ? req.query.sourceId
            : undefined,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});
