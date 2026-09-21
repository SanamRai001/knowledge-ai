import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import { orchestrationEngine } from '../server/mediator/orchestrationEngine.js';
import { agentRegistry } from '../server/mediator/agentRegistry.js';
import { benchmarkRunner } from '../server/mediator/benchmarkRunner.js';
import { runMediatorPhase6Tests } from '../server/mediator/mediatorPhase6Runner.js';
import { adaptiveOrchestrator } from '../server/mediator/adaptiveOrchestrator.js';
import { adaptiveBenchmarkEngine } from '../server/mediator/adaptiveBenchmarkEngine.js';
import { taskComplexityAnalyzer } from '../server/mediator/taskComplexityAnalyzer.js';
import { riskAssessmentEngine } from '../server/mediator/riskAssessmentEngine.js';
import { adaptiveStrategyPlanner } from '../server/mediator/adaptiveStrategyPlanner.js';
import { adaptiveDisagreementDetector } from '../server/mediator/adaptiveDisagreementDetector.js';
import { independentVerifier } from '../server/mediator/independentVerifier.js';
import {
  LEGACY_ROUTE_COMPATIBILITY_FLAG,
  LEGACY_ROUTE_QUARANTINE_CODE,
  classifyLegacyRoute,
  legacyPrototypeRouteQuarantineMiddleware,
} from '../server/legacyRouteQuarantine.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson(
  response: Response
): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function startServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use(legacyPrototypeRouteQuarantineMiddleware);
  app.all('*', (req, res) => {
    res.json({
      source: 'post-quarantine-handler',
      path: req.path,
    });
  });

  const server = await new Promise<Server>(
    (resolve) => {
      const listener = app.listen(
        0,
        '127.0.0.1',
        () => resolve(listener)
      );
    }
  );

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error(
      'B2D3B3A retirement proof server failed to bind.'
    );
  }

  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
}

