# Production D3 — Watch Scheduling Transaction Boundary

Status: **COMPLETE** — authoritative implementation Quality Gate `35948962695`.

## Goal

D3 closes the post-claim consistency gap in scheduled PostgreSQL Watch execution.

Before D3, ready-job claiming already used an atomic PostgreSQL `FOR UPDATE SKIP LOCKED` boundary, but a claimed job was completed through several independent commits:

1. evaluation insert
2. alert episode create/update/resolve
3. WatchRule state/schedule update
4. WatchJob completion

A process crash between those writes could leave durable partial state and make a retry replay an already-persisted evaluation or alert transition.

D3 keeps the existing claim/lease model and makes the relational state transition after measurement atomic.

## Migration 014 — one evaluation per scheduled job

Added:

`server/persistence/migrations/014_watch_job_transaction_boundary.sql`

`watch_evaluations` now has nullable:

`job_id`

with:

- account-scoped FK to `watch_jobs(account_id, id)`
- unique partial index on `(account_id, job_id)` when job_id is not null
- backfill from existing `watch_jobs.evaluation_id`

Manual evaluations remain valid with `job_id = NULL`.

The unique job linkage gives scheduled execution a database-enforced exactly-once evaluation identity.

## Existing claim/lease boundary preserved

D3 does **not** replace the established scheduler claim primitive.

PostgreSQL Watch jobs still use:

- durable `watch_jobs`
- unique schedule fingerprints
- `FOR UPDATE SKIP LOCKED`
- RUNNING claim state
- attempt counts
- stale RUNNING requeue after lease expiry
- exponential retry/backoff

This phase strengthens what happens **after** a job is claimed.

## Non-mutating scheduled measurement

Added to:

`server/watch/watchRuntimeEvaluator.ts`

`prepareScheduledEvaluation(...)`

It:

- resolves the current active rule
- deterministically measures the existing Watch condition
- returns a complete evaluation payload
- returns user-facing copy if a new alert episode may be required
- converts measurement errors into FAILED evaluation payloads
- performs no persistence

The existing manual `evaluate(...)` path remains unchanged.

## Atomic claimed-job evaluation commit

Added typed contracts in:

`server/persistence/a4Types.ts`

and PostgreSQL implementation in:

`server/persistence/a4PostgresRepositories.ts`

`commitClaimedJobEvaluation(...)`

The transaction:

1. locks the claimed WatchJob
2. returns the previously committed result for an already-COMPLETED replay
3. requires RUNNING state
4. validates the expected rule version
5. locks the WatchRule
6. requires ACTIVE + INTERVAL + exact rule version
7. verifies evaluation account/job/rule/version identity
8. rejects a stale measured `previousConditionState`
9. inserts or reuses the job-linked evaluation
10. locks the active alert episode
11. creates, repeats, or resolves the alert episode as required
12. updates WatchRule state/timestamps/next schedule
13. completes the WatchJob and links its evaluation
14. commits all relational effects together

If any late stage fails, all earlier writes in the transaction roll back.

## Alert episode behavior

D3 preserves existing Watch semantics:

- FALSE/UNKNOWN → TRUE opens one episode
- repeated TRUE updates the same non-resolved episode
- evaluation IDs are deduplicated
- repeated replay cannot increment occurrence count twice
- ACKNOWLEDGED/SNOOZED lifecycle is preserved
- an expired snooze can reopen on a later trigger
- TRUE → FALSE resolves the active episode
- a later FALSE → TRUE transition can create a new episode

The scheduler supplies deterministic IDs for scheduled evaluation/new-alert creation from the claimed job identity.

## Stale-state protection

Measurement happens before the transaction.

To prevent stale measurement from overwriting a newer rule state, the commit transaction checks:

`evaluation.previousConditionState === lockedRule.currentState`

A mismatch fails with:

`WATCH_JOB_RULE_STATE_CHANGED`

No evaluation, alert, rule-state, or job-completion write is committed.

Rule version/status/mode changes are also rejected.

## Idempotent replay

