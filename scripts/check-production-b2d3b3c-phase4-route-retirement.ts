import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import { memoryStore } from '../server/memoryStore.js';
import { memoryRetrievalService } from '../server/memoryRetrievalService.js';
import { sandboxService } from '../server/sandboxService.js';
import { learningService } from '../server/learningService.js';
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
      'B2D3B3C retirement proof server failed to bind.'
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
  const workspaceRouterSource = fs.readFileSync(
    'server/workspaceRouter.ts',
    'utf8'
  );
  const specializedAiSource = fs.readFileSync(
    'server/specializedAIService.ts',
    'utf8'
  );
  const appSource = fs.readFileSync(
    'src/App.tsx',
    'utf8'
  );
  const unifiedAskSource = fs.readFileSync(
    'src/components/UnifiedAskView.tsx',
    'utf8'
  );

  const phase4RoutePattern =
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/phase4(?:\/|['"])/;

  assert(
    !phase4RoutePattern.test(serverSource),
    'Retired /api/phase4 HTTP registration remains in server.ts.'
  );

  for (const importName of [
    'memoryStore',
    'sandboxService',
    'learningService',
  ]) {
    assert(
      serverSource.includes(importName),
      'Phase 4 supporting dependency required by authenticated /api/v1/ai compatibility must remain in server.ts: ' +
        importName
    );
  }

  for (const route of [
    "app.get('/api/v1/ai/:ai_id/memories'",
    "app.post('/api/v1/ai/:ai_id/memories'",
    "app.patch('/api/v1/ai/:ai_id/memories/:memory_id/status'",
    "app.get('/api/v1/ai/:ai_id/experiences'",
    "app.post('/api/v1/ai/:ai_id/experiences'",
    "app.get('/api/v1/ai/:ai_id/sandbox/scenarios'",
    "app.post('/api/v1/ai/:ai_id/sandbox/scenarios'",
    "app.post('/api/v1/ai/:ai_id/sandbox/runs'",
    "app.post('/api/v1/ai/:ai_id/sandbox/batch'",
    "app.get('/api/v1/ai/:ai_id/sandbox/runs'",
    "app.get('/api/v1/ai/:ai_id/learning'",
    "app.post('/api/v1/ai/:ai_id/learning/generate'",
    "app.get('/api/v1/ai/:ai_id/improvements'",
    "app.post('/api/v1/ai/:ai_id/improvements/propose'",
    "app.post('/api/v1/ai/:ai_id/improvements/:id/approve'",
    "app.post('/api/v1/ai/:ai_id/improvements/:id/reject'",
    "app.get('/api/v1/ai/:ai_id/dashboard'",
    "app.get('/api/v1/ai/:ai_id/audit'",
  ]) {
    assert(
      serverSource.includes(route),
      'Supported authenticated Specialized AI compatibility route must remain registered: ' +
        route
    );
  }

  assert(
    serverSource.includes('authenticateApiRequest(req, res, requestId)'),
    'Supported /api/v1/ai compatibility routes must retain API-key authentication.'
  );

  assert(
    workspaceRouterSource.includes(
      'workspaceRouter.use(applicationIdentityMiddleware);'
    ) &&
      workspaceRouterSource.includes(
        "workspaceRouter.put('/:id/ai'"
      ),
    'Modern HUMAN_SESSION workspace AI configuration route must remain identity-aware.'
  );

  assert(
    appSource.includes('<UnifiedAskView') &&
      unifiedAskSource.includes(
        "fetch('/api/query/ask'"
      ),
    'Current product Ask UI must remain on the modern /api/query/ask contract.'
  );

  assert(
    specializedAiSource.includes(
      "import { memoryRetrievalService }"
    ) &&
      specializedAiSource.includes(
        'memoryRetrievalService.retrieveRelevantMemories'
      ) &&
      specializedAiSource.includes(
        'memoryStore.recordExperience'
      ),
    'Governed memory retrieval and experience recording must remain part of the internal Specialized AI answer path.'
  );

  assert(
    classifyLegacyRoute('/api/phase4/proof')
      ?.disposition === 'RETIRED',
    '/api/phase4 must be classified RETIRED after B2D3B3C.'
  );

  assert(
    classifyLegacyRoute('/api/v1/ai/ai_demo/memories')
      ?.disposition === 'PRODUCTION_SUPPORTED',
    '/api/v1/ai must remain a production-supported compatibility family.'
  );

  assert(
    typeof memoryStore.listMemories === 'function' &&
      typeof memoryStore.listExperiences === 'function' &&
      typeof memoryStore.listScenarios === 'function' &&
      typeof memoryStore.listRuns === 'function' &&
      typeof memoryStore.listLearningCandidates ===
        'function' &&
      typeof memoryStore.listImprovementProposals ===
        'function' &&
      typeof memoryStore.getDashboardStats === 'function',
    'Governed memory/experience/sandbox/learning state APIs must remain directly importable.'
  );

  assert(
    typeof memoryRetrievalService
      .retrieveRelevantMemories === 'function',
    'Memory retrieval service must remain directly importable.'
  );

  assert(
    typeof sandboxService.runScenario === 'function' &&
      typeof sandboxService.runBatch === 'function',
    'Sandbox service must remain directly importable.'
  );

  assert(
    typeof learningService
      .generateCandidateFromExperiences === 'function' &&
      typeof learningService
        .evaluateCandidatesAndBuildScorecard ===
        'function',
    'Controlled learning service must remain directly importable.'
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
      '/api/phase4/dashboard',
      '/api/phase4/memories',
      '/api/phase4/memories/mem_demo/status',
      '/api/phase4/experiences',
      '/api/phase4/feedback',
      '/api/phase4/sandbox/scenarios',
      '/api/phase4/sandbox/runs',
      '/api/phase4/sandbox/batch',
      '/api/phase4/learning/candidates',
      '/api/phase4/learning/generate',
      '/api/phase4/improvements',
      '/api/phase4/improvements/propose',
      '/api/phase4/improvements/proposal_demo/approve',
      '/api/phase4/improvements/proposal_demo/reject',
      '/api/phase4/ai-config',
    ]) {
      const response = await fetch(
        baseUrl + path
      );
      const body = await readJson(response);
      assert(
        response.status === 404 &&
          body?.code ===
            LEGACY_ROUTE_QUARANTINE_CODE &&
          body?.family === 'prototype-phase4' &&
          body?.disposition === 'RETIRED',
        'Retired Phase 4 route must stay unavailable even with compatibility enabled: ' +
          path
      );
    }

    for (const path of [
      '/api/v1/ai/ai_demo/memories',
      '/api/v1/ai/ai_demo/experiences',
      '/api/v1/ai/ai_demo/sandbox/scenarios',
      '/api/v1/ai/ai_demo/learning',
      '/api/v1/ai/ai_demo/improvements',
      '/api/v1/ai/ai_demo/dashboard',
      '/api/v1/ai/ai_demo/audit',
    ]) {
      const response = await fetch(
        baseUrl + path
      );
      const body = await readJson(response);
      assert(
        response.status === 200 &&
          body?.source ===
            'post-quarantine-handler',
        'Production-supported /api/v1/ai family must still pass the quarantine boundary: ' +
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
    'PRODUCTION_B2D3B3C_PHASE4_ROUTE_RETIREMENT_CHECK_PASSED'
  );
  console.log(
    'Legacy /api/phase4 convenience routes are removed and permanently RETIRED; compatibility cannot reopen them; authenticated /api/v1/ai memory/sandbox/learning compatibility remains; modern workspace AI configuration and /api/query/ask remain intact; and governed memory retrieval/experience recording stays internal to the supported answer path.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3B3C_PHASE4_ROUTE_RETIREMENT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
