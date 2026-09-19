# Knowledge AI — Phase 6 Progress

Last updated: **2026-09-18**

## Status

# ✅ PHASE 6 COMPLETE

Phase 6 connects Knowledge AI to external systems without creating isolated provider-specific data silos.

## Goal

> Reduce manual uploads by synchronizing external company sources through one permission-aware, provenance-preserving, incremental connector architecture.

## Execution slices

```text
6A Integration foundation / connector contract          COMPLETE
6B First live cloud-file connector                      COMPLETE
6C Second connector on the same abstraction             COMPLETE
6D Sync/retry/revocation/permission hardening           COMPLETE
6E Integrations UI + final Phase 6 audit                IN PROGRESS
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


## Phase 6B verification

Quality Gate `35421434768` passed the first live-provider connector.

Google Drive implementation now verifies:

- Google OAuth 2.0 web-server authorization flow
- server-side single-use OAuth state with expiry
- `drive.file` per-file scope rather than broad Drive-wide read access
- offline access / refresh-token lifecycle
- encrypted AES-256-GCM integration credential vault
- Google client secret remains environment-only
- normal IntegrationConnection/API records contain only an opaque credential reference
- snapshot-safe initial sync: start-page token captured before file discovery
- accessible CSV discovery and binary download
- Google Sheets discovery and XLSX export
- stable external file/version provenance
- incremental `changes.list` cursor progression
- removed Drive files become external tombstones
- expired access tokens refresh automatically
- changed Drive versions append to the existing internal Dataset
- disconnect deletes local OAuth credentials and attempts Google token revocation
- disconnected connections fail closed
- OAuth-state replay is rejected
- foreign accounts cannot inspect/disconnect/sync another account's Drive connection
- TypeScript, production build, all Phase 0–6A gates, unseen benchmark, and live Gemini benchmark remain green

### Google Drive scope boundary

The connector intentionally uses `https://www.googleapis.com/auth/drive.file`.

This follows Google's narrower per-file access model. A future Integrations UI should use Google Picker so users explicitly choose which files Knowledge AI may continuously synchronize.

The connector does not request `drive.readonly` by default.

## Current exact next work

**Phase 6C — Microsoft OneDrive connector on the same abstraction**

1. verify current Microsoft identity-platform delegated OAuth and Graph Drive delta behavior
2. reuse the encrypted credential vault and OAuth-state pattern
3. implement least-privilege delegated OneDrive read access with offline refresh
4. implement initial/delta file discovery
5. download CSV/XLSX through Microsoft Graph
6. feed records through the existing Phase 6A sync engine
7. add deterministic mocked Microsoft Graph acceptance proof
8. only then begin Phase 6D hardening / permissions / revocation edge cases


## Phase 6C verification

Quality Gate `35421700960` passed the second real provider on the shared integration architecture.

Microsoft OneDrive implementation verifies:

- Microsoft identity-platform authorization-code flow
- delegated `Files.Read` permission plus `offline_access`
- S256 PKCE on the server-side authorization flow
- single-use account-bound OAuth state
- encrypted access/refresh-token storage using the same Phase 6 credential vault
- Microsoft app client secret remains environment-only
- initial OneDrive hierarchy enumeration through Microsoft Graph delta
- persistent `@odata.deltaLink` cursor
- incremental delta synchronization
- CSV and XLSX download through Graph `driveItem /content`
- folders/non-file records ignored by the structured connector
- stable eTag/cTag/date external version provenance
- changed OneDrive versions append to the same internal Dataset
- removed items create external tombstones
- expired access tokens refresh automatically
- rotated Microsoft refresh tokens replace the previous stored refresh token
- stored delta cursors are origin/path validated before any HTTP request, blocking cursor-based SSRF
- disconnect deletes local encrypted OAuth material and fails closed
- foreign accounts cannot inspect/disconnect/sync another account's OneDrive connection
- TypeScript, production build, all prior Phase 0–6B proofs, unseen benchmark, and live Gemini benchmark remain green

### Two-provider architecture checkpoint

Phase 6 now has two real connector implementations sharing the same foundation:

```text
GoogleDriveConnector ─┐
                      ├─ IntegrationConnector
OneDriveConnector ────┘
                              ↓
                    IntegrationConnection
                              ↓
                          SyncRun
                              ↓
                   external import map
                              ↓
                    Dataset ingestion
                              ↓
                  Living Company Knowledge
```

The connector abstraction is therefore no longer proven only by a synthetic test provider.

