import crypto from 'crypto';
import {
  PostgresWatchTransactionError,
} from '../persistence/a4PostgresRepositories.js';
import { watchScheduler } from './watchScheduler.js';
import { watchPersistence } from './watchPersistence.js';
import { watchRuntimeEvaluator } from './watchRuntimeEvaluator.js';
import type { WatchJob } from './types.js';

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_JOBS_PER_CYCLE = 100;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60_000;

export interface WatchRuntimeSchedulerCycleResult {
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

function stableId(
  prefix: string,
  parts: unknown[]
): string {
  return (
    prefix +
    '_' +
    crypto
      .createHash('sha256')
      .update(JSON.stringify(parts))
      .digest('hex')
      .slice(0, 20)
  );
}

export class WatchRuntimeScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  public async runCycle(params?: {
    now?: number;
    leaseMs?: number;
    maxJobs?: number;
  }): Promise<WatchRuntimeSchedulerCycleResult> {
    if (!watchPersistence.usesPostgres()) {
      return watchScheduler.runCycle(params);
    }

    const now = params?.now ?? Date.now();
    const leaseMs = params?.leaseMs ?? DEFAULT_LEASE_MS;
    const maxJobs =
      params?.maxJobs ?? DEFAULT_MAX_JOBS_PER_CYCLE;

    const recovered =
      await watchPersistence.requeueStaleRunningJobs({
        now,
        leaseMs,
      });

    const enqueued: WatchJob[] = [];
    for (const rule of await watchPersistence.listDueIntervalRules(now)) {
      if (typeof rule.nextEvaluationAt !== 'number') continue;
      enqueued.push(
        await watchPersistence.ensureJob({
          accountId: rule.accountId,
          watchRuleId: rule.id,
          ruleVersion: rule.version,
          scheduledFor: rule.nextEvaluationAt,
        })
      );
    }

    const result: WatchRuntimeSchedulerCycleResult = {
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

    for (let index = 0; index < maxJobs; index += 1) {
      const running = await watchPersistence.claimReadyJob({
        now,
        leaseStartedAt: now,
      });
      if (!running) break;

      result.processedJobIds.push(running.id);

      const rule = await watchPersistence.getRule(
        running.accountId,
        running.watchRuleId
      );

      if (!rule) {
        await watchPersistence.updateJob(
          running.accountId,
          running.id,
          {
            status: 'SKIPPED',
            completedAt: now,
            skipReason: 'Watch rule no longer exists.',
          }
        );
        result.skippedJobIds.push(running.id);
        continue;
      }

      if (
        rule.version !== running.ruleVersion ||
        rule.status !== 'ACTIVE' ||
        rule.evaluationMode !== 'INTERVAL'
      ) {
        await watchPersistence.updateJob(
          running.accountId,
          running.id,
          {
            status: 'SKIPPED',
            completedAt: now,
            skipReason:
              'Watch rule changed, paused, archived, or is no longer interval-driven.',
          }
        );
        result.skippedJobIds.push(running.id);
        continue;
      }

      try {
        const prepared =
          await watchRuntimeEvaluator
            .prepareScheduledEvaluation({
              accountId:
                running.accountId,
              watchRuleId:
                running.watchRuleId,
              evaluatedAt: now,
            });

        const evaluationId =
          stableId('wev', [
            running.accountId,
            running.id,
          ]);

        await watchPersistence
          .commitClaimedJobEvaluation({
            accountId:
              running.accountId,
            jobId: running.id,
            expectedRuleVersion:
              running.ruleVersion,
            completedAt: now,
            evaluation: {
              ...prepared.evaluation,
              id: evaluationId,
              jobId: running.id,
            },
            newAlert:
              prepared.newAlertCopy
                ? {
                    id: stableId(
                      'wal',
                      [
                        running.accountId,
                        running.id,
                      ]
                    ),
                    episodeKey: [
                      running.accountId,
                      running.watchRuleId,
                      running.ruleVersion,
                      running.scheduledFor,
                    ].join(':'),
                    title:
                      prepared
                        .newAlertCopy
                        .title,
                    summary:
                      prepared
                        .newAlertCopy
                        .summary,
                  }
                : undefined,
          });

        result.completedJobIds.push(
          running.id
        );
      } catch (error: any) {
        const message =
          error?.message ||
          'Watch worker execution failed.';

        if (
          error instanceof
            PostgresWatchTransactionError &&
          error.code ===
            'WATCH_JOB_RULE_STALE'
        ) {
          await watchPersistence
            .updateJob(
              running.accountId,
              running.id,
              {
                status: 'SKIPPED',
                completedAt: now,
                skipReason: message,
              }
            );
          result.skippedJobIds.push(
            running.id
          );
          continue;
        }

        if (
          running.attemptCount >=
          running.maxAttempts
        ) {
          await watchPersistence
            .commitClaimedJobTerminalFailure(
              {
                accountId:
                  running.accountId,
                jobId: running.id,
                expectedRuleVersion:
                  running.ruleVersion,
                failedAt: now,
                error: message,
              }
            );

          result.failedJobIds.push(
            running.id
          );
        } else {
          await watchPersistence.updateJob(
            running.accountId,
            running.id,
            {
              status: 'PENDING',
              startedAt: undefined,
              nextAttemptAt:
                now +
                retryDelayMs(
                  running.attemptCount
                ),
              lastError: message,
            }
          );
          result.retryingJobIds.push(
            running.id
          );
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
    if (!watchPersistence.usesPostgres()) {
      watchScheduler.start(params);
      return;
    }
    if (this.timer) return;

    const tickMs = Math.max(
      5_000,
      params?.tickMs ?? DEFAULT_TICK_MS
    );

    const run = () => {
      void this.runCycle({
        leaseMs: params?.leaseMs,
        maxJobs: params?.maxJobs,
      }).catch((error) => {
        console.error('Watch runtime scheduler cycle failed:', error);
      });
    };

    run();
    this.timer = setInterval(run, tickMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (!watchPersistence.usesPostgres()) {
      watchScheduler.stop();
      return;
    }
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const watchRuntimeScheduler =
  new WatchRuntimeScheduler();
