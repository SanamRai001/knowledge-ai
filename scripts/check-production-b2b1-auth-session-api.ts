import express from 'express';
import type { Server } from 'http';
import { authRouter } from '../server/identity/authRouter.js';
import {
  AUTH_CSRF_COOKIE,
  AUTH_SESSION_COOKIE,
} from '../server/identity/authHttpSecurity.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import { hashBrowserSessionToken } from '../server/identity/humanIdentityFoundationService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function cookieValue(
  setCookie: string,
  name: string
): string {
  const prefix = name + '=';
  for (const part of setCookie.split(',')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(
        trimmed.slice(prefix.length).split(';')[0]
      );
    }
    const embedded = trimmed.indexOf(prefix);
    if (embedded >= 0) {
      return decodeURIComponent(
        trimmed
          .slice(embedded + prefix.length)
          .split(';')[0]
      );
    }
  }
  throw new Error('Cookie not found: ' + name);
}

async function reset(): Promise<void> {
  await postgresPool().query(
    `UPDATE auth_bootstrap_state
     SET consumed_at = NULL,
         consumed_by_user_id = NULL
     WHERE id = 'initial-owner'`
  );
  await postgresPool().query(`
    TRUNCATE TABLE
      browser_sessions,
      user_password_credentials,
      account_memberships,
      users,
      account_workspace_state,
      workspaces,
      accounts
    CASCADE
  `);
}

