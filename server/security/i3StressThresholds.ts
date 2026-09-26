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
    maxUnexpectedErrors: 0,
    maxDeadLetters: 0,
  },
} as const;
