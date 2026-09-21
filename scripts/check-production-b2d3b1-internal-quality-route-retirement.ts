import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import { runApiAcceptanceTests } from '../server/apiTestRunner.js';
import { runPhase4AcceptanceTests } from '../server/phase4TestRunner.js';
import { runMediatorPhase3Tests } from '../server/mediator/mediatorPhase3Runner.js';
import { runMediatorPhase4Tests } from '../server/mediator/mediatorPhase4Runner.js';
import { runMediatorPhase5Tests } from '../server/mediator/mediatorPhase5Runner.js';
import { runMediatorPhase7Tests } from '../server/mediator/mediatorPhase7Runner.js';
import { runMediatorPhase8Tests } from '../server/mediator/mediatorPhase8Runner.js';
import { runMediatorPhase9Tests } from '../server/mediator/mediatorPhase9Runner.js';
import { integratedStressHarness } from '../server/mediator/integratedStressHarness.js';
import { goldenDatasetService } from '../server/mediator/goldenDatasetService.js';
import { executeComprehensiveAudit } from '../server/fullAuditRunner.js';
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
      'B2D3B1 retirement proof server failed to bind.'
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

  const forbiddenRoutePatterns = [
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/tests\//,
    /app\.(?:get|post|put|patch|delete)\(\s*\[\s*['"]\/api\/v1\/tests\//,
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/stress\//,
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/eval\//,
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/audit\//,
  ];

  for (const pattern of forbiddenRoutePatterns) {
    assert(
      !pattern.test(serverSource),
      'Retired internal quality HTTP route registration remains in server.ts: ' +
        pattern
    );
  }

  const retiredServerImports = [
    'runApiAcceptanceTests',
    'runPhase4AcceptanceTests',
    'runMediatorPhase3Tests',
    'runMediatorPhase4Tests',
    'runMediatorPhase5Tests',
    'runMediatorPhase7Tests',
    'runMediatorPhase8Tests',
    'runMediatorPhase9Tests',
    'integratedStressHarness',
    'goldenDatasetService',
    'executeComprehensiveAudit',
  ];

  for (const symbol of retiredServerImports) {
    assert(
      !serverSource.includes(symbol),
      'server.ts must not retain obsolete HTTP-only import ' +
        symbol
    );
  }

  assert(
    serverSource.includes(
      "import { runMediatorPhase6Tests }"
    ) &&
      serverSource.includes(
        "app.post('/api/v1/mediator/tests/phase6'"
      ),
    'B2D3B1 must not accidentally remove the separate mediator-family Phase 6 route reserved for B2D3B3.'
  );

  for (const prefix of [
    '/api/v1/tests',
    '/api/v1/stress',
    '/api/v1/eval',
    '/api/v1/audit',
  ]) {
    assert(
      classifyLegacyRoute(prefix + '/proof')
        ?.disposition === 'RETIRED',
      prefix +
        ' must be classified RETIRED after HTTP removal.'
    );
  }

  assert(
    typeof runApiAcceptanceTests === 'function' &&
      typeof runPhase4AcceptanceTests === 'function' &&
      typeof runMediatorPhase3Tests === 'function' &&
      typeof runMediatorPhase4Tests === 'function' &&
      typeof runMediatorPhase5Tests === 'function' &&
      typeof runMediatorPhase7Tests === 'function' &&
      typeof runMediatorPhase8Tests === 'function' &&
      typeof runMediatorPhase9Tests === 'function',
    'Acceptance-test runners must remain importable by CLI/CI scripts after HTTP retirement.'
  );

  assert(
    typeof integratedStressHarness.runConcurrencyStress ===
      'function' &&
      typeof integratedStressHarness
        .auditTaskAndTenantIsolation === 'function' &&
      typeof integratedStressHarness
        .auditStateMachineTransitions === 'function',
    'Stress harness must remain script-callable after HTTP retirement.'
  );

  const stateMachineAudit =
    integratedStressHarness.auditStateMachineTransitions();
  assert(
    Boolean(stateMachineAudit),
    'Stress state-machine audit must remain directly callable outside HTTP.'
  );

  assert(
    Array.isArray(
      goldenDatasetService.listDatasets()
    ) &&
      Array.isArray(
        goldenDatasetService.listEvaluationRuns()
      ),
    'Evaluation service read APIs must remain directly callable outside HTTP.'
  );

  assert(
    typeof goldenDatasetService
      .executeEvaluationRun === 'function' &&
      typeof goldenDatasetService
        .recordHumanEvaluation === 'function' &&
      typeof executeComprehensiveAudit === 'function',
    'Evaluation and comprehensive-audit execution services must remain importable for internal scripts.'
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
      '/api/v1/tests/run',
      '/api/v1/tests/phase9',
      '/api/v1/stress/concurrency',
      '/api/v1/eval/run',
      '/api/v1/audit/comprehensive',
    ]) {
      const response = await fetch(
        baseUrl + path,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: '{}',
        }
      );
      const body = await readJson(response);
      assert(
        response.status === 404 &&
          body?.code ===
            LEGACY_ROUTE_QUARANTINE_CODE,
        'Retired quality route must stay unavailable even with non-production compatibility enabled: ' +
          path
      );
    }

    const devOnly = await fetch(
      baseUrl + '/api/v1/mediator/execute'
    );
    const devOnlyBody = await readJson(devOnly);
    assert(
      devOnly.status === 200 &&
        devOnlyBody?.source ===
          'post-quarantine-handler',
      'B2D3B1 must preserve explicit non-production compatibility for later DEVELOPMENT_ONLY route groups.'
    );
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
    'PRODUCTION_B2D3B1_INTERNAL_QUALITY_ROUTE_RETIREMENT_CHECK_PASSED'
  );
  console.log(
    'Test, stress, evaluation, and audit HTTP registrations are removed from server.ts; their supporting modules remain directly importable for CLI/CI; retired families cannot be reopened by compatibility flags; later DEVELOPMENT_ONLY groups remain untouched.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3B1_INTERNAL_QUALITY_ROUTE_RETIREMENT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
