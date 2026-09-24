export type WorkerJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DEAD_LETTER';

export interface WorkerJob {
  id: string;
  accountId: string;
  jobType: string;
  payload: Record<string, unknown>;
  payloadRef?: string;
  idempotencyKey?: string;
  concurrencyKey?: string;
  priority: number;
  status: WorkerJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: number;
  lastHeartbeatAt?: number;
  startedAt?: number;
  completedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EnqueueWorkerJobInput {
  accountId: string;
  jobType: string;
  payload?: Record<string, unknown>;
  payloadRef?: string;
  idempotencyKey?: string;
  concurrencyKey?: string;
  priority?: number;
  maxAttempts?: number;
  runAt?: number;
}

export interface ClaimWorkerJobInput {
  workerId: string;
  leaseMs: number;
  now?: number;
  jobTypes?: string[];
}

export interface WorkerJobFailureInput {
  accountId: string;
  jobId: string;
  workerId: string;
  leaseToken: string;
  error: string;
  retryable: boolean;
  now?: number;
  retryAt?: number;
}

export interface WorkerJobLeaseMutationInput {
  accountId: string;
  jobId: string;
  workerId: string;
  leaseToken: string;
  now?: number;
}

export interface WorkerJobHeartbeatInput
  extends WorkerJobLeaseMutationInput {
  leaseMs: number;
}

export interface WorkerJobListInput {
  accountId: string;
  status?: WorkerJobStatus;
  jobType?: string;
  limit?: number;
}

export interface WorkerJobHandlerContext {
  job: WorkerJob;
  workerId: string;
  heartbeat: (
    leaseMs?: number
  ) => Promise<WorkerJob>;
}

export type WorkerJobHandler = (
  context: WorkerJobHandlerContext
) => Promise<void>;

export class WorkerJobHandlerError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly retryDelayMs?: number
  ) {
    super(message);
    this.name = 'WorkerJobHandlerError';
  }
}

export class WorkerJobLeaseError extends Error {
  readonly code = 'WORKER_JOB_LEASE_LOST';

  constructor(message: string) {
    super(message);
    this.name = 'WorkerJobLeaseError';
  }
}

export function workerRetryDelayMs(
  attemptCount: number
): number {
  const baseMs = 30_000;
  const maxMs = 15 * 60_000;
  return Math.min(
    maxMs,
    baseMs *
      Math.pow(
        2,
        Math.max(0, attemptCount - 1)
      )
  );
}
