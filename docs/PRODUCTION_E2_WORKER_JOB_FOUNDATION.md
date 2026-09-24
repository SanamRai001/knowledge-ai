# Production E2 — PostgreSQL Worker Job Contract + Queue Foundation

Status: **COMPLETE** — authoritative implementation Quality Gate `36015433343`.

## Goal

E2 proves a reusable durable PostgreSQL worker-job primitive before migrating product-specific workloads or introducing an external queue system.

E1 established WEB/WORKER process ownership.

E2 adds the generic durable job contract owned by that worker process.

## Migration 015

Added:

`server/persistence/migrations/015_worker_jobs.sql`

The `worker_jobs` table stores:

- account-scoped job identity
- job type
- JSON payload and optional payload reference
- optional idempotency key
- optional concurrency key
- priority
- lifecycle state
- attempt count / max attempts
- next-attempt scheduling
- lease owner
- lease token
- lease expiry
- last heartbeat
- started/completed timestamps
- bounded last-error text
- created/updated timestamps

Lifecycle states:

- `PENDING`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `DEAD_LETTER`

Database checks ensure:

- RUNNING rows always have complete lease state
- non-RUNNING rows cannot retain active lease state
- terminal rows have `completed_at`
- PENDING jobs still have retry budget
- priority and attempt bounds remain valid

## Database-enforced idempotency

A partial unique index covers:

`(account_id, job_type, idempotency_key)`

when an idempotency key is present.

Concurrent enqueue callers with the same account/type/key converge on one durable job.

The winning job payload is not rewritten by later duplicate enqueue requests.

Idempotency remains tenant scoped.

## Concurrency policy

A partial unique index covers:

`(account_id, job_type, concurrency_key)`

for RUNNING jobs.

The claim query also excludes lanes that already have RUNNING work.

This gives two defenses:

1. selection-time lane exclusion
2. database uniqueness against claim races

A later same-lane job becomes claimable only after the prior lease is released/settled.

## Atomic claim

Added:

`server/worker/postgresWorkerJobRepository.ts`

Claim semantics use:

`FOR UPDATE SKIP LOCKED`

with ordering by:

1. priority descending
2. next-attempt time
3. creation time
4. job ID

Claim atomically:

- transitions PENDING → RUNNING
- increments attempt count
- writes worker ID
- creates a cryptographically random lease token
- writes lease expiry
- writes heartbeat/start timestamps

Concurrent workers cannot own the same job.

## Fenced lease ownership

Mutation of RUNNING work requires:

- account ID
- job ID
- worker ID
- lease token
- unexpired lease

This fencing applies to:

- heartbeat
- completion
- failure settlement

A stale worker cannot complete a job after another worker has recovered/reclaimed it.

## Heartbeat

Heartbeat extends an owned unexpired lease and records the heartbeat timestamp.

Invalid worker/token or expired ownership raises:

`WORKER_JOB_LEASE_LOST`

## Retry and terminal behavior

Retry delay is deterministic exponential backoff:

- base: 30 seconds
- cap: 15 minutes

Retryable failure:

- remaining attempts → PENDING + future `next_attempt_at`
- exhausted attempts → DEAD_LETTER

Non-retryable failure:

- terminal FAILED

Terminal failure state remains inspectable instead of disappearing.

## Stale recovery

Expired RUNNING leases are recovered by PostgreSQL.

If retry budget remains:

- status → PENDING
- lease state cleared
- job can be reclaimed

If budget is exhausted:

- status → DEAD_LETTER

Recovery can be scoped to the job types actually owned by a worker pool so future specialized worker pools do not interfere with each other.

## Handler registry

Added:

`server/worker/workerJobHandlerRegistry.ts`

The registry is provider/product neutral:

- job type → handler
- duplicate handler ownership rejected
- worker can list only executable job types

No Integration, Automation, Discovery, or other product business logic is embedded in the queue repository.

## Generic worker runtime

Added:

`server/worker/workerJobRuntime.ts`

The runtime:

