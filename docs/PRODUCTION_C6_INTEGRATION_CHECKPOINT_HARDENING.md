# Production C6 — Integration Source Snapshots + Checkpoint Atomicity

Status: **COMPLETE** — authoritative implementation Quality Gate `35892271035`.

## Goal

C6 closes the remaining P0 integration durability gap identified by C1:

- fetched provider bytes must map to immutable durable source snapshots
- retries must not create duplicate snapshots for the same provider version
- a crash between source/Dataset/import/projection steps must be recoverable
- the provider cursor must advance only after every record in the page has durable committed prerequisites

The existing PostgreSQL checkpoint transaction was preserved and strengthened rather than replaced.

## Migration 012

Added:

`server/persistence/migrations/012_integration_source_checkpoint.sql`

`integration_external_imports` now carries:

`source_version_id`

with an account-scoped foreign key to:

`source_versions(account_id, id)`

The public integration model exposes only the opaque sourceVersionId.

It does not expose:

- storage backend
- bucket
- object key
- ETag
- credentials

## Stable provider source identity

C6 extends the source-object repository with account-scoped lookups for:

- connection + external resource identity
- exact external version identity

Provider-backed Dataset sources now treat:

`account + connectionId + externalId + externalVersion`

as the immutable provider snapshot identity.

If that exact source version already exists:

1. incoming size/SHA-256 must match
2. configured storage backend must match
3. stored bytes are downloaded and integrity-verified
4. the exact existing SourceVersion is reused

Different bytes for the same external version fail closed.

This also searches across pre-C6 SourceObjects so C5 history remains recoverable.

## Safe source compensation

C6 fixes an important lifecycle edge from C5.

A failed retry may reuse an existing provider snapshot.

Therefore compensation now records whether the current attempt created:

- the SourceObject
- the SourceVersion

Only a newly created source version may be purged by that failed attempt.

The whole SourceObject is tombstoned only if that same attempt created it.

This preserves historical provider versions.

## Crash recovery

Added:

`server/integrations/integrationSourceRecoveryService.ts`

For a provider resource/version with no external-import journal row, it can reconstruct identity from:

1. immutable SourceVersion by provider identity
2. owning DATASET_SOURCE SourceObject
3. DatasetVersion linked by sourceVersionId
4. source size/SHA-256 agreement

It returns only:

- sourceVersionId
- datasetId
- datasetVersionId

The production IntegrationRuntimeService performs this recovery **before provider fetch**.

Therefore a process crash after Dataset commit but before external-import journaling can resume without:

- re-downloading the provider file
- creating a duplicate source snapshot
- creating a duplicate DatasetVersion

## Pre-C6 compatibility repair

A pre-C6 external-import row may already reference a durable C5 DatasetVersion but lack its new `sourceVersionId` column.

On retry, PostgreSQL runtime lazily resolves the DatasetVersion's sourceVersionId and repairs the external-import row before checkpointing.

## External-import journal invariant

After every provider record is processed, the production runtime now requires a durable exact external-import row.

If no row exists, the attempt fails with:

`INTEGRATION_CHECKPOINT_IMPORT_MISSING`

This prevents the page from being considered checkpointable without a durable per-record journal.

## Atomic checkpoint transaction

C6 keeps the existing:

`IntegrationPersistence.commitSuccessfulCheckpoint()`

and:

`PostgresIntegrationCheckpointRepository.commitSuccessfulCheckpoint()`

The PostgreSQL implementation locks the connection and run with `FOR UPDATE`, verifies the expected cursor, and commits the following in one transaction:

1. checkpoint external-import rows
2. completed SyncRun
3. IntegrationConnection cursor + success timestamps

C6 strengthens the prerequisites.

### Import state

Each checkpoint import must be:

- READY
- or TOMBSTONE

An INGESTED or incomplete record blocks cursor movement.

### Dataset identity

A READY Dataset import must reference a committed:

- Dataset
- DatasetVersion

### Source snapshot

