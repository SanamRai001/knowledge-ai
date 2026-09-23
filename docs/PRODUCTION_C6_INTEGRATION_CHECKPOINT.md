# Production C6 — Integration Snapshot + Checkpoint Commit Ordering

Status: **COMPLETE** — authoritative implementation Quality Gate `35888423609`.

## Goal

C6 closes the remaining structured-integration crash window after C5 made Dataset source and analytical payloads durable.

The important audit result was that PostgreSQL integration checkpoint commit already existed and was transactional.

C6 therefore did **not** replace that transaction.

Instead, C6 closes the gap before checkpoint commit where:

1. Dataset source bytes could already be durable
2. DatasetVersion metadata could already be committed
3. the process could fail before `integration_external_imports` was recorded
4. the provider cursor would correctly remain unchanged
5. retry could replay the same external version but create a duplicate Dataset because the missing external-import row was the only identity bridge

C6 makes that state recoverable from immutable source provenance.

## Existing checkpoint transaction preserved

The existing production path remains:

`IntegrationRuntimeService.sync()`

→

`IntegrationPersistence.commitSuccessfulCheckpoint(...)`

→

`PostgresIntegrationCheckpointRepository.commitSuccessfulCheckpoint(...)`

The PostgreSQL checkpoint uses one transaction to:

- lock the IntegrationConnection
- verify the expected provider cursor
- lock the SyncRun
- persist checkpoint external-import state
- complete the SyncRun
- advance the connection cursor and success timestamps

C6 extends this boundary instead of replacing it.

## Migration 012

Added:

`server/persistence/migrations/012_integration_source_checkpoint.sql`

It adds:

- nullable `integration_external_imports.source_version_id`
- account-scoped FK to immutable `source_versions`
- source-version lookup index
- one-to-one durable `dataset_versions(account_id, source_version_id)` mapping for non-null source links

Nullable linkage preserves pre-C6 historical external-import rows.

## Exact source snapshot linkage

`ExternalImportState` now carries:

`sourceVersionId?: string`

New PostgreSQL structured integration imports persist that opaque source identity.

Physical object keys remain inside storage metadata and never enter public integration state.

## PostgreSQL provider provenance

The authoritative PostgreSQL integration runtime now passes C5 source provenance into Dataset import:

- external connection ID
- external resource ID
- external provider version
- provider origin mapping

Google Drive / Google Sheets map to `GOOGLE_DRIVE`.

OneDrive / Excel map to `MICROSOFT_ONEDRIVE`.

Other integration providers retain their external identity/version while using the existing source-origin fallback.

## Crash-window recovery

Added:

`server/integrations/integrationSourceRecoveryService.ts`

Before provider refetch, when no exact external-import row exists, the runtime now searches for active durable source snapshots matching:

- account
- connection
- external resource ID
- external version

For each matching immutable SourceVersion, recovery requires a committed owned DatasetVersion linked to that exact sourceVersionId.

Only then can it reconstruct the missing Integration external-import state.

An orphan SourceVersion without a committed DatasetVersion is ignored.

This is intentionally conservative.

## Recovery before provider fetch

The PostgreSQL processing order is now:

1. exact external-import lookup
2. READY → skip idempotently
3. INGESTED → finish projection
4. recover committed DatasetVersion from durable external source snapshot
5. only if recovery does not exist, fetch the provider record and import normally

This means a retry after the specific Dataset-commit/external-import-record crash can recover even if provider fetch is temporarily unavailable.

It also prevents creating a duplicate Dataset for the already-committed provider version.

## New import fail-closed requirement

A new PostgreSQL integration Dataset import must return a C5 `sourceVersionId`.

If a durable integration Dataset import somehow completes without that linkage, runtime fails instead of recording provenance that cannot be recovered later.

## Checkpoint completeness guards

C6 strengthens the existing PostgreSQL checkpoint transaction.

The cursor cannot advance if a checkpoint import is still:

