export type BackgroundExecutionModel =
  | 'AUTONOMOUS_LOOP'
  | 'REQUEST_DRIVEN'
  | 'POST_COMMIT_INLINE';

export interface BackgroundWorkloadDescriptor {
  id:
    | 'WATCH_EVALUATION'
    | 'INTEGRATION_SYNC'
    | 'AUTOMATION_EXECUTION'
    | 'DISCOVERY_ANALYSIS';
  executionModel:
    BackgroundExecutionModel;
  durableState: string;
  claimOrLease: string;
  e1Owner:
    | 'WORKER'
    | 'REQUEST_PATH'
    | 'POST_COMMIT_PATH';
  futureQueueCandidate: boolean;
}

export const BACKGROUND_WORKLOAD_CATALOG:
  readonly BackgroundWorkloadDescriptor[] =
  [
    {
      id: 'WATCH_EVALUATION',
      executionModel:
        'AUTONOMOUS_LOOP',
      durableState:
        'PostgreSQL watch_jobs + watch_evaluations + watch_alerts',
      claimOrLease:
        'FOR UPDATE SKIP LOCKED claim + stale RUNNING lease recovery',
      e1Owner: 'WORKER',
      futureQueueCandidate: true,
    },
    {
      id: 'INTEGRATION_SYNC',
      executionModel:
        'REQUEST_DRIVEN',
      durableState:
        'PostgreSQL integration sync runs/import journal/checkpoint state',
      claimOrLease:
        'per-connection PostgreSQL sync lease',
      e1Owner: 'REQUEST_PATH',
      futureQueueCandidate: true,
    },
    {
      id: 'AUTOMATION_EXECUTION',
      executionModel:
        'REQUEST_DRIVEN',
      durableState:
        'PostgreSQL automation_runs + Action transaction state',
      claimOrLease:
        'database-enforced Automation execution claim/transaction',
      e1Owner: 'REQUEST_PATH',
      futureQueueCandidate: true,
    },
    {
      id: 'DISCOVERY_ANALYSIS',
      executionModel:
        'POST_COMMIT_INLINE',
      durableState:
        'relational Discovery/Insights analysis metadata',
      claimOrLease:
        'no autonomous scheduler/worker lease in E1',
      e1Owner: 'POST_COMMIT_PATH',
      futureQueueCandidate: true,
    },
  ] as const;

export function autonomousWorkerWorkloads():
  readonly BackgroundWorkloadDescriptor[] {
  return BACKGROUND_WORKLOAD_CATALOG
    .filter(
      (item) =>
        item.executionModel ===
          'AUTONOMOUS_LOOP' &&
        item.e1Owner === 'WORKER'
    );
}
