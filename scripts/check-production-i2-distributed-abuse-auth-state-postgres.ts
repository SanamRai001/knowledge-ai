import crypto from 'crypto';
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
  ApiKeyRuntimeService,
} from '../server/apiKeyRuntimeService.js';
import {
  HumanLoginThrottleService,
} from '../server/identity/humanLoginThrottleService.js';
import {
  GoogleDriveOAuthService,
} from '../server/integrations/googleDriveOAuthService.js';
import {
  GoogleDriveOAuthStateError,
  GoogleDriveOAuthStateRuntime,
} from '../server/integrations/googleDriveOAuthStateStore.js';
import {
  MicrosoftOneDriveOAuthService,
} from '../server/integrations/microsoftOneDriveOAuthService.js';
import {
  MicrosoftOneDriveOAuthStateError,
  MicrosoftOneDriveOAuthStateRuntime,
} from '../server/integrations/microsoftOneDriveOAuthStateStore.js';
import {
  integrationOAuthSecretRuntime,
} from '../server/integrations/integrationOAuthSecretRuntime.js';
import {
  distributedSecurityState,
  hashOAuthState,
} from '../server/security/distributedSecurityState.js';
import {
  cleanupExpiredOAuthSecurityState,
} from '../server/integrations/oauthAttemptSecurityCleanup.js';
import {
  postgresSecretStore,
} from '../server/security/postgresSecretStore.js';
import {
  I2_SECURITY_THRESHOLDS,
} from '../server/security/i2SecurityThresholds.js';
import {
  GOOGLE_DRIVE_FILE_SCOPE,
} from '../server/integrations/googleDriveConfig.js';
import {
  MICROSOFT_GRAPH_FILES_READ_SCOPE,
  MICROSOFT_OFFLINE_SCOPE,
} from '../server/integrations/microsoftOneDriveConfig.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function base64Key(
  fill: number
): string {
  return Buffer.alloc(
    32,
    fill
  ).toString('base64');
}

function stateFrom(
  authorizationUrl: string
): string {
  const state =
    new URL(
      authorizationUrl
    ).searchParams.get('state');
  assert(
    Boolean(state),
    'OAuth authorization URL must include state.'
  );
  return state!;
}

