import express from 'express';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import {
  IntegrationAccessError,
  IntegrationStateError,
} from './integrationStore.js';
import {
  IntegrationSyncError,
  integrationSyncService,
} from './integrationSyncService.js';

export const integrationRouter = express.Router();

integrationRouter.use((req, res, next) => {
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

function limitFrom(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function handleError(res: express.Response, error: any): void {
  if (
    error instanceof RequestIdentityError ||
    error instanceof IntegrationAccessError ||
    error instanceof IntegrationStateError ||
    error instanceof IntegrationSyncError
  ) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  if (
    error &&
    typeof error.statusCode === 'number' &&
    typeof error.code === 'string'
  ) {
    res.status(error.statusCode).json({
      error: error.message || 'Integration request failed.',
      code: error.code,
    });
    return;
  }

  res.status(500).json({
    error: error?.message || 'Integration request failed.',
  });
}

integrationRouter.get('/connections', (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connections: integrationSyncService.listConnections(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.get('/connections/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: integrationSyncService.getConnection(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.get('/connections/:id/runs', (req, res) => {
  try {
    const { accountId } = identity(res);
    integrationSyncService.getConnection(accountId, req.params.id);
    res.json({
      runs: integrationSyncService.listRuns({
        accountId,
        connectionId: req.params.id,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.get('/connections/:id/imports', (req, res) => {
  try {
    const { accountId } = identity(res);
    integrationSyncService.getConnection(accountId, req.params.id);
    res.json({
      imports: integrationSyncService.listImports({
        accountId,
        connectionId: req.params.id,
        externalId:
          typeof req.query.externalId === 'string'
            ? req.query.externalId
            : undefined,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.post('/connections/:id/sync', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const run = await integrationSyncService.sync({
      accountId,
      connectionId: req.params.id,
    });

    res.status(run.status === 'COMPLETED' ? 200 : 422).json({
      run,
      connection: integrationSyncService.getConnection(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.post('/connections/:id/pause', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: integrationSyncService.pause(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.post('/connections/:id/resume', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: integrationSyncService.resume(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.post('/connections/:id/revoke', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: integrationSyncService.revoke(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});
