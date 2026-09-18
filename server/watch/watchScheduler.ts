import { watchEvaluator } from './watchEvaluator.js';
import { watchStore } from './watchStore.js';
import { WatchJob } from './types.js';

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_JOBS_PER_CYCLE = 100;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60_000;

export interface WatchSchedulerCycleResult {
  recoveredJobIds: string[];
  enqueuedJobIds: string[];
  processedJobIds: string[];
  completedJobIds: string[];
  skippedJobIds: string[];
  retryingJobIds: string[];
  failedJobIds: string[];
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    MAX_RETRY_MS,
    BASE_RETRY_MS * Math.pow(2, Math.max(0, attemptCount - 1))
  );
}

export class WatchScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  public runCycle(params?: {
    now?: number;
    leaseMs?: number;
    maxJobs?: number;
  }): WatchSchedulerCycleResult {
    const now = params?.now ?? Date.now();
    const leaseMs = params?.leaseMs ?? DEFAULT_LEASE_MS;
    const maxJobs =
      params?.maxJobs ?? DEFAULT_MAX_JOBS_PER_CYCLE;

    const recovered = watchStore.requeueStaleRunningJobs({
      now,
      leaseMs,
    });

    const enqueued: WatchJob[] = [];
    for (const rule of watchStore.listDueIntervalRules(now)) {
      if (typeof rule.nextEvaluationAt !== 'number') continue;

      enqueued.push(
        watchStore.ensureJob({
          accountId: rule.accountId,
          watchRuleId: rule.id,
          ruleVersion: rule.version,
          scheduledFor: rule.nextEvaluationAt,
        })
      );
    }

    const ready = watchStore.listJobs({
      status: 'PENDING',
      readyAt: now,
      limit: maxJobs,
    });

    const result: WatchSchedulerCycleResult = {
      recoveredJobIds: recovered.map((job) => job.id),
      enqueuedJobIds: Array.from(
        new Set(enqueued.map((job) => job.id))
      ),
      processedJobIds: [],
      completedJobIds: [],
      skippedJobIds: [],
      retryingJobIds: [],
      failedJobIds: [],
    };

    for (const queued of ready) {
      result.processedJobIds.push(queued.id);

      const running = watchStore.updateJob(queued.id, {
        status: 'RUNNING',
        attemptCount: queued.attemptCount + 1,
        startedAt: now,
        completedAt: undefined,
        lastError: undefined,
        skipReason: undefined,
      });

      const rule = watchStore.getRule(
        running.accountId,
        running.watchRuleId
      );

      if (!rule) {
        watchStore.updateJob(running.id, {
          status: 'SKIPPED',
          completedAt: now,
          skipReason: 'Watch rule no longer exists.',
        });
        result.skippedJobIds.push(running.id);
        continue;
      }

      if (
        rule.version !== running.ruleVersion ||
        rule.status !== 'ACTIVE' ||
        rule.evaluationMode !== 'INTERVAL'
      ) {
        watchStore.updateJob(running.id, {
          status: 'SKIPPED',
          completedAt: now,
          skipReason:
            'Watch rule changed, paused, archived, or is no longer interval-driven.',
        });
        result.skippedJobIds.push(running.id);
        continue;
      }

      try {
        const evaluated = watchEvaluator.evaluate({
          accountId: running.accountId,
          watchRuleId: running.watchRuleId,
          evaluatedAt: now,
        });

        watchStore.updateJob(running.id, {
          status: 'COMPLETED',
          completedAt: now,
          evaluationId: evaluated.evaluation.id,
          lastError:
            evaluated.evaluation.status === 'FAILED'
              ? evaluated.evaluation.error
              : undefined,
        });
        result.completedJobIds.push(running.id);
      } catch (error: any) {
        const message =
          error?.message || 'Watch worker execution failed.';

        if (running.attemptCount >= running.maxAttempts) {
          watchStore.updateJob(running.id, {
            status: 'FAILED',
            completedAt: now,
            lastError: message,
          });

          const intervalMinutes =
            rule.intervalMinutes && rule.intervalMinutes > 0
              ? rule.intervalMinutes
              : 60;
          watchStore.updateRule(
            rule.accountId,
            rule.id,
            {
              currentState: 'ERROR',
              lastEvaluationAt: now,
              nextEvaluationAt:
                now + intervalMinutes * 60 * 1000,
            }
          );

          result.failedJobIds.push(running.id);
        } else {
          watchStore.updateJob(running.id, {
            status: 'PENDING',
            startedAt: undefined,
            nextAttemptAt:
              now + retryDelayMs(running.attemptCount),
            lastError: message,
          });
          result.retryingJobIds.push(running.id);
        }
      }
    }

    return result;
  }

  public start(params?: {
    tickMs?: number;
    leaseMs?: number;
    maxJobs?: number;
  }): void {
    if (this.timer) return;

    const tickMs = Math.max(
      5_000,
      params?.tickMs ?? DEFAULT_TICK_MS
    );

    const run = () => {
      try {
        this.runCycle({
          leaseMs: params?.leaseMs,
          maxJobs: params?.maxJobs,
        });
      } catch (error) {
        console.error('Watch scheduler cycle failed:', error);
      }
    };

    run();
    this.timer = setInterval(run, tickMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const watchScheduler = new WatchScheduler();
