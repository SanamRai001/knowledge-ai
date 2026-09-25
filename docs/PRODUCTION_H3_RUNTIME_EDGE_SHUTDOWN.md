# Production H3 — Runtime Edge + Graceful Shutdown Hardening

Status: **COMPLETE** — authoritative implementation Quality Gate `36171328745`.

## Goal

H3 hardens the runtime edge of the immutable H2 artifact without starting staging promotion or release-orchestration work.

The web and worker processes now expose explicit deployment contracts for:

- validated ports
- trusted reverse-proxy topology
- security headers / CSP
- TLS/HSTS ownership
- bounded general request sizes
- graceful web drain
- graceful worker drain
- supervisor-consumable worker readiness

The H2 build/image layout is unchanged.

## Runtime edge configuration

Added:

`server/runtime/runtimeEdgeConfig.ts`

Validated settings:

- `PORT` — default 3000, valid range 1–65535
- `KNOWLEDGE_AI_TRUST_PROXY_HOPS` — default 0, explicit hop count only
- `KNOWLEDGE_AI_JSON_BODY_LIMIT_KB` — default 1024 KiB
- `KNOWLEDGE_AI_URLENCODED_BODY_LIMIT_KB` — default 256 KiB
- `KNOWLEDGE_AI_MAX_REQUEST_BODY_MB` — default 260 MiB outer request bound
- `KNOWLEDGE_AI_SHUTDOWN_TIMEOUT_MS` — default 30 seconds
- `KNOWLEDGE_AI_HSTS_OWNER` — `proxy` or `app`
- `KNOWLEDGE_AI_WORKER_HEALTH_HOST` — private/listen host contract
- `KNOWLEDGE_AI_WORKER_HEALTH_PORT` — default 3001

Invalid values fail closed.

Production `HSTS_OWNER=app` requires at least one explicitly trusted proxy hop because the Node process itself serves plain HTTP and relies on the trusted TLS terminator to forward secure scheme information.

## Trusted proxy contract

Knowledge AI does not use unrestricted:

`app.set('trust proxy', true)`

The application configures an exact trusted-proxy hop count.

Default:

`KNOWLEDGE_AI_TRUST_PROXY_HOPS=0`

Production deployment must set the hop count to match the real reverse-proxy/load-balancer topology.

## Security headers

Added:

`server/runtime/securityHeadersMiddleware.ts`

Production responses now receive:

- Content-Security-Policy
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy
- Permissions-Policy
- Cross-Origin-Opener-Policy

The CSP keeps Google OAuth/Drive browser integration origins explicit rather than using a broad wildcard.

HSTS ownership is explicit:

- `proxy` — trusted TLS boundary emits HSTS
- `app` — app emits HSTS only for a trusted secure request

The application disables Express `x-powered-by`.

## Request-size boundary

The old global 50 MB JSON/urlencoded limits are removed.

Defaults:

- JSON: 1 MiB
- URL encoded: 256 KiB
- outer application request bound: 260 MiB

The outer Content-Length guard returns:

- 400 `INVALID_CONTENT_LENGTH` for invalid length metadata
- 413 `REQUEST_BODY_TOO_LARGE` when the configured application edge limit is exceeded

Large ingestion remains behind route-specific multipart limits.

Existing PDF limits remain:

- 25 MiB per PDF
- up to 10 PDFs per request

Existing Dataset parser/file limits remain unchanged.

The deployment contract documents that any reverse proxy exposing the full multipart contract must be configured consistently with the application bound.

## Web graceful shutdown

Added:

`server/runtime/httpDrainController.ts`

The web process now retains the HTTP server handle and owns SIGTERM/SIGINT shutdown.

Shutdown sequence:

1. mark the process draining
2. stop accepting new listener connections
3. reject new normal requests with 503 `SERVICE_DRAINING`
4. keep shallow `/api/health` available with `Connection: close`
5. close idle HTTP connections
6. wait for accepted active requests up to the configured shutdown budget
7. drain any combined-mode compatibility worker loops
8. force-close remaining HTTP connections if the budget is exceeded
9. close the PostgreSQL pool

