import type express from 'express';
import { apiKeyStore } from './apiKeyStore.js';

export interface RequestIdentity {
  accountId: string;
  source: 'API_KEY' | 'DEFAULT_WEB';
  authenticated: boolean;
  apiKeyId?: string;
}

export class RequestIdentityError extends Error {
  public statusCode: number;
  public code: 'UNAUTHORIZED' | 'FORBIDDEN';

  constructor(code: 'UNAUTHORIZED' | 'FORBIDDEN', statusCode: number, message: string) {
    super(message);
    this.name = 'RequestIdentityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Resolve the account scope for normal application requests.
 *
 * Security invariant:
 * - a valid Bearer API key may select only the account stored on that key
 * - requests without credentials are restricted to the legacy/demo acc_default scope
 * - caller-supplied account headers/query/body values are never trusted as identity
 * - an invalid Authorization header is denied rather than silently falling back
 */
export function resolveRequestIdentity(req: express.Request): RequestIdentity {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return {
      accountId: 'acc_default',
      source: 'DEFAULT_WEB',
      authenticated: false,
    };
  }

  if (typeof authHeader !== 'string') {
    throw new RequestIdentityError('UNAUTHORIZED', 401, 'Invalid Authorization header.');
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    throw new RequestIdentityError(
      'UNAUTHORIZED',
      401,
      'Invalid Authorization header format. Expected "Bearer <API_KEY>".'
    );
  }

  const validation = apiKeyStore.validateApiKey(parts[1]);
  if (!validation.valid || !validation.apiKey) {
    const revoked = validation.error?.toLowerCase().includes('revoked');
    throw new RequestIdentityError(
      revoked ? 'FORBIDDEN' : 'UNAUTHORIZED',
      revoked ? 403 : 401,
      validation.error || 'Invalid API key.'
    );
  }

  return {
    accountId: validation.apiKey.accountId,
    source: 'API_KEY',
    authenticated: true,
    apiKeyId: validation.apiKey.id,
  };
}
