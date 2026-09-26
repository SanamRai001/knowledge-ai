import express from 'express';
import type {
  Server,
} from 'http';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  humanIdentityFoundationService,
} from '../server/identity/humanIdentityFoundationService.js';
import {
  apiKeyRuntimeService,
} from '../server/apiKeyRuntimeService.js';
import {
  AUTH_SESSION_COOKIE,
} from '../server/identity/authHttpSecurity.js';
import {
  applicationIdentityMiddleware,
} from '../server/requestIdentityMiddleware.js';
import {
  I1_TEST_THRESHOLDS,
} from '../server/security/i1SecurityThresholds.js';
import {
  assertMeasuredThresholds,
  runHttpLoad,
} from './support/i1HttpLoadHarness.js';

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
  app.get(
    '/identity',
    applicationIdentityMiddleware,
    (_req, res) => {
      res.json(
        res.locals.requestIdentity
      );
    }
  );

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
      'I1 PostgreSQL isolation server failed to bind.'
    );
  }
  return {
    server,
    origin:
      'http://127.0.0.1:' +
      address.port,
  };
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'I1 concurrent isolation proof must run in PostgreSQL mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the I1 concurrent isolation proof.'
  );

  await runPostgresMigrations();
  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
  await apiKeyRuntimeService.bootstrap();

  process.env.NODE_ENV =
    'production';
  delete process.env
    .KNOWLEDGE_AI_ALLOW_DEFAULT_WEB;

  const accountA =
    'acc_i1_concurrent_a';
  const accountB =
    'acc_i1_concurrent_b';

  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  const userA =
    await humanIdentityFoundationService
      .createUser({
        email:
          'i1-a@example.test',
        displayName: 'I1 A',
      });
  const userB =
    await humanIdentityFoundationService
      .createUser({
        email:
          'i1-b@example.test',
        displayName: 'I1 B',
      });

  await humanIdentityFoundationService
    .upsertMembership({
      accountId: accountA,
      userId: userA.id,
      role: 'OWNER',
    });
  await humanIdentityFoundationService
    .upsertMembership({
      accountId: accountB,
      userId: userB.id,
      role: 'OWNER',
    });

  const sessionA =
    await humanIdentityFoundationService
      .createSession({
        userId: userA.id,
        selectedAccountId:
          accountA,
      });
  const sessionB =
    await humanIdentityFoundationService
      .createSession({
        userId: userB.id,
        selectedAccountId:
          accountB,
      });

  const keyA =
    await apiKeyRuntimeService
      .createApiKey({
        accountId: accountA,
        name: 'I1 key A',
        environment: 'test',
        scopes: ['knowledge:read'],
      });
  const keyB =
    await apiKeyRuntimeService
      .createApiKey({
        accountId: accountB,
        name: 'I1 key B',
        environment: 'test',
        scopes: ['knowledge:read'],
      });

  const { server, origin } =
    await startServer();

  try {
    const expected = [
      {
        source: 'HUMAN_SESSION',
        accountId: accountA,
        userId: userA.id,
      },
      {
        source: 'HUMAN_SESSION',
        accountId: accountB,
        userId: userB.id,
      },
      {
        source: 'API_KEY',
        accountId: accountA,
        apiKeyId: keyA.apiKey.id,
      },
      {
        source: 'API_KEY',
        accountId: accountB,
        apiKeyId: keyB.apiKey.id,
      },
    ] as const;

    const summary =
      await runHttpLoad({
        origin,
        path: '/identity',
        requestCount:
          I1_TEST_THRESHOLDS
            .localHttpSmoke
            .requestCount,
        concurrency:
          I1_TEST_THRESHOLDS
            .localHttpSmoke
            .concurrency,
        requestInit(index) {
          const group =
            index %
            expected.length;
          const headers:
            Record<string,string> = {
              'x-account-id':
                group % 2 === 0
                  ? accountB
                  : accountA,
            };

          if (group === 0) {
            headers.cookie =
              AUTH_SESSION_COOKIE +
              '=' +
              encodeURIComponent(
                sessionA.secret
              );
          } else if (
            group === 1
          ) {
            headers.cookie =
              AUTH_SESSION_COOKIE +
              '=' +
              encodeURIComponent(
                sessionB.secret
              );
          } else if (
            group === 2
          ) {
            headers.authorization =
              'Bearer ' +
              keyA.secret;
          } else {
            headers.authorization =
              'Bearer ' +
              keyB.secret;
          }

          return { headers };
        },
        expectedStatus(status) {
          return status === 200;
        },
        async validateResponse(
          response,
          index
        ) {
          const body: any =
            await response.json();
          const wanted =
            expected[
              index %
                expected.length
            ];

          return (
            body.source ===
              wanted.source &&
            body.accountId ===
              wanted.accountId &&
            ('userId' in wanted
              ? body.userId ===
                  wanted.userId &&
                !body.apiKeyId
              : body.apiKeyId ===
                  wanted.apiKeyId &&
                !body.userId)
          );
        },
      });

    assertMeasuredThresholds(
      summary,
      I1_TEST_THRESHOLDS
        .localHttpSmoke
    );
    assert(
      summary.validationFailures ===
        0 &&
        summary.successes ===
          I1_TEST_THRESHOLDS
            .localHttpSmoke
            .requestCount,
      'Concurrent HUMAN_SESSION/API_KEY isolation must have zero tenant mismatches.'
    );

    const ambiguous = await fetch(
      origin + '/identity',
      {
        headers: {
          cookie:
            AUTH_SESSION_COOKIE +
            '=' +
            encodeURIComponent(
              sessionA.secret
            ),
          authorization:
            'Bearer ' +
            keyB.secret,
        },
      }
    );
    assert(
      ambiguous.status === 400,
      'Mixed human-session and API-key credentials must fail closed.'
    );
    const ambiguousBody: any =
      await ambiguous.json();
    assert(
      ambiguousBody.code ===
        'AMBIGUOUS_CREDENTIALS',
      'Mixed credential classes must report AMBIGUOUS_CREDENTIALS.'
    );

    console.log(
      'PRODUCTION_I1_CONCURRENT_ISOLATION_POSTGRES_CHECK_PASSED'
    );
    console.log(
      JSON.stringify(
        {
          thresholdClass:
            'isolated-ci-identity-smoke',
          thresholds:
            I1_TEST_THRESHOLDS
              .localHttpSmoke,
          measured: summary,
          credentialClasses: [
            'HUMAN_SESSION',
            'API_KEY',
          ],
          accounts: 2,
          disclaimer:
            'This proves bounded CI concurrency/isolation only; it is not a production capacity claim.',
        },
        null,
        2
      )
    );
  } finally {
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

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_I1_CONCURRENT_ISOLATION_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