The shutdown path is idempotent: repeated signals share one shutdown promise.

## Worker cycle ownership

The generic worker loop and Watch scheduler now track one explicit in-flight cycle.

Timer ticks do not start a second cycle while one is running.

This closes the previous overlap ambiguity and creates one drainable execution boundary per worker loop.

Both loops expose bounded:

`drain(timeoutMs)`

Drain behavior:

1. stop future timer claims
2. wait for the current cycle
3. return success when it settles within the budget
4. return timeout when it does not

Durable E2 leases/idempotency remain the recovery fallback after forced supervisor termination.

## Background runtime drain

`BackgroundRuntime.drain(...)` starts Watch and generic-worker drain concurrently so both share one shutdown window.

It returns:

- drained
- watchDrained
- genericDrained

## Worker readiness

Added:

`server/runtime/workerHealthServer.ts`

Default private binding:

`127.0.0.1:3001`

Endpoints:

- `GET /health` — shallow worker-process liveness
- `GET /ready` — real G2 worker readiness

`/ready` uses:

`productionReadinessService.checkWorkerReadiness()`

During shutdown it returns 503 with:

`WORKER_DRAINING`

A platform that requires network health probes can bind the worker health server to `0.0.0.0` only on a private/unrouted worker network.

## Worker shutdown

Worker SIGTERM/SIGINT now:

1. stops periodic readiness telemetry
2. marks worker readiness draining
3. stops new Watch/generic worker claims
4. waits for active cycles up to the shutdown budget
5. emits a privacy-safe warning if the drain times out
6. stops the private health server
7. closes PostgreSQL

## Historical proof advancement

H1 now recognizes that H3 closes:

- web graceful shutdown
- worker bounded drain
- trusted-proxy ownership
- CSP/security headers
- request-size hardening
- worker supervisor readiness

H1 continues to guard H4 gaps:

- staging topology/promotion
- dependency/container vulnerability policy
- SBOM release gate
- immutable GitHub Action SHA pinning
- release migration orchestration
- forward-only rollback/restore promotion gate

E1 now recognizes the H3 worker drain/readiness behavior while retaining the existing E1–E5 ownership model.

## Executable proofs

### Runtime edge

`scripts/check-production-h3-runtime-edge-contract.ts`

Verifies:

- default/custom edge configuration
- invalid port/proxy/HSTS/health-host fail-closed behavior
- security headers
- explicit HSTS ownership
- outer request-size enforcement
- HTTP drain admission behavior
- deployment environment contract
- web runtime wiring

### Graceful drain

`scripts/check-production-h3-graceful-drain.ts`

Verifies:

- concurrent background-loop drain
- one in-flight cycle per worker loop
- bounded loop drain contracts
- worker health/readiness wiring
- worker drain-before-PostgreSQL shutdown
- signal-driven web drain ownership

## Validation

Authoritative implementation Quality Gate:

`36171328745`

Verified green:

- exact Node/npm + frozen install
- TypeScript
- production build
- H2 package-layout proof
- full Phase 0–8 regression suite
- production hardening proofs through H3
- H3 runtime-edge proof
- H3 graceful-drain proof
- full PostgreSQL production suite through G3
- H2 real production-image smoke
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Scope intentionally not completed

H3 does not claim:

- staging deployment/promotion
- migration-job release orchestration
- build-once image digest promotion
- dependency/container vulnerability policy
- SBOM release policy
- immutable GitHub Action SHA pinning
- final staging rollback/restore gate
- broad load/abuse/security testing

## Next phase

**H4 — Staging Promotion + Rollback Release Gate**

H4 should turn the H1/H2/H3 deployment contracts plus G2/G3 readiness/recovery contracts into an executable release/promotion gate without rebuilding the production artifact between staging and production.
