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

  let secretsDeleted = 0;

  for (const attempt of expired) {
    if (!attempt.secretRef) {
      continue;
    }

    const deleted =
      await postgresSecretStore
        .delete({
          accountId:
            attempt.accountId,
          secretId:
            attempt.secretRef,
          purpose:
            'INTEGRATION_OAUTH_ATTEMPT',
          provider:
            attempt.provider,
        })
        .catch(() => false);

    if (deleted) {
      secretsDeleted += 1;
    }
  }

  secretsDeleted +=
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