When a job is already COMPLETED with an evaluation link, repeating the D3 commit returns the existing:

- job
- rule
- evaluation
- matching alert transition when present

with:

`idempotentReplay: true`

No second evaluation or alert occurrence is created.

## Atomic terminal worker failure

Added:

`commitClaimedJobTerminalFailure(...)`

When retry budget is exhausted it atomically commits:

- WatchJob → FAILED
- completed timestamp + last error
- WatchRule → ERROR
- last evaluation timestamp
- next interval evaluation time

Repeating the same terminal settlement is idempotent.

## Scheduler cutover

`server/watch/watchRuntimeScheduler.ts` now uses the D3 flow only in PostgreSQL mode:

`claimReadyJob → prepareScheduledEvaluation → commitClaimedJobEvaluation`

The old multi-commit scheduled call to:

`watchRuntimeEvaluator.evaluate(...)`

is no longer used by the PostgreSQL scheduler.

File-mode scheduling continues to delegate to the existing `watchScheduler`.

## Crash outcomes

### Crash after claim, before evaluation

The durable job remains RUNNING.

After lease expiry:

- stale-job recovery returns it to PENDING
- the job can be reclaimed
- the D3 transaction commits one evaluation/alert result

### Failure after evaluation insertion, before later writes

The evaluation insert is inside the same transaction.

A later failure rolls back:

- evaluation
- alert mutation
- rule mutation
- job completion

The claimed job remains RUNNING/retryable.

### Crash after transaction commit

Job/evaluation/alert/rule state are already mutually consistent.

A retry observes COMPLETED and returns the existing result without replaying effects.

### Rule changes between measurement and commit

The rule lock/version/state checks reject the stale prepared result.

The worker can skip/retry according to scheduler policy without committing stale evaluation state.

## Security / tenancy

Every transaction is scoped by `account_id`.

A foreign account cannot:

- locate the claimed job in the transaction
- commit its evaluation
- mutate its rule
- mutate its alert episode

The PostgreSQL proof includes explicit cross-account denial.

## Scope preserved

D3 does not introduce:

- Redis
- BullMQ
- pg-boss
- external workers
- separate queue processes
- managed secret storage
- deployment changes
- observability infrastructure

Those belong to later production-hardening tracks.

## Executable proofs

### Contract proof

`scripts/check-production-d3-watch-transaction-contract.ts`

Verifies:

- migration 014 job linkage and unique index
- scheduled preparation-without-write path
- scheduler transaction routing
- no old multi-commit evaluator call in PostgreSQL scheduled execution
- job/rule row-lock transaction invariants
- evaluation/alert/rule/job commit primitives
- atomic terminal failure
- file-mode scheduler preservation
- no Track E queue dependency introduced

### PostgreSQL proof

`scripts/check-production-d3-watch-transaction-postgres.ts`

Using real PostgreSQL, verifies:

- concurrent duplicate completion converges on one evaluation and one alert effect
- repeated TRUE increments the same episode once
- TRUE → FALSE resolves the same episode
- forced late-stage error rolls back evaluation/alert/rule/job changes
- cross-account commit is denied
- stale prepared rule state is rejected without an evaluation write
- terminal failure commits job/rule together and replays idempotently
- stale RUNNING lease recovers, reclaims, and converges on one committed evaluation/alert

## Validation

Authoritative implementation Quality Gate:

`35948962695`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression suite
- A2–A7G PostgreSQL runtime chain
- A7C existing Watch runtime proof
- B2 identity/authorization hardening proofs
- C2–C7 durability proofs
- D1 confirmed Action transaction proof
- D2 controlled Automation transaction proof
- D3 Watch contract proof
- D3 real PostgreSQL transaction proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini benchmark

## Next phase

**E1 — Worker/Queue Forensic Audit + Runtime Separation Foundation**

E1 should inventory every background execution surface and establish the web-process vs worker-process runtime boundary before selecting or introducing a generalized queue implementation.

The default candidate remains PostgreSQL-backed durable jobs first; Redis/managed queue infrastructure should be introduced only if workload/concurrency evidence justifies it.
