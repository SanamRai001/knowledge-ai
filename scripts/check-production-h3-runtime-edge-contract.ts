import {
  RuntimeEdgeConfigurationError,
  runtimeEdgeConfig,
} from '../server/runtime/runtimeEdgeConfig.js';
import {
  requestSizeGuard,
  securityHeadersMiddleware,
} from '../server/runtime/securityHeadersMiddleware.js';
import {
  HttpDrainController,
} from '../server/runtime/httpDrainController.js';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

class MockResponse
  extends EventEmitter
{
  headers =
    new Map<string, string>();
  statusCode = 200;
  body: unknown;

  setHeader(
    name: string,
    value: string
  ) {
    this.headers.set(
      name.toLowerCase(),
      String(value)
    );
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    this.emit('finish');
    return this;
  }
}

function expectConfigError(
  env: NodeJS.ProcessEnv
): void {
  let blocked = false;
  try {
    runtimeEdgeConfig(env);
  } catch (error) {
    blocked =
      error instanceof
        RuntimeEdgeConfigurationError;
  }
  assert(
    blocked,
    'Expected invalid H3 runtime-edge configuration to fail closed.'
  );
}

async function main() {
  const defaults =
    runtimeEdgeConfig({
      NODE_ENV: 'production',
    });

  assert(
    defaults.port === 3000 &&
      defaults.trustProxyHops === 0 &&
      defaults.jsonBodyLimitBytes ===
        1024 * 1024 &&
      defaults.urlencodedBodyLimitBytes ===
        256 * 1024 &&
      defaults.maxRequestBodyBytes ===
        260 * 1024 * 1024 &&
      defaults.shutdownTimeoutMs ===
        30_000 &&
      defaults.hstsOwner ===
        'proxy' &&
      defaults.workerHealthHost ===
        '127.0.0.1' &&
      defaults.workerHealthPort ===
        3001,
    'H3 runtime-edge defaults drifted.'
  );

  const custom =
    runtimeEdgeConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      KNOWLEDGE_AI_TRUST_PROXY_HOPS:
        '1',
      KNOWLEDGE_AI_JSON_BODY_LIMIT_KB:
        '512',
      KNOWLEDGE_AI_URLENCODED_BODY_LIMIT_KB:
        '128',
      KNOWLEDGE_AI_MAX_REQUEST_BODY_MB:
        '300',
      KNOWLEDGE_AI_SHUTDOWN_TIMEOUT_MS:
        '15000',
      KNOWLEDGE_AI_HSTS_OWNER:
        'app',
      KNOWLEDGE_AI_WORKER_HEALTH_HOST:
        '0.0.0.0',
      KNOWLEDGE_AI_WORKER_HEALTH_PORT:
        '8081',
    });

  assert(
    custom.port === 8080 &&
      custom.trustProxyHops === 1 &&
      custom.hstsOwner ===
        'app' &&
      custom.workerHealthPort ===
        8081,
    'H3 custom runtime-edge configuration was not parsed correctly.'
  );

  expectConfigError({
    NODE_ENV: 'production',
    PORT: '0',
  });
  expectConfigError({
    NODE_ENV: 'production',
    KNOWLEDGE_AI_TRUST_PROXY_HOPS:
      '11',
  });
  expectConfigError({
    NODE_ENV: 'production',
    KNOWLEDGE_AI_HSTS_OWNER:
      'app',
    KNOWLEDGE_AI_TRUST_PROXY_HOPS:
      '0',
  });
  expectConfigError({
    NODE_ENV: 'production',
    KNOWLEDGE_AI_WORKER_HEALTH_HOST:
      'public.example.com',
  });

  const proxyConfig =
    runtimeEdgeConfig({
      NODE_ENV: 'production',
      KNOWLEDGE_AI_HSTS_OWNER:
        'proxy',
    });
  const proxyRes =
    new MockResponse();
  securityHeadersMiddleware(
    proxyConfig
  )(
    { secure: true } as any,
    proxyRes as any,
    () => undefined
  );

  for (const header of [
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'cross-origin-opener-policy',
  ]) {
    assert(
      proxyRes.headers.has(header),
      'H3 security middleware is missing header: ' +
        header
    );
  }
  assert(
    !proxyRes.headers.has(
      'strict-transport-security'
    ),
    'Proxy-owned HSTS must not be duplicated by the application.'
  );

  const appRes =
    new MockResponse();
  securityHeadersMiddleware(
    custom
  )(
    { secure: true } as any,
    appRes as any,
    () => undefined
  );
  assert(
    appRes.headers
      .get(
        'strict-transport-security'
      )
      ?.includes(
        'max-age=31536000'
      ),
    'App-owned HSTS must be emitted for trusted secure requests.'
  );

  let nextCalled = false;
  requestSizeGuard(100)(
    {
      header: () => '101',
    } as any,
    new MockResponse() as any,
    () => {
      nextCalled = true;
    }
  );
  assert(
    !nextCalled,
    'Oversized request must not reach downstream middleware.'
  );

  const oversizeRes =
    new MockResponse();
  requestSizeGuard(100)(
    {
      header: () => '101',
    } as any,
    oversizeRes as any,
    () => undefined
  );
  assert(
    oversizeRes.statusCode ===
      413,
    'Oversized request must receive 413.'
  );

  const allowedRes =
    new MockResponse();
  let allowed = false;
  requestSizeGuard(100)(
    {
      header: () => '100',
    } as any,
    allowedRes as any,
    () => {
      allowed = true;
    }
  );
  assert(
    allowed,
    'Request at the configured outer bound must be allowed.'
  );

  const drain =
    new HttpDrainController();
  const activeRes =
    new MockResponse();
  let activeNext = false;
  drain.middleware()(
    {
      path: '/api/query/ask',
    } as any,
    activeRes as any,
    () => {
      activeNext = true;
    }
  );
  assert(
    activeNext &&
      drain.getActiveRequestCount() ===
        1,
    'H3 drain controller must track accepted in-flight requests.'
  );

  drain.beginDrain();

  const blockedRes =
    new MockResponse();
  drain.middleware()(
    {
      path: '/api/query/ask',
    } as any,
    blockedRes as any,
    () => {
      throw new Error(
        'Draining request must not continue.'
      );
    }
  );
  assert(
    blockedRes.statusCode ===
      503 &&
      (blockedRes.body as any)
        ?.code ===
        'SERVICE_DRAINING',
    'H3 must reject new non-liveness requests after drain begins.'
  );

  activeRes.emit('finish');
  assert(
    await drain.waitForIdle(50),
    'H3 drain controller must settle when the last accepted request completes.'
  );

  const healthRes =
    new MockResponse();
  let healthNext = false;
  drain.middleware()(
    {
      path: '/api/health',
    } as any,
    healthRes as any,
    () => {
      healthNext = true;
    }
  );
  assert(
    healthNext &&
      healthRes.headers.get(
        'connection'
      ) === 'close',
    'Liveness must remain available during drain while closing the connection.'
  );
  healthRes.emit('finish');

  const server = fs.readFileSync(
    'server.ts',
    'utf8'
  );
  const env = fs.readFileSync(
    '.env.example',
    'utf8'
  );

  for (const required of [
    "app.set(\n  'trust proxy'",
    'securityHeadersMiddleware',
    'requestSizeGuard',
    'edgeConfig.jsonBodyLimitBytes',
    'edgeConfig.urlencodedBodyLimitBytes',
    'edgeConfig.maxRequestBodyBytes',
    'httpDrainController.middleware()',
    'httpDrainController',
    'closeAllConnections',
  ]) {
    assert(
      server.includes(required),
      'H3 web runtime integration is missing: ' +
        required
    );
  }

  for (const required of [
    'PORT=3000',
    'KNOWLEDGE_AI_TRUST_PROXY_HOPS=0',
    'KNOWLEDGE_AI_JSON_BODY_LIMIT_KB=1024',
    'KNOWLEDGE_AI_URLENCODED_BODY_LIMIT_KB=256',
    'KNOWLEDGE_AI_MAX_REQUEST_BODY_MB=260',
    'KNOWLEDGE_AI_SHUTDOWN_TIMEOUT_MS=30000',
    'KNOWLEDGE_AI_HSTS_OWNER=proxy',
    'KNOWLEDGE_AI_WORKER_HEALTH_PORT=3001',
  ]) {
    assert(
      env.includes(required),
      'H3 environment contract is missing: ' +
        required
    );
  }

  console.log(
    'PRODUCTION_H3_RUNTIME_EDGE_CONTRACT_CHECK_PASSED'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_H3_RUNTIME_EDGE_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
