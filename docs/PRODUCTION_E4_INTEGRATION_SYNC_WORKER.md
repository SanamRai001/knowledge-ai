# Production E4 — Integration Sync Worker Migration

Status: **COMPLETE** — authoritative implementation Quality Gate `36029571982`.

## Goal

E4 moves Integration synchronization execution off the product request path and onto the durable PostgreSQL worker runtime introduced in E2, while preserving the C6 Integration source/checkpoint correctness boundary.

E4 intentionally keeps the legacy synchronous sync endpoint as compatibility while product callers migrate deliberately to the queued contract.

## Durable linkage

Migration:

`server/persistence/migrations/017_integration_sync_worker_jobs.sql`

adds `integration_sync_worker_jobs` and relationally binds:

- account
- Integration connection
- E2 worker job
- optional completed Integration SyncRun
- request/audit metadata

The linkage remains account scoped and preserves the existing Integration connection and SyncRun foreign-key boundaries.

## Worker contract

Job type:

`INTEGRATION_SYNC_V1`

Payload schema:

- `schemaVersion = 1`
- connectionId
- requestedAt
- optional requestedBy
- cursorBefore
- lastSuccessfulSyncAtBefore
- connectionUpdatedAtBefore

The payload intentionally carries identifiers/reference metadata only. Provider credentials and source bytes are not embedded in the queue payload.

## Idempotent enqueue

E4 uses a deterministic baseline derived from:

- account
- connection
- cursor
- last successful sync time
- connection updated-at time

The logical idempotency key is:

`integration-sync:<connectionId>:<baselineHash>`

This means request replay against the same durable connection baseline converges on the same logical sync work.

Before creating a new job, E4 also coalesces any existing PENDING/RUNNING Integration sync job for that account/connection.

## Concurrency boundary

Worker concurrency lane:

`integration:<connectionId>`

This prevents two generic worker jobs for the same connection from executing concurrently.

The existing C6 PostgreSQL Integration sync lease remains underneath this worker-level lane as a second correctness boundary.

Therefore E4 does not weaken or replace the C6 checkpoint transaction.

## Worker execution

Added:

`server/integrations/integrationSyncWorker.ts`

The worker-only handler:

1. validates the versioned payload
2. verifies the Integration worker-job linkage
3. invokes the existing PostgreSQL `integrationRuntimeService.sync(...)`
4. heartbeats the generic worker lease
5. handles `SYNC_ALREADY_RUNNING` as retryable worker contention
6. associates the completed SyncRun with the worker job
7. preserves C6 provider source snapshots/import recovery/projection prerequisites/atomic cursor advancement

No connector, Dataset import, or checkpoint business logic is duplicated in the worker handler.

## Restart and replay recovery

E4 records the Integration connection baseline in the queued payload.

If the worker restarts after the underlying Integration sync committed but before the generic worker job was finalized, the handler can recognize a completed sync after the recorded baseline and attach that SyncRun instead of starting duplicate logical work.

This combines:

- E2 worker fenced leases
- stale RUNNING recovery
- retry/backoff/dead-letter state
- Integration account/connection concurrency key
- C6 per-connection sync lease
- C6 atomic provider cursor checkpoint

## Terminal failure

Terminal worker failure is inspectable in the generic worker job state.

E4 also updates Integration sync health metadata without rewriting the last committed provider checkpoint.

A failed worker job cannot falsely advance the provider cursor.

## API migration

E4 adds queued Integration sync surfaces:

- enqueue sync job
- inspect one sync job
- list sync jobs for a connection

The browser-safe job view includes only useful product state such as:

- job ID
- connection ID
- PENDING/RUNNING/SUCCEEDED/FAILED/DEAD_LETTER state
- attempts
- timestamps
- last error
- request audit metadata
- linked SyncRun ID

It does not expose generic worker internals such as lease tokens, raw payload, idempotency key, or concurrency key.

## Product caller migration

`IntegrationsWorkspace` now uses the queued sync contract and shows truthful job state/history.

The product UI can tell the user that synchronization is queued rather than pretending the sync already completed.

The UI handles queue-unavailable errors truthfully when PostgreSQL worker infrastructure is unavailable.

## Synchronous compatibility

The existing:

`POST /api/integrations/connections/:id/sync`

route remains available and still invokes `integrationRuntimeService.sync(...)` synchronously.

This is intentional compatibility during caller migration.

E4 does not silently break existing API consumers.

## Worker ownership

The E4 handler is registered only after the process-role worker guard in `backgroundRuntime`.

The workload catalog now marks Integration Sync as:

- `AUTONOMOUS_LOOP`
- owner: `WORKER`
- durable state: E2 worker jobs + E4 link + existing Integration sync state
- no longer a future queue candidate

Dedicated worker startup also verifies the E4 schema exists before accepting work.

## Scope boundary

E4 does not migrate or redesign:

- OAuth connect/callback/disconnect
- Integration pause/resume/reset-cursor administration
- Controlled Automation execution
- manual/explicit Discovery
- Watch evaluation
- provider connector business logic
- C6 checkpoint semantics
- Redis/BullMQ/managed queue infrastructure

## Executable evidence

### Contract proof

`scripts/check-production-e4-integration-sync-worker-contract.ts`

Verifies:

- migration 017 linkage
- versioned payload contract
- deterministic enqueue identity
- PENDING/RUNNING coalescing
- account + connection concurrency lane
- worker-only registration
- safe browser job view
- queued HTTP surface
- product UI migration
- synchronous compatibility route
- PostgreSQL queue reuse
- no Redis/BullMQ/pg-boss addition

### PostgreSQL proof

`scripts/check-production-e4-integration-sync-worker-postgres.ts`

Using real PostgreSQL and deterministic test Integration/source-storage infrastructure, verifies:

- migration 017
- one logical queued job per connection baseline
- account isolation
- worker execution through existing Integration runtime
- SyncRun linkage
- C6 provider checkpoint correctness
- stale lease/restart recovery
- replay after committed sync without duplicate Dataset/import/cursor advancement
- retry and terminal worker failure behavior
- inspectable queued/running/succeeded/failed/dead-letter state

## Validation

Authoritative implementation Quality Gate:

`36029571982`

Green:

- TypeScript
- production build
- Phase 0–8 regression gates
- Production Hardening A–D
- C1–C7
- E1–E3 historical guards
- E4 contract proof
- E4 PostgreSQL proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini benchmark

## Verdict

**E4 is complete.**

Integration synchronization is now durable worker-owned work while C6 remains the authoritative provider/source/checkpoint transaction boundary.

## Next phase

**E5 — Automation Execution/Recovery Worker Migration**

E5 should migrate only Controlled Automation execution/recovery onto the E2 generic worker runtime while preserving the D2 Automation + Action transaction/recovery guarantees.

Policy administration, manual Action confirmation, Watch evaluation, Integration sync, and explicit/manual Discovery should remain unchanged during E5.