## Current exact next work

**Phase 6D — sync/revocation/permission hardening**

Focus on cross-provider operational behavior rather than adding another provider:

1. classify connector failures into retryable vs non-retryable categories
2. add bounded automatic retry/backoff metadata to SyncRun
3. handle expired/invalid provider cursors with explicit recovery states instead of silent full-resync
4. strengthen connection ERROR → reconnect/re-authorize lifecycle
5. model external deletion/revocation visibility more explicitly
6. verify permission loss and token-revocation behavior for both Google and Microsoft
7. add sync concurrency/idempotency protection so two workers cannot process the same connection simultaneously
8. add retention/observability for sync failures
9. then build the Phase 6E Integrations UI and final Phase 6 audit


## Phase 6D verification

Quality Gate `35422900472` passed the cross-provider hardening slice.

Verified:

- shared failure categories: AUTHORIZATION, PERMISSION, RATE_LIMIT, TRANSIENT, CURSOR_INVALID, DATA_INVALID, UNSUPPORTED, CONFLICT, UNKNOWN
- retryable vs non-retryable failure metadata on SyncRun
- bounded exponential retry/backoff for transient and rate-limit failures
- provider checkpoint remains frozen across failed attempts
- checkpoint advances only after successful sync completion
- exhausted retries become observable ERROR/SYNC_FAILED state
- explicit failure category, attempt count, and retryability remain in sync history
- expired/invalid provider cursors become ERROR/CURSOR_RESET_REQUIRED rather than silently forcing a full resync
- explicit cursor reset clears the broken checkpoint and permits a new snapshot
- generic resume cannot bypass reauthorization/permission/cursor recovery states
- per-connection persisted sync lease
- overlapping sync requests are rejected with SYNC_ALREADY_RUNNING
- public API exposes only syncInProgress, never the internal lease identifier
- expired leases can be reclaimed after worker/process loss
- Google Drive 403 permission loss becomes ERROR/PERMISSION_LOST
- OneDrive 403 permission loss becomes ERROR/PERMISSION_LOST
- Google Drive reauthorization repairs the same IntegrationConnection ID
- OneDrive S256-PKCE reauthorization repairs the same IntegrationConnection ID
- reauthorization preserves provider cursor/import history
- superseded encrypted OAuth credentials are deleted
- TypeScript, production build, all Phase 0–6C proofs, unseen benchmark, and live Gemini benchmark remain green

## Current exact next work

**Phase 6E — Integrations UI + final Phase 6 exit gate**

1. add Integrations as a first-class product workspace
2. expose Google Drive and Microsoft OneDrive connection flows
3. expose real connection health/status/attention state
4. expose Sync now, pause/resume, reauthorize, explicit cursor reset, and disconnect
5. expose sync-run history and imported external sources/provenance
6. integrate Google Picker for explicit drive.file file sharing before sync
7. improve browser OAuth callback UX so successful authorization returns to the Integrations workspace
8. add an executable Integrations UI contract proof
9. run the full Quality Gate
10. create `docs/PHASE_6_FINAL_AUDIT.md`
11. advance the master handoff to Phase 7 only after the complete integrated gate is green


## Phase 6E verification

Quality Gate `35423633294` passed the final Phase 6 slice and complete integrated gate.

Verified:

- Integrations is a first-class navigation workspace
- Google Drive and Microsoft OneDrive connect through real backend OAuth start routes
- browser OAuth callbacks return to the Integrations workspace
- real persisted connection state is shown
- ACTIVE / PAUSED / REVOKED / ERROR state is visible
- REAUTHORIZE / PERMISSION_LOST / CURSOR_RESET_REQUIRED / SYNC_FAILED attention states are visible
- Sync now / Pause / Resume / Reauthorize / Reset checkpoint / Disconnect are wired to real APIs
- sync-run history is visible
- attempt/failure information is visible
- imported external versions and provider provenance are visible
- external provider source links are surfaced where available
- official Google Workspace Drive Picker React wrapper is integrated
- Picker uses public Vite configuration only
- provider OAuth tokens/secrets are not stored by the frontend
- TypeScript and production build pass
- all Phase 0–6D regressions pass
- unseen-corpus and live Gemini benchmarks remain green

## Final exit decision

Phase 6 satisfies its exit gate.

See:

`docs/PHASE_6_FINAL_AUDIT.md`

## Next phase

**Phase 7 — Controlled Automation**

Continue from:

`docs/PHASE_7_PROGRESS.md`
