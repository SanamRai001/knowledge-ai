import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import { operationalHardeningService } from '../server/mediator/operationalHardeningService.js';
import { telemetryService } from '../server/mediator/telemetryAndObservability.js';
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
      'B2D3B2A retirement proof server failed to bind.'
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

  for (const pattern of [
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/operations\//,
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/observability\//,
  ]) {
    assert(
      !pattern.test(serverSource),
      'Retired operations/observability HTTP route remains registered: ' +
        pattern
    );
  }

  assert(
    !serverSource.includes(
      "import { telemetryService }"
    ) &&
      !serverSource.includes(
        "import { operationalHardeningService }"
      ),
    'server.ts must not retain obsolete operations/observability service imports.'
  );

  assert(
    serverSource.includes(
      "app.get('/api/v1/system/health'"
    ) &&
      serverSource.includes(
        "app.get('/api/v1/system/readiness'"
      ) &&
      serverSource.includes(
        "app.get('/api/v1/providers/health'"
      ),
    'B2D3B2A must preserve intended system/provider read-only compatibility routes.'
  );

  for (const prefix of [
    '/api/v1/operations',
    '/api/v1/observability',
  ]) {
    assert(
      classifyLegacyRoute(prefix + '/proof')
        ?.disposition === 'RETIRED',
      prefix +
        ' must be classified RETIRED after HTTP removal.'
    );
  }

  assert(
    typeof operationalHardeningService
      .getOperationalReadinessReport === 'function' &&
      typeof operationalHardeningService
        .listIncidents === 'function' &&
      typeof operationalHardeningService
        .listFeatureFlags === 'function' &&
      typeof operationalHardeningService
        .detectConfigurationDrift === 'function' &&
      typeof operationalHardeningService
        .getCanaryConfig === 'function',
    'Operational hardening service APIs must remain directly importable.'
  );

  const readiness =
    operationalHardeningService.getOperationalReadinessReport();
  const incidents =
    operationalHardeningService.listIncidents();
  const flags =
    operationalHardeningService.listFeatureFlags();
  const canary =
    operationalHardeningService.getCanaryConfig();

  assert(
    Boolean(readiness) &&
      Array.isArray(incidents) &&
      Array.isArray(flags) &&
      Boolean(canary),
    'Operational hardening service must remain directly callable outside HTTP.'
  );

  assert(
    typeof telemetryService.getSloReport ===
      'function' &&
      typeof telemetryService.listTraceSpans ===
        'function' &&
      typeof telemetryService.listAlerts ===
        'function' &&
      typeof telemetryService.updateSloConfig ===
        'function' &&
      typeof telemetryService.resolveAlert ===
        'function',
    'Telemetry/observability service APIs must remain directly importable.'
  );

  const slo = telemetryService.getSloReport();
  const traces = telemetryService.listTraceSpans(5);
  const alerts = telemetryService.listAlerts(true);

  assert(
    Boolean(slo?.status) &&
      Array.isArray(traces) &&
      Array.isArray(alerts),
    'Telemetry service must remain directly callable outside HTTP.'
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
      '/api/v1/operations/incidents',
      '/api/v1/operations/canary',
      '/api/v1/observability/slos',
      '/api/v1/observability/alerts',
    ]) {
      const response = await fetch(
        baseUrl + path
      );
      const body = await readJson(response);
      assert(
        response.status === 404 &&
          body?.code ===
            LEGACY_ROUTE_QUARANTINE_CODE,
        'Retired operations/observability route must stay unavailable even with compatibility enabled: ' +
          path
      );
    }

    const phase4 = await fetch(
      baseUrl + '/api/phase4/dashboard'
    );
    const phase4Body = await readJson(phase4);
    assert(
      phase4.status === 404 &&
        phase4Body?.code ===
          LEGACY_ROUTE_QUARANTINE_CODE &&
        phase4Body?.disposition === 'RETIRED',
      'B2D3B2A regression proof must accept the later B2D3B3C Phase 4 retirement.'
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
    'PRODUCTION_B2D3B2A_OPERATIONS_OBSERVABILITY_RETIREMENT_CHECK_PASSED'
  );
  console.log(
    'Operations and observability HTTP registrations are removed, both route families are permanently retired, operational/telemetry services remain directly callable, system/provider read-only compatibility remains registered, and later DEVELOPMENT_ONLY RAG/Cognitive/Phase 4 compatibility remains untouched.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3B2A_OPERATIONS_OBSERVABILITY_RETIREMENT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
