export class RuntimeEdgeConfigurationError
  extends Error
{
  readonly code =
    'RUNTIME_EDGE_CONFIGURATION_INVALID';

  constructor(message: string) {
    super(message);
    this.name =
      'RuntimeEdgeConfigurationError';
  }
}

function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;

  if (!/^\d+$/.test(raw)) {
    throw new RuntimeEdgeConfigurationError(
      name + ' must be an integer.'
    );
  }

  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new RuntimeEdgeConfigurationError(
      name +
        ' must be between ' +
        min +
        ' and ' +
        max +
        '.'
    );
  }

  return value;
}

export type HstsOwner =
  | 'proxy'
  | 'app';

export interface RuntimeEdgeConfig {
  port: number;
  trustProxyHops: number;
  jsonBodyLimitBytes: number;
  urlencodedBodyLimitBytes: number;
  maxRequestBodyBytes: number;
  shutdownTimeoutMs: number;
  hstsOwner: HstsOwner;
  workerHealthHost: string;
  workerHealthPort: number;
}

export function runtimeEdgeConfig(
  env: NodeJS.ProcessEnv = process.env
): RuntimeEdgeConfig {
  const jsonBodyLimitBytes =
    integerEnv(
      env,
      'KNOWLEDGE_AI_JSON_BODY_LIMIT_KB',
      1024,
      16,
      10 * 1024
    ) * 1024;

  const urlencodedBodyLimitBytes =
    integerEnv(
      env,
      'KNOWLEDGE_AI_URLENCODED_BODY_LIMIT_KB',
      256,
      16,
      10 * 1024
    ) * 1024;

  const maxRequestBodyBytes =
    integerEnv(
      env,
      'KNOWLEDGE_AI_MAX_REQUEST_BODY_MB',
      260,
      16,
      512
    ) *
    1024 *
    1024;

  if (
    maxRequestBodyBytes <
      jsonBodyLimitBytes ||
    maxRequestBodyBytes <
      urlencodedBodyLimitBytes
  ) {
    throw new RuntimeEdgeConfigurationError(
      'KNOWLEDGE_AI_MAX_REQUEST_BODY_MB must be at least as large as the configured JSON/urlencoded limits.'
    );
  }

  const hstsOwnerRaw =
    env.KNOWLEDGE_AI_HSTS_OWNER
      ?.trim()
      .toLowerCase() ||
    'proxy';

  if (
    hstsOwnerRaw !== 'proxy' &&
    hstsOwnerRaw !== 'app'
  ) {
    throw new RuntimeEdgeConfigurationError(
      'KNOWLEDGE_AI_HSTS_OWNER must be either "proxy" or "app".'
    );
  }

  const workerHealthHost =
    env.KNOWLEDGE_AI_WORKER_HEALTH_HOST
      ?.trim() ||
    '127.0.0.1';
  const allowedWorkerHosts =
    new Set([
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '::',
    ]);

  if (
    !allowedWorkerHosts.has(
      workerHealthHost
    )
  ) {
    throw new RuntimeEdgeConfigurationError(
      'KNOWLEDGE_AI_WORKER_HEALTH_HOST must be one of 127.0.0.1, 0.0.0.0, ::1, or ::.'
    );
  }

  const trustProxyHops =
    integerEnv(
      env,
      'KNOWLEDGE_AI_TRUST_PROXY_HOPS',
      0,
      0,
      10
    );

  if (
    hstsOwnerRaw === 'app' &&
    env.NODE_ENV
      ?.trim()
      .toLowerCase() ===
      'production' &&
    trustProxyHops === 0
  ) {
    throw new RuntimeEdgeConfigurationError(
      'KNOWLEDGE_AI_HSTS_OWNER=app requires KNOWLEDGE_AI_TRUST_PROXY_HOPS > 0 because the Node web server terminates plain HTTP.'
    );
  }

  return {
    port: integerEnv(
      env,
      'PORT',
      3000,
      1,
      65535
    ),
    trustProxyHops,
    jsonBodyLimitBytes,
    urlencodedBodyLimitBytes,
    maxRequestBodyBytes,
    shutdownTimeoutMs:
      integerEnv(
        env,
        'KNOWLEDGE_AI_SHUTDOWN_TIMEOUT_MS',
        30_000,
        1_000,
        120_000
      ),
    hstsOwner:
      hstsOwnerRaw as HstsOwner,
    workerHealthHost,
    workerHealthPort:
      integerEnv(
        env,
        'KNOWLEDGE_AI_WORKER_HEALTH_PORT',
        3001,
        1,
        65535
      ),
  };
}
