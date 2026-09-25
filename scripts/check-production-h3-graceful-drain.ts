import {
  BackgroundRuntime,
} from '../server/runtime/backgroundRuntime.js';
import fs from 'node:fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function deferred<T>() {
  let resolve!: (
    value: T
  ) => void;
  const promise =
    new Promise<T>((res) => {
      resolve = res;
    });
  return {
    promise,
    resolve,
  };
}

async function main() {
  const watchDone =
    deferred<boolean>();
  const genericDone =
    deferred<boolean>();

  let watchStarted = 0;
  let genericStarted = 0;
  let watchDrainCalled = 0;
  let genericDrainCalled = 0;

  const watch = {
    start: () => {
      watchStarted += 1;
    },
    stop: () => undefined,
    drain: async () => {
      watchDrainCalled += 1;
      return watchDone.promise;
    },
  };

  const generic = {
    start: () => {
      genericStarted += 1;
    },
    stop: () => undefined,
    drain: async () => {
      genericDrainCalled += 1;
      return genericDone.promise;
    },
  };

  const runtime =
    new BackgroundRuntime(
      watch as any,
      generic as any
    );

  const started =
    runtime.startForRole(
      'worker',
      {
        keepProcessAlive: true,
      }
    );

  assert(
    started.started &&
      watchStarted === 1 &&
      genericStarted === 1,
    'H3 background runtime test precondition failed.'
  );

  const draining =
    runtime.drain(500);

  await Promise.resolve();

  assert(
    watchDrainCalled === 1 &&
      genericDrainCalled === 1,
    'H3 background drain must start both loop drains concurrently.'
  );

  watchDone.resolve(true);
  genericDone.resolve(true);

  const drained =
    await draining;

  assert(
    drained.drained &&
      drained.watchDrained &&
      drained.genericDrained &&
      !runtime.isStarted(),
    'H3 background runtime must report successful bounded drain.'
  );

  const workerRuntime =
    fs.readFileSync(
      'server/worker/workerJobRuntime.ts',
      'utf8'
    );
  const watchRuntime =
    fs.readFileSync(
      'server/watch/watchRuntimeScheduler.ts',
      'utf8'
    );
  const workerEntry =
    fs.readFileSync(
      'worker.ts',
      'utf8'
    );
  const workerHealth =
    fs.readFileSync(
      'server/runtime/workerHealthServer.ts',
      'utf8'
    );
  const server =
    fs.readFileSync(
      'server.ts',
      'utf8'
    );

  for (const [name, source] of [
    [
      'generic worker',
      workerRuntime,
    ],
    [
      'Watch worker',
      watchRuntime,
    ],
  ] as const) {
    assert(
      source.includes(
        'private inFlightCycle'
      ) &&
        source.includes(
          'if (this.inFlightCycle)'
        ) &&
        source.includes(
          'public async drain('
        ),
      'H3 ' +
        name +
        ' must prevent overlapping scheduled cycles and expose bounded drain.'
    );
  }

  assert(
    workerEntry.includes(
      'workerHealthServer.start'
    ) &&
      workerEntry.includes(
        'workerHealthServer.setDraining'
      ) &&
      workerEntry.includes(
        'backgroundRuntime.drain('
      ) &&
      workerEntry.includes(
        'await closePostgresPool()'
      ) &&
      workerHealth.includes(
        "req.url === '/ready'"
      ) &&
      workerHealth.includes(
        'checkWorkerReadiness'
      ) &&
      workerHealth.includes(
        'WORKER_DRAINING'
      ),
    'H3 worker entrypoint must expose real supervisor readiness and drain before PostgreSQL close.'
  );

  assert(
    server.includes(
      "process.once(\n    'SIGTERM'"
    ) &&
      server.includes(
        'httpDrainController.beginDrain'
      ) &&
      server.includes(
        'backgroundRuntime.drain('
      ) &&
      server.includes(
        'await closePostgresPool()'
      ),
    'H3 web entrypoint must own bounded signal-driven drain and PostgreSQL shutdown.'
  );

  console.log(
    'PRODUCTION_H3_GRACEFUL_DRAIN_CHECK_PASSED'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_H3_GRACEFUL_DRAIN_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
