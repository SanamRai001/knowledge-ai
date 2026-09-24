# Production E1 — Worker/Queue Forensic Audit + Runtime Separation Foundation

Status: **COMPLETE** — authoritative implementation Quality Gate `35950002619`.

## Goal

E1 establishes an explicit production process boundary before introducing generalized queue infrastructure.

The phase answers two questions first:

1. which workloads are actually autonomous background work today?
2. which process is allowed to own those loops in a multi-replica deployment?

E1 intentionally does **not** introduce Redis, BullMQ, pg-boss, or another managed/generalized queue.

## Forensic workload inventory

### WATCH_EVALUATION

Execution model:

`AUTONOMOUS_LOOP`

Durable state:

- PostgreSQL `watch_jobs`
- `watch_evaluations`
- `watch_alerts`

Existing correctness:

- `FOR UPDATE SKIP LOCKED` job claim
- stale RUNNING lease recovery
- retry/backoff
- terminal failure state
- D3 atomic Watch evaluation transaction

E1 owner:

`WORKER`

This is the only workload that currently needs an autonomous startup loop.

### INTEGRATION_SYNC

Execution model:

`REQUEST_DRIVEN`

Durable state:

- PostgreSQL sync runs
- external-import journal
- provider checkpoint/cursor state

Existing correctness:

- per-connection PostgreSQL sync lease
- C6 immutable source snapshots
- crash recovery
- atomic checkpoint commit

E1 owner:

`REQUEST_PATH`

It is a future queue candidate, but E1 does not change its API semantics.

### AUTOMATION_EXECUTION

Execution model:

`REQUEST_DRIVEN`

Durable state:

- PostgreSQL `automation_runs`
- D1 Action transaction state

Existing correctness:

- database-enforced execution claim
- D2 Automation transaction/recovery guarantees

E1 owner:

`REQUEST_PATH`

It remains a future worker/queue candidate.

### DISCOVERY_ANALYSIS

Execution model:

`POST_COMMIT_INLINE`

Durable state:

- relational Discovery/Insights analysis metadata

Current limitation:

- no autonomous scheduler
- no generalized worker lease

E1 owner:

`POST_COMMIT_PATH`

This is a future queue candidate and should be evaluated during later Track E migration work.

## Explicit process roles

Added:

`server/runtime/processRole.ts`

Supported roles:

- `web`
- `worker`
- `combined`

Production behavior is fail-closed:

`KNOWLEDGE_AI_PROCESS_ROLE`

must be explicitly configured when `NODE_ENV=production`.

### web

- owns HTTP/API
- cannot start autonomous worker loops

### worker

- owns background worker loops
- cannot start the HTTP entrypoint

### combined

- HTTP + worker compatibility mode
- useful for local/single-process development
- not required for multi-replica production topology

## Dedicated worker entrypoint

Added:

`worker.ts`

The worker entrypoint:

- validates the process role
- requires PostgreSQL persistence
- verifies the Watch job schema before starting
- starts background runtime with process keepalive
- owns graceful SIGTERM/SIGINT shutdown
- closes PostgreSQL cleanly

Build/runtime scripts now publish:

- `dist/server.cjs`
- `dist/worker.cjs`

Commands:

- `npm run worker:dev`
- `npm run start:worker`

## Background runtime ownership

Added:

`server/runtime/backgroundRuntime.ts`

The HTTP server no longer starts Watch directly.

Instead:

`backgroundRuntime.startForRole(processRole)`

owns autonomous background startup.

This proves that a WEB-only application replica cannot accidentally start the Watch loop.

Repeated worker startup is idempotent within one process.

## Watch timer ownership

`WatchRuntimeScheduler.start(...)` now accepts:

`keepProcessAlive`

Behavior:

- web-hosted combined compatibility mode may `unref()` the timer
- dedicated worker mode keeps the process alive

The existing D3 job/lease/transaction semantics remain unchanged.

## Workload catalog

Added:

`server/runtime/backgroundWorkloadCatalog.ts`

The catalog makes current execution ownership explicit instead of assuming every asynchronous-looking feature is already a worker workload.

Current autonomous worker workload count:

**1 — WATCH_EVALUATION**

This prevents premature queue migration of request-driven Integration/Automation flows.

## Queue technology decision

E1 found no evidence requiring Redis/BullMQ yet.

The existing production backbone is already PostgreSQL, and the current autonomous Watch workload already has strong PostgreSQL claim/lease/retry semantics.

Therefore Track E remains **PostgreSQL-first** until measured throughput, latency, isolation, or operational requirements justify a different queue backend.

No new generalized queue package was added in E1.

## Configuration

`.env.example` now documents:

`KNOWLEDGE_AI_PROCESS_ROLE=`

Production deployment can run independent web and worker processes against the same PostgreSQL/object-storage infrastructure.

## Executable proof

Added:

`scripts/check-production-e1-worker-runtime-separation.ts`

It verifies:

- development compatibility defaults
- explicit production role parsing
- missing production role fails closed
- WEB-only cannot start Watch
- WORKER starts the loop exactly once
- combined compatibility behavior
- graceful stop ownership
- Watch is the only current autonomous workload
- Integration/Automation remain request-driven
- Discovery remains post-commit inline
- HTTP bootstrap no longer directly owns Watch
- dedicated worker build/runtime entrypoints
- worker PostgreSQL/schema requirements
- timer keepalive semantics
- environment documentation
- no BullMQ / pg-boss / bee-queue dependency introduced

## Validation

Authoritative Quality Gate:

`35950002619`

Both required jobs passed:

- `quality`
- `Production A2 PostgreSQL`

All Phase 0–8 regression gates and Production Hardening A–D proofs remained green.

## E1 verdict

**COMPLETE**

Knowledge AI now has an explicit production WEB/WORKER process boundary.

Multiple WEB replicas no longer need to own the autonomous Watch scheduler.

The system is ready for the next Track E slice without prematurely changing product APIs or queue technology.

## Next phase

**E2 — PostgreSQL Worker Job Contract + Queue Foundation**

Keep E2 focused on the reusable durable worker-job primitive:

- durable job identity/type/payload reference
- database idempotency key
- PENDING/RUNNING/SUCCEEDED/FAILED/DEAD-LETTER lifecycle
- atomic `SKIP LOCKED` claim
- lease/heartbeat + stale recovery
- retry/backoff
- concurrency policy
- inspectable failure state
- graceful worker polling
- provider-neutral handler registry

Do not migrate every workload in E2.

Do not introduce Redis/BullMQ/managed queue infrastructure without measured evidence.

A later Track E slice should select and migrate the first non-Watch workload only after the generic PostgreSQL contract is proven.
