# Knowledge AI — Production A4 PostgreSQL Watch + Integrations

Date: **2026-09-19**

## Verdict

# ✅ PRODUCTION HARDENING A4 COMPLETE

A4 moves Watch scheduling state and Integration synchronization metadata behind PostgreSQL repository/transaction boundaries.

Authoritative integrated workflow:

- **Quality + PostgreSQL:** `35458772829`
- **Result:** PASS

The PostgreSQL job passed A2, A3, and A4 sequentially against PostgreSQL 16.

## Migration

`server/persistence/migrations/003_watch_integrations.sql`

Relationalized:

### Watch

- WatchRule
- WatchDraft
- WatchEvaluation
- WatchAlert
- WatchJob

### Integrations

- IntegrationConnection metadata
- SyncRun
- ExternalImportState

OAuth credential bytes remain outside ordinary relational metadata.

## Database-enforced guarantees

A4 verifies:

- explicit account ownership on Watch/Integration rows
- Watch schedule fingerprint uniqueness
- account-safe Watch rule/evaluation/alert/job relationships
- concurrent ready-job claim semantics
- external-version uniqueness for integration imports
- same-account SyncRun → IntegrationConnection relationships
- provider-aware connection ownership
- no OAuth access-token / refresh-token / client-secret columns in integration metadata

## Transaction boundaries

### Watch worker claim

The PostgreSQL repository supports atomic ready-job claim behavior so multiple workers cannot claim the same Watch job simultaneously.

### Integration checkpoint

The successful checkpoint transaction commits together:

```text
external imports
+ SyncRun completion
+ provider cursor advancement
= one PostgreSQL transaction
```

The transaction uses the expected prior cursor.

If another writer already advanced the cursor, the stale checkpoint commit fails and rolls back its imports/run mutations.

## Legacy migration

`server/persistence/a4LegacyImporter.ts`

Supported legacy sources:

- `data/watch.json`
- `data/integrations.json`

Properties:

- dry-run capable
- preserves IDs
- validates account/relationship ownership
- idempotent on repeat
- source JSON remains unchanged
- semantic comparison follows JSON semantics, including treating omitted optional properties and adapter-materialized `undefined` equivalently
- encrypted integration credential-file contents are not migrated into relational metadata

The normal migration CLI now runs A4 after A2 and A3.

## Important boundary

A4 does **not** claim production secret storage is complete.

`IntegrationConnection.credentialRef` may be persisted as opaque metadata, but OAuth secret bytes remain a separate Track F/KMS concern.

## Next

**Production Hardening A5 — Automation + Platform state**

Relationalize:

- AutomationPolicy + immutable revisions
- AutomationApproval
- AutomationControl + immutable revisions
- AutomationRun
- DomainPackInstallation
- ToolInvocationAudit

Prioritize the emergency automation kill-switch and policy revision transaction boundary.
