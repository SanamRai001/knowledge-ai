# Production E3 — Action Post-Commit Discovery Refresh Worker Migration

Status: **COMPLETE** — authoritative implementation Quality Gate `36022612284`.

## Goal

E3 moves only the derived Discovery refresh that follows a confirmed PostgreSQL Action off the request path and onto the durable E2 worker-job runtime.

The authoritative Action mutation remains owned by D1/D2. E3 never replays or downgrades that committed business mutation.

## Durable linkage

Migration `016_action_discovery_worker_jobs.sql` adds `action_execution_discovery_jobs` and binds, per account:

- Action execution
- worker job
- Dataset

A unique `(account_id, execution_id, dataset_id)` constraint prevents duplicate logical downstream refresh linkage.

## Worker contract

Job type:

`ACTION_DISCOVERY_REFRESH_V1`

Payload:

- schemaVersion = 1
- executionId
- proposalId
- datasetId
- referenceTime
- deterministic analysisRunId

Idempotency identity:

`action-discovery:<executionId>:<datasetId>`

Concurrency lane:

`dataset:<datasetId>`

The deterministic Discovery run ID is derived from account + Action execution + Dataset, so retries converge on one analytical run identity.

## Post-commit boundary

PostgreSQL Action confirmation still commits through the D1/D2 transaction boundary first.

Only after that commit succeeds does `ActionRuntimeExecutionService` plan downstream Dataset refreshes.

For each Dataset, E3 atomically:

1. enqueues the durable E2 worker job
2. links that worker job to the committed Action execution

Those two writes occur in one PostgreSQL transaction.

Planning/enqueue failure is recorded as downstream warning metadata. It does not roll back or rewrite the already-confirmed Action.

## Worker ownership

The E3 handler is registered only by the worker-owned background runtime.

WEB role does not execute E3 jobs.

The dedicated worker startup now fails closed unless all required schemas exist:

- `watch_jobs`
- `worker_jobs`
- `action_execution_discovery_jobs`

The background workload catalog now marks Action-triggered Discovery analysis as worker-owned autonomous work.

## Handler behavior

The handler:

1. validates the versioned payload
2. resolves the Action execution in account scope
3. verifies the worker job is linked to that execution
4. runs existing `discoveryRuntimeService.analyzeDataset(...)`
5. uses the deterministic analysisRunId/reference time
6. appends the completed analysis-run ID to Action downstream metadata

Explicit/manual Discovery API behavior remains synchronous and unchanged.

## Retry, restart, and failure

E3 inherits E2:

- fenced leases
- heartbeat
- retry/backoff
- stale-lease recovery
- dead-letter state
- account-scoped idempotency
- concurrency lanes

A worker crash can therefore recover/retry the derived Discovery job without replaying the D1 Action mutation.

On terminal Discovery failure:

- the worker job becomes inspectable FAILED/DEAD_LETTER state
- an Action downstream warning is appended
- the proposal remains CONFIRMED
- the committed company-state mutation remains exactly once

## Scope boundary

E3 does not migrate:

- Integration sync
- Automation execution/recovery
- explicit/manual Discovery analysis
- OAuth/admin flows
- Watch off its specialized D3 contract
- any workload to Redis/BullMQ/managed queue infrastructure

## Executable evidence

### Contract proof

`scripts/check-production-e3-action-discovery-worker-contract.ts`

Verifies:

- migration/link constraints
- payload schema
- deterministic idempotency/concurrency keys
- post-D1-commit enqueue ownership
- atomic job enqueue + Action linkage
- worker-only handler registration
- manual Discovery remains synchronous
- Integration/Automation scope boundaries
- prior D1/E1/E2 guarantees remain valid

### PostgreSQL proof

`scripts/check-production-e3-action-discovery-worker-postgres.ts`

Verifies with real PostgreSQL:

- migration 016
- Action confirmation returns before Discovery execution
- exactly one queued downstream job per Action execution/Dataset
- Action business mutation already committed exactly once
- worker completion records deterministic analysis-run ID
- account isolation
- simulated worker crash + stale lease recovery
- retry succeeds without replaying Action mutation
- repeated/replayed finalization remains job-idempotent
- terminal Discovery failure dead-letters truthfully
- terminal failure appends downstream warning
- Action remains CONFIRMED after downstream failure

## Validation

Authoritative implementation Quality Gate:

`36022612284`

Green:

- TypeScript
- production build
- Phase 0–8 regressions
- Production Hardening A–D
- C1–C7
- E1/E2
- E3 contract proof
- E3 PostgreSQL proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini benchmark

## Verdict

**E3 is complete.**

Action-triggered Discovery refresh is now durable worker-owned derived work. Worker restart/failure cannot replay or downgrade the committed Action.

## Next phase

**E4 — Integration Sync Worker Migration**

E4 should migrate only Integration synchronization execution onto the E2 worker runtime while preserving the C6 source/checkpoint transaction semantics and existing Integration administration/OAuth behavior.

Automation execution should remain request-driven during E4.
