import express from 'express';
import fs from 'fs';
import type { Server } from 'http';
import { runRag50GoldenBenchmark } from '../server/ragBenchmarkRunner.js';
import { runEightTurnConversationalSequence } from '../server/ragConversationalTester.js';
import { ragTelemetryStore } from '../server/ragTelemetryStore.js';
import { hybridRagIndex } from '../server/ragPipeline.js';
import { knowledgeCognitiveEngine } from '../server/cognitiveEngine/knowledgeCognitiveEngine.js';
import {
  runAurora24Benchmark,
  runMultilingualBenchmark,
} from '../server/cognitiveEngine/benchmarks/auroraBenchmark.js';
import { runGolden220Benchmark } from '../server/cognitiveEngine/benchmarks/golden200Benchmark.js';
import { cognitiveTelemetryStore } from '../server/cognitiveEngine/cognitiveTelemetryStore.js';
import { knowledgeGraphEngine } from '../server/cognitiveEngine/knowledgeGraphEngine.js';
import { hierarchicalIndex } from '../server/cognitiveEngine/hierarchicalIndex.js';
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
      'B2D3B3B retirement proof server failed to bind.'
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
  const queryRouterSource = fs.readFileSync(
    'server/querying/queryRouter.ts',
    'utf8'
  );

  for (const pattern of [
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/rag(?:\/|['"])/,
    /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/v1\/cognitive(?:\/|['"])/,
  ]) {
    assert(
      !pattern.test(serverSource),
      'Retired RAG/Cognitive HTTP registration remains in server.ts: ' +
        pattern
    );
  }

  for (const importName of [
    'runRag50GoldenBenchmark',
    'runEightTurnConversationalSequence',
    'ragTelemetryStore',
    'knowledgeCognitiveEngine',
    'runAurora24Benchmark',
    'runMultilingualBenchmark',
    'runGolden220Benchmark',
    'cognitiveTelemetryStore',
    'knowledgeGraphEngine',
    'hierarchicalIndex',
    'generateFullAuroraRoboticsCorpusPdf',
  ]) {
    assert(
      !serverSource.includes(importName),
      'server.ts must not retain obsolete RAG/Cognitive HTTP-only dependency ' +
        importName
    );
  }

  assert(
    serverSource.includes(
      "import { parsePdfBuffer, createKnowledgeDocument }"
    ),
    'Shared document parsing/import support must remain available to supported upload flows.'
  );

  assert(
    serverSource.includes(
      "app.use('/api/query', queryRouter);"
    ) &&
      queryRouterSource.includes(
        'queryRouter.use(applicationIdentityMiddleware);'
      ) &&
      queryRouterSource.includes(
        "queryRouter.post('/ask'"
      ) &&
      queryRouterSource.includes(
        'unifiedQueryService.answer'
      ),
    'Supported identity-aware /api/query/ask must remain the product query contract.'
  );

  for (const prefix of [
    '/api/v1/rag',
    '/api/v1/cognitive',
  ]) {
    assert(
      classifyLegacyRoute(prefix + '/proof')
        ?.disposition === 'RETIRED',
      prefix +
        ' must be classified RETIRED after B2D3B3B.'
    );
  }

  assert(
    classifyLegacyRoute('/api/phase4/proof')
      ?.disposition === 'DEVELOPMENT_ONLY',
    '/api/phase4 must remain DEVELOPMENT_ONLY for B2D3B3C.'
  );

  assert(
    typeof runRag50GoldenBenchmark === 'function' &&
      typeof runEightTurnConversationalSequence ===
        'function',
    'RAG benchmark/reproduction runners must remain directly importable for internal quality workflows.'
  );

  assert(
    typeof ragTelemetryStore.getRecentTraces ===
      'function' &&
      typeof ragTelemetryStore.getStatistics ===
        'function' &&
      typeof hybridRagIndex.getChunks === 'function' &&
      typeof hybridRagIndex.search === 'function',
    'RAG telemetry/index internals must remain directly importable.'
  );

  assert(
    typeof knowledgeCognitiveEngine.answerQuestion ===
      'function' &&
      typeof runAurora24Benchmark === 'function' &&
      typeof runMultilingualBenchmark === 'function' &&
      typeof runGolden220Benchmark === 'function',
    'Cognitive engine and benchmark internals must remain directly importable.'
  );

  assert(
    typeof cognitiveTelemetryStore.getTraces ===
      'function' &&
      typeof cognitiveTelemetryStore.getStatistics ===
        'function' &&
      typeof knowledgeGraphEngine.getOrCreateGraph ===
        'function' &&
      typeof hierarchicalIndex.indexDocument ===
        'function' &&
      typeof hierarchicalIndex.getStructuredTables ===
        'function' &&
      typeof hierarchicalIndex.getDocumentOutline ===
        'function',
    'Cognitive telemetry/graph/index internals must remain directly importable.'
  );

  const ragTraces =
    ragTelemetryStore.getRecentTraces(1);
  const ragStats =
    ragTelemetryStore.getStatistics();
  const cognitiveTraces =
    cognitiveTelemetryStore.getTraces(1);
  const cognitiveStats =
    cognitiveTelemetryStore.getStatistics();
  const graph =
    knowledgeGraphEngine.getOrCreateGraph(
      'b2d3b3b_internal_fixture',
      'kb_fixture'
    );
  const chunks =
    hybridRagIndex.getChunks(
      'b2d3b3b_internal_fixture',
      'kb_fixture'
    );
  const tables =
    hierarchicalIndex.getStructuredTables(
      'b2d3b3b_internal_fixture',
      'kb_fixture'
    );
  const outline =
    hierarchicalIndex.getDocumentOutline(
      'b2d3b3b_internal_fixture',
      'kb_fixture'
    );

  assert(
    Array.isArray(ragTraces) &&
      Boolean(ragStats) &&
      Array.isArray(cognitiveTraces) &&
      Boolean(cognitiveStats) &&
      Array.isArray(graph.nodes) &&
      Array.isArray(graph.edges) &&
      Array.isArray(chunks) &&
      Array.isArray(tables) &&
      Array.isArray(outline),
    'RAG/Cognitive supporting read APIs must remain callable outside HTTP.'
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
      '/api/v1/rag/benchmark/run',
      '/api/v1/rag/benchmark/status',
      '/api/v1/rag/reproduce-sequence',
      '/api/v1/rag/telemetry',
      '/api/v1/rag/telemetry/stats',
      '/api/v1/cognitive/query',
      '/api/v1/cognitive/benchmarks/aurora',
      '/api/v1/cognitive/benchmarks/golden',
      '/api/v1/cognitive/benchmarks/multilingual',
      '/api/v1/cognitive/telemetry',
      '/api/v1/cognitive/graph',
      '/api/v1/cognitive/tables',
      '/api/v1/cognitive/outline',
    ]) {
      const response = await fetch(
        baseUrl + path
      );
      const body = await readJson(response);
      assert(
        response.status === 404 &&
          body?.code ===
            LEGACY_ROUTE_QUARANTINE_CODE &&
          body?.disposition === 'RETIRED' &&
          (body?.family === 'prototype-rag' ||
            body?.family === 'prototype-cognitive'),
        'Retired RAG/Cognitive route must stay unavailable even with compatibility enabled: ' +
          path
      );
    }

    const phase4 = await fetch(
      baseUrl + '/api/phase4/dashboard'
    );
    const phase4Body = await readJson(phase4);
    assert(
      phase4.status === 200 &&
        phase4Body?.source ===
          'post-quarantine-handler',
      'B2D3B3B must preserve Phase 4 DEVELOPMENT_ONLY compatibility for B2D3B3C.'
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
    'PRODUCTION_B2D3B3B_RAG_COGNITIVE_ROUTE_RETIREMENT_CHECK_PASSED'
  );
  console.log(
    'Prototype RAG and Cognitive HTTP registrations are removed and permanently RETIRED; compatibility cannot reopen them; the identity-aware /api/query/ask contract remains supported; RAG/Cognitive engines, telemetry, graph/index, and benchmark modules remain internally importable; and Phase 4 compatibility is untouched.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_B2D3B3B_RAG_COGNITIVE_ROUTE_RETIREMENT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
