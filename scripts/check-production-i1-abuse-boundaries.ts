import express from 'express';
import type {
  Server,
} from 'http';
import crypto from 'crypto';
import {
  apiKeyStore,
  API_KEY_RATE_LIMIT_MAX_REQUESTS,
} from '../server/apiKeyStore.js';
import {
  applicationIdentityMiddleware,
} from '../server/requestIdentityMiddleware.js';
import {
  requestSizeGuard,
} from '../server/runtime/securityHeadersMiddleware.js';
import {
  parseCsvBuffer,
  CsvParseError,
  CSV_LIMITS,
} from '../server/datasets/csvParser.js';
import {
  parseXlsxBuffer,
  XlsxParseError,
  XLSX_LIMITS,
} from '../server/datasets/xlsxParser.js';
import {
  parsePdfBuffer,
} from '../server/documentService.js';
import {
  GoogleDriveOAuthStateStore,
  GoogleDriveOAuthStateError,
} from '../server/integrations/googleDriveOAuthStateStore.js';
import {
  GoogleDriveOAuthError,
  GoogleDriveOAuthService,
} from '../server/integrations/googleDriveOAuthService.js';
import {
  MicrosoftOneDriveOAuthStateStore,
  MicrosoftOneDriveOAuthStateError,
} from '../server/integrations/microsoftOneDriveOAuthStateStore.js';
import {
  MicrosoftOneDriveOAuthError,
  MicrosoftOneDriveOAuthService,
} from '../server/integrations/microsoftOneDriveOAuthService.js';
import {
  AuthHttpSecurityError,
  AUTH_CSRF_COOKIE,
  AUTH_CSRF_HEADER,
  requireDoubleSubmitCsrf,
  requireSameOrigin,
} from '../server/identity/authHttpSecurity.js';
import {
  I1_TEST_THRESHOLDS,
} from '../server/security/i1SecurityThresholds.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function startServer(): Promise<{
  server: Server;
  origin: string;
}> {
  const app = express();
  app.use(
    requestSizeGuard(128)
  );
  app.use(
    express.json({ limit: 64 })
  );
  app.get(
    '/identity',
    applicationIdentityMiddleware,
    (_req, res) => {
      res.json(
        res.locals.requestIdentity
      );
    }
  );
  app.post('/echo', (req, res) => {
    res.json(req.body);
  });

  const server =
    await new Promise<Server>(
      (resolve) => {
        const listener = app.listen(
          0,
          '127.0.0.1',
          () => resolve(listener)
        );
      }
    );
  const address = server.address();
  if (
    !address ||
    typeof address === 'string'
  ) {
    throw new Error(
      'I1 abuse test server failed to bind.'
    );
  }
  return {
    server,
    origin:
      'http://127.0.0.1:' +
      address.port,
  };
}

function fakeRequest(input: {
  origin?: string;
  cookie?: string;
  csrf?: string;
}) {
  const headers = new Map<string,string>();
  if (input.origin) {
    headers.set('origin', input.origin);
  }
  if (input.cookie) {
    headers.set('cookie', input.cookie);
  }
  if (input.csrf) {
    headers.set(
      AUTH_CSRF_HEADER,
      input.csrf
    );
  }
  return {
    protocol: 'https',
    get(name: string) {
      const key =
        name.toLowerCase();
      if (key === 'host') {
        return 'app.example.test';
      }
      return headers.get(key);
    },
  } as any;
}

async function expectReject(
  promise: Promise<unknown>,
  predicate: (
    error: any
  ) => boolean,
  message: string
) {
  try {
    await promise;
  } catch (error) {
    if (predicate(error)) return;
    throw error;
  }
  throw new Error(message);
}

