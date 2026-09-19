# Knowledge AI — Production Hardening A3 Final Record

Date: **2026-09-19**

## Verdict

# ✅ A3 COMPLETE

A3 moves Living Company Knowledge and the confirmed Action transaction path into a PostgreSQL-backed relational adapter layer while preserving the existing Phase 0–8 trust contracts.

## Authoritative workflow

`35437410594`

Both required jobs passed:

- full product `quality`
- PostgreSQL production proof, including A2 + A3

## Relational records proven in A3

Living Company Knowledge:

- CompanyEntity
- CompanyRelationship
- KnowledgeClaim
- BusinessEvent
- KnowledgeProjectionRun

Actions:

- ActionProposal
- ActionProposal target ownership
- ActionExecution
- execution-to-claim links
- execution-to-event links
- ActionAuditEntry

## Confirmed Action transaction

The PostgreSQL adapter proves an atomic bounded confirmation transaction containing:

```text
proposal lock
+ stale-state re-check
+ confirmed claims
+ BusinessEvent
+ ActionExecution
+ proposal transition
+ audit entry
= one relational transaction
```

## Safety verified

- account-scoped repository reads
- cross-account relationship constraints
- cross-account execution links rejected
- database-enforced one execution per account/proposal
- higher-authority USER_CONFIRMED claims become effective
- imported STRUCTURED_SOURCE claims remain preserved
- stale preconditions reject the whole transaction
- mid-transaction failure rolls back claims, execution, and proposal state together
- repeated confirmation returns the already committed execution
- proposal/execution/audit IDs remain stable
- legacy source JSON remains unchanged

## Legacy importer

A3 includes an explicit Living Knowledge + Actions legacy importer.

Verified behavior:

- dry run
- ID preservation
- conflict reporting
- idempotent repeat import
- semantic JSON comparison across PostgreSQL `jsonb` key reordering
- execution/proposal/claim/event linkage preservation
- non-destructive source files

The semantic-comparison fix is important: `jsonb` does not preserve object key order, so migration idempotency compares canonical JSON values rather than raw `JSON.stringify` ordering.

## Migration

Migration:

`002_living_knowledge_actions.sql`

A3 migrations remain checksum-safe and repeatable.

## Runtime cutover status

A3 proves the relational repositories, transaction boundary, and migration/import path.

It does **not** claim every current runtime read/write path has already removed the legacy file adapter.

The production-hardening strategy remains incremental rather than big-bang.

## Next

**Production Hardening A4 — Watch + Integrations relational persistence**

Priority:

1. Watch rules/evaluations/alerts/jobs
2. IntegrationConnection metadata
3. SyncRun
4. ExternalImportState
5. database-enforced Watch job/schedule idempotency
6. relational integration cursor/checkpoint transaction semantics
7. OAuth secret bytes remain outside ordinary relational tables
