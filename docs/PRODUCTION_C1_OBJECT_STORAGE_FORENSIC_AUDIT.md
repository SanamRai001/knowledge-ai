# Production C1 — Durable Source File / Object Storage Forensic Audit

Date: **2026-09-22**

Status: **IMPLEMENTED — awaiting integrated Quality Gate validation.**

## Verdict

Knowledge AI has completed the PostgreSQL metadata/runtime cutover, but user content is not yet durable across application-container replacement.

The remaining Track C risk is not one single file store. It is four distinct payload classes:

1. **original uploaded/synchronized source bytes**
2. **derived document payloads**
3. **derived analytical Dataset payloads**
4. **structured workspace state that is currently bundled beside document payloads**

These classes must not be migrated with one blanket “put the JSON file in object storage” solution.

The highest-priority production issue is:

> PostgreSQL can retain metadata that points to payloads or source history that no longer exists after a container replacement.

---

# 1. Current byte-flow inventory

## 1.1 Browser PDF upload

Entry point:

`POST /api/kb/documents/upload`

Current flow:

```text
multipart upload
  ↓
multer.memoryStorage()
  ↓
Buffer (max 25 MiB/file, max 10 files)
  ↓
pdf-parse
  ↓
KnowledgeDocument {
  filename,
  fileSize,
  parsed pages,
  summary,
  ...
}
  ↓
data/knowledge_bases.json
```

### Critical finding

The original PDF bytes are discarded after parsing.

`KnowledgeDocument` does not contain:

- SHA-256
- a durable source object ID
- a source version ID
- an object-storage locator

It stores only metadata such as filename/file size plus parsed page text.

### Consequence

The application cannot faithfully reprocess an uploaded PDF after the original request ends.

The current retry endpoint confirms this limitation:

`POST /api/kb/documents/:id/retry`

does not re-read or re-parse source bytes. It only changes the document status back to `processed`.

### Classification

**MIGRATE — P0 durable source object**

---

# 2. Workspace/document payload boundary

Current payload file:

`data/knowledge_bases.json`

The file contains a mixed aggregate:

- parsed document pages
- document summaries
- KnowledgeVersion document snapshots
- chat history
- Specialized AI configuration
- evaluation test cases
- evaluation runs
- legacy active-workspace state

Workspace identity/metadata and per-account active selection are already PostgreSQL-authoritative.

`WorkspaceRuntimeService.materialize()` explicitly fails with:

`WORKSPACE_PAYLOAD_UNAVAILABLE`

when PostgreSQL workspace metadata survives but the local payload is missing.

## Important architecture decision

Do **not** upload `knowledge_bases.json` as one opaque object and call Track C complete.

Split it by data semantics:

| Payload | Target classification |
|---|---|
| Original PDF bytes | **MIGRATE → object storage** |
| Parsed document pages / summaries | **MIGRATE → durable derived payload or reproducible cache** |
| KnowledgeVersion document snapshots | **MIGRATE → references to immutable document/source versions; do not duplicate full documents** |
| Chat history | **STRUCTURED STATE → relational/domain persistence, not source-object storage** |
| Specialized AI config | **STRUCTURED STATE → relational/domain persistence** |
| Evaluation test cases/runs | **STRUCTURED STATE → relational/domain persistence** |
| Legacy global active ID | **RETIRE/ignore in production; PostgreSQL selection is authoritative** |

### Current failure mode

If the application filesystem is replaced:

- PostgreSQL still knows the workspace exists
- workspace materialization can return HTTP 503
- Ask loses its parsed document corpus
- versions/history depending on document snapshots disappear

### Classification

**MIGRATE — P0 document payload**, plus separate structured-state follow-up.

---

# 3. Dataset upload and source bytes

Entry points use:

`multer.memoryStorage()`

Limits:

- CSV: **10 MiB**
- XLSX: **15 MiB**
- one file per request

Current import flow:

```text
CSV/XLSX Buffer
  ↓
parse
  ↓
DatasetSource metadata:
  filename
  mimeType
  sizeBytes
  sha256
  format
  ↓
DatasetVersion tables/rows
```

### Good existing seam

Dataset source metadata already computes:

- SHA-256
- MIME type
- byte size
- filename
- format

### Critical finding

The original CSV/XLSX source bytes themselves are not retained.

The SHA-256 can prove what the source was, but there is no object that can be retrieved and hashed again.

### Consequence

Re-import/reprocessing with a newer parser or schema inference implementation is impossible without the user/provider supplying the source again.

### Classification

**MIGRATE — P0 durable source object**

---

# 4. Dataset analytical payload

In PostgreSQL mode:

- Dataset metadata is relational
- DatasetVersion metadata is relational
- ImportRun metadata is relational
- each DatasetVersion stores a `payload_backend` + `payload_ref`

