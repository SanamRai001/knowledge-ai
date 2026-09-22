# Production C2 — Source Object Metadata + Storage Abstraction Foundation

Status: **COMPLETE** — authoritative implementation Quality Gate `35754956014`.

## Scope

C2 creates the durable metadata and provider-neutral contracts required by Track C.

It deliberately does **not**:

- choose S3, Cloudflare R2, GCS, Azure Blob, or another provider
- add cloud credentials
- add signed URLs
- persist uploaded PDF/CSV/XLSX bytes yet
- change browser upload behavior
- change Dataset analytical payload storage
- change Google Drive / OneDrive checkpoint ordering
- add workers or queues

Existing runtime byte flows remain unchanged.

## PostgreSQL metadata

Migration:

`server/persistence/migrations/009_source_objects.sql`

### source_objects

Logical source identity with explicit tenant ownership:

- id
- account_id
- optional workspace_id
- kind:
  - DOCUMENT
  - DATASET_SOURCE
- origin:
  - UPLOAD
  - GOOGLE_DRIVE
  - MICROSOFT_ONEDRIVE
  - GENERATED
- optional external_connection_id
- optional external_id
- status:
  - ACTIVE
  - TOMBSTONED
- created_at
- updated_at

The optional workspace link is constrained by the composite:

`(account_id, workspace_id)`

so a source object cannot point at another account's workspace.

### source_versions

Immutable byte-snapshot metadata:

- id
- account_id
- source_object_id
- optional external_version
- original_filename
- content_type
- size_bytes
- sha256
- storage_backend
- storage_key
- optional storage_etag
- retention_state:
  - ACTIVE
  - TOMBSTONED
  - PURGE_PENDING
- created_at
- retention_updated_at

The physical `(storage_backend, storage_key)` pair is unique.

SHA-256 is indexed only inside the account namespace; C2 does not introduce cross-tenant global deduplication.

## Database immutability

Migration 009 adds:

`source_versions_immutable_byte_identity`

The trigger rejects rewrites of:

- version ID
- account ownership
- source-object ownership
- provider/external version
- original filename
- content type
- byte size
- SHA-256
- storage backend/key/etag
- creation time

Only retention lifecycle state/time may change after creation.

This makes immutable source identity a database invariant rather than a TypeScript convention.

## Repository boundary

Added:

`server/storage/postgresSourceObjectRepository.ts`

Every read/update method requires `accountId`.

Supported operations:

- create source object
- get/list source objects inside one account
- tombstone source object
- create immutable source version
- get/list source versions inside one account/source object
- move a source version through retention lifecycle

There is intentionally no API for rewriting source-version byte identity.

## Provider-neutral byte-storage contract

Added:

`server/storage/sourceByteStorage.ts`

The interface defines:

- `put`
- `get`
- `delete`

and returns provider-neutral stored-object metadata:

- backend
- key
- sizeBytes
- sha256
- optional etag

No production storage provider implementation exists in C2.

## Server-generated storage keys

`buildSourceStorageKey()` produces:

`accounts/<accountId>/sources/<sourceObjectId>/versions/<sourceVersionId>`

Properties:

- tenant namespace is explicit
- client filename is never part of the storage key
- arbitrary object keys are not accepted
- unsafe path segments, slashes, dot traversal, and whitespace are rejected

The exact future cloud-provider bucket/key format remains an adapter concern.

## Integrity contract

Added:

- `sha256Bytes()`
- `verifySourceIntegrity()`
- `SourceIntegrityError`

A future storage adapter must verify both:

- expected byte length
- expected SHA-256

before a source version can be considered safely stored.

## Runtime non-cutover

C2 intentionally does not import the new source repository/storage contracts into:

- `workspaceRouter`
- `datasetService`
- `integrationSyncService`

Current upload/import/sync behavior remains unchanged until later Track C slices.

## Executable proofs

### Provider-neutral foundation proof

`scripts/check-production-c2-storage-foundation.ts`

Checks:

- deterministic tenant-safe storage keys
- cross-account key separation
- unsafe path rejection
- SHA-256/size integrity validation
- provider-neutral put/get/delete contract
- migration 009 source metadata + immutability presence
- no current browser/Dataset/integration runtime cutover
- no AWS/GCS/Azure storage SDK added

### PostgreSQL metadata proof

`scripts/check-production-c2-source-metadata-postgres.ts`

Checks:

- migration 009 repeatability
- source object account/workspace ownership
- cross-account object read denial
- cross-account workspace-link rejection
- immutable source-version metadata persistence
- cross-account version read/create denial
- cross-account retention mutation denial
- allowed retention lifecycle transition
- database rejection of SHA-256 rewrite
- database rejection of source-object identity rewrite
- unique physical backend/key locator
- source-object tombstone preserving version history
- explicit account_id on both source metadata tables

## Validation

Authoritative implementation Quality Gate:

`35754956014`

Verified green:

- TypeScript
- production build
- provider-neutral C2 storage-foundation proof
- PostgreSQL C2 source-metadata/isolation/immutability proof
- all earlier production-hardening proofs
- Phase 0–8 regression gates
- PostgreSQL production suite
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Next phase

After C2 closes:

**C3 — Durable Object Backend + Document Source Migration**

C3 may select/configure one production object backend and cut only document source-byte persistence/retry over first. Dataset analytical payloads and integration checkpoint hardening remain later slices.
