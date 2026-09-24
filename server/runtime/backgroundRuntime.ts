import {
  watchRuntimeScheduler,
  type WatchRuntimeScheduler,
} from '../watch/watchRuntimeScheduler.js';
import {
  roleRunsWorkers,
  type KnowledgeAiProcessRole,
} from './processRole.js';

type WorkerLoop = Pick<
  WatchRuntimeScheduler,
  'start' | 'stop'
>;

export interface BackgroundRuntimeStartResult {
  started: boolean;
  workloads: string[];
}

export class BackgroundRuntime {
  private started = false;

  constructor(
    private readonly watchLoop:
      WorkerLoop =
        watchRuntimeScheduler
  ) {}

  public startForRole(
    role: KnowledgeAiProcessRole,
    options?: {
      keepProcessAlive?: boolean;
    }
  ): BackgroundRuntimeStartResult {
    if (!roleRunsWorkers(role)) {
      return {
        started: false,
        workloads: [],
      };
    }

    if (!this.started) {
      this.watchLoop.start({
        keepProcessAlive:
          options?.keepProcessAlive,
      });
      this.started = true;
    }

    return {
      started: true,
      workloads: [
        'WATCH_EVALUATION',
      ],
    };
  }

  public stop(): void {
    if (!this.started) return;
    this.watchLoop.stop();
    this.started = false;
  }

  public isStarted(): boolean {
    return this.started;
  }
}

export const backgroundRuntime =
  new BackgroundRuntime();
