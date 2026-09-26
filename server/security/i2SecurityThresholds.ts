export const I2_SECURITY_THRESHOLDS = {
  apiKey: {
    maxRequestsPerWindow: 100,
    windowMs: 60_000,
  },
  humanLogin: {
    maxAttemptsPerWindow: 10,
    windowMs: 15 * 60_000,
  },
  oauth: {
    stateTtlMs: 10 * 60_000,
  },
  cleanup: {
    rateEventsBatchSize: 128,
    oauthAttemptsBatchSize: 64,
  },
} as const;