async function main() {
  process.env.NODE_ENV =
    'production';
  process.env
    .KNOWLEDGE_AI_PUBLIC_ORIGIN =
    'https://app.example.test';

  const rawKey =
    'kn_test_' +
    crypto.randomBytes(20)
      .toString('hex');
  const fixtureKeyId =
    'key_i1_http_' +
    crypto.randomBytes(6)
      .toString('hex');

  apiKeyStore.cacheApiKey({
    id: fixtureKeyId,
    accountId:
      'acc_i1_http_rate',
    name: 'I1 HTTP rate fixture',
    keyPrefix: 'kn_test_',
    keyHash:
      apiKeyStore.hashKey(rawKey),
    maskedKey:
      'kn_test_••••' +
      rawKey.slice(-4),
    environment: 'test',
    scopes: ['knowledge:read'],
    status: 'active',
    createdAt: Date.now(),
    lastUsedAt: null,
    expiresAt: null,
  });

  const { server, origin } =
    await startServer();

  try {
    for (
      let index = 0;
      index <
      API_KEY_RATE_LIMIT_MAX_REQUESTS;
      index += 1
    ) {
      const response = await fetch(
        origin + '/identity',
        {
          headers: {
            authorization:
              'Bearer ' + rawKey,
          },
        }
      );
      assert(
        response.status === 200,
        'Modern API-key identity request ' +
          String(index + 1) +
          ' should be allowed before the threshold.'
      );
    }

    const throttled = await fetch(
      origin + '/identity',
      {
        headers: {
          authorization:
            'Bearer ' + rawKey,
        },
      }
    );
    assert(
      throttled.status === 429 &&
        Number(
          throttled.headers.get(
            'retry-after'
          )
        ) >=
          I1_TEST_THRESHOLDS
            .apiKey
            .minRetryAfterSeconds,
      'Request 101 must be rate limited with Retry-After on the modern identity path.'
    );
    const throttleBody: any =
      await throttled.json();
    assert(
      throttleBody.code ===
        'RATE_LIMITED',
      'Modern API-key abuse response must expose RATE_LIMITED.'
    );

    const jsonTooLarge = await fetch(
      origin + '/echo',
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json',
        },
        body: JSON.stringify({
          value: 'x'.repeat(80),
        }),
      }
    );
    assert(
      jsonTooLarge.status === 413,
      'JSON parser must reject a body over its configured parser boundary.'
    );

    const edgeTooLarge = await fetch(
      origin + '/echo',
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json',
        },
        body: JSON.stringify({
          value: 'x'.repeat(160),
        }),
      }
    );
    assert(
      edgeTooLarge.status === 413,
      'Application edge guard must reject oversized request bodies.'
    );
    const edgeBody: any =
      await edgeTooLarge.json();
    assert(
      edgeBody.code ===
        'REQUEST_BODY_TOO_LARGE',
      'Edge overflow must report REQUEST_BODY_TOO_LARGE.'
    );

    let invalidLengthStatus = 0;
    let invalidLengthCode = '';
    await new Promise<void>(
      (resolve, reject) => {
        requestSizeGuard(128)(
          {
            header(name: string) {
              return name.toLowerCase() ===
                'content-length'
                ? 'not-a-number'
                : undefined;
            },
          } as any,
          {
            status(code: number) {
              invalidLengthStatus =
                code;
              return this;
            },
            json(body: any) {
              invalidLengthCode =
                body.code;
              resolve();
            },
          } as any,
          reject
        );
      }
    );
    assert(
      invalidLengthStatus === 400 &&
        invalidLengthCode ===
          'INVALID_CONTENT_LENGTH',
      'Invalid Content-Length must fail closed.'
    );

    await expectReject(
      Promise.resolve().then(() =>
        parseCsvBuffer(
          Buffer.from(
            'a,b\n"unterminated,b',
            'utf8'
          )
        )
      ),
      (error) =>
        error instanceof CsvParseError,
      'Malformed CSV must fail with a bounded parser error.'
    );

    await expectReject(
      Promise.resolve().then(() =>
        parseCsvBuffer(
          Buffer.alloc(
            CSV_LIMITS.maxFileBytes +
              1
          )
        )
      ),
      (error) =>
        error instanceof CsvParseError,
      'Oversized CSV must be rejected before parsing.'
    );

    await expectReject(
      parseXlsxBuffer(
        Buffer.alloc(
          XLSX_LIMITS.maxFileBytes +
            1
        )
      ),
      (error) =>
        error instanceof XlsxParseError,
      'Oversized XLSX must be rejected before workbook parsing.'
    );

    await expectReject(
      parseXlsxBuffer(
        Buffer.from(
          'not-an-xlsx',
          'utf8'
        )
      ),
      (error) =>
        error instanceof Error,
      'Malformed XLSX must fail without producing a Dataset.'
    );

    await expectReject(
      parsePdfBuffer(
        'invalid-i1.pdf',
        Buffer.from(
          'not-a-pdf',
          'utf8'
        )
      ),
      (error) =>
        error instanceof Error &&
        String(error.message)
          .includes(
            'Failed to parse PDF'
          ),
      'Malformed PDF must fail as an explicit parser error.'
    );

    const googleState =
      new GoogleDriveOAuthStateStore();
    const google =
      googleState.create({
        accountId:
          'acc_i1_google_a',
        displayName: 'I1 Google',
        redirectUri:
          'https://app.example.test/api/integrations/google-drive/oauth/callback',
      });
    const googleService =
      new GoogleDriveOAuthService(
        googleState,
        {} as any,
        (async () => {
          throw new Error(
            'Token exchange must not be reached.'
          );
        }) as any
      );

    await expectReject(
      googleService.complete({
        state: google.state,
        code: 'fake-code',
        expectedAccountId:
          'acc_i1_google_b',
      }),
      (error) =>
        error instanceof
          GoogleDriveOAuthError &&
        error.code ===
          'OAUTH_ACCOUNT_MISMATCH',
      'Google OAuth callback must reject state from another account before token exchange.'
    );
    await expectReject(
      Promise.resolve().then(() =>
        googleState.consume(
          google.state
        )
      ),
      (error) =>
        error instanceof
          GoogleDriveOAuthStateError &&
        error.code ===
          'OAUTH_STATE_INVALID',
      'Consumed Google OAuth state must not be replayable.'
    );

    const oneDriveState =
      new MicrosoftOneDriveOAuthStateStore();
    const oneDrive =
      oneDriveState.create({
        accountId:
          'acc_i1_onedrive_a',
        displayName:
          'I1 OneDrive',
        redirectUri:
          'https://app.example.test/api/integrations/onedrive/oauth/callback',
        tenant: 'common',
      });
    const oneDriveService =
      new MicrosoftOneDriveOAuthService(
        oneDriveState,
        {} as any,
        (async () => {
          throw new Error(
            'Token exchange must not be reached.'
          );
        }) as any
      );

    await expectReject(
      oneDriveService.complete({
        state: oneDrive.state,
        code: 'fake-code',
        expectedAccountId:
          'acc_i1_onedrive_b',
      }),
      (error) =>
        error instanceof
          MicrosoftOneDriveOAuthError &&
        error.code ===
          'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH',
      'OneDrive OAuth callback must reject state from another account before token exchange.'
    );
    await expectReject(
      Promise.resolve().then(() =>
        oneDriveState.consume(
          oneDrive.state
        )
      ),
      (error) =>
        error instanceof
          MicrosoftOneDriveOAuthStateError &&
        error.code ===
          'ONEDRIVE_OAUTH_STATE_INVALID',
      'Consumed OneDrive OAuth state must not be replayable.'
    );

    let originBlocked = false;
    try {
      requireSameOrigin(
        fakeRequest({
          origin:
            'https://attacker.example',
        })
      );
    } catch (error) {
      originBlocked =
        error instanceof
          AuthHttpSecurityError &&
        error.code ===
          'AUTH_ORIGIN_DENIED';
    }
    assert(
      originBlocked,
      'Cross-origin browser mutation must be rejected.'
    );

    const csrfToken =
      'i1-csrf-token';
    requireSameOrigin(
      fakeRequest({
        origin:
          'https://app.example.test',
      })
    );
    requireDoubleSubmitCsrf(
      fakeRequest({
        cookie:
          AUTH_CSRF_COOKIE +
          '=' +
          csrfToken,
        csrf: csrfToken,
      })
    );

    let csrfBlocked = false;
    try {
      requireDoubleSubmitCsrf(
        fakeRequest({
          cookie:
            AUTH_CSRF_COOKIE +
            '=' +
            csrfToken,
          csrf: 'different',
        })
      );
    } catch (error) {
      csrfBlocked =
        error instanceof
          AuthHttpSecurityError &&
        error.code ===
          'AUTH_CSRF_INVALID';
    }
    assert(
      csrfBlocked,
      'Mismatched double-submit CSRF token must be rejected.'
    );

    console.log(
      'PRODUCTION_I1_ABUSE_BOUNDARIES_CHECK_PASSED'
    );
    console.log(
      'Modern API-key 100/min throttling, Retry-After, body limits, malformed/oversized parser rejection, OAuth one-time state/account binding, and browser origin/CSRF boundaries are verified.'
    );
  } finally {
    apiKeyStore.removeCachedApiKey(
      fixtureKeyId
    );
    await new Promise<void>(
      (resolve, reject) => {
        server.close((error) =>
          error
            ? reject(error)
            : resolve()
        );
      }
    );
  }
}

main().catch((error) => {
  console.error(
    'PRODUCTION_I1_ABUSE_BOUNDARIES_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
