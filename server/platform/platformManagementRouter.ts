import express from 'express';
import { apiKeyStore } from '../apiKeyStore.js';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import { PLATFORM_SCOPES } from './platformApiManifest.js';

const INTERNAL_DEVELOPER_MANAGE_SCOPE =
  'platform-internal:developer:manage';

const ALLOWED_PLATFORM_SCOPES = new Set(
  Object.values(PLATFORM_SCOPES)
);

export const platformManagementRouter = express.Router();

platformManagementRouter.use((req, res, next) => {
  try {
    const identity = resolveRequestIdentity(req);
    res.locals.requestIdentity = identity;

    if (
      identity.source === 'API_KEY' &&
      identity.apiKeyId
    ) {
      const key = apiKeyStore.getApiKeyById(identity.apiKeyId);
      if (
        !key ||
        !key.scopes.includes(INTERNAL_DEVELOPER_MANAGE_SCOPE)
      ) {
        res.status(403).json({
          error:
            'Developer key management requires the internal developer-management capability.',
          code: 'DEVELOPER_MANAGEMENT_FORBIDDEN',
        });
        return;
      }
    }

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
      error: 'Failed to resolve developer management identity.',
    });
  }
});

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

platformManagementRouter.get('/keys', (_req, res) => {
  const { accountId } = identity(res);
  res.json({
    keys: apiKeyStore.listApiKeys(accountId),
  });
});

platformManagementRouter.post('/keys', (req, res) => {
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

    const created = apiKeyStore.createApiKey({
      name,
      accountId,
      environment,
      scopes,
    });

    res.status(201).json({
      apiKey: created.apiKey,
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

platformManagementRouter.delete('/keys/:id', (req, res) => {
  const { accountId } = identity(res);
  const revoked = apiKeyStore.revokeApiKey(
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
    keys: apiKeyStore.listApiKeys(accountId),
  });
});

platformManagementRouter.get('/usage', (_req, res) => {
  const { accountId } = identity(res);
  res.json(apiKeyStore.getUsageStats(accountId));
});

export const PLATFORM_INTERNAL_DEVELOPER_MANAGE_SCOPE =
  INTERNAL_DEVELOPER_MANAGE_SCOPE;
