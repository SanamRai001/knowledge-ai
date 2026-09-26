export const I1_TEST_THRESHOLDS = {
  localHttpSmoke: {
    requestCount: 64,
    concurrency: 16,
    p95LatencyMs: 750,
    maxUnexpectedErrorRate: 0,
    maxIsolationFailures: 0,
  },
  apiKey: {
    maxRequestsPerWindow: 100,
    windowMs: 60_000,
    minRetryAfterSeconds: 1,
    maxRetryAfterSeconds: 60,
  },
  oauth: {
    stateTtlMs: 10 * 60_000,
    maxReplaySuccesses: 0,
    maxCrossAccountSuccesses: 0,
  },
  requestBodies: {
    defaultJsonBytes: 1024 * 1024,
    defaultUrlencodedBytes: 256 * 1024,
    defaultApplicationEdgeBytes:
      260 * 1024 * 1024,
    pdfFileBytes: 25 * 1024 * 1024,
    pdfFileCount: 10,
    csvFileBytes: 10 * 1024 * 1024,
    xlsxFileBytes: 15 * 1024 * 1024,
  },
} as const;

export type I1LoadSummary = {
  requests: number;
  successes: number;
  unexpectedErrors: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  unexpectedErrorRate: number;
};
