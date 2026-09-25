# Production G2 — Production Observability + Real Readiness Foundation

Date: **2026-09-25**

Status: **COMPLETE** — authoritative implementation Quality Gate `36155946479`.

## Goal

G2 converts the provider-neutral observability/readiness contract from G1 into real runtime instrumentation without selecting a monitoring vendor or implementing backup/restore.

The production operational plane now derives signals from:

- real HTTP requests
- real authenticated request identity
- real Gemini provider calls
- real Unified Query/retrieval stages
- real PostgreSQL queries/pool state
- durable worker queue state
- real worker processing cycles
- real production dependency/schema configuration

The legacy mediator Phase 7/8 readiness/provider fixtures remain synthetic compatibility/research surfaces and are not used for production readiness or SLO claims.

## Operational telemetry foundation

Added:

`server/operations/operationalTelemetry.ts`

Provides:

- vendor-neutral metric/event sink
- COUNTER / HISTOGRAM / GAUGE samples
- deterministic in-memory test adapter
- structured-console production event adapter
- AsyncLocalStorage request context
- request ID
- trace ID
- privacy-safe hashed tenant correlation
- optional job/sync/watch/action/automation correlation fields
- bounded metadata/event storage in the test/default in-memory sink

Operational metadata sanitization redacts content and secret-bearing fields including:

- prompts/content/document/Dataset rows
- OAuth access/refresh tokens
- API/session tokens
- passwords
- authorization material
- ciphertext
- secret values
- KMS key material

No user prompt/document/Dataset payload is intentionally emitted as a metric label.

## HTTP observability

Added:

`server/operations/httpObservabilityMiddleware.ts`

Mounted globally in `server.ts`.

Every HTTP request now gets:

- a safe accepted/generated `X-Request-ID`
- an internal trace ID
- process-role context
- completion event

Metrics:

- `http_requests_total`
- `http_request_duration_ms`

Low-cardinality labels:

- route template
- method
- status class
- process role

Raw path/query-string labels are intentionally excluded.

After application identity is resolved, `requestIdentityMiddleware` adds a hashed tenant correlation identifier to the operational context.

## Provider observability

`GeminiProvider` now records real provider results:

- `provider_requests_total`
- `provider_request_duration_ms`

Signals include:

- provider
- operation
- success/failure
- normalized failure category
- retryability/status code in structured event metadata
- measured token counts when available

G2 does not add a billable provider health probe.

Provider unavailability/configuration failure remains a feature-degraded state rather than a global readiness failure.

## Query/retrieval observability

`UnifiedQueryService` now records:

- `retrieval_stage_duration_ms`
- `retrieval_failures_total`

Stages:

- `route_selection`
- `dataset_analytics`
- `workspace_materialization`
- `document_answer`

The instrumentation wraps the existing routing/retrieval behavior; it does not replace C4/C7 workspace hydration, deterministic Dataset analytics, or Specialized AI grounding.

## PostgreSQL observability

`server/persistence/postgres.ts` now instruments real pool queries.

Metrics:

- `db_query_duration_ms`
- `db_pool_connections`
  - total
  - idle
  - waiting

Structured events:

- `database.query.failed`
- `database.query.slow`
- `database.pool.error`

Slow-query threshold:

`KNOWLEDGE_AI_DB_SLOW_QUERY_MS`

Default:

`1000`

Only operation classes such as SELECT/INSERT/UPDATE are used in metric metadata.

Raw SQL and bound parameter values are not emitted.

## Worker queue and loop observability

The E2 worker runtime now exposes real queue/runtime signals while preserving its lease/idempotency semantics.

`PostgresWorkerJobRepository.operationalSummary()` derives durable queue state from `worker_jobs`.

Metrics:

- `worker_queue_depth`
- `worker_job_attempts_total`
- `worker_job_age_ms`
- `worker_dead_letter_total`

Worker-cycle structured events:

- `worker.cycle.started`
- `worker.cycle.completed`
- `worker.cycle.failed`
- `worker.metrics.snapshot_failed`

The worker runtime also tracks:

- last activity
- last cycle start
- last cycle completion
- last cycle outcome
- last cycle error code

Telemetry snapshot failures are non-authoritative side effects: they do not turn an otherwise successful business job into a retry.

## Real production readiness

Added:

`server/operations/productionReadinessService.ts`

### Web readiness

Checks:

1. PROCESS_ROLE_VALID
2. POSTGRES_REACHABLE
3. SCHEMA_CURRENT
4. OBJECT_STORAGE_CONFIGURED
5. SECRET_KMS_CONFIGURED

Schema readiness compares the running build's version/filename/checksum migration inventory against `schema_migrations` without running migrations.

