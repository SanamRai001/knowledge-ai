# Production C4 — Durable Derived Document Payload + Workspace Reconstruction

Status: **COMPLETE** — authoritative implementation Quality Gate `35762662087`.

## Goal

C4 removes parsed PDF pages/summaries from the local-only durability boundary.

C3 made the original PDF bytes durable.

C4 makes the **derived document corpus** durable and reconstructable while intentionally leaving chat history, Specialized AI configuration, and evaluation state on their existing structured-state boundary.

## Migration 010

Added:

`server/persistence/migrations/010_document_derived_payloads.sql`

The `document_derived_payloads` table stores relational metadata for each rebuildable parsed document payload:

- account
- workspace
- document ID
- immutable C3 sourceVersionId
- parser/derivation version
- filename/content type/source size
- processing state/error state
- page count
- storage backend/key
- payload byte size
- payload SHA-256
- current-vs-historical authority
- timestamps

Database constraints enforce:

- account ownership
- account/workspace ownership
- account/source-version ownership
- unique document/source/derivation identity
- unique physical payload locator
- valid SHA-256/size/state values

## Durable derived payload format

Added:

`server/storage/documentDerivedPayloadService.ts`

Current derivation identity:

`pdf-parse-v1`

Each durable object contains a versioned JSON envelope around the existing `KnowledgeDocument`.

The object key is server generated and tenant namespaced:

`accounts/<account>/workspaces/<workspace>/documents/<document>/derived/<derivation>/<write>.json`

Client filenames never determine object keys.

Before and after storage, payload integrity is verified using:

- byte size
- SHA-256

Provider credentials remain in the C3 runtime configuration boundary and never enter document state.

## Authoritative PostgreSQL document corpus

In PostgreSQL mode, once a workspace has C4 derived payload records, that durable store becomes authoritative for the current document corpus.

`WorkspaceRuntimeService` now:

1. checks whether a workspace has durable document payloads
2. loads current durable payload metadata
3. downloads and integrity-checks exact parsed payload bytes
4. hydrates `kbStore` compatibility state
5. returns the hydrated workspace

This means deleting/losing the local **document array** no longer loses the parsed PDF corpus.

The local JSON store remains a temporary compatibility carrier for other structured workspace state.

## Unified Ask integration

`server/querying/unifiedQueryService.ts` now resolves document workspaces through:

`workspaceRuntimeService.requireKB(...)`

rather than directly through the file-backed access service.

Therefore normal `POST /api/query/ask` document requests hydrate the durable parsed document corpus before the existing grounding engine reads it.

The grounding engine itself was not rewritten.

## Document lifecycle

### Add / successful retry

For PostgreSQL documents with C3 sourceVersionId:

1. parsed document JSON is serialized
2. durable object is written and verified
3. derived relational metadata is upserted
4. an opaque `derivedPayloadId` is attached to the document
5. local compatibility state mirrors the durable document

### Failed parse

C3 failed/retryable documents also receive a C4 derived payload record containing their failure state.

### Status transitions

Processing/failed/processed status changes are persisted into the durable derived payload before local state is updated.

### Replacement

When a same-name document replaces an older document:

- the new derived payload becomes current
- the old derived payload becomes historical/inactive
- its parsed payload is retained for version history

### Removal

Removing a current document marks its derived payload inactive rather than deleting historical parsed bytes.

Original C3 source-byte retirement behavior remains separate.

## KnowledgeVersion de-duplication

Added:

`KnowledgeVersionDocumentRef`

Durable documents in newly created versions now store:

- documentId
- filename
- sourceVersionId
- derivedPayloadId

instead of embedding full parsed pages/summaries repeatedly.

Legacy/non-durable documents remain in the optional legacy `documents` array for backward compatibility.

This preserves compatibility while stopping new C4 documents from multiplying their page payload across snapshots.

## Historical version queries

`specializedAIService` now resolves `documentRefs` through the durable derived payload service when a historical version is requested.

An intentionally empty version remains empty rather than silently falling back to current documents.

## Durable rollback

For C4 versions, rollback:

1. switches PostgreSQL current derived-payload authority to the target version refs
2. downloads and validates those exact payloads
3. restores them into compatibility state
4. updates version-current flags/current version tag
5. re-materializes through the durable workspace runtime

Historical payload bytes remain available even after later document replacement.

## Scope boundary

C4 intentionally does **not** make the entire workspace stateless.

Still outside C4:

- chat history
- Specialized AI configuration
- evaluation test cases/runs
- Dataset CSV/XLSX source bytes
- Dataset analytical row payloads
- Google Drive / OneDrive immutable source snapshots
- integration checkpoint transaction hardening
- workers/queues
- Track D workflows

If the whole local workspace shell is lost, the document corpus remains durable, but the runtime still reports that the remaining structured workspace payload is unavailable instead of fabricating replacement AI configuration/chat/evaluation state.

That limitation is deliberate and truthful.

## Historical proof advancement

C1 was advanced narrowly:

- original PDFs remain durable from C3
- parsed document payloads are now durable from C4
- local `knowledge_bases.json` is still explicitly identified as temporary structured-state compatibility storage
- Dataset/integration durability debt remains guarded

C2 and C3 contracts remain unchanged.

## C4 executable proofs

### Contract proof

`scripts/check-production-c4-derived-document-contract.ts`

Verifies:

- migration 010 ownership/integrity schema
- opaque derived payload IDs
- derivation versioning
- generated tenant-safe storage keys
- payload integrity verification
- authoritative workspace hydration
- Unified Ask runtime hydration
- version refs rather than full durable document copies
- historical ref resolution
- Dataset/integration non-cutover

### PostgreSQL reconstruction proof

`scripts/check-production-c4-derived-document-postgres.ts`

Using real PostgreSQL and a deterministic in-memory object backend behind the real storage contract, verifies:

- migration 010
- durable derived payload creation
- opaque derivedPayloadId assignment
- KnowledgeVersion ref-only snapshot for durable documents
- local document-array deletion
- reconstruction from durable parsed payload
- cross-account denial
- tamper detection
- same-name replacement authority
- second version snapshot
- rollback to the first durable version
- exact parsed-page recovery after rollback

## Validation

Authoritative implementation Quality Gate:

`35762662087`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression gates
- all prior production-hardening guards
- C1/C2/C3 historical guards
- C4 contract proof
- C4 PostgreSQL reconstruction proof
- PostgreSQL production suite
- unseen-corpus benchmark
- live Gemini benchmark

## Next phase

**C5 — Dataset Source + Analytical Payload Migration**

C5 should move both original CSV/XLSX source bytes and DatasetVersion analytical row payloads off request/local JSON durability boundaries while preserving PostgreSQL Dataset metadata as authoritative.

Drive/OneDrive immutable provider snapshots and cursor/checkpoint ordering remain for the following integration-focused slice.
