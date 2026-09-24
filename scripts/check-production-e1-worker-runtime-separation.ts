import fs from 'fs';
import {
  BackgroundRuntime,
} from '../server/runtime/backgroundRuntime.js';
import {
  autonomousWorkerWorkloads,
  BACKGROUND_WORKLOAD_CATALOG,
} from '../server/runtime/backgroundWorkloadCatalog.js';
import {
  ProcessRoleConfigurationError,
  resolveProcessRole,
  roleRunsWeb,
  roleRunsWorkers,
} from '../server/runtime/processRole.js';

function assert(
  condition: unknown,
  message: string
): void {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  assert(
    resolveProcessRole(
      {
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv
    ) === 'combined',
    'Development server role must default to combined for backward compatibility.'
  );

  assert(
    resolveProcessRole(
      {
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv,
      {
        nonProductionDefault:
          'worker',
      }
    ) === 'worker',
    'Dedicated worker development entrypoint must be able to default to worker.'
  );

  for (const role of [
    'web',
    'worker',
    'combined',
  ] as const) {
    assert(
      resolveProcessRole(
        {
          NODE_ENV: 'production',
          KNOWLEDGE_AI_PROCESS_ROLE:
            role,
        } as NodeJS.ProcessEnv
      ) === role,
      'Production process role must preserve explicit role: ' +
        role
    );
  }

  let missingProductionRoleBlocked =
    false;
  try {
    resolveProcessRole({
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
  } catch (error) {
    missingProductionRoleBlocked =
      error instanceof
        ProcessRoleConfigurationError;
  }
  assert(
    missingProductionRoleBlocked,
    'Production must fail closed when KNOWLEDGE_AI_PROCESS_ROLE is not configured.'
  );

  assert(
    roleRunsWeb('web') &&
      !roleRunsWorkers('web') &&
      !roleRunsWeb('worker') &&
      roleRunsWorkers('worker') &&
      roleRunsWeb('combined') &&
      roleRunsWorkers('combined'),
    'WEB/WORKER/combined ownership semantics must be explicit.'
  );

  const starts: Array<{
    keepProcessAlive?: boolean;
  }> = [];
  let stops = 0;
  const fakeWatchLoop = {
    start(options?: {
      keepProcessAlive?: boolean;
    }) {
      starts.push(
        options || {}
      );
    },
    stop() {
      stops += 1;
    },
  };

  const webRuntime =
    new BackgroundRuntime(
      fakeWatchLoop
    );
  const webStart =
    webRuntime.startForRole(
      'web'
    );

  assert(
    !webStart.started &&
      starts.length === 0 &&
      !webRuntime.isStarted(),
    'A WEB-only process must not start autonomous Watch worker loops.'
  );

  const workerRuntime =
    new BackgroundRuntime(
      fakeWatchLoop
    );
  const workerStart =
    workerRuntime.startForRole(
      'worker',
      {
        keepProcessAlive: true,
      }
    );
  const repeatedWorkerStart =
    workerRuntime.startForRole(
      'worker',
      {
        keepProcessAlive: true,
      }
    );

  assert(
    workerStart.started &&
      repeatedWorkerStart.started &&
      starts.length === 1 &&
      starts[0]
        .keepProcessAlive === true &&
      workerRuntime.isStarted(),
    'Dedicated worker role must start Watch exactly once and keep its event loop alive.'
  );

  workerRuntime.stop();
  assert(
    stops === 1 &&
      !workerRuntime.isStarted(),
    'Background runtime must stop its owned Watch loop cleanly.'
  );

  const combinedRuntime =
    new BackgroundRuntime(
      fakeWatchLoop
    );
  combinedRuntime.startForRole(
    'combined',
    {
      keepProcessAlive: false,
    }
  );

  assert(
    starts.length === 2 &&
      starts[1]
        .keepProcessAlive === false,
    'Combined compatibility mode must retain an unref-able web-hosted worker loop.'
  );
  combinedRuntime.stop();

  const autonomous =
    autonomousWorkerWorkloads();
  assert(
    autonomous
      .map((item) => item.id)
      .sort()
      .join(',') ===
      [
        'AUTOMATION_EXECUTION',
        'DISCOVERY_ANALYSIS',
        'INTEGRATION_SYNC',
        'WATCH_EVALUATION',
      ].join(','),
    'E1 historical role proof must accept the later E3 Discovery, E4 Integration, and E5 Automation worker migrations while keeping autonomous ownership explicit.'
  );

  const byId = new Map(
    BACKGROUND_WORKLOAD_CATALOG.map(
      (item) => [item.id, item]
    )
  );
  assert(
    byId.get('INTEGRATION_SYNC')
      ?.executionModel ===
      'AUTONOMOUS_LOOP' &&
      byId.get('INTEGRATION_SYNC')
        ?.e1Owner === 'WORKER' &&
      byId.get(
        'AUTOMATION_EXECUTION'
      )?.executionModel ===
        'AUTONOMOUS_LOOP' &&
      byId.get(
        'AUTOMATION_EXECUTION'
      )?.e1Owner ===
        'WORKER' &&
      byId.get(
        'DISCOVERY_ANALYSIS'
      )?.executionModel ===
        'AUTONOMOUS_LOOP' &&
      byId.get(
        'DISCOVERY_ANALYSIS'
      )?.e1Owner ===
        'WORKER',
    'E1 historical role proof must accept E3 Discovery, E4 Integration, and E5 Automation worker ownership.'
  );

  const server = read('server.ts');
  assert(
    server.includes(
      'resolveProcessRole'
    ) &&
      server.includes(
        'assertWebEntrypointRole'
      ) &&
      server.includes(
        'backgroundRuntime.startForRole'
      ) &&
      !server.includes(
        'watchRuntimeScheduler.start()'
      ) &&
      !server.includes(
        "from './server/watch/watchRuntimeScheduler.js'"
      ),
    'HTTP bootstrap must route autonomous work through the E1 role boundary rather than starting Watch directly.'
  );

  const worker = read('worker.ts');
  assert(
    worker.includes(
      'assertWorkerEntrypointRole'
    ) &&
      worker.includes(
        'KNOWLEDGE_AI_PERSISTENCE_MODE=postgres'
      ) &&
      worker.includes(
        'keepProcessAlive: true'
      ) &&
      worker.includes(
        'SELECT 1 FROM watch_jobs'
      ) &&
      worker.includes(
        'SELECT 1 FROM worker_jobs'
      ) &&
      worker.includes(
        'SELECT 1 FROM action_execution_discovery_jobs'
      ) &&
      worker.includes(
        'SELECT 1 FROM integration_sync_worker_jobs'
      ) &&
      worker.includes(
        'SELECT 1 FROM automation_execution_worker_jobs'
      ) &&
      worker.includes(
        "process.once('SIGTERM'"
      ) &&
      worker.includes(
        "process.once('SIGINT'"
      ),
    'Dedicated worker entrypoint must fail closed on role/persistence/E1-E5 schemas and own graceful worker startup/shutdown.'
  );

  const scheduler = read(
    'server/watch/watchRuntimeScheduler.ts'
  );
  assert(
    scheduler.includes(
      'keepProcessAlive?: boolean'
    ) &&
      scheduler.includes(
        'if (!params?.keepProcessAlive)'
      ) &&
      scheduler.includes(
        'this.timer.unref?.()'
      ),
    'Watch timer must distinguish web-hosted unref behavior from dedicated-worker keepalive.'
  );

  const pkg = JSON.parse(
    read('package.json')
  );
  assert(
    String(pkg.scripts?.build)
      .includes('worker.ts') &&
      pkg.scripts?.['worker:dev'] ===
        'tsx worker.ts' &&
      pkg.scripts?.[
        'start:worker'
      ] ===
        'node dist/worker.cjs',
    'Build/runtime scripts must publish a dedicated worker artifact and entrypoint.'
  );

  const env = read('.env.example');
  assert(
    env.includes(
      'KNOWLEDGE_AI_PROCESS_ROLE='
    ) &&
      env.includes(
        'web      = HTTP/API only'
      ) &&
      env.includes(
        'worker   = dedicated background worker'
      ),
    'Environment template must document explicit production process ownership.'
  );

  const pkgText =
    read('package.json')
      .toLowerCase();
  for (const forbidden of [
    'bullmq',
    'pg-boss',
    'bee-queue',
  ]) {
    assert(
      !pkgText.includes(forbidden),
      'E1 must not introduce generalized queue infrastructure before evidence requires it: ' +
        forbidden
    );
  }

  console.log(
    'PRODUCTION_E1_WORKER_RUNTIME_SEPARATION_CHECK_PASSED'
  );
  console.log(
    'Explicit production roles, WEB-only loop exclusion, dedicated worker ownership, workload inventory, graceful Watch ownership, and no-premature-queue scope are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_E1_WORKER_RUNTIME_SEPARATION_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
