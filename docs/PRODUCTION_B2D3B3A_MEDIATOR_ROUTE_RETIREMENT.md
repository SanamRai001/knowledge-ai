# Production Hardening B2D3B3A — Mediator Route Retirement

Status: **IMPLEMENTED — QUALITY GATE PENDING**

Date: 2026-09-21

## Scope

B2D3B3A retires only the prototype mediator HTTP family:

- `/api/v1/mediator/*`

RAG, Cognitive, and legacy Phase 4 remain outside this slice.

## HTTP inventory retired

The following 16 mediator endpoints were present before this slice and are now removed from `server.ts`:

1. `POST /api/v1/mediator/tests/phase6`
2. `GET /api/v1/mediator/agents`
3. `GET /api/v1/mediator/runs`
4. `GET /api/v1/mediator/runs/:runId`
5. `POST /api/v1/mediator/execute`
6. `POST /api/v1/mediator/plan`
7. `POST /api/v1/mediator/disagreements/analyze`
8. `POST /api/v1/mediator/verify`
9. `GET /api/v1/mediator/adaptive/runs`
10. `GET /api/v1/mediator/adaptive/runs/:runId`
11. `POST /api/v1/mediator/benchmarks/compare`
12. `POST /api/v1/mediator/runs/:runId/cancel`
13. `GET /api/v1/mediator/metrics`
14. `POST /api/v1/mediator/benchmarks/parallelism`
15. `POST /api/v1/mediator/benchmarks/scaling`
16. `POST /api/v1/mediator/benchmarks/majority-wrong`

No `/api/v1/mediator/*` HTTP registration remains.

## Route-only server imports removed

Removed from `server.ts` because they only served the retired HTTP family:

- `orchestrationEngine`
- `agentRegistry`
- `benchmarkRunner`
- `runMediatorPhase6Tests`
- `adaptiveOrchestrator`
- `adaptiveBenchmarkEngine`
- `taskComplexityAnalyzer`
- `riskAssessmentEngine`
- `adaptiveStrategyPlanner`
- `adaptiveDisagreementDetector`
- `independentVerifier`

The underlying modules are not deleted.

## Mediator-directory services still required by supported runtime

B2D3B3A preserves mediator-directory services that still back supported compatibility endpoints:

- `apiManagementService` → `GET /api/v1/api-docs/openapi`
- `realProviderAdapter` → `GET /api/v1/providers/health`
- `systemReadinessService` → `/api/v1/system/*`
- `getProductionLimitations` → `GET /api/v1/system/limitations`

This prevents incorrectly treating the whole `server/mediator/` directory as disposable.

## Internal mediator capability preserved

The orchestration/reliability modules remain directly importable for internal scripts, CI, research, or a later supported integration.

The focused proof checks orchestration runs, agent registry, benchmark runner, Phase 6 runner, adaptive orchestration/benchmarking, task complexity, risk assessment, planning, disagreement analysis, and independent verification.

B2D3B3A removes exposure, not reusable implementation.

## Route disposition

`/api/v1/mediator/*` is now `RETIRED`.

Therefore `KNOWLEDGE_AI_ALLOW_LEGACY_PROTOTYPE_ROUTES=true` cannot reopen mediator routes.

## Later slices preserved

Still `DEVELOPMENT_ONLY` and untouched:

- `/api/v1/rag/*`
- `/api/v1/cognitive/*`
- `/api/phase4/*`

These belong to B2D3B3B and B2D3B3C.

## Historical proofs advanced

Updated:

- `scripts/check-production-b2d3a-route-quarantine.ts`
- `scripts/check-production-b2d3b1-internal-quality-route-retirement.ts`
- `scripts/check-production-b2d3b2a-operations-observability-retirement.ts`
- `scripts/check-production-b2d3b2b-tenant-saas-retirement.ts`

Historical proofs now treat mediator as retired and use later RAG/Phase 4 families as the remaining non-production compatibility examples.

## Executable proof

Added:

`scripts/check-production-b2d3b3a-mediator-route-retirement.ts`

Command:

`npm run check:production:b2d3b3a-mediator-route-retirement`

It verifies HTTP removal, dead-import cleanup, supported compatibility dependencies, RETIRED classification, internal module availability, fail-closed compatibility behavior, and preservation of RAG/Cognitive/Phase 4.

## Quality Gate

Pending the B2D3B3A branch Quality Gate.

The phase must not be marked COMPLETE or advance the handoff until the integrated gate passes.