Current production payload backend:

`data/dataset_runtime_payloads.json`

Locator:

```text
backend = local-dataset-payload
ref     = <dataset-version-id>
```

The local file contains full `DatasetVersion` payloads including all parsed table rows.

### Current startup dependency

`server.ts` runs:

`await datasetRuntimePersistence.bootstrap()`

before the server listens.

Bootstrap reads PostgreSQL metadata and then resolves every payload locator.

If PostgreSQL survives but `dataset_runtime_payloads.json` is gone, payload resolution throws before the HTTP server is ready.

### Consequence

A container replacement can turn durable Dataset metadata into a startup-blocking missing-payload failure.

### Classification

**MIGRATE — P0 durable analytical payload backend**

This analytical payload is distinct from the original source file.

A later implementation may use JSON, compressed JSON, Parquet, or another analytical representation behind the existing payload repository contract. C1 does not select that format.

---

# 5. Google Drive / OneDrive synchronization

Connectors correctly track durable provider identity:

- connection
- external ID
- external version
- name
- MIME type
- modified time
- provider URL/provenance

Both Google Drive and OneDrive fetch the source into a transient:

`Buffer`

The integration sync then passes:

`record.buffer`

directly into `datasetService.importFile()`.

The downloaded bytes are not snapshotted.

## Current durable state after a successful sync

PostgreSQL can persist:

- connection metadata
- sync run
- cursor
- external import state
- external version/provenance
- internal Dataset ID/version ID

But the imported Dataset's analytical payload remains local and the original provider bytes are gone.

## Critical checkpoint ordering risk

The integration cursor can advance after an import is marked successful even though no durable source snapshot exists.

If the provider later:

- deletes the file
- changes the version
- revokes access
- expires permissions

Knowledge AI cannot necessarily reconstruct the exact imported source version.

### Required later ordering

```text
fetch exact provider version
  ↓
persist immutable source snapshot
  ↓
verify hash/size
  ↓
parse/import
  ↓
persist durable analytical payload
  ↓
commit Dataset + integration import metadata
  ↓
project company knowledge
  ↓
mark import READY
  ↓
advance provider cursor/checkpoint
```

### Classification

**MIGRATE — P0 provider source snapshot before READY/checkpoint**

---

# 6. Sample documents

Sample PDFs are generated deterministically from source code using `pdf-lib`.

They are demonstration/test material, not irreplaceable user uploads.

### Classification

**REGENERABLE / TEST-DEMO — no production object durability requirement**

If a sample is attached to a real workspace, its parsed/document association still follows the same durable document-payload model as any other document.

---

# 7. Development and legacy file adapters

Current ignored `data/` files include:

- `knowledge_bases.json`
- `datasets.json`
- `dataset_runtime_payloads.json`
- other legacy/development runtime stores

`.gitignore` explicitly describes `data/` as mutable application state recreated by runtime stores.

### Decision

Local JSON adapters may remain useful for local development and migration fixtures.

They are **not** acceptable production durability targets.

### Classification

**KEEP FOR DEV / LEGACY MIGRATION ONLY**

---

# 8. Payload classification matrix

| Payload family | Current location | Durable after container replacement? | C1 classification | Priority |
|---|---|---:|---|---:|
| Uploaded PDF source bytes | request memory only | No | MIGRATE → source object | P0 |
| Parsed PDF pages/summary | `knowledge_bases.json` | No | MIGRATE → derived document payload / rebuildable cache | P0 |
| Full document copies in KnowledgeVersion | `knowledge_bases.json` | No | REPLACE with immutable refs | P0 |
| Chat history | `knowledge_bases.json` | No | STRUCTURED/RELATIONAL, not object-source storage | P1 |
| Specialized AI config | `knowledge_bases.json` | No | STRUCTURED/RELATIONAL | P1 |
| Evaluation cases/runs | `knowledge_bases.json` | No | STRUCTURED/RELATIONAL | P1 |
| Uploaded CSV/XLSX source bytes | request memory only | No | MIGRATE → source object | P0 |
| Dataset source metadata/hash | PostgreSQL | Yes | KEEP relational | — |
| Dataset parsed tables/rows | `dataset_runtime_payloads.json` | No | MIGRATE → durable analytical payload backend | P0 |
| Integration provider provenance | PostgreSQL | Yes | KEEP relational; later link source version | — |
| Drive/OneDrive fetched source bytes | request memory only | No | MIGRATE → immutable provider snapshot | P0 |
| Sample PDF generator source | repository code | Yes/rebuildable | TEST/DEMO | — |
| OAuth credentials | encrypted local credential store today | separate secret-hardening concern | SECRET MANAGER, not object Track C | separate |
| RAG/Cognitive telemetry | memory | intentionally ephemeral | EPHEMERAL | — |

