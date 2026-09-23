# Production D1 — Confirmed Action Transaction Boundary

Status: **COMPLETE** — authoritative integrated Quality Gate `35897430490`.

## Goal

D1 verifies and closes the relational consistency boundary for confirmed/manual Actions.

The target is:

```text
idempotency
+ company-state mutation
+ business event
+ Action execution
+ proposal status
+ confirmation audit
= one PostgreSQL transaction
```

Downstream Discovery refresh is intentionally outside this core transaction because it is follow-up analysis rather than the authoritative business mutation.

## Forensic result

The required production transaction already existed in the PostgreSQL runtime before D1 closeout.

`ActionRuntimeExecutionService.confirm(...)` delegates PostgreSQL confirmation to:

`postgresConfirmedActionTransactionRepository.commitConfirmedAction(...)`

File-mode development continues to use the legacy in-memory/file Action execution path.

D1 therefore did not rewrite a correct transaction. It added focused executable evidence for the crash and concurrency guarantees that were previously only partially covered by A7D.

## Transaction boundary

The confirmed Action transaction performs the following under one `withTransaction(...)` callback:

1. lock the proposal row
2. check for an existing execution for the same account/proposal
3. return that execution as an idempotent replay when already committed
4. acquire deterministic PostgreSQL advisory transaction locks for every relevant entity/predicate state key
5. re-resolve proposal preconditions inside the transaction
6. reject stale effective state before mutation
7. close superseded current claims
8. insert the new USER_CONFIRMED claims
9. insert the business event and subject links
10. insert the Action execution plus claim/event links
11. transition the proposal from PROPOSED to CONFIRMED and attach the execution
12. insert the CONFIRMED audit entry
13. commit all relational changes together

The database schema already enforces:

`UNIQUE (account_id, proposal_id)`

on `action_executions`, which provides the durable exactly-once execution identity for a proposal within an account.

## Concurrency behavior

D1 explicitly proves two simultaneous confirmation calls against the same proposal.

Expected and verified result:

- both calls succeed
- both return the same execution ID
- one Action execution row exists
- one CONFIRMED audit exists
- one Action-derived state claim exists for the proposal
- one Action business event exists for the proposal
- effective company state changes exactly once

The second transaction waits on the proposal lock and then resolves the already-committed execution as an idempotent replay.

## Crash / late-failure behavior

D1 adds a direct transaction proof that deliberately causes a failure at the audit-identity validation stage.

That point occurs after the transaction has already attempted:

- prior-claim supersession
- new claim insertion
- event insertion
- Action execution insertion
- proposal CONFIRMED transition

The transaction is expected to abort.

Verified after failure:

- proposal remains PROPOSED
- newly inserted claim does not exist
- newly inserted business event does not exist
- Action execution does not exist
- confirmation audit does not exist
- the previous effective claim remains current

This demonstrates that a late relational failure cannot report or leave partial business mutation state.

## Stale-state protection

The transaction rechecks effective state under the same relational transaction after acquiring state-key locks.

If the proposal precondition no longer matches:

- the confirmation transaction performs no business mutation
- the runtime classifies the proposal as stale outside the failed mutation transaction
- the caller receives a conflict response
- a fresh proposal is required

This behavior remains covered by the existing A7D runtime proof.

## Tenant isolation

D1 directly verifies that using another account with a raw proposal ID cannot enter the transaction.

The transaction loads the proposal with both:

- `account_id`
- `proposal_id`

A foreign account receives `ACTION_PROPOSAL_NOT_FOUND` before any write.

## Downstream analysis

Discovery refresh is performed only after the core Action transaction commits.

This is intentional:

- Discovery is derived analysis
- a Discovery failure must not roll back a valid confirmed business mutation
- downstream run IDs/warnings are persisted afterward as execution metadata
- failure to persist that optional metadata does not change the truth of the confirmed Action itself

No compensation is necessary for the core relational Action workflow because all authoritative business writes participate in one PostgreSQL transaction.

## File-mode compatibility

D1 preserves the existing file-mode development path:

`actionExecutionService.confirm(...)`

PostgreSQL production correctness is not weakened to preserve that compatibility.

## Executable evidence

### Contract proof

`scripts/check-production-d1-confirmed-action-transaction-contract.ts`

Verifies:

- PostgreSQL runtime uses the explicit confirmed-Action transaction repository
- file-mode fallback remains intact
- downstream Discovery runs after the core commit
- proposal row locking
- advisory state-key locking
- in-transaction effective-state recheck
- claim/event/execution/proposal/audit writes in the transaction
- idempotent replay path
- database uniqueness for account/proposal execution identity

### PostgreSQL proof

`scripts/check-production-d1-confirmed-action-transaction-postgres.ts`

Verifies with real PostgreSQL:

- concurrent duplicate confirmations converge on one execution
- exactly one Action mutation set is committed
- effective state changes exactly once
- late transaction failure rolls back all earlier writes
- prior effective state remains current after rollback
- cross-account raw proposal IDs are rejected

## Validation

Authoritative integrated Quality Gate:

`35897430490`

Green:

- TypeScript
- production build
- Phase 0–8 regression gates
- A2–A7G PostgreSQL runtime proofs
- B2 identity/authorization/product-route proofs
- C1–C7 durability proofs
- D1 contract proof
- D1 PostgreSQL concurrency/rollback proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini unseen-corpus benchmark

## Verdict

**D1 is complete.**

The confirmed/manual Action workflow has a database-enforced idempotent transaction boundary for the relationally compatible authoritative business writes.

## Next phase

**D2 — Controlled Automation Transaction Boundary**

D2 should focus only on the Automation execution workflow:

- policy decision
- execution/idempotency claim
- Action/company-state mutation
- Automation execution/recovery status
- audit/recovery state

Do not start Watch scheduling transaction redesign or Track E worker/queue work in D2.
