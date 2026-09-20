# Knowledge AI — Production A7B Integration Runtime Cutover

Date: **2026-09-20**

## Verdict

# ✅ A7B COMPLETE

Production-mode Integration runtime now selects PostgreSQL when:

`KNOWLEDGE_AI_PERSISTENCE_MODE=postgres`

while file-mode development and the historical Phase 6 regression suite remain supported.

Authoritative integrated workflow:

- **Workflow:** `35517514449`
- **Quality job:** PASS
- **PostgreSQL A2→A7B job:** PASS
- **Live Gemini benchmark:** PASS

## Runtime boundary

The existing Phase 6 file-backed `integrationSyncService` remains intact for local/file-mode behavior.

Production-facing Integration paths now use:

- `server/integrations/integrationPersistence.ts`
- `server/integrations/integrationRuntimeService.ts`
- `server/persistence/a4PostgresRepositories.ts`

When PostgreSQL mode is disabled, the selected persistence layer delegates to the existing `integrationStore`.

When PostgreSQL mode is enabled, non-secret Integration state is read and written through the A4 PostgreSQL repositories.

## Cut-over entry points

Normal runtime paths now select the production Integration backend:

- Integration connection list/detail
- sync-run history
- external-import history
- manual sync
- pause
- resume
- cursor reset
- revoke
- Google Drive OAuth connection creation/reauthorization metadata
- Google Drive health/disconnect metadata
- Microsoft OneDrive OAuth connection creation/reauthorization metadata
- Microsoft OneDrive health/disconnect metadata

OAuth token bytes remain in the encrypted credential vault and are deliberately outside ordinary relational Integration metadata.

## PostgreSQL state

A7B routes these durable records through PostgreSQL:

- `IntegrationConnection`
- `SyncRun`
- `ExternalImportState`

The existing A4 transaction owns a successful checkpoint:

```text
ExternalImportState upserts
        +
SyncRun completion
        +
expected current cursor check
        +
IntegrationConnection cursor advance
        =
one PostgreSQL transaction
```

A stale expected cursor aborts the transaction rather than silently advancing from an outdated checkpoint.

## Atomic sync lease

A7B extends the A4 Integration repository with atomic lease operations.

Lease acquisition is one conditional PostgreSQL UPDATE:

```text
acquire only when:
  no lease
  OR no expiry
  OR lease expired
```

Concurrent acquisition for the same connection returns no row and becomes `SYNC_ALREADY_RUNNING`.

Lease identity is never exposed through the public Integration connection DTO; clients see only `syncInProgress`.

## External structured payload boundary

A7B does **not** move Dataset payload rows/source bytes into PostgreSQL.

The existing structured ingestion path remains authoritative:

```text
external provider
    ↓
Integration runtime
    ↓
datasetService.importFile()
    ↓
existing Dataset / DatasetVersion payload path
```

Only Integration metadata/checkpoints are cut over in A7B.

Durable source/object payload migration remains part of the separate object-storage/payload hardening track.

## Living Knowledge projection bridge

Structured Integration imports still execute the existing Phase 3 projection behavior.

Because `integration_external_imports.knowledge_projection_run_id` is a relational foreign key, A7B also persists the returned `KnowledgeProjectionRun` metadata through the existing A3 PostgreSQL repository in PostgreSQL mode.

This is a bounded bridge for relational provenance.

It does **not** claim the full Living Knowledge runtime has been cut over yet.

## Executable proof

`scripts/check-production-a7b-integration-runtime.ts`

The real PostgreSQL test verifies:

1. normal Integration HTTP reads a PostgreSQL-created connection
2. normal HTTP sync writes a durable SyncRun
3. successful checkpoint advances the PostgreSQL cursor
4. successful checkpoint releases the PostgreSQL lease
5. external import/version/projection identity is stored relationally
6. existing structured Dataset payload behavior remains intact
7. foreign account cannot read another account connection by raw ID
8. foreign account cannot trigger another account sync
9. PostgreSQL pool/service reconstruction preserves connection/run/import state
10. a changed external version resumes from the durable cursor
11. changed versions append to the same internal Dataset identity
12. PostgreSQL lease acquisition blocks an overlapping lease atomically
13. public state reports `syncInProgress` without leaking lease ID
14. failed sync state is durably visible in PostgreSQL
15. recoverable `SYNC_FAILED` state can be resumed
16. `data/integrations.json` remains byte-for-byte unchanged throughout production-mode operations

## Regression safety

Workflow `35517514449` also passed the complete file-mode product suite:

- Phase 0–8 trust/product gates
- Google Drive integration proof
- OneDrive integration proof
- Integration retry/cursor/concurrency hardening proof
- Integrations UI proof
- automation/platform proofs
- TypeScript
- production build
- unseen-corpus benchmark
- live Gemini benchmark

This confirms that introducing the production runtime selector did not remove the existing local/file-mode development path.

## Important limitations

### Secret storage

A7B does not move OAuth secret bytes into PostgreSQL.

That is intentional.

The current encrypted credential vault remains a separate boundary until Production Track F introduces production KMS/secret storage.

### Dataset payloads

The dataset metadata/payload split is not fully production-complete.

Integration runtime can now persist its own synchronization metadata relationally, but imported structured payloads still use the existing Dataset payload path.

### Full Living Knowledge runtime

Only projection-run metadata needed for Integration relational provenance is mirrored into PostgreSQL here.

Entities, claims, relationships, and events still await their normal production runtime cutover.

### Distributed sync scheduling

A7B provides a database-backed per-connection lease for normal Integration sync concurrency.

It does not yet introduce an external distributed queue/worker service.

## Next slice

# Production Hardening A7C — Watch runtime PostgreSQL cutover

Watch is the next production runtime target because A4 already provides relational:

- WatchRule
- WatchDraft
- WatchEvaluation
- WatchAlert
- WatchJob
- schedule fingerprint uniqueness
- atomic ready-job claim

The A7C target is:

```text
normal Watch HTTP
      +
Watch scheduler
      ↓
selected Watch persistence
      ↓
PostgreSQL rules / evaluations / alerts / jobs
      ↓
atomic database job claim
```

while preserving the existing file-mode Watch suite for local development and regression coverage.
