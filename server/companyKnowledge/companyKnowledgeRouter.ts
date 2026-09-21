import express from 'express';
import { DatasetAccessError } from '../datasets/datasetStore.js';
import { WorkspaceAccessError } from '../workspaceAccessService.js';
import {
  RequestIdentity,
  RequestIdentityError,
} from '../requestIdentity.js';
import { applicationIdentityMiddleware } from '../requestIdentityMiddleware.js';
import {
  CompanyKnowledgeAccessError,
} from './companyKnowledgeStore.js';
import { companyKnowledgePersistence } from './companyKnowledgePersistence.js';
import { structuredKnowledgeRuntimeProjectionService } from './structuredKnowledgeRuntimeProjectionService.js';
import { documentKnowledgeRuntimeProjectionService } from './documentKnowledgeRuntimeProjectionService.js';
import { knowledgeConflictRuntimeService } from './knowledgeConflictRuntimeService.js';
import { KnowledgeChangeError } from './companyKnowledgeChangeService.js';
import { companyKnowledgeChangeRuntimeService } from './companyKnowledgeChangeRuntimeService.js';
import { CompanyEntityType } from './types.js';

export const companyKnowledgeRouter = express.Router();

companyKnowledgeRouter.use(applicationIdentityMiddleware);

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function handleError(res: express.Response, error: any): void {
  if (
    error instanceof RequestIdentityError ||
    error instanceof DatasetAccessError ||
    error instanceof WorkspaceAccessError ||
    error instanceof CompanyKnowledgeAccessError ||
    error instanceof KnowledgeChangeError
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

companyKnowledgeRouter.post('/project/dataset', async (req, res) => {
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

    const run =
      await structuredKnowledgeRuntimeProjectionService.projectDataset({
      accountId,
      datasetId,
      versionId:
        typeof req.body?.versionId === 'string' && req.body.versionId.trim()
          ? req.body.versionId.trim()
          : undefined,
    });

    res.status(201).json({
      run,
      summary: await companyKnowledgePersistence.snapshotCounts(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.post('/project/documents', async (req, res) => {
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

    const run =
      await documentKnowledgeRuntimeProjectionService.projectKnowledgeBase({
      accountId,
      knowledgeBaseId,
    });

    res.status(201).json({
      run,
      summary: await companyKnowledgePersistence.snapshotCounts(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/changes/compare', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const fromRunId =
      typeof req.query.fromRunId === 'string'
        ? req.query.fromRunId.trim()
        : '';
    const toRunId =
      typeof req.query.toRunId === 'string'
        ? req.query.toRunId.trim()
        : '';

    if (!fromRunId || !toRunId) {
      res.status(400).json({
        error: 'fromRunId and toRunId are required.',
        code: 'CHANGE_RUN_IDS_REQUIRED',
      });
      return;
    }

    res.json({
      changes:
        await companyKnowledgeChangeRuntimeService.compareProjectionRuns({
        accountId,
        fromRunId,
        toRunId,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/changes/since', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const since =
      typeof req.query.since === 'string'
        ? Number(req.query.since)
        : Number.NaN;

    if (!Number.isFinite(since)) {
      res.status(400).json({
        error: 'since must be a timestamp.',
        code: 'INVALID_CHANGE_WINDOW',
      });
      return;
    }

    res.json({
      changes:
        await companyKnowledgeChangeRuntimeService.changesSince({
        accountId,
        since,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/summary', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      summary: await companyKnowledgePersistence.snapshotCounts(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/entities', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      entities: await companyKnowledgePersistence.listEntities({
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

companyKnowledgeRouter.get('/entities/:id', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const entity =
      await companyKnowledgePersistence.requireEntity(
      accountId,
      req.params.id
    );

    res.json({
      entity,
      relationships:
        await companyKnowledgePersistence.listRelationships({
        accountId,
        entityId: entity.id,
        limit: 100,
      }),
      claims: await companyKnowledgePersistence.listClaims({
        accountId,
        entityId: entity.id,
        currentOnly: false,
        limit: 300,
      }),
      events: await companyKnowledgePersistence.listEvents({
        accountId,
        entityId: entity.id,
        limit: 200,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

companyKnowledgeRouter.get('/relationships', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      relationships: await companyKnowledgePersistence.listRelationships({
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

companyKnowledgeRouter.get('/claims', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      claims: await companyKnowledgePersistence.listClaims({
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

companyKnowledgeRouter.get('/conflicts', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      conflicts: await knowledgeConflictRuntimeService.listConflicts({
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

companyKnowledgeRouter.get('/events', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const since =
      typeof req.query.since === 'string'
        ? Number(req.query.since)
        : undefined;

    res.json({
      events: await companyKnowledgePersistence.listEvents({
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

companyKnowledgeRouter.get('/projection-runs', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const sourceType =
      req.query.sourceType === 'DATASET' ||
      req.query.sourceType === 'DOCUMENT'
        ? req.query.sourceType
        : undefined;

    res.json({
      runs:
        await companyKnowledgePersistence.listProjectionRuns({
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
