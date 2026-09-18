# Knowledge AI — Phase 6 Progress

Last updated: **2026-09-18**

## Status

# 🚧 PHASE 6 IN PROGRESS

Phase 6 connects Knowledge AI to external systems without creating isolated provider-specific data silos.

## Goal

> Reduce manual uploads by synchronizing external company sources through one permission-aware, provenance-preserving, incremental connector architecture.

## Execution slices

```text
6A Integration foundation / connector contract          COMPLETE
6B First live cloud-file connector                      IN PROGRESS
6C Second connector on the same abstraction             NOT STARTED
6D Sync/retry/revocation/permission hardening           NOT STARTED
6E Integrations UI + final Phase 6 audit                NOT STARTED
```

## Non-negotiable architecture

Every connector must map into the same concepts:

```text
External provider
      ↓
IntegrationConnector
      ↓
IntegrationConnection
      ↓
SyncRun + cursor/checkpoint
      ↓
External record/source identity
      ↓
existing Knowledge AI ingestion
      ↓
Source / SourceVersion / Dataset / Document
      ↓
Company Knowledge / Insights / Actions / Watch
```

Do not create one-off provider stores that bypass provenance, account isolation, or existing ingestion.

## Phase 6A — Integration foundation

### Required contracts

Introduce durable/account-scoped concepts such as:

- `IntegrationConnection`
- `IntegrationProvider`
- `IntegrationConnector`
- `SyncRun`
- `SyncCursor` / checkpoint
- `ExternalSourceRef`
- connection status / revocation state

### Connector interface direction

A connector should provide bounded operations such as:

```text
capabilities()
validateConnection()
listChanges(cursor)
fetchRecord(recordRef)
normalizeRecord()
healthCheck()
```

Provider credentials must not leak into ordinary persisted metadata or API responses.

### Sync requirements

The common sync engine must support:

- account isolation
- incremental cursor/checkpoint
- idempotent record/version import
- retryable SyncRun state
- safe disconnection/revocation
- source deletion/tombstone representation where supported
- exact provider/external-record provenance
- visible last successful sync
- visible last failure

### Ingestion boundary

Connector output should reuse the existing trusted ingestion paths.

Examples:

- external CSV/XLSX → Dataset / DatasetVersion
- external supported document → existing document/source ingestion
- later communication records → normalized Source/SourceVersion before knowledge projection

The connector layer is responsible for obtaining and identifying external records.

It is not a second analytics/knowledge system.

## Initial provider progression

Preferred order:

1. cloud-file connector — Google Drive is a reasonable first candidate
2. spreadsheet connector — Google Sheets is a reasonable second candidate
3. communications after the abstraction is proven
4. database/business-system connectors later

Do not require two real OAuth providers before the shared foundation itself is tested.

## Phase 6A executable proof target

Before live provider work, CI should prove with a deterministic test connector that:

- the same external record is not imported twice for the same external version
- a changed external version creates a new internal source/dataset version
- the sync cursor advances only after successful processing
- failed sync does not silently advance the checkpoint
- retry resumes safely
- foreign accounts cannot inspect/use another account's connection
- revoked connections cannot sync
- provider secrets are absent from persisted/API-visible connection metadata
- provenance preserves provider + external resource identity

## Phase 6 exit gate

Phase 6 is complete only when:

- at least two integrations use the same connector abstraction
- sync is incremental and recoverable
- provenance identifies the external record/source
- disconnected/revoked integrations fail safely
- authorization boundaries are executable
- the Integrations UI exposes real connection/sync state

## Current exact next work

**Phase 6A — shared connector foundation**

Start by auditing the current Source/Dataset/Document ingestion boundaries, then define the smallest common connector model and an in-memory/file-backed test connector. Add the integration proof to CI before implementing Google Drive or another live provider.


## Phase 6A verification

Quality Gate `35377306001` passed the shared integration foundation.

Verified:

- one shared `IntegrationConnector` contract
- account-scoped `IntegrationConnection`
- durable `SyncRun` history
- external-record/version provenance
- persisted external → internal import mappings
- incremental cursor/checkpoint semantics
- exact external-version idempotency
- changed external versions append to the same internal Dataset
- successful records from a partially failed sync remain reusable
- failed sync does not advance the connection checkpoint
- retry skips already completed external versions and resumes safely
- structured connector records reuse `datasetService.importFile()`
- imported structured versions automatically project into Living Company Knowledge
- external import readiness is resumable through `INGESTED → READY`
- revoked connections fail closed and cannot be normally resumed
- integration APIs use authoritative request identity
- foreign accounts cannot inspect or trigger another account's sync
- API-safe connection DTOs omit credential references
- integration metadata contains no raw access-token / refresh-token / client-secret fields
- TypeScript, production build, all Phase 0–5 gates, unseen benchmark, and live Gemini benchmark remain green

### Current structured ingestion boundary

Phase 6A intentionally imports CSV/XLSX through the common engine first.

The connector contract is resource-type agnostic, but unsupported external document types fail explicitly rather than entering a half-implemented parallel document pipeline.

## Current exact next work

**Phase 6B — Google Drive cloud-file connector**

1. verify current Google OAuth 2.0 and Drive API v3 behavior from official documentation
2. add a secret-store boundary separate from IntegrationConnection metadata
3. add server-side OAuth state handling
4. implement Google Drive read-only connection flow
5. implement initial file discovery + incremental changes cursor
6. download CSV/XLSX directly and export Google Sheets to XLSX
7. feed records through the existing Phase 6A sync engine
8. add deterministic HTTP-mocked connector tests plus optional live smoke test when credentials are configured
9. then proceed to a second connector through the same abstraction
