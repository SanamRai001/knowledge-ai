import { Router } from 'express';
import {
  HumanAuthError,
  humanAuthService,
} from './humanAuthService.js';
import {
  AUTH_SESSION_COOKIE,
  AuthHttpSecurityError,
  clearAuthCookies,
  createCsrfToken,
  issueAuthCookies,
  parseCookieHeader,
  requireDoubleSubmitCsrf,
  requireSameOrigin,
} from './authHttpSecurity.js';

export const authRouter = Router();

function sessionSecretFromRequest(
  cookieHeader: string | undefined
): string | undefined {
  return parseCookieHeader(cookieHeader)[
    AUTH_SESSION_COOKIE
  ];
}

function publicContext(context: any) {
  return {
    user: {
      id: context.user.id,
      email: context.user.email,
      displayName: context.user.displayName,
      status: context.user.status,
    },
    membership: context.membership
      ? {
          accountId: context.membership.accountId,
          role: context.membership.role,
          status: context.membership.status,
        }
      : null,
    session: {
      id: context.session.id,
      selectedAccountId:
        context.session.selectedAccountId ?? null,
      selectedWorkspaceId:
        context.session.selectedWorkspaceId ?? null,
      expiresAt: context.session.expiresAt,
    },
  };
}

function handleAuthError(error: unknown, res: any) {
  if (error instanceof AuthHttpSecurityError) {
    const status =
      error.code ===
      'AUTH_PUBLIC_ORIGIN_NOT_CONFIGURED'
        ? 503
        : 403;
    if (
      error.code === 'AUTH_RATE_LIMITED' &&
      error.retryAfterSeconds
    ) {
      res.setHeader(
        'Retry-After',
        String(error.retryAfterSeconds)
      );
    }

    return res.status(status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  if (error instanceof HumanAuthError) {
    const status =
      error.code === 'AUTH_BOOTSTRAP_NOT_CONFIGURED'
        ? 503
        : error.code === 'AUTH_BOOTSTRAP_DENIED'
          ? 403
          : error.code === 'AUTH_BOOTSTRAP_ALREADY_USED'
            ? 409
            : error.code === 'AUTH_RATE_LIMITED'
              ? 429
              : error.code === 'AUTH_PASSWORD_INVALID' ||
                  error.code === 'AUTH_EMAIL_INVALID'
                ? 400
                : error.code ===
                    'AUTH_ACCOUNT_MEMBERSHIP_REQUIRED'
                  ? 403
                  : 401;
    return res.status(status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  console.error('Authentication route failure:', error);
  return res.status(500).json({
    error: {
      code: 'AUTH_INTERNAL_ERROR',
      message: 'Authentication request failed.',
    },
  });
}

authRouter.post('/bootstrap', async (req, res) => {
  try {
    const bootstrapToken =
      req.get('x-bootstrap-token')?.trim() || '';
    const {
      email,
      password,
      displayName,
    } = req.body || {};

    const result =
      await humanAuthService.bootstrapInitialOwner({
        bootstrapToken,
        email: String(email || ''),
        password: String(password || ''),
        displayName:
          typeof displayName === 'string'
            ? displayName
            : undefined,
      });

    return res.status(201).json({
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        status: result.user.status,
      },
      membership: {
        accountId: result.membership.accountId,
        role: result.membership.role,
        status: result.membership.status,
      },
    });
  } catch (error) {
    return handleAuthError(error, res);
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    requireSameOrigin(req);

    const previousSessionSecret =
      sessionSecretFromRequest(req.get('cookie'));
    const { email, password } = req.body || {};

    const result = await humanAuthService.login({
      email: String(email || ''),
      password: String(password || ''),
      previousSessionSecret,
    });

    const csrfToken = createCsrfToken();
    issueAuthCookies(res, {
      sessionSecret: result.secret,
      expiresAt: result.context.session.expiresAt,
      csrfToken,
    });

    return res.json({
      ...publicContext(result.context),
      memberships: result.memberships.map(
        (membership) => ({
          accountId: membership.accountId,
          role: membership.role,
          status: membership.status,
        })
      ),
      csrfToken,
    });
  } catch (error) {
    return handleAuthError(error, res);
  }
});

authRouter.get('/me', async (req, res) => {
  try {
    const secret = sessionSecretFromRequest(
      req.get('cookie')
    );
    if (!secret) {
      return res.status(401).json({
        error: {
          code: 'AUTH_SESSION_REQUIRED',
          message: 'Authentication is required.',
        },
      });
    }

    const context =
      await humanAuthService.resolveSession(secret);
    return res.json(publicContext(context));
  } catch {
    return res.status(401).json({
      error: {
        code: 'AUTH_SESSION_INVALID',
        message: 'Authentication is required.',
      },
    });
  }
});

authRouter.post('/logout', async (req, res) => {
  try {
    requireSameOrigin(req);
    requireDoubleSubmitCsrf(req);

    const secret = sessionSecretFromRequest(
      req.get('cookie')
    );
    if (secret) {
      await humanAuthService.logout(secret);
    }

    clearAuthCookies(res);
    return res.status(204).end();
  } catch (error) {
    return handleAuthError(error, res);
  }
});
