# Knowledge AI — Production A6 PostgreSQL Discovery + Insights

Date: **2026-09-19**

## Verdict

# ✅ PRODUCTION HARDENING A6 COMPLETE

A6 relationalizes the remaining authoritative Discovery / Insights state that was still persisted in:

`data/discovery.json`

Authoritative integrated workflow:

- **Workflow:** `35459661040`
- **Quality Gate:** PASS
- **PostgreSQL A2→A6 chain:** PASS

## Migration

`server/persistence/migrations/005_discovery_insights.sql`

Tables:

- `discovery_analysis_runs`
- `discovery_insights`
- `discovery_analysis_run_insights`

## Relational guarantees

A6 proves:

- AnalysisRun account ownership
- Dataset AnalysisRun → same-account Dataset/DatasetVersion
- Document AnalysisRun → same-account Workspace
- Insight → same-account latest AnalysisRun
- Insight → same-account Dataset/DatasetVersion or Workspace source
- one Insight identity per `(account_id, fingerprint)`
- historical AnalysisRun ↔ Insight membership is preserved separately from the Insight's latest run
- Insight status updates are account-scoped
- recurrence keeps the original Insight ID
- recurrence keeps status / statusUpdatedAt / firstSeenAt / createdAt
- recurrence advances lastSeenAt / latest AnalysisRun / occurrenceCount
- retrying the same AnalysisRun does not increment recurrence twice

## Why the run-membership table matters

The legacy file model stores a recurring Insight as one mutable record whose `analysisRunId` advances to the newest run.

Without an independent relation, older AnalysisRuns can lose historical membership.

A6 stores:

```text
Insight identity
  ↕ latest run
discovery_insights

historical membership
  ↕
discovery_analysis_run_insights
```

So two AnalysisRuns can both truthfully report that they produced the same recurring Insight identity.

## Legacy migration

`server/persistence/a6LegacyImporter.ts`

The importer supports:

- dry-run validation
- ID preservation
- fingerprint uniqueness validation
- account/source ownership validation
- exact recurrence/status preservation
- exact AnalysisRun membership restoration
- repeated idempotent import
- source `discovery.json` remains unchanged

The normal legacy import command now runs:

```text
A2 → A3 → A4 → A5 → A6
```

and stops before later slices if any earlier migration reports conflicts.

## Exit evidence

Workflow `35459661040` passed:

- TypeScript
- production build
- all Phase 0–8 executable product gates
- unseen-corpus benchmark
- live Gemini benchmark
- Production A2 PostgreSQL proof
- Production A3 PostgreSQL proof
- Production A4 PostgreSQL proof
- Production A5 PostgreSQL proof
- Production A6 PostgreSQL proof

## Important boundary

A6 completes the primary relational schema/repository modeling of authoritative mutable product state.

It still does **not** mean normal production runtime traffic has fully cut over from file stores to PostgreSQL.

That distinction is now the highest-priority persistence risk.

## Next milestone

# Production A7 — PostgreSQL runtime cutover

The next work is to switch production-mode domain services deliberately onto the PostgreSQL repositories while preserving file-mode development compatibility and every Phase 0–8 trust contract.

Do not delete the legacy adapters until cutover proofs and migration/rollback behavior are green.
