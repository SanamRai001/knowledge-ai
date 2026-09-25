# Production E5 — Automation Execution/Recovery Worker Migration

Status: **COMPLETE** — authoritative implementation Quality Gate `36035111875`.

## Goal

E5 moves Controlled Automation execution/recovery onto the durable E2 PostgreSQL worker runtime without replacing the D1/D2 business-transaction boundary.

The existing synchronous execution API and manual compensation path remain available as compatibility.

## Durable linkage

Migration:

`server/persistence/migrations/018_automation_execution_worker_jobs.sql`

links:

- account
- Action proposal
- E2 worker job
- queued principal/audit metadata
- optional AutomationRun
- optional Action execution
- processed outcome code/message

All durable linkage is account scoped.

## Worker contract

Job type:

`AUTOMATION_EXECUTION_V1`

Payload contains only durable identifiers/audit metadata:

- schemaVersion
- proposalId
- requestedAt
- identity source
- principal ID
- requested actor role
- authorization revision timestamp

The payload does **not** carry:

- API-key secret/hash
- session secret/token
- worker lease data
- provider credentials
- company-state mutation payload

## Principal revalidation

Queued authorization is not trusted indefinitely.

At enqueue and execution time E5 revalidates the principal:

### Human session

- user must still be ACTIVE
- account membership must still be ACTIVE
- current membership role is reloaded
- worker execution uses the current role, not the queued role snapshot

### API key

- key must still exist in the same account
- status must remain active
- expiration is rechecked

### DEFAULT_WEB

- rejected for queued Automation execution in production

This means a role revocation, membership revocation, API-key revocation, or API-key expiry after enqueue prevents later execution.

## Deterministic enqueue

E5 derives worker idempotency from the durable proposal/governance/principal baseline:

- account
- proposal
- proposal status/update time
- Automation policy identity/version/update time
- emergency control version/update time
- identity source
- durable principal ID
- requested role
- authorization revision

Idempotency key:

`automation-execution:<proposalId>:<baselineHash>`

Concurrency lane:

`automation-proposal:<proposalId>`

PENDING/RUNNING work for the same proposal is coalesced.

If an earlier worker job already successfully produced an Action execution, replay returns that completed worker job rather than creating new logical work.

## Worker execution

Added:

`server/automation/automationExecutionWorker.ts`

The worker:

1. validates the versioned payload/link
2. revalidates the current principal
3. invokes the existing `automationExecutionRuntimeService.executeEligible(...)`
4. heartbeats the generic worker lease
5. links the resulting AutomationRun/Action execution
6. records a safe outcome code/message

The worker does **not** implement policy evaluation, Action mutation, or compensation logic itself.

## D2 remains authoritative

E5 preserves the D2 execution engine unchanged as the business boundary:

- policy revalidation
- emergency control revalidation
- durable AutomationRun claim
- bounded D2 execution retry
- D1 confirmed Action transaction
- AutomationRun completion
- partial-success reconciliation
- restart recovery
- exactly-once company-state mutation

A generic worker restart simply re-enters D2, which converges on the already committed run/execution when applicable.

## Worker status vs business outcome

Generic worker state represents queue processing health.

AutomationRun state remains the business outcome.

Therefore deterministic outcomes such as:

- policy denied
- approval required
- unsupported automatic intent
- stale Action state
- execution-mode conflict

can be processed successfully by the worker while the linked AutomationRun remains truthfully BLOCKED/FAILED as appropriate.

A terminal D2 technical failure is not retried again as a second business retry loop by E5.

Worker retry is reserved for recoverable process/transport interruption around the durable D2 state.

## Crash recovery

E5 proves the dangerous window:

`D2 business commit succeeds -> worker dies before generic worker completion`

After the worker lease expires:

- E2 recovers the stale RUNNING job
- E5 sees the already-linked successful D2 state
- the job completes without reapplying the Action
- AutomationRun count remains one
- Action execution count remains one
- effective company-state mutation remains one

## Queued API

Added additive queued surfaces:

- enqueue Automation execution job
- list execution jobs for a proposal
- inspect one execution job

The browser-safe view exposes:

- job state
- attempts/timestamps
- proposal
- requested actor label/source/role
- linked AutomationRun ID/status
- linked Action execution ID
- safe outcome code/message

It does not expose:

- principal raw ID
- authorization revision
- worker lease owner/token
- raw payload
- idempotency key
- concurrency key

## Compatibility

The existing synchronous:

`POST /api/automation/execute/:proposalId`

remains unchanged.

Manual:

`POST /api/automation/runs/:runId/compensate`

also remains synchronous.

Automation policy/approval/control administration remains unchanged.

## Worker ownership

The E5 handler registers only after the worker/combined process-role guard.

The background workload catalog now marks Automation execution as:

- AUTONOMOUS_LOOP
- owner: WORKER
- E2 generic worker queue
- D2 database execution claim beneath the worker lease
- no longer a future queue candidate

Dedicated worker startup verifies migration 018 before accepting work.

## Historical proof advancement

E1, E2, and E3 historical guards were advanced narrowly to recognize the later Automation worker migration while preserving their original guarantees.

## Executable evidence

### Contract proof

`scripts/check-production-e5-automation-execution-worker-contract.ts`

Verifies:

- migration 018 ownership/linkage
- versioned identifier-only payload
- current principal revalidation
- no credential/session secret payload
- deterministic idempotency
- per-proposal concurrency
- D2 runtime reuse
- safe browser job view
- queued API surfaces
- worker-only ownership
- synchronous execute/compensation compatibility
- no Redis/BullMQ/pg-boss

### PostgreSQL proof

`scripts/check-production-e5-automation-execution-worker-postgres.ts`

Using real PostgreSQL verifies:

- migration 018
- duplicate enqueue convergence
- exactly-once D2 AutomationRun + D1 Action execution
- successful enqueue replay convergence
- worker crash after D2 commit
- stale lease recovery without duplicate mutation
- policy change after enqueue is revalidated
- deterministic policy denial is a truthful business outcome
- API-key revocation after enqueue prevents execution
- human membership revocation prevents execution
- cross-account job visibility denial

## Validation

Authoritative implementation Quality Gate:

`36035111875`

Green:

- TypeScript
- production build
- Phase 0–8 regressions
- A–D production-hardening proofs
- E1–E4 historical guards
- E5 contract proof
- E5 PostgreSQL proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini benchmark

## Verdict

**E5 is complete.**

Track E’s production worker objective is now satisfied for the current system:

- Watch evaluation already runs on its durable worker-owned scheduler
- Action Discovery refresh uses E2 generic workers
- Integration sync uses E2 generic workers
- Controlled Automation execution uses E2 generic workers
- request-driven compatibility remains where deliberate migration safety requires it

No Redis/managed queue is justified by current evidence.

## Next phase

**F1 — Production Secret/KMS Forensic Audit + Managed-Secret Boundary Plan**

F1 should inventory every production secret/credential/encryption-key path before selecting or implementing a managed secret provider.

No credential migration should begin until the audit distinguishes:

- deployment secrets
- account/provider credentials
- OAuth refresh tokens
- encryption keys
- webhook/signing secrets
- secrets currently persisted in local encrypted files or ordinary database metadata