`INGESTED`

The transaction raises:

`INTEGRATION_CHECKPOINT_INCOMPLETE`

For Dataset imports carrying sourceVersionId, the transaction also verifies that:

- account
- Dataset ID
- DatasetVersion ID
- sourceVersionId

all identify the same durable DatasetVersion.

A mismatch raises:

`INTEGRATION_CHECKPOINT_SOURCE_MISMATCH`

The existing stale-cursor guard remains:

`INTEGRATION_CHECKPOINT_STALE`

## Idempotency and retry behavior

The existing uniqueness contract remains:

`(account_id, connection_id, external_id, external_version)`

After a crash:

- a READY import is skipped
- an INGESTED import resumes projection
- a missing import row can be reconstructed from the durable source/DatasetVersion pair
- an incomplete or stale checkpoint cannot move the provider cursor

Current leases, retry/backoff, permission-loss handling, cursor reset, and reauthorization behavior are unchanged.

## Scope boundary

C6 intentionally does not add:

- a worker/queue system
- distributed job leasing beyond the existing sync lease
- broad Track D transaction redesign
- chat/config/evaluation persistence
- workspace structured-state migration

The legacy/file-mode integration runtime remains separate.

## Historical proof advancement

C1 was advanced narrowly.

It now recognizes:

- C3 durable original document bytes
- C4 durable derived document payloads
- C5 durable Dataset source + analytical payloads
- C6 durable integration source recovery + transactional checkpoint guards

The remaining explicit local durability debt is the workspace structured shell:

- Specialized AI configuration
- chat history
- evaluation test cases/runs
- KnowledgeVersion metadata/document refs

## C6 executable proofs

### Contract proof

`scripts/check-production-c6-integration-checkpoint-contract.ts`

Verifies:

- migration 012 source linkage
- recovery-before-provider-fetch ordering
- account/connection/external-resource/version source lookup
- DatasetVersion recovery by sourceVersionId
- external-import sourceVersionId persistence
- preserved transactional checkpoint implementation
- incomplete-import checkpoint guard
- source mismatch guard
- no C6 recovery coupling added to the legacy/file-mode runtime

### PostgreSQL crash/recovery proof

`scripts/check-production-c6-integration-checkpoint-postgres.ts`

Using real PostgreSQL and the deterministic in-memory implementation of the production object-storage contract, verifies:

- migration 012
- simulated crash after durable DatasetVersion commit but before external-import recording
- provider fetch intentionally unavailable
- recovery of the exact precommitted Dataset/version from durable source provenance
- no duplicate Dataset creation
- READY projection state
- sourceVersionId equality across DatasetVersion and external import
- external connection/resource/version provenance
- cross-account recovery denial
- later provider version keeps the same Dataset ID
- new provider version gets a new immutable DatasetVersion/sourceVersion
- stale checkpoint rejection leaves run/cursor uncommitted
- INGESTED checkpoint rejection prevents cursor advancement

## Validation

Authoritative implementation Quality Gate:

`35888423609`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression suite
- A2–A7G PostgreSQL runtime chain
- identity/authorization route proofs
- C1–C5 historical durability guards/proofs
- C6 contract proof
- C6 PostgreSQL crash/recovery proof
- unseen-corpus effectiveness benchmark
- live Gemini unseen-corpus benchmark

## Next phase

**C7A — Workspace Structured-State Forensic Audit + Relational Boundary**

The remaining production durability dependency is `data/knowledge_bases.json` for non-document workspace state.

C7A should inventory and classify:

- Specialized AI configuration
- chat history and feedback metadata
- KnowledgeVersion metadata / document refs
- evaluation test cases
- evaluation runs/results
- any other non-document state still written through `kbStore`

C7A should define relational vs large-payload boundaries, ownership constraints, migration/backfill strategy, startup reconstruction, and the smallest implementation slices.

Do not migrate workers/queues or begin broad Track D work in C7A.
