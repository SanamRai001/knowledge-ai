import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import {
  LEGACY_ROUTE_COMPATIBILITY_FLAG,
  LEGACY_ROUTE_QUARANTINE_CODE,
  classifyLegacyRoute,
  legacyPrototypeRouteQuarantineMiddleware,
  legacyRouteInventory,
} from '../server/legacyRouteQuarantine.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function startServer(params?: {
  modernKbRoute?: boolean;
}): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());

  if (params?.modernKbRoute) {
    app.get('/api/kb/modern-proof', (_req, res) => {
      res.json({ source: 'modern-router' });
    });
  }

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
      'B2D3A quarantine proof server failed to bind.'
    );
  }

  return {
    server,
    baseUrl:
      'http://127.0.0.1:' + address.port,
  };
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

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
  params?: { modernKbRoute?: boolean }
): Promise<void> {
  const { server, baseUrl } =
    await startServer(params);
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });
  }
}

async function main() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCompatibility =
    process.env[LEGACY_ROUTE_COMPATIBILITY_FLAG];

  try {
    const expectedRetired = [
      '/api/v1/tests',
      '/api/v1/stress',
      '/api/v1/eval',
      '/api/v1/audit',
      '/api/v1/operations',
      '/api/v1/observability',
    ];

    for (const prefix of expectedRetired) {
      const family = classifyLegacyRoute(
        prefix + '/proof'
      );
      assert(
        family?.disposition === 'RETIRED',
        prefix +
          ' must remain permanently retired.'
      );
    }

    const expectedDevelopmentOnly = [
      '/api/v1/tenants',
      '/api/v1/saas',
      '/api/v1/mediator',
      '/api/v1/rag',
      '/api/v1/cognitive',
      '/api/phase4',
    ];

    for (const prefix of expectedDevelopmentOnly) {
      const family = classifyLegacyRoute(
        prefix + '/proof'
      );
      assert(
        family?.disposition ===
          'DEVELOPMENT_ONLY',
        prefix +
          ' must be classified DEVELOPMENT_ONLY.'
      );
    }

    assert(
      classifyLegacyRoute('/api/kb/legacy-only')
        ?.disposition === 'RETIRED_FALLBACK',
      'Legacy /api/kb fall-through must be RETIRED_FALLBACK.'
    );

    for (const path of [
      '/api/v1/health',
      '/api/v1/chat',
      '/api/v1/ai/example',
      '/api/v1/system/health',
      '/api/v1/providers/health',
      '/api/v1/api-docs/openapi',
    ]) {
      assert(
        classifyLegacyRoute(path)?.disposition ===
          'PRODUCTION_SUPPORTED',
        path +
          ' must remain explicitly classified as production-supported compatibility.'
      );
    }

    assert(
      legacyRouteInventory.some(
        (family) =>
          family.id ===
            'legacy-developer-management' &&
          family.disposition === 'RETIRED'
      ),
      'Retired developer-management family must remain inventoried.'
    );

    process.env.NODE_ENV = 'production';
    process.env[
      LEGACY_ROUTE_COMPATIBILITY_FLAG
    ] = 'true';

    await withServer(async (baseUrl) => {
      for (const path of [
        '/api/v1/tests/run',
        '/api/v1/stress/concurrency',
        '/api/v1/operations/incidents',
        '/api/v1/observability/slos',
        '/api/v1/eval/run',
        '/api/v1/audit/comprehensive',
        '/api/v1/tenants',
        '/api/v1/saas/status',
        '/api/v1/mediator/execute',
        '/api/v1/rag/benchmark/run',
        '/api/v1/cognitive/query',
        '/api/phase4/dashboard',
        '/api/kb/legacy-only',
      ]) {
        const response = await fetch(
          baseUrl + path,
          {
            method: path.includes('/run') ||
              path.endsWith('/execute') ||
              path.endsWith('/query') ||
              path.includes('/concurrency')
              ? 'POST'
              : 'GET',
            headers: {
              'content-type':
                'application/json',
            },
            body:
              path.includes('/run') ||
              path.endsWith('/execute') ||
              path.endsWith('/query') ||
              path.includes('/concurrency')
                ? '{}'
                : undefined,
          }
        );
        const body = await readJson(response);
        assert(
          response.status === 404 &&
            body?.code ===
              LEGACY_ROUTE_QUARANTINE_CODE,
          'Production must quarantine ' +
            path +
            ' even when compatibility flag is true.'
        );
      }

      for (const path of [
        '/api/health',
        '/api/v1/health',
        '/api/v1/chat',
        '/api/v1/ai/example',
        '/api/v1/system/health',
        '/api/v1/providers/health',
        '/api/v1/api-docs/openapi',
        '/api/not-in-inventory',
      ]) {
        const response = await fetch(
          baseUrl + path
        );
        const body = await readJson(response);
        assert(
          response.status === 200 &&
            body?.source ===
              'post-quarantine-handler',
          'Supported/unclassified route must pass quarantine: ' +
            path
        );
      }
    });

    await withServer(
      async (baseUrl) => {
        const modern = await fetch(
          baseUrl + '/api/kb/modern-proof'
        );
        const modernBody = await readJson(modern);
        assert(
          modern.status === 200 &&
            modernBody?.source ===
              'modern-router',
          'A modern /api/kb handler mounted before quarantine must remain reachable.'
        );

        const legacy = await fetch(
          baseUrl + '/api/kb/legacy-only'
        );
        const legacyBody = await readJson(legacy);
        assert(
          legacy.status === 404 &&
            legacyBody?.family ===
              'legacy-workspace-fallback',
          'Unhandled /api/kb traffic must not fall through to retired inline handlers in production.'
        );
      },
      { modernKbRoute: true }
    );

    process.env.NODE_ENV = 'development';
    delete process.env[
      LEGACY_ROUTE_COMPATIBILITY_FLAG
    ];

    await withServer(async (baseUrl) => {
      const response = await fetch(
        baseUrl + '/api/v1/tenants'
      );
      const body = await readJson(response);
      assert(
        response.status === 404 &&
          body?.code ===
            LEGACY_ROUTE_QUARANTINE_CODE,
        'Development must remain default-deny without explicit compatibility opt-in.'
      );
    });

    process.env[
      LEGACY_ROUTE_COMPATIBILITY_FLAG
    ] = 'true';

    await withServer(async (baseUrl) => {
      for (const path of [
        '/api/v1/tenants',
        '/api/v1/mediator/execute',
        '/api/phase4/dashboard',
      ]) {
        const response = await fetch(
          baseUrl + path,
          {
            method:
              path.endsWith('/execute')
                ? 'POST'
                : 'GET',
          }
        );
        const body = await readJson(response);
        assert(
          response.status === 200 &&
            body?.source ===
              'post-quarantine-handler',
          'Explicit non-production compatibility must allow DEVELOPMENT_ONLY route ' +
            path
        );
      }

      for (const path of [
        '/api/v1/tests/run',
        '/api/v1/stress/concurrency',
        '/api/v1/eval/run',
        '/api/v1/audit/comprehensive',
        '/api/v1/operations/incidents',
        '/api/v1/observability/slos',
        '/api/kb/legacy-only',
      ]) {
        const response = await fetch(
          baseUrl + path,
          {
            method:
              path.includes('/run') ||
              path.includes('/concurrency') ||
              path.includes('/comprehensive')
                ? 'POST'
                : 'GET',
          }
        );
        const body = await readJson(response);
        assert(
          response.status === 404 &&
            body?.code ===
              LEGACY_ROUTE_QUARANTINE_CODE,
          'Retired route must remain unavailable even with non-production compatibility enabled: ' +
            path
        );
      }
    });

    const serverSource = fs.readFileSync(
      'server.ts',
      'utf8'
    );
    const modernMountIndex =
      serverSource.indexOf(
        "app.use('/api/kb', workspaceRouter)"
      );
    const developerClosureIndex =
      serverSource.indexOf(
        "app.use('/api/v1/developer', legacyDeveloperRouteClosureRouter)"
      );
    const quarantineIndex =
      serverSource.indexOf(
        'app.use(legacyPrototypeRouteQuarantineMiddleware)'
      );
    const legacyKbIndex =
      serverSource.indexOf(
        "app.get('/api/kb', (req, res) =>"
      );

    assert(
      modernMountIndex >= 0 &&
        developerClosureIndex > modernMountIndex &&
        quarantineIndex >
          developerClosureIndex &&
        legacyKbIndex > quarantineIndex,
      'server.ts must mount modern routers and explicit developer retirement before quarantine, with old inline /api/kb handlers after quarantine.'
    );

    const envExample = fs.readFileSync(
      '.env.example',
      'utf8'
    );
    assert(
      envExample.includes(
        'KNOWLEDGE_AI_ALLOW_LEGACY_PROTOTYPE_ROUTES=false'
      ),
      'Explicit legacy/prototype compatibility flag must be documented and default false.'
    );

    console.log(
      'PRODUCTION_B2D3A_ROUTE_QUARANTINE_CHECK_PASSED'
    );
    console.log(
      'Legacy/prototype route families are inventoried, modern and intended API-key compatibility paths pass, retired/prototype families fail closed in production, legacy /api/kb fall-through is blocked, and non-production compatibility requires an explicit opt-in flag.'
    );
  } finally {
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
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3A_ROUTE_QUARANTINE_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
