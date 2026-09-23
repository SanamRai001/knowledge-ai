# Production D2 — Controlled Automation Transaction Boundary

Status: **COMPLETE** — authoritative implementation Quality Gate `35903477902`.

## Goal

D2 replaces the remaining recovery-first consistency gap around policy-authorized automatic Action execution.

Before D2, PostgreSQL Automation execution followed this shape:

```
policy evaluation
→ create/update AutomationRun RUNNING
→ D1 confirmed Action transaction
→ update AutomationRun SUCCEEDED
```

The D1 Action transaction was already atomic, but a process crash after the Action commit and before the final AutomationRun update could leave:

- the business mutation committed
- the Action proposal CONFIRMED
- the Action execution/audit durable
- the Automation run still RUNNING

Recovery could detect that state, but correctness still depended on repair after partial success.

D2 makes the core automatic execution commit transactional.

## D1 composition

D2 does **not** duplicate confirmed Action mutation SQL.

`server/persistence/a3PostgresRepositories.ts` now exposes:

`commitConfirmedActionWithClient(...)`

The existing D1 public repository remains a thin `withTransaction(...)` wrapper around the same helper.

This lets D2 compose the exact D1 sequence inside a larger Automation transaction:

- state-key locking
- precondition recheck
- claim supersession
- claim insertion
- business event
- ActionExecution
- proposal CONFIRMED transition
- CONFIRMED audit entry

Manual Action confirmation keeps the same behavior.

## Shared Action preparation/finalization

`server/actions/actionRuntimeExecutionService.ts` now exposes:

- `preparePostgresConfirmedAction(...)`
- `finalizeCommittedPostgresAction(...)`

Preparation contains the existing proposal validation and deterministic construction of the D1 transaction input.

Finalization keeps downstream Discovery refresh as best-effort post-commit derived work.

Therefore manual confirmation and Automation use the same business mutation preparation and the same D1 transaction body.

## Durable Automation execution claim

D2 adds an explicit PostgreSQL execution-claim step:

`PostgresAutomationExecutionTransactionRepository.claimPolicyExecution(...)`

The claim is serialized by an account/proposal PostgreSQL advisory lock.

For one account + proposal:

- an existing SUCCEEDED run is replayed
- an existing RUNNING run under the same policy revision is reused
- a stale RUNNING claim from an older policy revision is closed as BLOCKED
- otherwise one new RUNNING claim is created

The RUNNING row is intentionally committed before the business mutation.

That makes the pre-Action crash state truthful and recoverable:

```
AutomationRun = RUNNING
ActionExecution = absent
company mutation = absent
```

## Atomic policy-authorized commit

D2 adds:

`PostgresAutomationExecutionTransactionRepository.commitPolicyExecution(...)`

The transaction:

1. takes the account-level Automation advisory lock
2. takes the proposal-level execution advisory lock
3. locks the AutomationRun claim
4. locks/revalidates the current Automation policy
5. locks/revalidates the emergency control state
6. verifies the durable run claim matches the policy revision
7. verifies the prepared Action authorization matches that policy
8. invokes the D1 client-scoped Action commit
9. verifies the resulting Action execution is `AUTOMATION_POLICY` under the same policy revision
10. updates the same AutomationRun to `SUCCEEDED` with the Action execution ID
11. commits all relational writes together

Core invariant:

```
D1 company-state mutation
+ Action execution/status/audit
+ AutomationRun SUCCEEDED
= one PostgreSQL transaction
```

## Governance serialization

Automation policy revisions and emergency-control revisions now use the same account-level advisory lock as policy execution.

This prevents policy or kill-switch state from changing underneath a committing automatic Action.

The transaction also re-checks:

- policy ID
- policy version
- policy enabled state
- `AUTO_EXECUTE_LOW_RISK` mode
- control version
- emergency stop state

A changed policy/control fails before commit.

## Idempotency

D2 combines two database-backed idempotency boundaries:

- proposal-scoped PostgreSQL advisory execution claim
- D1's unique Action execution per `(account_id, proposal_id)`

Concurrent duplicate automatic execution converges on:

- one Automation run claim
- one ActionExecution
- one business mutation
- one CONFIRMED Action audit

Replay returns the same durable execution/run rather than launching the governed Action again.

## Crash/restart outcomes

### Crash before Action commit

Durable state:

- AutomationRun RUNNING
- proposal still PROPOSED
- no ActionExecution
- no company mutation

Restart reuses the same RUNNING claim.

### Failure after D1 writes inside the outer transaction but before Automation completion

Because D1 runs on the same PostgreSQL client/transaction, any failure while persisting Automation completion rolls back:

- claims
- event
- ActionExecution
- proposal transition
- Action audit
- Automation success

The pre-existing RUNNING claim remains outside that failed transaction and can be retried.

### Legacy/pre-D2 crash after Action commit

D2 preserves compatibility with previously possible state:

- Action execution committed
- AutomationRun still RUNNING

On restart, the runtime reconciles the **original RUNNING run** to SUCCEEDED using the committed Action execution.

It does not create a duplicate success run or repeat the mutation.

### Policy/kill-switch changed before commit

The Action transaction does not commit.

The existing RUNNING claim is subsequently settled as BLOCKED under the current governance decision.

## Existing semantics preserved

D2 preserves:

- OWNER/ADMIN-authored policy governance
- API_KEY machine actors as SERVICE
- policy re-evaluation before execution
- approval flows
- manual confirmation
- compensation behavior
- file-mode development compatibility
- D1 stale-state protection
- unsupported Action denial
- downstream Discovery as post-commit best-effort work

Compensation remains a separate governed Action and is intentionally not redesigned in D2.

## Executable proofs

### Contract proof

`scripts/check-production-d2-automation-transaction-contract.ts`

Verifies:

- client-scoped D1 composition
- shared Action preparation/finalization
- Automation transaction contracts
- account/proposal advisory locks
- policy/control serialization
- D1 invocation from D2
- policy/control/authorization invariants
- runtime claim/commit/recovery path
- compensation and file-mode preservation
- no Watch/worker scope expansion

### PostgreSQL proof

`scripts/check-production-d2-automation-transaction-postgres.ts`

Using real PostgreSQL, verifies:

- concurrent duplicate automatic execution converges on one run/execution/mutation
- one CONFIRMED audit entry
- RUNNING-only crash recovery reuses the original run
- pre-D2 Action-committed/RUNNING recovery reuses the original run
- forced failure after D1 writes rolls back all Action relational work
- failed transaction leaves a resumable RUNNING claim
- kill-switch governance race blocks commit
- restart settles the original RUNNING claim as BLOCKED
- cross-account claim is denied by relational ownership
- successful Action/Automation state reconstructs after PostgreSQL pool restart

## Validation

Authoritative implementation Quality Gate:

`35903477902`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression gates
- A2–A7G PostgreSQL runtime proofs
- B2 identity/product/privileged authorization proofs
- C1–C7 durability guards
- D1 contract + PostgreSQL proofs
- D2 contract + PostgreSQL proofs
- arithmetic grounding guard
- deterministic synthesis guard
- unseen-corpus benchmark
- live Gemini benchmark

## Next phase

**D3 — Watch Scheduling Transaction Boundary**

D3 should harden the Watch scheduler's job claim/lease, evaluation, alert episode, rule state, retry/requeue, and job completion consistency using explicit PostgreSQL transaction boundaries.

D3 must stop before Track E worker/queue migration.
