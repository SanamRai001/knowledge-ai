# Production C7 — Workspace Structured State Relational Migration

Status: **COMPLETE** — authoritative implementation Quality Gate `35895848629`.

## Goal

C7 removes production authority from local `data/knowledge_bases.json` structured workspace state.

In PostgreSQL mode, a workspace can now be reconstructed from:

- PostgreSQL workspace metadata
- PostgreSQL C7 structured state
- C4 durable derived-document payloads
- C3 durable original-document source versions

The legacy JSON store remains available for file-mode development and one-time migration compatibility only.

## Migration 013

Added:

`server/persistence/migrations/013_workspace_structured_state.sql`

Relational state now includes:

- `workspace_specialized_ai`
- `workspace_knowledge_versions`
- `workspace_chat_messages`
- `workspace_evaluation_test_cases`
- `workspace_evaluation_runs`

Every family is account/workspace scoped and database-linked to the owning workspace.

## Specialized AI configuration

Specialized AI configuration is now PostgreSQL-authoritative in production.

`specializedAIService` no longer resolves production AI/workspace state directly from `kbStore`.

Resolution goes through `workspaceRuntimeService` and account-scoped relational lookup.

File-mode compatibility keeps its historical tenant-isolation behavior.

## KnowledgeVersion state

KnowledgeVersion metadata and durable document references are relationally persisted.

New snapshots preserve:

- immutable version identity
- version number/tag
- label/timestamp
- document counts/page counts
- legacy-document compatibility payloads when required
- C4 durable `documentRefs`
- current-version state

Rollback switches relational current-version state and reactivates the durable C4 payload references for the target version.

## Chat history

Chat messages are persisted per account/workspace in PostgreSQL.

Both append and clear operations survive:

- process restart
- in-memory compatibility-store loss
- absence of local `knowledge_bases.json`

## Evaluation state

Evaluation test cases and evaluation runs are PostgreSQL-authoritative.

The historical behavior of retaining only the latest 25 evaluation runs is preserved relationally.

`evaluationService` now reads and writes through the workspace runtime boundary rather than directly through `kbStore`.

## Workspace reconstruction

`WorkspaceRuntimeService.materialize()` combines:

1. PostgreSQL workspace metadata
2. C7 relational structured state
3. current KnowledgeVersion legacy compatibility documents when required
4. C4 durable current document payloads

The resulting `KnowledgeBase` is hydrated into `kbStore` as a **memory-only compatibility mirror**.

Production materialization does not write the compatibility mirror back to `knowledge_bases.json`.

## One-time legacy migration

If relational structured state is absent but an authorized legacy workspace payload is available, C7 can initialize the relational state once.

After initialization, subsequent reconstruction succeeds without the legacy payload.

This provides a migration path without allowing JSON to override existing PostgreSQL state.

## Active workspace authority

Production active-workspace selection remains PostgreSQL-authoritative and account scoped.

Loss or mutation of the legacy global `kbStore` active-workspace state cannot override production selection.

## Document compatibility

C3/C4 document durability remains unchanged.

PostgreSQL-mode document mutations use:

- C3 durable original bytes
- C4 durable parsed-document payloads
- C7 relational version metadata/refs

`kbStore` document mutation methods can operate memory-only so production document changes do not mutate the legacy JSON file.

## Security and isolation

C7 preserves:

- account/workspace ownership checks
- foreign raw workspace-ID denial
- foreign Specialized AI-ID denial
- human/API-key identity boundaries
- modern workspace router behavior
- file-mode isolation semantics

PostgreSQL Specialized AI lookup requires explicit account scope and does not perform cross-tenant existence lookup.

## Historical proof advancement

C1 now recognizes C7 relational workspace state and treats `knowledge_bases.json` as compatibility-only.

C4 now recognizes that KnowledgeVersion durable-document references are stored relationally by C7 while C4 object payload authority remains unchanged.

## C7 executable proofs

### Contract proof

`scripts/check-production-c7-workspace-structured-state-contract.ts`

Verifies:

- migration 013 relational families
- account/workspace database scoping
- PostgreSQL runtime write boundaries
- Specialized AI and Evaluation service cutover
- memory-only production compatibility hydration
- bounded evaluation history

### PostgreSQL proof

`scripts/check-production-c7-workspace-structured-state-postgres.ts`

Using real PostgreSQL, verifies:

- Specialized AI persistence
- KnowledgeVersion persistence/current selection
- chat persistence and clear
- evaluation test-case persistence
- evaluation-run persistence
- restart reconstruction after compatibility-store loss
- PostgreSQL-authoritative active workspace selection
- one-time legacy structured-state migration
- cross-account workspace/AI denial
- no production mutation of `data/knowledge_bases.json`

## Validation

Authoritative implementation Quality Gate:

`35895848629`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression suite
- workspace and HTTP tenant-isolation proofs
- A2–A7G PostgreSQL runtime chain
- B2 identity/authorization/product-route proofs
- C1 historical durability guard
- C2 source storage proofs
- C3 document source proofs
- C4 derived-document proofs
- C5 Dataset durability proofs
- C6 integration checkpoint proofs
- C7 contract proof
- C7 PostgreSQL restart/isolation proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini unseen-corpus benchmark

## Next phase

**D1 — Confirmed Action Transaction Boundary**

Keep D1 limited to the confirmed/manual Action workflow:

- inventory the idempotency claim, company-state mutation, Action state, and audit writes
- move relationally compatible writes into one explicit PostgreSQL transaction
- use database-enforced idempotency where possible
- define truthful compensation for effects that cannot participate in the transaction
- preserve human/API-key authorization and Action policy semantics
- add duplicate/crash/cross-account PostgreSQL proofs

Do not start Controlled Automation transaction redesign, worker/queue migration, managed secrets, deployment, or broader Track D work in D1.
