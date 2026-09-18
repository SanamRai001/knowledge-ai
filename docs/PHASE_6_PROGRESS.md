# Knowledge AI — Phase 6 Progress

Last updated: **2026-09-18**

## Status

# 🚧 PHASE 6 IN PROGRESS

Phase 6 connects Knowledge AI to external systems without creating isolated provider-specific data silos.

## Goal

> Reduce manual uploads by synchronizing external company sources through one permission-aware, provenance-preserving, incremental connector architecture.

## Execution slices

```text
6A Integration foundation / connector contract          IN PROGRESS
6B First live cloud-file connector                      NOT STARTED
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
