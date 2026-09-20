# Knowledge AI — Production A7D Living Knowledge + Actions Runtime

Date: **2026-09-20**

## Status

# ✅ COMPLETE

Authoritative integrated workflow: **`35520216547`**

Both required jobs passed:

- `quality` — complete Phase 0–8 regression suite, TypeScript, production build, unseen benchmark, live Gemini benchmark
- `Production A2 PostgreSQL` — A2–A7D PostgreSQL runtime proofs, including the dedicated A7D Living Knowledge + Actions cutover test

## Runtime cutover delivered

When:

```text
KNOWLEDGE_AI_PERSISTENCE_MODE=postgres
```

the selected production runtime now routes these user-facing paths through PostgreSQL:

### Living Company Knowledge

- structured Dataset projection
- document knowledge projection
- summary
- entity list/detail
- relationships
- claims
- events
- projection runs
- conflicts
- What Changed?
- changes-since
- effective company state
- effective Dataset overlays

### Actions

- proposal creation
- proposal refinement
- proposal list/detail
- audit history
- cancellation/stale transitions
- confirmation
- execution lookup
- downstream analysis metadata

## Transaction boundary

Confirmed Action execution uses the existing A3 relational transaction:

```text
proposal lock
+ effective-state precondition locks
+ USER_CONFIRMED claims
+ business event
+ ActionExecution
+ proposal → CONFIRMED
+ CONFIRMED audit
= one PostgreSQL transaction
```

Repeated confirmation returns the same relational execution idempotently.

If the effective state changed after proposal creation, the confirmation fails with stale-state semantics and no execution/business mutation is committed.

## A7D executable proof

`scripts/check-production-a7d-knowledge-actions-runtime.ts`

The proof verifies:

- Dataset projection creates PostgreSQL company entities/claims/projection runs
- normal Company Knowledge HTTP reads come from selected PostgreSQL state
- raw entity IDs remain account isolated
- normal Action proposal reads effective PostgreSQL company state
- proposal + PROPOSED audit are durable
- Action confirmation creates USER_CONFIRMED effective state
- proposal transition / execution / claim links / event links / audit all exist after the transaction
- repeated confirmation is idempotent
- stale confirmation produces no execution
- foreign account cannot inspect or confirm another account's Action
- state survives pool/service reconstruction
- Integration-synchronized Dataset projection feeds PostgreSQL Living Knowledge
- `data/company-knowledge.json` is not mutated in PostgreSQL mode
- `data/company-actions.json` is not mutated in PostgreSQL mode
- file-mode Phase 3/4 behavior remains green

## Regression fixed during cutover

The first integrated A7D run exposed a compatibility regression in the normal `What changed?` HTTP path.

The PostgreSQL runtime initially declared a second `KnowledgeChangeError` class. The router correctly recognized the legacy/shared error class, so incompatible source-scope comparisons became HTTP 500 instead of the established HTTP 400 contract.

A7D now reuses the authoritative `KnowledgeChangeError` type from `companyKnowledgeChangeService.ts`.

This restored:

```text
unrelated projection source scopes → HTTP 400
```

and Phase 3D is green again.

## Production limitations that remain

A7D does not mean the entire product is fully PostgreSQL-backed yet.

The next remaining mutable runtime family is:

- Controlled Automation

Additional production-hardening tracks still remain afterward:

- identity / org admin
- durable object storage
- production worker infrastructure
- managed KMS/secret storage
- observability/backups
- deployment hardening
- load/abuse/security testing

## Next task

**Production Hardening A7E — Automation runtime PostgreSQL cutover**

Route:

- automation policies + revisions
- approval requests
- emergency control state + revisions
- automation runs
- recovery/compensation state
- automation quality feedback

through the already-existing A5 PostgreSQL repositories when production mode is enabled, while preserving file mode and all Phase 7 behavior.
