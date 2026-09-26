import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const migration = read(
    'server/persistence/migrations/020_distributed_security_state.sql'
  );
  assert(
    migration.includes(
      'CREATE TABLE security_rate_limit_events'
    ) &&
      migration.includes(
        'CREATE TABLE integration_oauth_attempts'
      ) &&
      migration.includes(
        "'INTEGRATION_OAUTH_ATTEMPT'"
      ),
    'I2 must define shared rate-limit, OAuth-attempt, and transient secret persistence.'
  );

  const thresholds = read(
    'server/security/i2SecurityThresholds.ts'
  );
  assert(
    thresholds.includes(
      'maxRequestsPerWindow: 100'
    ) &&
      thresholds.includes(
        'windowMs: 60_000'
      ) &&
      thresholds.includes(
        'maxAttemptsPerWindow: 10'
      ) &&
      thresholds.includes(
        '15 * 60_000'
      ) &&
      thresholds.includes(
        'stateTtlMs: 10 * 60_000'
      ),
    'I2 thresholds must preserve 100/60 API-key and 10-minute OAuth state contracts while adding bounded login throttling.'
  );

  const securityState = read(
    'server/security/distributedSecurityState.ts'
  );
  for (const invariant of [
    'pg_advisory_xact_lock',
    'security_rate_limit_events',
    'integration_oauth_attempts',
    'FOR UPDATE',
    'FOR UPDATE SKIP LOCKED',
    'ACCOUNT_MISMATCH',
    'cleanupRateEvents',
    'cleanupExpiredOAuthAttempts',
  ]) {
    assert(
      securityState.includes(invariant),
      'I2 shared security-state service is missing: ' +
        invariant
    );
  }

  const apiRuntime = read(
    'server/apiKeyRuntimeService.ts'
  );
  const identity = read(
    'server/requestIdentity.ts'
  );
  const server = read('server.ts');
  assert(
    apiRuntime.includes(
      'distributedSecurityState'
    ) &&
      apiRuntime.includes(
        "scope: 'API_KEY'"
      ) &&
      identity.includes(
        'await resolveApiKeyIdentity'
      ) &&
      identity.includes(
        '.checkRateLimit('
      ) &&
      server.includes(
        'await apiKeyRuntimeService.checkRateLimit'
      ) &&
      !server.includes(
        'const rateLimit = apiKeyStore.checkRateLimit(validation.apiKey.id, 100)'
      ),
    'Both modern and legacy API-key HTTP paths must use the shared PostgreSQL quota boundary.'
  );

  const loginThrottle = read(
    'server/identity/humanLoginThrottleService.ts'
  );
  const humanAuth = read(
    'server/identity/humanAuthService.ts'
  );
  const authRouter = read(
    'server/identity/authRouter.ts'
  );
  const reserveIndex =
    humanAuth.indexOf(
      '.reserve(params.email)'
    );
  const normalizeIndex =
    humanAuth.indexOf(
      'normalizeLoginEmail(params.email)'
    );

  assert(
    loginThrottle.includes(
      "scope: 'HUMAN_LOGIN'"
    ) &&
      reserveIndex >= 0 &&
      normalizeIndex >
        reserveIndex &&
      humanAuth.includes(
        "'AUTH_RATE_LIMITED'"
      ) &&
      humanAuth.includes(
        'Email or password is incorrect. Try again later.'
      ) &&
      authRouter.includes(
        "error.code === 'AUTH_RATE_LIMITED'"
      ) &&
      authRouter.includes(
        "'Retry-After'"
      ),
    'Human login throttling must happen before identity lookup and remain non-enumerating.'
  );

  const googleState = read(
    'server/integrations/googleDriveOAuthStateStore.ts'
  );
  const oneDriveState = read(
    'server/integrations/microsoftOneDriveOAuthStateStore.ts'
  );
  const googleService = read(
    'server/integrations/googleDriveOAuthService.ts'
  );
  const oneDriveService = read(
    'server/integrations/microsoftOneDriveOAuthService.ts'
  );
  const secretContract = read(
    'server/security/secretStoreContract.ts'
  );

  assert(
    googleState.includes(
      'GoogleDriveOAuthStateRuntime'
    ) &&
      googleState.includes(
        'createOAuthAttempt'
      ) &&
      googleState.includes(
        'consumeOAuthAttempt'
      ) &&
      googleService.includes(
        'googleDriveOAuthStateRuntime'
      ) &&
      googleService.includes(
        'await this.stateStore.create'
      ) &&
      googleService.includes(
        'await this.stateStore.consume'
      ),
    'Google OAuth must use shared one-time state in PostgreSQL mode.'
  );

  assert(
    oneDriveState.includes(
      'MicrosoftOneDriveOAuthStateRuntime'
    ) &&
      oneDriveState.includes(
        "'INTEGRATION_OAUTH_ATTEMPT'"
      ) &&
      oneDriveState.includes(
        'postgresSecretStore'
      ) &&
      oneDriveState.includes(
        'codeVerifier'
      ) &&
      oneDriveService.includes(
        'microsoftOneDriveOAuthStateRuntime'
      ) &&
      secretContract.includes(
        "'INTEGRATION_OAUTH_ATTEMPT'"
      ),
    'OneDrive OAuth must protect PKCE verifier material behind the F2 SecretStore boundary.'
  );

  assert(
    !migration.includes(
      'code_verifier'
    ) &&
      !migration.includes(
        'access_token'
      ) &&
      !migration.includes(
        'refresh_token'
      ),
    'I2 relational OAuth attempt rows must never store PKCE verifier or provider tokens in plaintext.'
  );

  const cleanup = read(
    'server/integrations/oauthAttemptSecurityCleanup.ts'
  );
  assert(
    cleanup.includes(
      'cleanupExpiredOAuthAttempts'
    ) &&
      cleanup.includes(
        'cleanupUnreferencedOAuthAttemptSecrets'
      ),
    'I2 must have bounded cleanup for expired OAuth attempts and orphaned transient secrets.'
  );

  console.log(
    'PRODUCTION_I2_DISTRIBUTED_ABUSE_AUTH_STATE_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Shared API-key quota, non-enumerating login throttle, cross-replica one-time OAuth state, protected PKCE, replay/account binding, and bounded cleanup contracts are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_I2_DISTRIBUTED_ABUSE_AUTH_STATE_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
