import express from 'express';
import { apiKeyStore } from '../apiKeyStore.js';
import { apiKeyRuntimeService } from '../apiKeyRuntimeService.js';
import type { RequestIdentity } from '../requestIdentity.js';
import { applicationIdentityMiddleware } from '../requestIdentityMiddleware.js';
import { requireOwnerOrAdmin } from '../identity/privilegedAuthorization.js';
import { PLATFORM_SCOPES } from './platformApiManifest.js';

const ALLOWED_PLATFORM_SCOPES = new Set(
  Object.values(PLATFORM_SCOPES)
);

export const platformManagementRouter = express.Router();

platformManagementRouter.use(applicationIdentityMiddleware);
platformManagementRouter.use(requireOwnerOrAdmin);

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function normalizePlatformScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('scopes must be an array.');
  }

  const normalized = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

  if (normalized.length === 0) {
    throw new Error('Select at least one stable platform scope.');
  }

  const invalid = normalized.filter(
    (scope) => !ALLOWED_PLATFORM_SCOPES.has(scope as any)
  );
  if (invalid.length > 0) {
    throw new Error(
      'Unknown or non-stable platform scope: ' +
        invalid.join(', ')
    );
  }

  return normalized;
}

platformManagementRouter.get('/keys', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      keys: await apiKeyRuntimeService.listApiKeyMetadata(
        accountId
      ),
    });
  } catch (error: any) {
    res.status(500).json({
      error:
        error?.message || 'Could not list Platform API keys.',
      code: 'PLATFORM_KEY_LIST_FAILED',
    });
  }
});

platformManagementRouter.post('/keys', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const scopes = normalizePlatformScopes(req.body?.scopes);
    const environment =
      req.body?.environment === 'live' ? 'live' : 'test';
    const name =
      typeof req.body?.name === 'string' &&
      req.body.name.trim()
        ? req.body.name.trim().slice(0, 160)
        : 'Platform API Key';

    const created = await apiKeyRuntimeService.createApiKey({
      name,
      accountId,
      environment,
      scopes,
    });

    res.status(201).json({
      apiKey: apiKeyStore.publicApiKey(created.apiKey),
      secret: created.secret,
      message:
        'Platform API key created. The secret is returned only once.',
    });
  } catch (error: any) {
    res.status(400).json({
      error:
        error?.message || 'Could not create Platform API key.',
      code: 'PLATFORM_KEY_INVALID',
    });
  }
});

platformManagementRouter.delete('/keys/:id', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const revoked = await apiKeyRuntimeService.revokeApiKey(
      req.params.id,
      accountId
    );

    if (!revoked) {
      res.status(404).json({
        error: 'API key not found in the current account scope.',
        code: 'PLATFORM_KEY_NOT_FOUND',
      });
      return;
    }

    res.json({
      message: 'API key revoked.',
      keys: await apiKeyRuntimeService.listApiKeyMetadata(
        accountId
      ),
    });
  } catch (error: any) {
    res.status(500).json({
      error:
        error?.message || 'Could not revoke Platform API key.',
      code: 'PLATFORM_KEY_REVOKE_FAILED',
    });
  }
});

platformManagementRouter.get('/usage', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json(
      await apiKeyRuntimeService.getUsageStats(accountId)
    );
  } catch (error: any) {
    res.status(500).json({
      error:
        error?.message || 'Could not load Platform API usage.',
      code: 'PLATFORM_USAGE_LOAD_FAILED',
    });
  }
});
