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
} from './integrationSyncService.js';
import { integrationRuntimeService } from './integrationRuntimeService.js';
import { googleDriveOAuthService } from './googleDriveOAuthService.js';
import { microsoftOneDriveOAuthService } from './microsoftOneDriveOAuthService.js';

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

function wantsHtml(req: express.Request): boolean {
  return String(req.headers.accept || '')
    .toLowerCase()
    .includes('text/html');
}

function integrationReturnUrl(params: {
  provider: 'google-drive' | 'onedrive';
  status: 'connected' | 'error';
  message?: string;
}): string {
  const query = new URLSearchParams({
    tab: 'integrations',
    integration: params.status,
    provider: params.provider,
  });
  if (params.message) {
    query.set('message', params.message.slice(0, 240));
  }
  return '/?' + query.toString();
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

integrationRouter.post(
  '/onedrive/oauth/start',
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const result = await microsoftOneDriveOAuthService.begin({
        accountId,
        displayName:
          typeof req.body?.displayName === 'string'
            ? req.body.displayName
            : undefined,
        connectionId:
          typeof req.body?.connectionId === 'string'
            ? req.body.connectionId
            : undefined,
      });
      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.get(
  '/onedrive/oauth/callback',
  async (req, res) => {
    try {
      if (
        typeof req.query.error === 'string' &&
        req.query.error
      ) {
        const message =
          typeof req.query.error_description === 'string'
            ? req.query.error_description
            : 'Microsoft OneDrive authorization was not completed.';
        if (wantsHtml(req)) {
          res.redirect(
            303,
            integrationReturnUrl({
              provider: 'onedrive',
              status: 'error',
              message,
            })
          );
          return;
        }
        res.status(400).json({
          error: message,
          code: 'ONEDRIVE_OAUTH_DENIED',
        });
        return;
      }

      const result =
        await microsoftOneDriveOAuthService.complete({
          state:
            typeof req.query.state === 'string'
              ? req.query.state
              : '',
          code:
            typeof req.query.code === 'string'
              ? req.query.code
              : '',
        });
      if (wantsHtml(req)) {
        res.redirect(
          303,
          integrationReturnUrl({
            provider: 'onedrive',
            status: 'connected',
          })
        );
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.get(
  '/onedrive/connections/:id/health',
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const health =
        await microsoftOneDriveOAuthService.health({
          accountId,
          connectionId: req.params.id,
        });
      res.status(health.ok ? 200 : 422).json({ health });
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.post(
  '/onedrive/connections/:id/disconnect',
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      res.json(
        await microsoftOneDriveOAuthService.disconnect({
          accountId,
          connectionId: req.params.id,
        })
      );
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.post(
  '/google-drive/oauth/start',
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const result = await googleDriveOAuthService.begin({
        accountId,
        displayName:
          typeof req.body?.displayName === 'string'
            ? req.body.displayName
            : undefined,
        connectionId:
          typeof req.body?.connectionId === 'string'
            ? req.body.connectionId
            : undefined,
      });
      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.get(
  '/google-drive/oauth/callback',
  async (req, res) => {
    try {
      if (
        typeof req.query.error === 'string' &&
        req.query.error
      ) {
        const message =
          typeof req.query.error_description === 'string'
            ? req.query.error_description
            : 'Google Drive authorization was not completed.';
        if (wantsHtml(req)) {
          res.redirect(
            303,
            integrationReturnUrl({
              provider: 'google-drive',
              status: 'error',
              message,
            })
          );
          return;
        }
        res.status(400).json({
          error: message,
          code: 'GOOGLE_OAUTH_DENIED',
        });
        return;
      }

      const state =
        typeof req.query.state === 'string'
          ? req.query.state
          : '';
      const code =
        typeof req.query.code === 'string'
          ? req.query.code
          : '';

      const result = await googleDriveOAuthService.complete({
        state,
        code,
      });
      if (wantsHtml(req)) {
        res.redirect(
          303,
          integrationReturnUrl({
            provider: 'google-drive',
            status: 'connected',
          })
        );
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.get(
  '/google-drive/connections/:id/health',
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const health = await googleDriveOAuthService.health({
        accountId,
        connectionId: req.params.id,
      });
      res.status(health.ok ? 200 : 422).json({ health });
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.post(
  '/google-drive/connections/:id/disconnect',
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      const result = await googleDriveOAuthService.disconnect({
        accountId,
        connectionId: req.params.id,
      });
      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.get('/connections', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connections: await integrationRuntimeService.listConnections(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.get('/connections/:id', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: await integrationRuntimeService.getConnection(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.get('/connections/:id/runs', async (req, res) => {
  try {
    const { accountId } = identity(res);
    await integrationRuntimeService.getConnection(accountId, req.params.id);
    res.json({
      runs: await integrationRuntimeService.listRuns({
        accountId,
        connectionId: req.params.id,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.get('/connections/:id/imports', async (req, res) => {
  try {
    const { accountId } = identity(res);
    await integrationRuntimeService.getConnection(accountId, req.params.id);
    res.json({
      imports: await integrationRuntimeService.listImports({
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
    const run = await integrationRuntimeService.sync({
      accountId,
      connectionId: req.params.id,
    });

    res.status(run.status === 'COMPLETED' ? 200 : 422).json({
      run,
      connection: await integrationRuntimeService.getConnection(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.post(
  '/connections/:id/reset-cursor',
  async (req, res) => {
    try {
      const { accountId } = identity(res);
      res.json({
        connection: await integrationRuntimeService.resetCursor(
          accountId,
          req.params.id
        ),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

integrationRouter.post('/connections/:id/pause', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: await integrationRuntimeService.pause(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.post('/connections/:id/resume', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: await integrationRuntimeService.resume(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

integrationRouter.post('/connections/:id/revoke', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      connection: await integrationRuntimeService.revoke(
        accountId,
        req.params.id
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});