async function startTestServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = await new Promise<Server>(
    (resolve) => {
      const listener = app.listen(
        0,
        '127.0.0.1',
        () => resolve(listener)
      );
    }
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server failed to bind.');
  }
  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2B1 auth proof.'
  );

  const firstMigration = await runPostgresMigrations();
  assert(
    firstMigration.applied.includes('008') ||
      firstMigration.alreadyApplied.includes('008'),
    'Migration 008 human credentials must be present.'
  );
  const secondMigration = await runPostgresMigrations();
  assert(
    secondMigration.applied.length === 0 &&
      secondMigration.alreadyApplied.includes('008'),
    'Human credential migration must be repeatable.'
  );

  await reset();

  process.env.KNOWLEDGE_AI_BOOTSTRAP_TOKEN =
    'b2b1-bootstrap-token-0123456789-abcdef';
  process.env.KNOWLEDGE_AI_BOOTSTRAP_ACCOUNT_ID =
    'acc_b2b1_primary';
  process.env.NODE_ENV = 'production';

  const { server, baseUrl } =
    await startTestServer();
  process.env.KNOWLEDGE_AI_PUBLIC_ORIGIN =
    baseUrl;

  try {
    const bootstrapDenied = await fetch(
      baseUrl + '/api/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bootstrap-token': 'wrong-token',
        },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'A-strong-bootstrap-password-123!',
        }),
      }
    );
    assert(
      bootstrapDenied.status === 403,
      'Initial owner bootstrap must reject the wrong bootstrap secret.'
    );

    const invalidBootstrapEmail = await fetch(
      baseUrl + '/api/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bootstrap-token':
            process.env.KNOWLEDGE_AI_BOOTSTRAP_TOKEN!,
        },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'A-strong-bootstrap-password-123!',
        }),
      }
    );
    assert(
      invalidBootstrapEmail.status === 400,
      'Bootstrap must reject malformed email input without consuming the one-time bootstrap.'
    );

    const bootstrap = await fetch(
      baseUrl + '/api/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bootstrap-token':
            process.env.KNOWLEDGE_AI_BOOTSTRAP_TOKEN!,
        },
        body: JSON.stringify({
          email: 'Owner@Example.com',
          password: 'A-strong-bootstrap-password-123!',
          displayName: 'Initial Owner',
        }),
      }
    );
    assert(
      bootstrap.status === 201,
      'Configured bootstrap secret must create the initial owner exactly once.'
    );
    const bootstrapBody: any =
      await bootstrap.json();
    assert(
      bootstrapBody.user.email ===
        'Owner@Example.com' &&
        bootstrapBody.membership.role === 'OWNER' &&
        bootstrapBody.membership.accountId ===
          'acc_b2b1_primary',
      'Bootstrap must create the configured account OWNER.'
    );

    const credential = await postgresPool().query(
      `SELECT
         algorithm,
         salt_base64,
         hash_base64,
         scrypt_n,
         scrypt_r,
         scrypt_p,
         key_length
       FROM user_password_credentials
       WHERE user_id = $1`,
      [bootstrapBody.user.id]
    );
    assert(
      credential.rowCount === 1 &&
        credential.rows[0].algorithm ===
          'scrypt-v1' &&
        credential.rows[0].hash_base64 !==
          'A-strong-bootstrap-password-123!' &&
        credential.rows[0].salt_base64 !==
          'A-strong-bootstrap-password-123!' &&
        credential.rows[0].scrypt_n >= 32768 &&
        credential.rows[0].key_length >= 32,
      'Passwords must be stored only as salted scrypt credentials.'
    );

    const bootstrapAgain = await fetch(
      baseUrl + '/api/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bootstrap-token':
            process.env.KNOWLEDGE_AI_BOOTSTRAP_TOKEN!,
        },
        body: JSON.stringify({
          email: 'second@example.com',
          password: 'Another-strong-password-123!',
        }),
      }
    );
    assert(
      bootstrapAgain.status === 409,
      'Initial owner bootstrap must be durably one-time.'
    );

    const malformedLogin = await fetch(
      baseUrl + '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
        },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'anything-at-all',
        }),
      }
    );
    assert(
      malformedLogin.status === 401,
      'Malformed login identity must fail as invalid credentials rather than an internal error.'
    );

    const wrongOrigin = await fetch(
      baseUrl + '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://attacker.example',
        },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'A-strong-bootstrap-password-123!',
        }),
      }
    );
    assert(
      wrongOrigin.status === 403,
      'Login must reject a cross-origin browser mutation.'
    );

    const wrongPassword = await fetch(
      baseUrl + '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
        },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'wrong-password',
        }),
      }
    );
    assert(
      wrongPassword.status === 401 &&
        !wrongPassword.headers.get('set-cookie'),
      'Wrong credentials must not issue browser cookies.'
    );

    const login = await fetch(
      baseUrl + '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
        },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'A-strong-bootstrap-password-123!',
        }),
      }
    );
    assert(
      login.status === 200,
      'Valid owner credentials must create a browser session.'
    );
    const loginBody: any = await login.json();
    assert(
      loginBody.user.id === bootstrapBody.user.id &&
        loginBody.membership.role === 'OWNER' &&
        loginBody.session.selectedAccountId ===
          'acc_b2b1_primary',
      'Login must resolve the human identity and its single active account membership.'
    );

    const setCookie =
      login.headers.get('set-cookie') || '';
    assert(
      setCookie.includes(
        AUTH_SESSION_COOKIE + '='
      ) &&
        setCookie.includes(
          AUTH_CSRF_COOKIE + '='
        ) &&
        setCookie.includes('HttpOnly') &&
        setCookie.includes('SameSite=Lax') &&
        setCookie.includes('Secure'),
      'Production login cookies must include HttpOnly session protection, SameSite, and Secure.'
    );

    const sessionSecret = cookieValue(
      setCookie,
      AUTH_SESSION_COOKIE
    );
    const csrfToken = cookieValue(
      setCookie,
      AUTH_CSRF_COOKIE
    );
    const cookieHeader =
      AUTH_SESSION_COOKIE +
      '=' +
      encodeURIComponent(sessionSecret) +
      '; ' +
      AUTH_CSRF_COOKIE +
      '=' +
      encodeURIComponent(csrfToken);

    const persistedSession =
      await postgresPool().query(
        `SELECT token_hash
         FROM browser_sessions
         WHERE id = $1`,
        [loginBody.session.id]
      );
    assert(
      persistedSession.rows[0].token_hash ===
        hashBrowserSessionToken(sessionSecret) &&
        persistedSession.rows[0].token_hash !==
          sessionSecret,
      'The browser receives the opaque secret while PostgreSQL stores only its hash.'
    );

    const me = await fetch(
      baseUrl + '/api/auth/me',
      {
        headers: {
          cookie: cookieHeader,
        },
      }
    );
    assert(
      me.status === 200,
      'A valid session cookie must authenticate GET /api/auth/me.'
    );
    const meBody: any = await me.json();
    assert(
      meBody.user.id === bootstrapBody.user.id &&
        !('tokenHash' in meBody.session),
      '/api/auth/me must return human identity without exposing persisted session hashes.'
    );

    const logoutMissingCsrf = await fetch(
      baseUrl + '/api/auth/logout',
      {
        method: 'POST',
        headers: {
          origin: baseUrl,
          cookie: cookieHeader,
        },
      }
    );
    assert(
      logoutMissingCsrf.status === 403,
      'Cookie-authenticated mutation must require the double-submit CSRF token.'
    );

    const stillAuthenticated = await fetch(
      baseUrl + '/api/auth/me',
      {
        headers: {
          cookie: cookieHeader,
        },
      }
    );
    assert(
      stillAuthenticated.status === 200,
      'Failed CSRF validation must not revoke the session.'
    );

    const logout = await fetch(
      baseUrl + '/api/auth/logout',
      {
        method: 'POST',
        headers: {
          origin: baseUrl,
          cookie: cookieHeader,
          'x-csrf-token': csrfToken,
        },
      }
    );
    assert(
      logout.status === 204,
      'Valid same-origin CSRF-protected logout must revoke the session.'
    );
    const logoutCookies =
      logout.headers.get('set-cookie') || '';
    assert(
      logoutCookies.includes('Max-Age=0'),
      'Logout must clear browser auth cookies.'
    );

    const revokedMe = await fetch(
      baseUrl + '/api/auth/me',
      {
        headers: {
          cookie: cookieHeader,
        },
      }
    );
    assert(
      revokedMe.status === 401,
      'Revoked session must fail closed on /api/auth/me.'
    );

    console.log(
      'PRODUCTION_B2B1_AUTH_SESSION_API_CHECK_PASSED'
    );
    console.log(
      'One-time initial OWNER bootstrap, salted scrypt credentials, same-origin login, secure HttpOnly session cookie, double-submit CSRF protection, /api/auth/me, logout revocation, and non-leaking session responses are verified.'
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });
    await closePostgresPool();
  }
}

main().catch(async (error) => {
  console.error(
    'PRODUCTION_B2B1_AUTH_SESSION_API_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