For durable DatasetVersions, the external import sourceVersionId must equal the DatasetVersion sourceVersionId.

The source snapshot must still be:

- account-owned
- ACTIVE
- attached to an ACTIVE DATASET_SOURCE SourceObject

### Living Knowledge projection

A READY Dataset import must have a completed projection matching exactly:

- account
- Dataset ID
- DatasetVersion ID
- projection run ID
- source type DATASET

The cursor cannot advance before that projection is completed.

### Stale cursor

The transaction compares the locked connection cursor to the attempt's expected cursor.

A changed cursor fails with:

`INTEGRATION_CHECKPOINT_STALE`

## Recovery windows proven

The C6 PostgreSQL proof covers three real crash windows.

### Window 1 — source snapshot committed, Dataset not committed

A provider snapshot is persisted manually.

On sync retry, the exact snapshot is reused and no duplicate SourceVersion is created.

### Window 2 — DatasetVersion committed, external-import journal missing

A DatasetVersion is committed with its provider SourceVersion but no external-import row.

The connector is configured to fail if fetched.

Sync still succeeds because C6 reconstructs the missing journal from the durable snapshot before fetch.

### Window 3 — READY journal committed, cursor not advanced

A DatasetVersion, projection, and READY external-import row exist while the connection cursor is still old.

The provider fetch is configured to fail.

Sync skips refetch, includes the READY journal in the checkpoint, and atomically advances the cursor.

## Transaction rollback proofs

The PostgreSQL proof also attempts invalid checkpoint commits.

### Wrong source snapshot

A READY Dataset import references a valid but different SourceVersion.

Expected:

`INTEGRATION_CHECKPOINT_SOURCE_MISMATCH`

The connection cursor remains unchanged and the SyncRun remains RUNNING.

### Missing projection

A READY Dataset import has the correct Dataset/source identity but no completed exact projection.

Expected:

`INTEGRATION_CHECKPOINT_PROJECTION_MISSING`

Again, the cursor does not move.

## Scope boundary

C6 does not migrate:

- chat history
- Specialized AI configuration
- evaluation cases/runs
- KnowledgeVersion metadata
- workers/queues
- credential storage
- unrelated Track D workflows

No new integration HTTP surface was added.

## Executable proofs

### Contract proof

`scripts/check-production-c6-integration-checkpoint-contract.ts`

Verifies:

- migration 012 source linkage
- opaque sourceVersionId only
- exact provider-version snapshot reuse
- recovery before provider fetch
- atomic checkpoint primitive remains authoritative
- source/projection/checkpoint guards
- safe compensation behavior

### PostgreSQL crash/checkpoint proof

`scripts/check-production-c6-integration-checkpoint-postgres.ts`

Verifies:

- migration 012
- source-only crash recovery
- Dataset-before-journal crash recovery
- READY-before-checkpoint recovery
- exact snapshot reuse
- cross-account recovery denial
- source mismatch rollback
- projection prerequisite rollback
- cursor immutability on rejected checkpoints
- provider source → exact DatasetVersion resolution

## Validation

Authoritative implementation Quality Gate:

`35892271035`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression matrix
- A2–A7G PostgreSQL runtime chain
- A7B Integration runtime compatibility
- all B2 identity/route hardening proofs
- C1 historical durability guard
- C2–C5 Track C proofs
- C6 contract proof
- C6 PostgreSQL crash/checkpoint proof
- arithmetic/deterministic synthesis guards
- unseen-corpus benchmark
- live Gemini benchmark

## Next phase

**C7 — Workspace Structured State Relational Migration**

C7 should remove the remaining production dependence on `data/knowledge_bases.json` for:

- KnowledgeVersion metadata + durable document refs
- chat history
- Specialized AI configuration
- evaluation test cases
- evaluation runs

Workspace identity/metadata, active selection, original/derived document payloads, Dataset payloads, and integration snapshots are already handled by earlier hardening slices.

C7 should make a PostgreSQL workspace shell reconstructable even when the local compatibility file is absent.
