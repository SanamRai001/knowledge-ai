# Production C5 — Dataset Source + Analytical Payload Migration

Status: **COMPLETE** — authoritative implementation Quality Gate `35886051635`.

## Goal

C5 removes the remaining production Dataset durability dependency on request-memory source bytes and `data/dataset_runtime_payloads.json`.

PostgreSQL remains authoritative for Dataset, DatasetVersion, and import-run metadata.

Object storage now owns:

- immutable original CSV/XLSX source bytes
- derived analytical table payloads

Legacy local Dataset payloads remain readable only for pre-C5 compatibility.

## Migration 011

Added:

`server/persistence/migrations/011_dataset_durable_payloads.sql`

DatasetVersion metadata now supports:

- `source_version_id`
- analytical payload storage backend
- analytical payload byte size
- analytical payload SHA-256

Database linkage enforces account ownership between DatasetVersion and immutable SourceVersion.

Existing pre-C5 DatasetVersion rows remain valid because the new durability columns are nullable for compatibility.

## Immutable Dataset source bytes

Added:

`server/datasets/datasetSourceStorageService.ts`

New PostgreSQL Dataset imports now follow this order:

1. ensure the owning account row exists
2. write original CSV/XLSX bytes to the configured durable object backend
3. verify byte size + SHA-256
4. create a `DATASET_SOURCE` SourceObject
5. create an immutable SourceVersion
6. parse the exact request bytes
7. verify parsed source metadata still matches the durable SourceVersion
8. write the derived analytical payload
9. commit Dataset/DatasetVersion/import-run metadata transactionally

If parsing or relational import commit fails, the newly persisted source is compensated/tombstoned and physical bytes are deleted when possible.

A failed import cannot truthfully remain `IMPORTED` with missing durable source bytes.

## Provider provenance

The Dataset import contract now accepts source provenance fields for integration-driven imports.

Drive/OneDrive Dataset imports preserve:

- source origin
- external connection ID
- external resource ID
- external version

The C5 slice does **not** change integration cursor/checkpoint transaction semantics.

That deferred consistency work is C6.

## Durable analytical Dataset payloads

Added:

`server/datasets/durableDatasetPayloadStore.ts`

New PostgreSQL DatasetVersion analytical payloads are stored as versioned JSON envelopes containing table schemas and rows.

Generated storage keys are account/dataset/version scoped:

`accounts/<account>/datasets/<dataset>/versions/<version>/payload/<write>.json`

The client never provides physical object keys.

Each locator carries:

- logical backend: `durable-dataset-payload`
- physical storage backend
- object key
- byte size
- SHA-256

Reads verify:

- account/dataset/version key namespace
- configured storage backend
- byte size
- SHA-256
- envelope dataset/version identity

Tampered payloads fail closed.

## Runtime reconstruction

`DatasetRuntimePersistence.bootstrap()` now supports:

- `durable-dataset-payload` for new C5 versions
- `local-dataset-payload` for legacy compatibility
- `legacy-dataset-json` for older migration compatibility

For durable rows, PostgreSQL supplies DatasetVersion identity/source metadata and the object backend supplies the analytical tables.

After in-process Dataset cache loss, current and historical analytical versions reconstruct from PostgreSQL + durable object storage without depending on `data/dataset_runtime_payloads.json`.

Deterministic analytics continue to use the existing synchronous runtime cache after bootstrap.

## Historical-version behavior

C5 preserves immutable DatasetVersion history.

A later version does not overwrite an earlier analytical payload.

Queries specifying an older version still produce the historical analytical result after runtime reconstruction.

## Source reload

The Dataset source service can reload an immutable source version by opaque `sourceVersionId` under the owning account.

It verifies:

- SourceVersion account ownership
- active SourceObject
- `DATASET_SOURCE` object kind
- active retention state
- configured backend match
- exact size
- exact SHA-256

Cross-account source retrieval is denied.

## Legacy compatibility

`server/datasets/datasetRuntimePayloadStore.ts` remains in the repository as a compatibility backend.

It is no longer the production payload destination for new PostgreSQL Dataset imports.

Existing rows whose relational locator is `local-dataset-payload` remain reconstructable while an explicit future migration/backfill can move them if desired.

File persistence mode remains unchanged.

## Error semantics

Dataset HTTP routes now surface missing/misconfigured production object storage as a truthful `503` storage-configuration error instead of a generic internal failure.

Production does not silently fall back to local storage.

## Historical proof advancement

C1 was advanced narrowly:

- original PDF source bytes remain durable from C3
- parsed document payloads remain durable from C4
- new Dataset source + analytical payloads are durable from C5
- the local Dataset payload store is compatibility-only
- integration checkpoint atomicity remains deferred

A7B/A7D/A7G PostgreSQL proofs now inject the same deterministic in-memory implementation of the production storage contract so CI does not require cloud credentials.

Production runtime behavior remains fail-closed without configured durable storage.

## C5 executable proofs

### Contract proof

`scripts/check-production-c5-dataset-durability-contract.ts`

Verifies:

- migration 011 Dataset/source linkage
- source-first import ordering
- failed-import compensation
- durable analytical backend selection
- tenant-safe generated storage keys
- integrity verification
- PostgreSQL durability metadata
- account-scoped source reload
- legacy local payload compatibility
- integration provenance without checkpoint-scope expansion

### PostgreSQL durability proof

`scripts/check-production-c5-dataset-durability-postgres.ts`

Using real PostgreSQL plus an in-memory object backend behind the real `SourceByteStorage` contract, verifies:

- migration 011
- durable CSV source creation
- opaque `sourceVersionId`
- durable analytical locator + SHA/size metadata
- exact source-byte reload
- source object kind/origin
- cross-account source denial
- cross-account analytical payload denial
- immediate deterministic analytics
- second immutable DatasetVersion
- current + historical analytics
- runtime cache wipe
- bootstrap reconstruction from PostgreSQL + durable objects
- analytical payload tamper rejection
- source-byte tamper rejection
- failed-import source compensation

## Validation

Authoritative implementation Quality Gate:

`35886051635`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression suite
- A2–A7G PostgreSQL runtime chain
- B2 identity/authorization/product-route proofs
- C1 historical durability guard
- C2 source metadata PostgreSQL proof
- C3 document source PostgreSQL proof
- C4 derived-document PostgreSQL proof
- C5 contract proof
- C5 PostgreSQL durability proof
- unseen-corpus effectiveness benchmark
- live Gemini unseen-corpus benchmark

## Next phase

**C6 — Integration Snapshot + Checkpoint Commit Ordering**

Keep C6 limited to integration durability/consistency:

- bind provider external versions to durable SourceVersions where required
- make external-import provenance reference those immutable snapshots
- advance provider cursors only after the required durable imports/projections for the checkpoint are committed
- make retry after partial failure idempotent by connection/external resource/external version
- preserve existing leases, reauthorization, account isolation, Dataset identity, and projection behavior

Do not start worker/queue migration, chat/config/evaluation persistence, or broad Track D transaction redesign in C6.