Object-storage readiness validates production configuration without making a destructive provider call.

Secret/KMS readiness validates the configured versioned keyring without decrypting account secret payloads.

External LLM/integration provider availability is intentionally absent from the global readiness gate.

### Worker readiness

Includes every web dependency check plus:

6. WORKER_HANDLERS_REGISTERED
7. WORKER_LOOP_HEALTHY

Required production worker handlers:

- ACTION_DISCOVERY_REFRESH_V1
- INTEGRATION_SYNC_V1
- AUTOMATION_EXECUTION_V1

Loop health is based on the real worker runtime's recent activity/cycle result.

Configuration:

- `KNOWLEDGE_AI_READINESS_TIMEOUT_MS`
- `KNOWLEDGE_AI_WORKER_READINESS_MAX_STALENESS_MS`
- `KNOWLEDGE_AI_WORKER_READINESS_INTERVAL_MS`

## Liveness vs readiness

`GET /api/health`

remains intentionally shallow process liveness.

New:

`GET /api/ready`

returns:

- HTTP 200 when web readiness passes
- HTTP 503 when a required production dependency/configuration/schema check fails
- per-check PASS/FAIL evidence

Worker processes do not receive a new HTTP server in G2.

Instead the worker entrypoint emits a steady-state `worker.readiness.signal` using the same real worker readiness service.

Supervisor/network probe wiring remains a Track H deployment concern.

## Migration inventory support

`expectedPostgresMigrations()` now exposes the immutable migration version/filename/checksum inventory shipped with the running build.

This lets readiness verify schema currency without applying migrations during a health probe.

Migrations remain a deployment responsibility.

## Degraded-mode behavior

G2 explicitly proves:

- PostgreSQL/schema failure => not ready
- invalid durable storage configuration => not ready
- invalid SecretStore/KMS configuration => not ready
- missing worker handlers => worker not ready
- stale/failing worker loop => worker not ready
- Gemini unavailable/not configured => feature degraded, but web readiness can remain ready

This preserves the G1 degraded-mode contract.

## Focused executable proofs

### Contract/privacy proof

`scripts/check-production-g2-observability-readiness-contract.ts`

Verifies:

- request/trace correlation
- hashed tenant correlation
- prompt/token redaction
- HTTP metric contract
- provider metric contract
- query/retrieval stage instrumentation
- database metric privacy boundary
- worker queue/job/loop instrumentation
- real production readiness requirements
- liveness/readiness separation
- provider outage exclusion from global readiness
- synthetic mediator readiness remains separate

### PostgreSQL/runtime proof

`scripts/check-production-g2-observability-readiness-postgres.ts`

Using real PostgreSQL, verifies:

- migrations/schema readiness
- web readiness with valid core dependencies
- non-billable Gemini NOT_CONFIGURED provider telemetry
- provider failure does not globally fail readiness
- query route-selection failure telemetry
- worker success + dead-letter outcomes
- durable pending queue-depth/age signals
- provider/query/DB/worker metric emission
- production worker-handler registration
- recent worker-loop health
- worker readiness

No live S3 call or billable provider probe is required by the proof.

## Historical guard advancement

G2 observability wrappers changed source formatting around two older invariants without changing their behavior:

- C4 Unified Ask still hydrates through `WorkspaceRuntimeService.requireKB`
- E2 worker runtime still uses registered job types and fenced repository recover/claim/heartbeat/complete/fail operations

Their executable guards were advanced semantically rather than weakening the underlying invariants.

## Scope deliberately left for G3+

G2 does not implement:

- PostgreSQL managed backup/PITR configuration
- backup freshness evidence
- object-storage versioning/retention policy enforcement
- isolated restore tooling
- SecretStore/KMS restore validation
- periodic restore drills
- Docker/staging/deployment probe wiring
- monitoring-vendor adapters/dashboards
- broad load/abuse testing

## Validation

Authoritative implementation Quality Gate:

`36155946479`

Verified green:

- TypeScript
- production build
- all Phase 0–8 regression gates
- all B/C/D/E/F/G1 historical production guards
- G2 contract/privacy proof
- full PostgreSQL A–F production chain
- G2 real PostgreSQL readiness/metrics proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Next phase

**G3 — Backup/Restore + Recovery Drill Foundation**

G3 should implement the provider-neutral recovery contracts defined by G1:

- deployment-target PostgreSQL PITR/backup requirements
- object-storage versioning/retention verification
- backup freshness evidence
- isolated restore verification
- SecretStore/KMS restore validation
- automated recovery smoke proof

Track H deployment should consume those recovery contracts rather than inventing separate assumptions.
