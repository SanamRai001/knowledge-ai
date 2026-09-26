import {
  postgresPersistenceEnabled,
} from '../persistence/postgres.js';
import {
  distributedSecurityState,
  type DistributedRateLimitDecision,
} from '../security/distributedSecurityState.js';
import {
  I2_SECURITY_THRESHOLDS,
} from '../security/i2SecurityThresholds.js';

const localAttempts =
  new Map<string, number[]>();

function subject(
  email: string
): string {
  return (
    'email:' +
    String(email || '')
      .trim()
      .toLowerCase()
      .slice(0, 512)
  );
}

function localConsume(
  key: string
): DistributedRateLimitDecision {
  const now = Date.now();
  const windowMs =
    I2_SECURITY_THRESHOLDS
      .humanLogin.windowMs;
  const max =
    I2_SECURITY_THRESHOLDS
      .humanLogin
      .maxAttemptsPerWindow;

  const current = (
    localAttempts.get(key) ||
    []
  ).filter(
    (at) => now - at < windowMs
  );

  if (current.length >= max) {
    const oldest =
      current[0] ?? now;
    localAttempts.set(
      key,
      current
    );
    return {
      allowed: false,
      remaining: 0,
      resetSeconds:
        Math.max(
          1,
          Math.ceil(
            (windowMs -
              (now - oldest)) /
              1000
          )
        ),
    };
  }

  current.push(now);
  localAttempts.set(key, current);
  return {
    allowed: true,
    remaining:
      max - current.length,
    resetSeconds:
      Math.ceil(
        windowMs / 1000
      ),
  };
}

export class HumanLoginThrottleService {
  async reserve(
    email: string
  ): Promise<DistributedRateLimitDecision> {
    const key = subject(email);

    if (
      !postgresPersistenceEnabled()
    ) {
      return localConsume(key);
    }

    return distributedSecurityState
      .consumeRateLimit({
        scope: 'HUMAN_LOGIN',
        subject: key,
        maxEvents:
          I2_SECURITY_THRESHOLDS
            .humanLogin
            .maxAttemptsPerWindow,
        windowMs:
          I2_SECURITY_THRESHOLDS
            .humanLogin.windowMs,
      });
  }

  async clear(
    email: string
  ): Promise<void> {
    const key = subject(email);

    if (
      !postgresPersistenceEnabled()
    ) {
      localAttempts.delete(key);
      return;
    }

    await distributedSecurityState
      .clearRateLimitSubject(
        'HUMAN_LOGIN',
        key
      );
  }
}

export const humanLoginThrottleService =
  new HumanLoginThrottleService();
