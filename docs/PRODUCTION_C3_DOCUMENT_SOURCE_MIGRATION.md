# Production C3 — Durable Object Backend + Document Source Migration

Status: **COMPLETE** — authoritative implementation Quality Gate `35757955890`.

## Scope

C3 makes original uploaded PDF source bytes durable in the PostgreSQL production path.

Selected production adapter:

- S3-compatible object storage
- AWS SDK for JavaScript v3
- compatible with AWS S3 and services exposing the S3 API

Provider-specific code stays behind the C2 `SourceByteStorage` contract.

C3 does not migrate:

- Dataset CSV/XLSX source bytes
- Dataset analytical row payloads
- Google Drive / OneDrive source snapshots
- integration checkpoint ordering
- parsed workspace/chat/evaluation payload storage
- workers/queues
- Track D transaction workflows

## Environment contract

Production document source uploads require:

- `SOURCE_STORAGE_BACKEND=s3`
- `SOURCE_STORAGE_BUCKET`
- `SOURCE_STORAGE_REGION`

Optional:

- `SOURCE_STORAGE_ENDPOINT`
- `SOURCE_STORAGE_FORCE_PATH_STYLE`
- `SOURCE_STORAGE_ACCESS_KEY_ID`
- `SOURCE_STORAGE_SECRET_ACCESS_KEY`

Static access key ID and secret must be provided together.

When static credentials are omitted, the AWS SDK default credential chain remains available for deployment-managed IAM credentials.

Secrets never enter SourceObject/SourceVersion metadata and are never returned by document APIs.

## S3-compatible adapter

Added:

`server/storage/s3SourceByteStorage.ts`

Operations:

- PutObject
- GetObject
- DeleteObject

Before upload, bytes must match the expected:

- byte length
- SHA-256

The SHA-256 is also written as private object metadata for operational inspection.

The adapter returns only the provider-neutral storage result required by C2:

- backend
- key
- size
- SHA-256
- optional ETag

## Runtime configuration

Added:

`server/storage/sourceByteStorageRuntime.ts`

Properties:

- lazy initialization
- fail-closed configuration validation
- no initialization during module import
- test injection seam
- production backend restricted to `s3`

This lets normal non-upload application startup remain independent of S3 connectivity.

## Document source orchestration

Added:

`server/storage/documentSourceStorageService.ts`

### persistUploadedPdf

Order:

1. generate SourceObject ID
2. generate immutable SourceVersion ID
3. build server-owned tenant-safe storage key
4. calculate source SHA-256 + size
5. write exact PDF bytes to object storage
6. verify adapter result
7. create SourceObject metadata
8. create immutable SourceVersion metadata
9. return opaque metadata to the document workflow

If relational metadata creation fails after byte storage:

- physical bytes are deleted
- created logical source metadata is tombstoned where applicable
- the upload is not reported as successful

### loadPdfBytes

Requires:

- account ID
- workspace ID
- opaque sourceVersionId

It performs an account+workspace-scoped repository join.

The browser cannot provide or retrieve:

- bucket
- storage key
- provider credentials

Retrieved bytes are revalidated against immutable:

- size
- SHA-256

before parsing.

### retireDocumentSource

Deletion/replacement behavior:

1. source version becomes `PURGE_PENDING`
2. source object is tombstoned, making normal lookup unavailable
3. physical object deletion is attempted
4. successful deletion moves the source version to `TOMBSTONED`
5. failed deletion remains `PURGE_PENDING` for later cleanup

This prevents failed physical cleanup from leaving the source logically readable.

## Document domain linkage

`KnowledgeDocument` now has:

`sourceVersionId?: string`

It intentionally does not contain:

- sourceObjectId
- storage backend
- bucket
- object key
- ETag
- SHA-256
- credentials

Older documents remain valid because the field is optional.

## PDF upload flow

In PostgreSQL production mode:

1. request identity resolves account/workspace
2. PDF remains bounded by existing 25 MB / 10-file limits
3. durable source bytes are stored first
4. SourceObject/SourceVersion metadata is committed
5. PDF parsing runs
6. successful document is stored with only `sourceVersionId`
7. same-name prior durable source is retired

### Parse failure

If durable storage succeeds but parsing fails:

- a failed KnowledgeDocument is kept
- it includes the opaque `sourceVersionId`
- it exposes the parse error
- it is reported as retryable

The original PDF remains durable specifically so retry can recover.

If even the failed document cannot be linked into the workspace, the newly stored source is compensated/tombstoned.

## Retry flow

For PostgreSQL documents with `sourceVersionId`:

1. document is marked processing
2. source version is resolved by account + workspace
3. exact object bytes are downloaded
4. size + SHA-256 are verified
5. PDF is parsed again
6. the same document ID and upload timestamp are preserved
7. parsed pages/summary replace the failed/stale derived state

Legacy documents without `sourceVersionId` receive:

`DOCUMENT_SOURCE_NOT_DURABLE`

rather than pretending that a retry happened.

File-mode development preserves the previous compatibility behavior.

## Document deletion/replacement

When a durable document is removed or replaced:

- logical source metadata is tombstoned
- physical bytes are deleted when possible
- failed physical deletion is surfaced as cleanup-pending state

Multiple same-name files in one upload request are handled sequentially with an in-request filename map so each superseded durable source is retired.

## Historical proof advancement

C1/C2 executable guards were updated narrowly:

- C1 now recognizes that document source bytes have progressed to durable source versions
- C1 still guards the remaining Dataset/integration durability debt
- C2 still requires the core byte-storage contract to remain provider-neutral
- C2 still guards Dataset/integration non-cutover

## C3 executable proofs

### Contract/config proof

`scripts/check-production-c3-document-source-contract.ts`

Verifies:

- S3 runtime configuration
- partial credential rejection
- unsupported backend rejection
- S3 SDK dependency
- documented environment variables
- browser domain exposes only sourceVersionId
- store-before-parse ordering
- retryable failed-document behavior
- unlinked-source compensation
- replacement/delete retirement
- retry re-fetch-before-parse ordering
- no provider key/secret exposure in HTTP document paths
- Dataset/integration remain out of scope

### PostgreSQL + durable-source proof

`scripts/check-production-c3-document-source-postgres.ts`

Uses a deterministic in-memory object adapter behind the real provider-neutral contract and real PostgreSQL metadata.

Verifies:

- PDF byte storage
- SourceObject/SourceVersion metadata
- service recreation and byte reload
- account/workspace isolation
- real PDF parsing from reloaded object bytes
- SHA-256/size tamper rejection
- source tombstone + physical delete
- truthful tombstone history
- compensation when workspace metadata ownership fails

No cloud credentials are required in CI.

## Important remaining durability boundary

C3 makes the **original PDF source** durable.

The parsed workspace/document/chat/evaluation payload still uses the existing local workspace payload store.

Therefore C3 does not claim complete stateless application-container recovery yet.

The durable PDF source now provides the authoritative material needed for a later workspace-payload reconstruction/migration slice.

## Validation

Authoritative implementation Quality Gate:

`35757955890`

Verified green:

- TypeScript
- production build
- C1/C2 historical guards
- C3 document-source contract proof
- C3 PostgreSQL durable-source proof
- all Phase 0–8 regression gates
- all previous production-hardening proofs
- PostgreSQL production suite
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Next phase

**C4 — Durable Derived Document Payload + Workspace Reconstruction**

C4 should make parsed document pages/summaries reconstructable after application-container replacement using the durable C3 source version as provenance. Chat history, Specialized AI configuration, evaluation state, Dataset payloads, and integration source snapshots remain separate later slices.
