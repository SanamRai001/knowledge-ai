import {
  distributedSecurityState,
} from '../security/distributedSecurityState.js';
import {
  postgresSecretStore,
} from '../security/postgresSecretStore.js';
import {
  I2_SECURITY_THRESHOLDS,
} from '../security/i2SecurityThresholds.js';

export async function cleanupExpiredOAuthSecurityState(): Promise<{
  attemptsDeleted: number;
  secretsDeleted: number;
}> {
  const expired =
    await distributedSecurityState
      .cleanupExpiredOAuthAttempts({
        limit:
          I2_SECURITY_THRESHOLDS
            .cleanup
            .oauthAttemptsBatchSize,
      });

  const secretsDeleted =
    await postgresSecretStore
      .cleanupUnreferencedOAuthAttemptSecrets({
        olderThanMs:
          I2_SECURITY_THRESHOLDS
            .oauth.stateTtlMs,
        limit:
          I2_SECURITY_THRESHOLDS
            .cleanup
            .oauthAttemptsBatchSize,
      });

  return {
    attemptsDeleted:
      expired.length,
    secretsDeleted,
  };
}
