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
  type WorkerRuntimeHealthSnapshot,
} from './workerJobTypes.js';
import {
  operationalTelemetry,
} from '../operations/operationalTelemetry.js';

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
  private inFlightCycle:
    | Promise<WorkerJobRuntimeCycleResult>
    | null = null;
  private lastActivityAt?: number;
  private lastCycleStartedAt?: number;
  private lastCycleCompletedAt?: number;
  private lastCycleOutcome?:
    | 'success'
    | 'failure';
  private lastCycleErrorCode?: string;

  private markActivity(
    at: number = Date.now()
  ): void {
    this.lastActivityAt = at;
  }

  private recordAttempt(
    jobType: string,
    outcome: string
  ): void {
    operationalTelemetry.recordMetric({
      name:
        'worker_job_attempts_total',
      kind: 'COUNTER',
      value: 1,
      labels: {
        job_type: jobType,
        outcome,
      },
    });
  }

  private async recordQueueMetrics(
    now: number
  ): Promise<void> {
    const summary =
      await this.repository
        .operationalSummary(now);

    for (const row of summary) {
      operationalTelemetry.recordMetric({
        name: 'worker_queue_depth',
        kind: 'GAUGE',
        value: row.count,
        labels: {
          job_type: row.jobType,
          status: row.status,
        },
      });

      if (
        row.oldestCreatedAt !==
        undefined
      ) {
        operationalTelemetry.recordMetric({
          name: 'worker_job_age_ms',
          kind: 'HISTOGRAM',
          value: Math.max(
            0,
            now -
              row.oldestCreatedAt
          ),
          labels: {
            job_type: row.jobType,
            status: row.status,
          },
        });
      }
    }
  }

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

  private async runCycleCore(params?: {
    now?: number;
    leaseMs?: number;
    maxJobs?: number;
  }): Promise<WorkerJobRuntimeCycleResult> {
    const recoveryNow =
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
        now: recoveryNow,
        jobTypes,
      });
    result.recoveredJobIds =
      recovered.map(
        (job) => job.id
      );
    this.markActivity();

    for (const job of recovered) {
      if (
        job.status ===
        'DEAD_LETTER'
      ) {
        operationalTelemetry.recordMetric({
          name:
            'worker_dead_letter_total',
          kind: 'COUNTER',
          value: 1,
          labels: {
            job_type: job.jobType,
          },
        });
      }
    }

    for (
      let index = 0;
      index < maxJobs;
      index += 1
    ) {
      const claimNow =
        params?.now ?? Date.now();
      const job =
        await this.repository.claim({
          workerId: this.workerId,
          leaseMs,
          now: claimNow,
          jobTypes,
        });

      if (!job) break;

      result.claimedJobIds.push(
        job.id
      );
      this.markActivity();

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
            now:
              params?.now ??
              Date.now(),
          });

        result.failedJobIds.push(
          settled.id
        );
        this.recordAttempt(
          job.jobType,
          'failed'
        );
        this.markActivity();
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
          ) => {
            const heartbeat =
              await this.repository
                .heartbeat({
                  accountId:
                    job.accountId,
                  jobId: job.id,
                  workerId:
                    this.workerId,
                  leaseToken:
                    job.leaseToken!,
                  leaseMs:
                    requestedLeaseMs,
                });
            this.markActivity();
            return heartbeat;
          },
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
        this.recordAttempt(
          job.jobType,
          'succeeded'
        );
        this.markActivity();
      } catch (error: any) {
        if (
          error instanceof
            WorkerJobLeaseError
        ) {
          result.leaseLostJobIds.push(
            job.id
          );
          this.recordAttempt(
            job.jobType,
            'lease_lost'
          );
          this.markActivity();
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
            this.recordAttempt(
              job.jobType,
              'retrying'
            );
          } else if (
            settled.status ===
              'DEAD_LETTER'
          ) {
            result.deadLetterJobIds.push(
              settled.id
            );
            this.recordAttempt(
              job.jobType,
              'dead_letter'
            );
            operationalTelemetry.recordMetric({
              name:
                'worker_dead_letter_total',
              kind: 'COUNTER',
              value: 1,
              labels: {
                job_type:
                  job.jobType,
              },
            });
          } else {
            result.failedJobIds.push(
              settled.id
            );
            this.recordAttempt(
              job.jobType,
              'failed'
            );
          }
          this.markActivity();
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
            this.recordAttempt(
              job.jobType,
              'lease_lost'
            );
            this.markActivity();
            continue;
          }
          throw settlementError;
        }
      }
    }

    return result;
  }

  public async runCycle(params?: {
    now?: number;
    leaseMs?: number;
    maxJobs?: number;
  }): Promise<WorkerJobRuntimeCycleResult> {
    const startedAt =
      params?.now ?? Date.now();
    this.lastCycleStartedAt =
      startedAt;
    this.markActivity(startedAt);

    operationalTelemetry.emitEvent({
      level: 'debug',
      eventName:
        'worker.cycle.started',
      component: 'worker',
      processRole: 'worker',
      outcome: 'started',
      correlation: {
        job_id: undefined,
      },
      metadata: {
        workerId:
          this.workerId,
      },
    });

    try {
      const result =
        await this.runCycleCore(
          params
        );
      const completedAt =
        Date.now();
      this.lastCycleCompletedAt =
        completedAt;
      this.lastCycleOutcome =
        'success';
      this.lastCycleErrorCode =
        undefined;
      this.markActivity(
        completedAt
      );

      await this
        .recordQueueMetrics(
          completedAt
        )
        .catch((error: any) => {
          operationalTelemetry.emitEvent({
            level: 'warn',
            eventName:
              'worker.metrics.snapshot_failed',
            component: 'worker',
            processRole:
              'worker',
            outcome:
              'failure',
            metadata: {
              errorCode:
                error?.code ||
                error?.name,
            },
          });
        });

      operationalTelemetry.emitEvent({
        level: 'info',
        eventName:
          'worker.cycle.completed',
        component: 'worker',
        processRole: 'worker',
        outcome: 'success',
        metadata: {
          workerId:
            this.workerId,
          recoveredCount:
            result.recoveredJobIds
              .length,
          claimedCount:
            result.claimedJobIds
              .length,
          succeededCount:
            result.succeededJobIds
              .length,
          retryingCount:
            result.retryingJobIds
              .length,
          failedCount:
            result.failedJobIds
              .length,
          deadLetterCount:
            result.deadLetterJobIds
              .length,
          leaseLostCount:
            result.leaseLostJobIds
              .length,
          durationMs:
            Math.max(
              0,
              completedAt -
                startedAt
            ),
        },
      });

      return result;
    } catch (error: any) {
      const failedAt =
        Date.now();
      this.lastCycleCompletedAt =
        failedAt;
      this.lastCycleOutcome =
        'failure';
      this.lastCycleErrorCode =
        String(
          error?.code ||
            error?.name ||
            'WORKER_CYCLE_FAILED'
        ).slice(0, 120);
      this.markActivity(
        failedAt
      );

      operationalTelemetry.emitEvent({
        level: 'error',
        eventName:
          'worker.cycle.failed',
        component: 'worker',
        processRole: 'worker',
        outcome: 'failure',
        metadata: {
          workerId:
            this.workerId,
          errorCode:
            this.lastCycleErrorCode,
          durationMs:
            Math.max(
              0,
              failedAt -
                startedAt
            ),
        },
      });

      throw error;
    }
  }

  public getHealthSnapshot(
    now: number = Date.now(),
    maxStalenessMs: number = Math.max(
      5_000,
      Number(
        process.env
          .KNOWLEDGE_AI_WORKER_READINESS_MAX_STALENESS_MS ||
          '30000'
      ) || 30_000
    )
  ): WorkerRuntimeHealthSnapshot {
    const started =
      this.isStarted();
    const recent =
      this.lastActivityAt !==
        undefined &&
      now -
        this.lastActivityAt <=
        maxStalenessMs;

    return {
      workerId:
        this.workerId,
      started,
      healthy:
        started &&
        recent &&
        this.lastCycleOutcome !==
          'failure',
      lastActivityAt:
        this.lastActivityAt,
      lastCycleStartedAt:
        this.lastCycleStartedAt,
      lastCycleCompletedAt:
        this.lastCycleCompletedAt,
      lastCycleOutcome:
        this.lastCycleOutcome,
      lastCycleErrorCode:
        this.lastCycleErrorCode,
      maxStalenessMs,
    };
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
      if (this.inFlightCycle) {
        return;
      }

      const cycle = this.runCycle({
        leaseMs: params?.leaseMs,
        maxJobs:
          params?.maxJobs,
      });
      this.inFlightCycle = cycle;

      void cycle
        .catch((error) => {
          console.error(
            'Worker job runtime cycle failed:',
            error
          );
        })
        .finally(() => {
          if (
            this.inFlightCycle === cycle
          ) {
            this.inFlightCycle = null;
          }
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

  public async drain(
    timeoutMs: number
  ): Promise<boolean> {
    this.stop();

    const cycle =
      this.inFlightCycle;
    if (!cycle) {
      return true;
    }

    let timer:
      | ReturnType<typeof setTimeout>
      | undefined;

    try {
      return await Promise.race([
        cycle
          .then(() => true)
          .catch(() => true),
        new Promise<boolean>(
          (resolve) => {
            timer = setTimeout(
              () => resolve(false),
              Math.max(
                1,
                timeoutMs
              )
            );
            timer.unref?.();
          }
        ),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public isCycleInFlight(): boolean {
    return Boolean(
      this.inFlightCycle
    );
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
