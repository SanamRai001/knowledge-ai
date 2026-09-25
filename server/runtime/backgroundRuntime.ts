import {
  watchRuntimeScheduler,
  type WatchRuntimeScheduler,
} from '../watch/watchRuntimeScheduler.js';
import {
  autonomousWorkerWorkloads,
} from './backgroundWorkloadCatalog.js';
import {
  roleRunsWorkers,
  type KnowledgeAiProcessRole,
} from './processRole.js';
import {
  workerJobRuntime,
  type WorkerJobRuntime,
} from '../worker/workerJobRuntime.js';
import {
  registerActionDiscoveryWorkerHandler,
} from '../actions/actionDiscoveryWorker.js';
import {
  registerIntegrationSyncWorkerHandler,
} from '../integrations/integrationSyncWorker.js';
import {
  registerAutomationExecutionWorkerHandler,
} from '../automation/automationExecutionWorker.js';

type WorkerLoop = Pick<
  WatchRuntimeScheduler,
  'start' | 'stop'
> &
  Partial<
    Pick<
      WatchRuntimeScheduler,
      'drain'
    >
  >;

type GenericJobLoop = Pick<
  WorkerJobRuntime,
  'start' | 'stop'
> &
  Partial<
    Pick<
      WorkerJobRuntime,
      'drain'
    >
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
        watchRuntimeScheduler,
    private readonly genericJobLoop?:
      GenericJobLoop
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
      registerActionDiscoveryWorkerHandler();
      registerIntegrationSyncWorkerHandler();
      registerAutomationExecutionWorkerHandler();

      this.watchLoop.start({
        keepProcessAlive:
          options?.keepProcessAlive,
      });
      this.genericJobLoop?.start({
        keepProcessAlive:
          options?.keepProcessAlive,
      });
      this.started = true;
    }

    return {
      started: true,
      workloads:
        autonomousWorkerWorkloads()
          .map((item) => item.id),
    };
  }

  public stop(): void {
    if (!this.started) return;
    this.watchLoop.stop();
    this.genericJobLoop?.stop();
    this.started = false;
  }

  public async drain(
    timeoutMs: number
  ): Promise<{
    drained: boolean;
    watchDrained: boolean;
    genericDrained: boolean;
  }> {
    if (!this.started) {
      return {
        drained: true,
        watchDrained: true,
        genericDrained: true,
      };
    }

    this.started = false;

    const watchDrained =
      this.watchLoop.drain
        ? await this.watchLoop.drain(
            timeoutMs
          )
        : (this.watchLoop.stop(),
          true);

    const genericDrained =
      this.genericJobLoop?.drain
        ? await this.genericJobLoop.drain(
            timeoutMs
          )
        : (this.genericJobLoop?.stop(),
          true);

    return {
      drained:
        watchDrained &&
        genericDrained,
      watchDrained,
      genericDrained,
    };
  }

  public isStarted(): boolean {
    return this.started;
  }
}

export const backgroundRuntime =
  new BackgroundRuntime(
    watchRuntimeScheduler,
    workerJobRuntime
  );
