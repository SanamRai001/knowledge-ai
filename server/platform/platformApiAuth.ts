import crypto from 'crypto';
import type express from 'express';
import { apiKeyStore } from '../apiKeyStore.js';
import {
  PlatformApiOperation,
  PlatformRateLimitClass,
  platformOperation,
} from './platformApiManifest.js';

const RATE_LIMITS: Record<
  PlatformRateLimitClass,
  number
> = {
  PUBLIC: 300,
  READ: 100,
  QUERY: 30,
  WRITE: 20,
};

export interface PlatformApiContext {
  requestId: string;
  accountId: string;
  apiKeyId: string;
  scopes: string[];
  operation: PlatformApiOperation;
}

export class PlatformApiAuthError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'PLATFORM_UNAUTHORIZED'
    | 'PLATFORM_FORBIDDEN'
    | 'PLATFORM_RATE_LIMITED';

  constructor(
    code:
      | 'PLATFORM_UNAUTHORIZED'
      | 'PLATFORM_FORBIDDEN'
      | 'PLATFORM_RATE_LIMITED',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'PlatformApiAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function bearerSecret(req: express.Request): string {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') {
    throw new PlatformApiAuthError(
      'PLATFORM_UNAUTHORIZED',
      401,
      'Missing API key. Provide Authorization: Bearer <API_KEY>.'
    );
  }

  const parts = header.trim().split(/\s+/);
  if (
    parts.length !== 2 ||
    parts[0].toLowerCase() !== 'bearer'
  ) {
    throw new PlatformApiAuthError(
      'PLATFORM_UNAUTHORIZED',
      401,
      'Invalid Authorization header format.'
    );
  }
  return parts[1];
}

export function requirePlatformOperation(
  operationId: string
): express.RequestHandler {
  const operation = platformOperation(operationId);

  return (req, res, next) => {
    const requestId =
      'platreq_' + crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-ID', requestId);

    try {
      const validation = apiKeyStore.validateApiKey(
        bearerSecret(req)
      );
      if (!validation.valid || !validation.apiKey) {
        const revoked = validation.error
          ?.toLowerCase()
          .includes('revoked');
        throw new PlatformApiAuthError(
          revoked
            ? 'PLATFORM_FORBIDDEN'
            : 'PLATFORM_UNAUTHORIZED',
          revoked ? 403 : 401,
          validation.error || 'Invalid API key.'
        );
      }

      const apiKey = validation.apiKey;
      const scopes = new Set(apiKey.scopes || []);
      const missing = operation.requiredScopes.filter(
        (scope) => !scopes.has(scope)
      );
      if (missing.length > 0) {
        throw new PlatformApiAuthError(
          'PLATFORM_FORBIDDEN',
          403,
          'API key is missing required scope(s): ' +
            missing.join(', ')
        );
      }

      const maxRequests =
        RATE_LIMITS[operation.rateLimitClass];
      const rate = apiKeyStore.checkRateLimit(
        apiKey.id,
        maxRequests
      );
      res.setHeader(
        'X-RateLimit-Limit',
        String(maxRequests)
      );
      res.setHeader(
        'X-RateLimit-Remaining',
        String(rate.remaining)
      );

      if (!rate.allowed) {
        res.setHeader(
          'Retry-After',
          String(rate.resetSeconds)
        );
        throw new PlatformApiAuthError(
          'PLATFORM_RATE_LIMITED',
          429,
          'Platform API rate limit exceeded.'
        );
      }

      const context: PlatformApiContext = {
        requestId,
        accountId: apiKey.accountId,
        apiKeyId: apiKey.id,
        scopes: [...(apiKey.scopes || [])],
        operation,
      };
      res.locals.platformApiContext = context;

      const startedAt = Date.now();
      res.once('finish', () => {
        apiKeyStore.recordUsage({
          requestId,
          apiKeyId: apiKey.id,
          accountId: apiKey.accountId,
          aiId: 'platform',
          endpoint:
            '/api/platform/v1' + operation.path,
          timestamp: startedAt,
          status: res.statusCode,
          latencyMs: Date.now() - startedAt,
          refused: false,
          grounded: false,
          errorCode:
            res.statusCode >= 400
              ? 'PLATFORM_API_ERROR'
              : undefined,
        });
      });

      next();
    } catch (error) {
      if (error instanceof PlatformApiAuthError) {
        res.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
          },
          request_id: requestId,
        });
        return;
      }
      next(error);
    }
  };
}

export function platformContext(
  res: express.Response
): PlatformApiContext {
  return res.locals.platformApiContext as PlatformApiContext;
}
