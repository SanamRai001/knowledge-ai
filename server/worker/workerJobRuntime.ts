import crypto from 'crypto';
import {
  postgresWorkerJobRepository,
  type PostgresWorkerJobRepository,
} from './postgresWorkerJobRepository.js';
import {
  workerJobHandlerRegistry,
  type WorkerJobHandlerRegistry,
} from './workerJobHandlerRegistry.js';
import {
  WorkerJobHandlerError,
  WorkerJobLeaseError,
  type WorkerJob,
} from './workerJobTypes.js';

const DEFAULT_TICK_MS = 5_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_JOBS_PER_CYCLE = 25;

export interface WorkerJobRuntimeCycleResult {
  recoveredJobIds: string[];
  claimedJobIds: string[];
  succeededJobIds: string[];
  retryingJobIds: string[];
  failedJobIds: string[];
  deadLetterJobIds: string[];
  leaseLostJobIds: string[];
}

function runtimeWorkerId(): string {
  return (
    'worker_' +
    process.pid +
    '_' +
    crypto
      .randomBytes(6)
      .toString('hex')
  );
}

export class WorkerJobRuntime {
  private timer:
    | ReturnType<typeof setInterval>
    | null = null;

  constructor(
    private readonly repository:
      PostgresWorkerJobRepository =
        postgresWorkerJobRepository,
    private readonly registry:
      WorkerJobHandlerRegistry =
        workerJobHandlerRegistry,
    private readonly workerId:
      string = runtimeWorkerId()
  ) {}

  public async runCycle(params?: {
    now?: number;
    leaseMs?: number;
    maxJobs?: number;
  }): Promise<WorkerJobRuntimeCycleResult> {
    const now =
      params?.now ?? Date.now();
    const leaseMs = Math.max(
      5_000,
      Math.trunc(
        params?.leaseMs ??
          DEFAULT_LEASE_MS
      )
    );
    const maxJobs = Math.max(
      1,
      Math.min(
        500,
        Math.trunc(
          params?.maxJobs ??
            DEFAULT_MAX_JOBS_PER_CYCLE
        )
      )
    );
    const jobTypes =
      this.registry.listJobTypes();

    const result:
      WorkerJobRuntimeCycleResult = {
        recoveredJobIds: [],
        claimedJobIds: [],
        succeededJobIds: [],
        retryingJobIds: [],
        failedJobIds: [],
        deadLetterJobIds: [],
        leaseLostJobIds: [],
      };

    if (jobTypes.length === 0) {
      return result;
    }

    const recovered =
      await this.repository.recoverStale({
        now,
        jobTypes,
      });
    result.recoveredJobIds =
      recovered.map(
        (job) => job.id
      );

    for (
      let index = 0;
      index < maxJobs;
      index += 1
    ) {
      const job =
        await this.repository.claim({
          workerId: this.workerId,
          leaseMs,
          now,
          jobTypes,
        });

      if (!job) break;

      result.claimedJobIds.push(
        job.id
      );

      const handler =
        this.registry.get(
          job.jobType
        );

      if (!handler) {
        const settled =
          await this.repository.fail({
            accountId:
              job.accountId,
            jobId: job.id,
            workerId:
              this.workerId,
            leaseToken:
              job.leaseToken!,
            error:
              'No worker handler is registered for job type ' +
              job.jobType +
              '.',
            retryable: false,
            now,
          });

        result.failedJobIds.push(
          settled.id
        );
        continue;
      }

      try {
        await handler({
          job,
          workerId:
            this.workerId,
          heartbeat: async (
            requestedLeaseMs =
              leaseMs
          ) =>
            this.repository.heartbeat({
              accountId:
                job.accountId,
              jobId: job.id,
              workerId:
                this.workerId,
              leaseToken:
                job.leaseToken!,
              leaseMs:
                requestedLeaseMs,
            }),
        });

        const completed =
          await this.repository.complete({
            accountId:
              job.accountId,
            jobId: job.id,
            workerId:
              this.workerId,
            leaseToken:
              job.leaseToken!,
          });

        result.succeededJobIds.push(
          completed.id
        );
      } catch (error: any) {
        if (
          error instanceof
            WorkerJobLeaseError
        ) {
          result.leaseLostJobIds.push(
            job.id
          );
          continue;
        }

        const typed =
          error instanceof
          WorkerJobHandlerError
            ? error
            : new WorkerJobHandlerError(
                error?.message ||
                  'Worker job handler failed.',
                true
              );

        try {
          const settled =
            await this.repository.fail({
              accountId:
                job.accountId,
              jobId: job.id,
              workerId:
                this.workerId,
              leaseToken:
                job.leaseToken!,
              error:
                typed.message,
              retryable:
                typed.retryable,
              retryAt:
                typed.retryDelayMs ===
                undefined
                  ? undefined
                  : Date.now() +
                    Math.max(
                      0,
                      typed.retryDelayMs
                    ),
            });

          if (
            settled.status ===
              'PENDING'
          ) {
            result.retryingJobIds.push(
              settled.id
            );
          } else if (
            settled.status ===
              'DEAD_LETTER'
          ) {
            result.deadLetterJobIds.push(
              settled.id
            );
          } else {
            result.failedJobIds.push(
              settled.id
            );
          }
        } catch (
          settlementError
        ) {
          if (
            settlementError instanceof
              WorkerJobLeaseError
          ) {
            result.leaseLostJobIds.push(
              job.id
            );
            continue;
          }
          throw settlementError;
        }
      }
    }

    return result;
  }

  public start(params?: {
    tickMs?: number;
    leaseMs?: number;
    maxJobs?: number;
    keepProcessAlive?: boolean;
  }): void {
    if (this.timer) return;

    const tickMs = Math.max(
      1_000,
      Math.trunc(
        params?.tickMs ??
          DEFAULT_TICK_MS
      )
    );

    const run = () => {
      void this.runCycle({
        leaseMs: params?.leaseMs,
        maxJobs:
          params?.maxJobs,
      }).catch((error) => {
        console.error(
          'Worker job runtime cycle failed:',
          error
        );
      });
    };

    run();
    this.timer =
      setInterval(
        run,
        tickMs
      );

    if (
      !params?.keepProcessAlive
    ) {
      this.timer.unref?.();
    }
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public isStarted(): boolean {
    return Boolean(this.timer);
  }

  public getWorkerId(): string {
    return this.workerId;
  }
}

export const workerJobRuntime =
  new WorkerJobRuntime();
