# Knowledge AI — Production Hardening A2 Final Record

Date: **2026-09-19**

## Verdict

# ✅ A2 COMPLETE

A2 establishes the first production PostgreSQL vertical slice without forcing a big-bang runtime cutover.

## Authoritative workflow

`35435257972`

Both jobs passed:

- full product `quality`
- isolated `Production A2 PostgreSQL`

## What is relational now as a proven adapter layer

- accounts
- workspace metadata
- per-account active workspace selection
- API-key metadata
- API usage
- Dataset metadata
- DatasetVersion metadata/provenance
- Dataset import-run metadata

## What deliberately remains outside migration 001

- parsed document/page bodies
- chat history
- KnowledgeVersion document snapshots
- Dataset cell/row payloads
- Living Company Knowledge
- Actions
- Watch
- Integrations
- Automation
- OAuth secret material

## Migration safety

Migration 001 is versioned and checksum protected.

The PostgreSQL proof verifies:

- empty-database migration
- repeat migration no-op
- account isolation
- relational Dataset current-version ownership
- cross-account DatasetVersion/import-run rejection
- legacy ID preservation
- importer dry run
- importer idempotency
- unchanged source JSON
- API secret absence

## Compatibility boundary

Full DatasetVersion rows remain readable from the legacy JSON payload through:

`LegacyDatasetPayloadRepository`

The relational metadata stores an explicit locator:

```text
backend = legacy-dataset-json
ref     = <dataset-version-id>
```

This keeps deterministic analytics behavior available while payload storage is migrated separately.

## Runtime cutover status

A2 proves the PostgreSQL adapters and migration path.

It does **not** claim that every current browser/API runtime path is PostgreSQL-backed yet. Cutover is intentionally incremental.

## Next

**Production Hardening A3 — Living Knowledge + Actions relational persistence**

This is the next priority because Action execution changes authoritative company state and currently depends on recovery/idempotency across file-backed stores rather than one relational transaction.