async function main() {
  const serverSource = fs.readFileSync(
    'server.ts',
    'utf8'
  );

  const mediatorRoutePattern =
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/mediator(?:\/|['"])/;

  assert(
    !mediatorRoutePattern.test(serverSource),
    'Retired /api/v1/mediator HTTP registration remains in server.ts.'
  );

  for (const importName of [
    'orchestrationEngine',
    'agentRegistry',
    'benchmarkRunner',
    'runMediatorPhase6Tests',
    'adaptiveOrchestrator',
    'adaptiveBenchmarkEngine',
    'taskComplexityAnalyzer',
    'riskAssessmentEngine',
    'adaptiveStrategyPlanner',
    'adaptiveDisagreementDetector',
    'independentVerifier',
  ]) {
    assert(
      !serverSource.includes(
        'import { ' + importName + ' }'
      ),
      'server.ts must not retain obsolete mediator-route-only import ' +
        importName
    );
  }

  for (const supported of [
    {
      importName: 'apiManagementService',
      route: "app.get('/api/v1/api-docs/openapi'",
    },
    {
      importName: 'realProviderAdapter',
      route: "app.get('/api/v1/providers/health'",
    },
    {
      importName: 'systemReadinessService',
      route: "app.get('/api/v1/system/health'",
    },
    {
      importName: 'getProductionLimitations',
      route: "app.get('/api/v1/system/limitations'",
    },
  ]) {
    assert(
      serverSource.includes(
        'import { ' + supported.importName + ' }'
      ) &&
        serverSource.includes(supported.route),
      'Supported compatibility dependency must remain registered: ' +
        supported.importName
    );
  }

  assert(
    classifyLegacyRoute('/api/v1/mediator/proof')
      ?.disposition === 'RETIRED',
    '/api/v1/mediator must be classified RETIRED.'
  );

  for (const prefix of [
    '/api/v1/rag',
    '/api/v1/cognitive',
    '/api/phase4',
  ]) {
    assert(
      classifyLegacyRoute(prefix + '/proof')
        ?.disposition === 'DEVELOPMENT_ONLY',
      prefix +
        ' must remain DEVELOPMENT_ONLY for later B2D3B3 slices.'
    );
  }

  assert(
    typeof orchestrationEngine.listRuns === 'function' &&
      typeof orchestrationEngine.getRun === 'function' &&
      typeof orchestrationEngine.executeRun === 'function' &&
      typeof orchestrationEngine.cancelRun === 'function',
    'Orchestration engine must remain directly importable.'
  );

  assert(
    typeof agentRegistry.listAgents === 'function',
    'Agent registry must remain directly importable.'
  );

  assert(
    typeof benchmarkRunner.getMetrics === 'function' &&
      typeof benchmarkRunner.runParallelSpeedupBenchmark ===
        'function' &&
      typeof benchmarkRunner.runAgentCountExperiment ===
        'function' &&
      typeof benchmarkRunner.runMajorityWrongBenchmark ===
        'function',
    'Mediator benchmark runner must remain directly importable.'
  );

  assert(
    typeof runMediatorPhase6Tests === 'function',
    'Mediator Phase 6 runner must remain directly importable for CI/internal use.'
  );

  assert(
    typeof adaptiveOrchestrator.executeRun === 'function' &&
      typeof adaptiveOrchestrator.getAllRuns === 'function' &&
      typeof adaptiveOrchestrator.getRun === 'function',
    'Adaptive orchestrator must remain directly importable.'
  );

  assert(
    typeof adaptiveBenchmarkEngine
      .runComparativeBenchmark === 'function' &&
      typeof taskComplexityAnalyzer.analyze === 'function' &&
      typeof riskAssessmentEngine.assess === 'function' &&
      typeof adaptiveStrategyPlanner.plan === 'function' &&
      typeof adaptiveDisagreementDetector
        .analyzeDisagreements === 'function' &&
      typeof independentVerifier.verify === 'function',
    'Mediator planning, disagreement, verification, and adaptive benchmark services must remain directly importable.'
  );

  const agents = agentRegistry.listAgents();
  const runs = orchestrationEngine.listRuns();
  const metrics = benchmarkRunner.getMetrics();

  assert(
    Array.isArray(agents) &&
      Array.isArray(runs) &&
      Boolean(metrics),
    'Mediator internal read APIs must remain callable outside HTTP.'
  );

  const originalNodeEnv = process.env.NODE_ENV;
  const originalCompatibility =
    process.env[LEGACY_ROUTE_COMPATIBILITY_FLAG];

  process.env.NODE_ENV = 'development';
  process.env[
    LEGACY_ROUTE_COMPATIBILITY_FLAG
  ] = 'true';

  const { server, baseUrl } = await startServer();

  try {
    for (const path of [
      '/api/v1/mediator/agents',
      '/api/v1/mediator/runs',
      '/api/v1/mediator/runs/run_demo',
      '/api/v1/mediator/execute',
      '/api/v1/mediator/plan',
      '/api/v1/mediator/disagreements/analyze',
      '/api/v1/mediator/verify',
      '/api/v1/mediator/adaptive/runs',
      '/api/v1/mediator/adaptive/runs/run_demo',
      '/api/v1/mediator/benchmarks/compare',
      '/api/v1/mediator/runs/run_demo/cancel',
      '/api/v1/mediator/metrics',
      '/api/v1/mediator/benchmarks/parallelism',
      '/api/v1/mediator/benchmarks/scaling',
      '/api/v1/mediator/benchmarks/majority-wrong',
      '/api/v1/mediator/tests/phase6',
    ]) {
      const response = await fetch(
        baseUrl + path
      );
      const body = await readJson(response);
      assert(
        response.status === 404 &&
          body?.code ===
            LEGACY_ROUTE_QUARANTINE_CODE &&
          body?.family === 'prototype-mediator' &&
          body?.disposition === 'RETIRED',
        'Retired mediator route must stay unavailable even with compatibility enabled: ' +
          path
      );
    }

    for (const path of [
      '/api/v1/rag/benchmark/run',
      '/api/v1/cognitive/query',
      '/api/phase4/dashboard',
    ]) {
      const response = await fetch(
        baseUrl + path
      );
      const body = await readJson(response);
      assert(
        response.status === 200 &&
          body?.source ===
            'post-quarantine-handler',
        'B2D3B3A must preserve later DEVELOPMENT_ONLY route family: ' +
          path
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalCompatibility === undefined) {
      delete process.env[
        LEGACY_ROUTE_COMPATIBILITY_FLAG
      ];
    } else {
      process.env[
        LEGACY_ROUTE_COMPATIBILITY_FLAG
      ] = originalCompatibility;
    }
  }

  console.log(
    'PRODUCTION_B2D3B3A_MEDIATOR_ROUTE_RETIREMENT_CHECK_PASSED'
  );
  console.log(
    'Prototype mediator HTTP registration is removed; all mediator routes are permanently retired; route-only server imports are gone; supported API-docs/provider/system dependencies remain; mediator internals stay directly callable; and RAG/Cognitive/Phase 4 compatibility remains untouched.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3B3A_MEDIATOR_ROUTE_RETIREMENT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
