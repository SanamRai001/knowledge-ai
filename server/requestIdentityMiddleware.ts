import type express from 'express';
import {
  RequestIdentityError,
  resolveAuthenticatedRequestIdentity,
} from './requestIdentity.js';
import {
  AuthHttpSecurityError,
  requireDoubleSubmitCsrf,
  requireSameOrigin,
} from './identity/authHttpSecurity.js';

const SAFE_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

export async function applicationIdentityMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  try {
    const identity =
      await resolveAuthenticatedRequestIdentity(req);

    if (
      identity.source === 'HUMAN_SESSION' &&
      !SAFE_METHODS.has(req.method.toUpperCase())
    ) {
      requireSameOrigin(req);
      requireDoubleSubmitCsrf(req);
    }

    res.locals.requestIdentity = identity;
    next();
  } catch (error: any) {
    if (error instanceof RequestIdentityError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
      return;
    }

    if (error instanceof AuthHttpSecurityError) {
      res
        .status(
          error.code ===
            'AUTH_PUBLIC_ORIGIN_NOT_CONFIGURED'
            ? 503
            : 403
        )
        .json({
          error: error.message,
          code: error.code,
        });
      return;
    }

    console.error(
      'Failed to resolve application request identity:',
      error
    );
    res.status(500).json({
      error: 'Failed to resolve request identity.',
      code: 'REQUEST_IDENTITY_FAILURE',
    });
  }
}