---

# 9. Provider-neutral SourceObject / SourceVersion contract

C1 does not choose S3, R2, GCS, Azure Blob, or another provider.

The next implementation should be provider-neutral.

## SourceObject

Logical source identity:

```text
SourceObject
  id
  accountId
  workspaceId? / owning domain scope
  kind: DOCUMENT | DATASET_SOURCE
  origin: UPLOAD | GOOGLE_DRIVE | MICROSOFT_ONEDRIVE | GENERATED
  externalConnectionId?
  externalId?
  status: ACTIVE | TOMBSTONED
  createdAt
  updatedAt
```

## SourceVersion

Immutable byte snapshot:

```text
SourceVersion
  id
  accountId
  sourceObjectId
  externalVersion?
  originalFilename
  contentType
  sizeBytes
  sha256
  storageBackend
  storageKey
  storageEtag?
  createdAt
  retentionState: ACTIVE | TOMBSTONED | PURGE_PENDING
```

### Required integrity rules

- `sha256` is required for every immutable source version
- size is verified after write
- storage keys are generated by the server, never trusted from a client
- source version IDs are immutable
- external provider version is metadata, not the durable storage identity
- no cross-account object lookup
- no public-bucket assumption
- hard deletion is retention-controlled, not coupled directly to UI unlink/delete actions

---

# 10. Tenant namespace and authorization

A safe provider-neutral key shape may conceptually resemble:

```text
accounts/<accountId>/sources/<sourceObjectId>/versions/<sourceVersionId>
```

The exact provider key format is not an API contract.

Authorization must be:

```text
HUMAN_SESSION / API_KEY identity
  ↓
account/workspace ownership lookup in application database
  ↓
SourceVersion metadata
  ↓
storage adapter get/stream
```

Do not allow:

- arbitrary object-key parameters
- public buckets
- guessable filename-based authorization
- provider URLs as authorization
- cross-tenant global deduplication that leaks existence

Signed URLs, if added later, should be short-lived and issued only after the normal authorization boundary succeeds.

---

# 11. Domain links required later

A durable source version should be referenced from the domain record that consumed it.

Minimum future relationships:

### Documents

`KnowledgeDocument.sourceVersionId`

The document's parsed payload should separately identify the parse/derived version.

### Datasets

`DatasetVersion.sourceVersionId`

Keep the existing analytical payload locator separate:

`DatasetVersionMetadata.payload`

Raw source and parsed analytical payload solve different problems.

### Integrations

`integration_external_imports.source_version_id`

This binds the exact external provider version to the exact immutable bytes imported.

---

# 12. Deletion / tombstone policy

A UI “remove document” or provider tombstone must not immediately hard-delete source history needed by:

- immutable Dataset/Knowledge versions
- audit/provenance
- rollback
- reproducibility

Initial model:

```text
ACTIVE
  ↓ unlink / provider deletion
TOMBSTONED
  ↓ retention policy / no remaining references
PURGE_PENDING
  ↓ storage + metadata purge
deleted
```

C1 does not define retention duration.

---

# 13. Migration ordering recommendation

Track C should proceed in small slices.

## C2 — Source Object Metadata + Storage Abstraction Foundation

- PostgreSQL `source_objects` / `source_versions`
- provider-neutral storage repository interface
- tenant-safe key builder
- integrity/hash contract
- no production cloud provider required yet
- executable ownership/isolation proof

## C3 — Durable Object Backend + Document Source Migration

- configure one production object backend
- upload PDF source bytes before parsing
- persist source version IDs
- make retry actually re-read source bytes
- migrate document derived payload boundary

## C4 — Dataset Source + Analytical Payload Durability

- persist CSV/XLSX source version
- replace `local-dataset-payload`
- keep relational Dataset metadata authoritative
- prove restart/container replacement reconstruction

## C5 — Integration Snapshot / Checkpoint Hardening

- source snapshot before import READY
- source snapshot before cursor advancement
- historical provider version provenance
- tombstone/retention behavior

Structured chat/config/evaluation state should get its own relational hardening slice rather than being hidden inside C2 object blobs.

---

# 14. C1 exit criteria

C1 is audit-only and is complete when:

- every current user-source byte path is inventoried
- current local/container durability boundaries are explicit
- source bytes are distinguished from derived analytical/document payloads
- structured workspace state is not misclassified as object-source data
- integration checkpoint risk is documented
- a provider-neutral SourceObject/SourceVersion contract is defined
- ownership, retrieval, deletion, and retention constraints are defined
- an executable audit-drift proof captures the current known boundaries
- integrated Quality Gate remains green

C1 does **not** select or integrate an object-storage provider.
