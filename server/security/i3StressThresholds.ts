export const I3_STRESS_THRESHOLDS = {
  races: {
    actionConfirmContenders: 16,
    automationExecutionContenders: 12,
    watchCompletionContenders: 16,
    maxUnexpectedErrors: 0,
  },
  workers: {
    watchJobs: 24,
    integrationJobs: 16,
    automationJobs: 16,
    watchWorkers: 2,
    genericWorkers: 2,
    watchMaxJobsPerWorkerCycle: 6,
    genericMaxJobsPerWorkerCycle: 4,
    maxUnexpectedErrors: 0,
    maxRetries: 0,
    maxDeadLetters: 0,
    maxLeaseLosses: 0,
    maxPressureDurationMs: 180_000,
  },
} as const;