function challengeFrom(
  authorizationUrl: string
): string {
  const challenge =
    new URL(
      authorizationUrl
    ).searchParams.get(
      'code_challenge'
    );
  assert(
    Boolean(challenge),
    'OneDrive authorization URL must include S256 challenge.'
  );
  return challenge!;
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'I2 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for I2 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes('020') ||
      migrations.alreadyApplied.includes(
        '020'
      ),
    'I2 requires migration 020.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );
  await postgresPool().query(
    'TRUNCATE TABLE security_rate_limit_events RESTART IDENTITY'
  );
  await postgresPool().query(
    'TRUNCATE TABLE integration_oauth_attempts'
  );

  process.env
    .KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID =
    'i2-k1';
  process.env
    .KNOWLEDGE_AI_SECRET_KEYRING_JSON =
    JSON.stringify({
      'i2-k1': base64Key(41),
    });

  process.env.GOOGLE_DRIVE_CLIENT_ID =
    'i2-google-client';
  process.env.GOOGLE_DRIVE_CLIENT_SECRET =
    'i2-google-secret';
  process.env.GOOGLE_DRIVE_REDIRECT_URI =
    'https://app.example.test/api/integrations/google-drive/oauth/callback';

  process.env
    .MICROSOFT_ONEDRIVE_CLIENT_ID =
    'i2-ms-client';
  process.env
    .MICROSOFT_ONEDRIVE_CLIENT_SECRET =
    'i2-ms-secret';
  process.env
    .MICROSOFT_ONEDRIVE_REDIRECT_URI =
    'https://app.example.test/api/integrations/onedrive/oauth/callback';
  process.env
    .MICROSOFT_ONEDRIVE_TENANT_ID =
    'common';

  const accountA = 'acc_i2_a';
  const accountB = 'acc_i2_b';
  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  // API-key quota: two independent runtime instances share one exact bucket.
  const webA =
    new ApiKeyRuntimeService();
  const webB =
    new ApiKeyRuntimeService();
  const keyId =
    'key_i2_shared_quota';

  await distributedSecurityState
    .clearRateLimitSubject(
      'API_KEY',
      keyId
    );

  for (
    let index = 0;
    index <
    I2_SECURITY_THRESHOLDS
      .apiKey
      .maxRequestsPerWindow;
    index += 1
  ) {
    const decision =
      await (
        index % 2 === 0
          ? webA
          : webB
      ).checkRateLimit(keyId);
    assert(
      decision.allowed,
      'Requests 1-100 must be accepted across the shared API-key quota.'
    );
  }

  const apiDenied =
    await webA.checkRateLimit(
      keyId
    );
  assert(
    !apiDenied.allowed &&
      apiDenied.remaining === 0 &&
      apiDenied.resetSeconds >=
        1 &&
      apiDenied.resetSeconds <=
        60,
    'Request 101 from another web instance must share the same 100/60 quota and be denied.'
  );

  // Human login throttle: same identifier shares one quota across replicas.
  const loginA =
    new HumanLoginThrottleService();
  const loginB =
    new HumanLoginThrottleService();
  const loginEmail =
    'Owner@Example.Test';

  await loginA.clear(loginEmail);

  for (
    let index = 0;
    index <
    I2_SECURITY_THRESHOLDS
      .humanLogin
      .maxAttemptsPerWindow;
    index += 1
  ) {
    const decision =
      await (
        index % 2 === 0
          ? loginA
          : loginB
      ).reserve(
        index % 2 === 0
          ? loginEmail
          : loginEmail.toLowerCase()
      );
    assert(
      decision.allowed,
      'Login attempts 1-10 must share one normalized distributed quota.'
    );
  }

  const loginDenied =
    await loginB.reserve(
      loginEmail.toLowerCase()
    );
  assert(
    !loginDenied.allowed &&
      loginDenied.resetSeconds >=
        1,
    'Login attempt 11 must be throttled across replicas without identity lookup.'
  );

  await loginA.clear(loginEmail);
  assert(
    (
      await loginB.reserve(
        loginEmail
      )
    ).allowed,
    'Successful-login reset semantics must clear the distributed login bucket.'
  );
  await loginA.clear(loginEmail);

  let googleFetches = 0;
  const googleFetch:
    typeof fetch = async () => {
      googleFetches += 1;
      return new Response(
        JSON.stringify({
          access_token:
            'i2-google-access',
          refresh_token:
            'i2-google-refresh',
          expires_in: 3600,
          scope:
            GOOGLE_DRIVE_FILE_SCOPE,
          token_type: 'Bearer',
        }),
        {
          status: 200,
          headers: {
            'Content-Type':
              'application/json',
          },
        }
      );
    };

  const googleWebA =
    new GoogleDriveOAuthService(
      new GoogleDriveOAuthStateRuntime(),
      integrationOAuthSecretRuntime,
      googleFetch
    );
  const googleWebB =
    new GoogleDriveOAuthService(
      new GoogleDriveOAuthStateRuntime(),
      integrationOAuthSecretRuntime,
      googleFetch
    );

  const googleStart =
    await googleWebA.begin({
      accountId: accountA,
      displayName:
        'I2 Google A to B',
    });
  const googleState =
    stateFrom(
      googleStart.authorizationUrl
    );

  const googleComplete =
    await googleWebB.complete({
      state: googleState,
      code: 'i2-google-code',
      expectedAccountId:
        accountA,
    });

  assert(
    googleComplete.connection
      .accountId === accountA &&
      googleFetches === 1,
    'Google OAuth start on web A must complete on web B using shared state.'
  );

  let googleReplayDenied = false;
  try {
    await googleWebA.complete({
      state: googleState,
      code: 'replay',
      expectedAccountId:
        accountA,
    });
  } catch (error) {
    googleReplayDenied =
      error instanceof
        GoogleDriveOAuthStateError &&
      error.code ===
        'OAUTH_STATE_INVALID';
  }
  assert(
    googleReplayDenied &&
      googleFetches === 1,
    'Google shared OAuth state must be one-time and deny replay before provider exchange.'
  );

  const googleCross =
    await googleWebA.begin({
      accountId: accountA,
      displayName:
        'I2 Google cross-account',
    });
  const googleCrossState =
    stateFrom(
      googleCross.authorizationUrl
    );

  let googleCrossDenied = false;
  try {
    await googleWebB.complete({
      state:
        googleCrossState,
      code: 'wrong-account',
      expectedAccountId:
        accountB,
    });
  } catch (error) {
    googleCrossDenied =
      error instanceof
        GoogleDriveOAuthStateError &&
      error.code ===
        'OAUTH_ACCOUNT_MISMATCH';
  }
  assert(
    googleCrossDenied,
    'Google OAuth shared state must reject a different account without consuming the state.'
  );

  await googleWebB.complete({
    state: googleCrossState,
    code: 'correct-account',
    expectedAccountId:
      accountA,
  });

  let capturedVerifier = '';
  const oneDriveFetch:
    typeof fetch = async (
      _input,
      init
    ) => {
      const body =
        new URLSearchParams(
          String(
            init?.body || ''
          )
        );
      capturedVerifier =
        body.get(
          'code_verifier'
        ) || '';

      return new Response(
        JSON.stringify({
          access_token:
            'i2-ms-access',
          refresh_token:
            'i2-ms-refresh',
          expires_in: 3600,
          scope:
            MICROSOFT_OFFLINE_SCOPE +
            ' ' +
            MICROSOFT_GRAPH_FILES_READ_SCOPE,
          token_type: 'Bearer',
        }),
        {
          status: 200,
          headers: {
            'Content-Type':
              'application/json',
          },
        }
      );
    };

  const oneDriveWebA =
    new MicrosoftOneDriveOAuthService(
      new MicrosoftOneDriveOAuthStateRuntime(),
      integrationOAuthSecretRuntime,
      oneDriveFetch
    );
  const oneDriveWebB =
    new MicrosoftOneDriveOAuthService(
      new MicrosoftOneDriveOAuthStateRuntime(),
      integrationOAuthSecretRuntime,
      oneDriveFetch
    );

  const oneDriveStart =
    await oneDriveWebA.begin({
      accountId: accountA,
      displayName:
        'I2 OneDrive A to B',
    });
  const oneDriveState =
    stateFrom(
      oneDriveStart.authorizationUrl
    );
  const oneDriveChallenge =
    challengeFrom(
      oneDriveStart.authorizationUrl
    );

  const persistedAttempt =
    await postgresPool().query<{
      secret_ref: string | null;
    }>(
      `SELECT secret_ref
       FROM integration_oauth_attempts
       WHERE provider =
           'MICROSOFT_ONEDRIVE'
         AND state_hash = $1`,
      [
        hashOAuthState(
          oneDriveState
        ),
      ]
    );
  const pkceSecretRef =
    persistedAttempt.rows[0]
      ?.secret_ref;
  assert(
    Boolean(pkceSecretRef),
    'OneDrive distributed state must reference an encrypted transient PKCE secret.'
  );

  const encryptedPkce =
    await postgresPool().query<{
      ciphertext: string;
    }>(
      `SELECT v.ciphertext
       FROM account_secret_versions v
       JOIN account_secrets s
         ON s.account_id =
            v.account_id
        AND s.id =
            v.secret_id
       WHERE s.account_id = $1
         AND s.id = $2
         AND s.purpose =
             'INTEGRATION_OAUTH_ATTEMPT'
         AND v.status = 'ACTIVE'`,
      [
        accountA,
        pkceSecretRef,
      ]
    );
  assert(
    encryptedPkce.rowCount === 1,
    'OneDrive PKCE verifier must be stored through the encrypted F2 SecretStore.'
  );

  const oneDriveComplete =
    await oneDriveWebB.complete({
      state:
        oneDriveState,
      code: 'i2-ms-code',
      expectedAccountId:
        accountA,
    });
  assert(
    oneDriveComplete.connection
      .accountId === accountA &&
      capturedVerifier.length >=
        43 &&
      crypto
        .createHash('sha256')
        .update(
          capturedVerifier,
          'utf8'
        )
        .digest('base64url') ===
        oneDriveChallenge,
    'OneDrive callback on web B must recover the protected PKCE verifier that matches web A S256 challenge.'
  );

  const secretAfterConsume =
    await postgresSecretStore
      .findMetadata(
        accountA,
        pkceSecretRef!
      );
  assert(
    secretAfterConsume === null,
    'Consumed OneDrive PKCE attempt secret must be deleted.'
  );

  let oneDriveReplayDenied = false;
  try {
    await oneDriveWebA.complete({
      state: oneDriveState,
      code: 'replay',
      expectedAccountId:
        accountA,
    });
  } catch (error) {
    oneDriveReplayDenied =
      error instanceof
        MicrosoftOneDriveOAuthStateError &&
      error.code ===
        'ONEDRIVE_OAUTH_STATE_INVALID';
  }
  assert(
    oneDriveReplayDenied,
    'OneDrive shared OAuth state must deny replay.'
  );

  const oneDriveCross =
    await oneDriveWebA.begin({
      accountId: accountA,
      displayName:
        'I2 OneDrive cross-account',
    });
  const oneDriveCrossState =
    stateFrom(
      oneDriveCross.authorizationUrl
    );

  let oneDriveCrossDenied = false;
  try {
    await oneDriveWebB.complete({
      state:
        oneDriveCrossState,
      code: 'wrong-account',
      expectedAccountId:
        accountB,
    });
  } catch (error) {
    oneDriveCrossDenied =
      error instanceof
        MicrosoftOneDriveOAuthStateError &&
      error.code ===
        'ONEDRIVE_OAUTH_ACCOUNT_MISMATCH';
  }
  assert(
    oneDriveCrossDenied,
    'OneDrive cross-account callback must not consume another account state.'
  );

  await oneDriveWebB.complete({
    state:
      oneDriveCrossState,
    code: 'correct-account',
    expectedAccountId:
      accountA,
  });

  // Expired OAuth rows and their transient secrets are cleaned in bounded batches.
  const expiredSecret =
    await postgresSecretStore
      .create({
        accountId: accountA,
        purpose:
          'INTEGRATION_OAUTH_ATTEMPT',
        provider:
          'MICROSOFT_ONEDRIVE',
        secret: {
          codeVerifier:
            'x'.repeat(64),
        },
      });
  const expiredState =
    'i2-expired-oauth-state';
  const now = Date.now();

  await distributedSecurityState
    .createOAuthAttempt({
      stateHash:
        hashOAuthState(
          expiredState
        ),
      attempt: {
        provider:
          'MICROSOFT_ONEDRIVE',
        accountId: accountA,
        displayName:
          'Expired I2 attempt',
        redirectUri:
          process.env
            .MICROSOFT_ONEDRIVE_REDIRECT_URI!,
        tenant: 'common',
        secretRef:
          expiredSecret.id,
        createdAt:
          now -
          I2_SECURITY_THRESHOLDS
            .oauth.stateTtlMs -
          1_000,
        expiresAt:
          now - 1_000,
      },
    });

  const cleaned =
    await cleanupExpiredOAuthSecurityState();
  assert(
    cleaned.attemptsDeleted >= 1,
    'I2 cleanup must remove expired OAuth attempt rows in bounded batches.'
  );
  assert(
    (
      await postgresSecretStore
        .findMetadata(
          accountA,
          expiredSecret.id
        )
    ) === null,
    'I2 cleanup must delete orphaned transient OAuth attempt secrets.'
  );

  // Explicit bounded rate-event cleanup.
  await postgresPool().query(
    `INSERT INTO security_rate_limit_events
      (scope, subject_hash, occurred_at)
     SELECT
       'HUMAN_LOGIN',
       repeat('a', 64),
       now() - interval '1 hour'
     FROM generate_series(1, 5)`
  );
  const deletedBatch =
    await distributedSecurityState
      .cleanupRateEvents({
        olderThan:
          Date.now() -
          30 * 60_000,
        limit: 2,
      });
  assert(
    deletedBatch === 2,
    'Rate-event cleanup must honor its bounded batch limit.'
  );

  console.log(
    'PRODUCTION_I2_DISTRIBUTED_ABUSE_AUTH_STATE_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Cross-replica API-key quota, login throttle, Google/OneDrive OAuth completion, replay/account binding, encrypted PKCE recovery, expiry cleanup, and bounded retention are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_I2_DISTRIBUTED_ABUSE_AUTH_STATE_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
