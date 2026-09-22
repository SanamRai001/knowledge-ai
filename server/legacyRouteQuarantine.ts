import type express from 'express';

export type LegacyRouteDisposition =
  | 'PRODUCTION_SUPPORTED'
  | 'DEVELOPMENT_ONLY'
  | 'RETIRED'
  | 'RETIRED_FALLBACK';

export interface LegacyRouteFamily {
  id: string;
  prefix: string;
  disposition: LegacyRouteDisposition;
  rationale: string;
}

export const LEGACY_ROUTE_QUARANTINE_CODE =
  'LEGACY_ROUTE_QUARANTINED';

export const LEGACY_ROUTE_COMPATIBILITY_FLAG =
  'KNOWLEDGE_AI_ALLOW_LEGACY_PROTOTYPE_ROUTES';

export const legacyRouteInventory:
  readonly LegacyRouteFamily[] = [
    {
      id: 'legacy-workspace-fallback',
      prefix: '/api/kb',
      disposition: 'RETIRED_FALLBACK',
      rationale:
        'The modern workspace router is authoritative. Any /api/kb request that falls through that router must not reach the old inline kbStore handlers in production.',
    },
    {
      id: 'legacy-developer-management',
      prefix: '/api/v1/developer',
      disposition: 'RETIRED',
      rationale:
        'Retired by B2D2A. Its explicit 410 router is mounted before this quarantine boundary.',
    },
    {
      id: 'legacy-api-health',
      prefix: '/api/v1/health',
      disposition: 'PRODUCTION_SUPPORTED',
      rationale:
        'Read-only compatibility health endpoint.',
    },
    {
      id: 'legacy-api-chat',
      prefix: '/api/v1/chat',
      disposition: 'PRODUCTION_SUPPORTED',
      rationale:
        'Intended API-key compatibility path retained during the stable Platform API migration.',
    },
    {
      id: 'legacy-api-ai',
      prefix: '/api/v1/ai',
      disposition: 'PRODUCTION_SUPPORTED',
      rationale:
        'Intended API-key-authenticated Specialized AI compatibility surface retained for later migration.',
    },
    {
      id: 'legacy-system-readiness',
      prefix: '/api/v1/system',
      disposition: 'PRODUCTION_SUPPORTED',
      rationale:
        'Read-only system/readiness compatibility surface retained pending a later operational-route migration.',
    },
    {
      id: 'legacy-provider-health',
      prefix: '/api/v1/providers',
      disposition: 'PRODUCTION_SUPPORTED',
      rationale:
        'Read-only provider health compatibility surface retained pending later migration.',
    },
    {
      id: 'legacy-api-docs',
      prefix: '/api/v1/api-docs',
      disposition: 'PRODUCTION_SUPPORTED',
      rationale:
        'Read-only API documentation compatibility endpoint.',
    },
    {
      id: 'prototype-test-harness',
      prefix: '/api/v1/tests',
      disposition: 'RETIRED',
      rationale:
        'Acceptance-test execution belongs in CI/development, not the production HTTP surface.',
    },
    {
      id: 'prototype-stress-harness',
      prefix: '/api/v1/stress',
      disposition: 'RETIRED',
      rationale:
        'Stress and state-machine audit harnesses are internal test tooling.',
    },
    {
      id: 'prototype-operations',
      prefix: '/api/v1/operations',
      disposition: 'RETIRED',
      rationale:
        'Prototype operational controls expose mutable incident, feature-flag, backup, canary, and readiness tooling without the modern admin boundary.',
    },
    {
      id: 'prototype-observability',
      prefix: '/api/v1/observability',
      disposition: 'RETIRED',
      rationale:
        'Prototype telemetry and mutable alert/SLO controls are not the production observability control plane.',
    },
    {
      id: 'prototype-evaluation',
      prefix: '/api/v1/eval',
      disposition: 'RETIRED',
      rationale:
        'Golden/human evaluation execution is internal quality tooling.',
    },
    {
      id: 'prototype-audit',
      prefix: '/api/v1/audit',
      disposition: 'RETIRED',
      rationale:
        'Comprehensive audit execution is internal quality tooling.',
    },
    {
      id: 'prototype-tenancy-admin',
      prefix: '/api/v1/tenants',
      disposition: 'RETIRED',
      rationale:
        'Prototype tenant/key/billing/quota/webhook administration predates the modern account identity and privileged authorization boundary.',
    },
    {
      id: 'prototype-saas',
      prefix: '/api/v1/saas',
      disposition: 'RETIRED',
      rationale:
        'SaaS simulation/readiness endpoints are prototype infrastructure.',
    },
    {
      id: 'prototype-mediator',
      prefix: '/api/v1/mediator',
      disposition: 'RETIRED',
      rationale:
        'Retired by B2D3B3A. Multi-agent orchestration, planning, verification, and benchmark tooling remains internal rather than HTTP-exposed.',
    },
    {
      id: 'prototype-rag',
      prefix: '/api/v1/rag',
      disposition: 'RETIRED',
      rationale:
        'Retired by B2D3B3B. RAG benchmark, reproduction, and telemetry capabilities remain internal evaluation tooling rather than production HTTP endpoints.',
    },
    {
      id: 'prototype-cognitive',
      prefix: '/api/v1/cognitive',
      disposition: 'RETIRED',
      rationale:
        'Retired by B2D3B3B. The prototype Cognitive Studio query, benchmark, telemetry, graph, table, and outline HTTP surfaces are replaced by supported product query APIs or kept internal.',
    },
    {
      id: 'prototype-phase4',
      prefix: '/api/phase4',
      disposition: 'DEVELOPMENT_ONLY',
      rationale:
        'Legacy Phase 4 memory/sandbox/learning routes predate the modern product and identity boundaries.',
    },
  ];

function pathMatchesPrefix(
  pathname: string,
  prefix: string
): boolean {
  return (
    pathname === prefix ||
    pathname.startsWith(prefix + '/')
  );
}

export function classifyLegacyRoute(
  pathname: string
): LegacyRouteFamily | null {
  const candidates = legacyRouteInventory
    .filter((family) =>
      pathMatchesPrefix(pathname, family.prefix)
    )
    .sort(
      (left, right) =>
        right.prefix.length - left.prefix.length
    );

  return candidates[0] || null;
}

export function isLegacyCompatibilityEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    env[LEGACY_ROUTE_COMPATIBILITY_FLAG] ===
      'true'
  );
}

export const legacyPrototypeRouteQuarantineMiddleware:
  express.RequestHandler = (req, res, next) => {
    const family = classifyLegacyRoute(req.path);

    if (
      !family ||
      family.disposition === 'PRODUCTION_SUPPORTED'
    ) {
      next();
      return;
    }

    if (
      family.disposition === 'DEVELOPMENT_ONLY' &&
      isLegacyCompatibilityEnabled()
    ) {
      next();
      return;
    }

    res.status(404).json({
      error:
        'This legacy or prototype route is not available in this runtime.',
      code: LEGACY_ROUTE_QUARANTINE_CODE,
      family: family.id,
      disposition: family.disposition,
    });
  };