1. lists registered job types
2. recovers stale work only for those types
3. atomically claims eligible jobs
4. executes the registered handler
5. exposes heartbeat to handlers
6. settles success/retry/failure/dead-letter through the fenced repository contract
7. records lease loss without overwriting another worker's outcome

If no handlers are registered, the poller performs no product work.

## E1 worker integration

`BackgroundRuntime` now owns:

- the existing Watch runtime
- the E2 generic worker-job runtime

WEB role starts neither.

WORKER/combined ownership remains idempotent within one process.

The dedicated worker startup now verifies both:

- `watch_jobs`
- `worker_jobs`

before starting loops.

## Technology decision

E2 remains PostgreSQL-first.

No dependency was added for:

- BullMQ
- pg-boss
- bee-queue
- Redis queue infrastructure
- managed queue services

The current correctness and workload scale do not yet justify adding another stateful infrastructure dependency.

## Scope boundary

E2 intentionally does **not** migrate product workloads.

Still unchanged:

- Watch continues on its D3-specialized job contract
- Integration sync remains request-driven
- Automation execution remains request-driven
- explicit/manual Discovery analysis remains synchronous
- Action post-commit Discovery refresh remains inline for this phase only

This separation allows the generic contract to be proven independently before business workflows depend on it.

## Executable proofs

### Contract proof

`scripts/check-production-e2-worker-job-foundation-contract.ts`

Verifies:

- migration lifecycle and indexes
- fenced lease fields
- SKIP LOCKED repository contract
- idempotency/concurrency semantics
- retry/dead-letter/stale-recovery code paths
- handler registry ownership
- WEB vs WORKER background ownership
- dedicated worker schema preflight
- no premature product workload migration
- no external queue dependency

### PostgreSQL proof

`scripts/check-production-e2-worker-job-foundation-postgres.ts`

Using real PostgreSQL, verifies:

- migration 015
- concurrent idempotent enqueue convergence
- tenant-scoped idempotency
- concurrent claim exclusion
- lease token/worker fencing
- heartbeat extension
- owned completion
- concurrency-lane serialization
- stale lease recovery
- rejection of stale lease completion
- reclaim with incremented attempt count
- deterministic 30-second first retry
- retry scheduling cannot execute early
- exhausted retry → DEAD_LETTER
- non-retryable → FAILED
- account isolation
- provider-neutral runtime handler dispatch
- successful handler heartbeat + completion
- terminal handler failure
- unknown/unregistered jobs remain untouched

## Validation

Authoritative implementation Quality Gate:

`36015433343`

Both required jobs passed:

- `quality`
- `Production A2 PostgreSQL`

The run also kept green:

- TypeScript
- production build
- Phase 0–8 product regressions
- Production Hardening A–D
- E1 runtime separation
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## E2 verdict

**COMPLETE**

Knowledge AI now has a reusable durable PostgreSQL queue primitive with multi-worker claim safety, lease fencing, heartbeat, restart recovery, retry/backoff, dead-letter state, idempotent enqueue, and concurrency lanes.

The next step should migrate one workload whose existing semantics already tolerate asynchronous downstream execution.

## Next phase

**E3 — Action Post-Commit Discovery Refresh Worker Migration**

Why this workload first:

- the D1 Action business transaction is already committed before Discovery refresh begins
- Discovery refresh is explicitly downstream/derived work
- current Discovery refresh failures are already converted into downstream warnings rather than rolling back the Action
- moving it to a durable job improves restart/retry behavior without weakening D1
- explicit/manual `POST /api/insights/analyze` can remain synchronous
- Integration sync and Automation execution currently have synchronous API contracts and should not be changed implicitly

E3 should:

1. define a versioned job payload for Action downstream Dataset discovery refresh
2. enqueue deterministically/idempotently after successful D1 commit
3. persist the worker job ID on Action execution downstream metadata
4. register one Discovery refresh handler
5. run `discoveryRuntimeService.analyzeDataset` from the worker
6. preserve account/dataset ownership checks
7. update Action downstream analysis/warning metadata truthfully after worker completion
8. prove retry/restart/idempotency without replaying the Action mutation
9. preserve explicit manual Discovery analysis as synchronous
10. stop before migrating Integration sync or Automation execution

