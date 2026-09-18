# Knowledge AI — Phase 2 Progress

Last updated: **2026-09-18**

Phase 2 turns queryable company data into proactive, evidence-backed findings.

## Goal

> Find important things the user did not know to ask about.

The Discovery Engine must calculate candidate findings deterministically first. An LLM may later explain or summarize a finding, but it must not invent the underlying measurement.

## Execution slices

```text
2A Insight + analysis-run foundation         COMPLETE
2B Ranking, deduplication, prioritization    COMPLETE
2C Deadlines + version change detection      COMPLETE
2D Richer anomaly/opportunity detectors      COMPLETE
2E Insights UI + final Phase 2 audit         IN PROGRESS
```

## Phase 2A — Insight + analysis-run foundation

Build the durable discovery contract and the first deterministic structured-data detectors.

Initial detector families:

- trend/change detector for time-series business measures
- outstanding/overdue balance detector when matching business columns exist
- inventory threshold detector when stock and reorder/minimum columns exist
- data-quality signal for material duplicate/missing-record problems

Every finding must preserve:

- account scope
- dataset ID
- exact dataset version
- source filename and SHA-256
- table
- detector ID/version
- calculation/evidence payload
- confidence
- severity
- generated timestamp
- analysis-run ID

The same detector must produce the same underlying measurement for the same immutable dataset version and reference time.

## Phase 2A verification

Quality Gate run `35364611761` passed the dedicated Phase 2A discovery proof.

Verified:

- persisted account-scoped AnalysisRun and Insight contracts
- deterministic monthly trend/change detection
- outstanding/overdue balance detection
- explicit inventory threshold detection
- material missing/duplicate data-quality findings
- stable fingerprints for the same immutable version/reference time
- source filename/hash, exact dataset version, table, calculation, and row evidence
- mounted discovery API account isolation

## Phase 2B — Ranking and prioritization

Add:

- stable fingerprints
- deduplication across repeated runs
- severity/impact/urgency/confidence scoring
- resolved/acknowledged lifecycle
- suppression of noisy low-value findings
- bounded “things worth your attention” output

## Phase 2B verification

Quality Gate run `35364939555` passed with the dedicated prioritization/lifecycle proof plus every existing regression gate.

Verified:

- identical repeated findings reuse a canonical insight ID
- occurrence count and first/last seen metadata
- deterministic bounded priority scores
- transparent priority reasons
- stockout/high-severity risk outranks lower-value data-quality findings
- ACKNOWLEDGED / RESOLVED lifecycle persistence across re-analysis
- historical analysis runs still resolve canonical insight IDs
- status filters and bounded result limits
- foreign accounts cannot read or mutate another account's insight state

## Phase 2C — Deadlines + change detection

Add:

- document deadline/date candidate extraction with source citations
- deterministic version-to-version dataset changes
- “what materially changed?” candidates
- explicit distinction between fact, calculation, and inference

## Phase 2C verification

Quality Gate run `35365820123` passed the Phase 2C proof after two useful regressions were found and fixed:

- single-table CSV versions are treated as the same logical table even when the re-import filename changes
- workspace ownership failures now preserve their authoritative 404 status through the discovery HTTP router instead of being converted to 500

Verified behavior includes:

- consecutive immutable dataset-version row-count changes
- added/removed schema columns
- previous/current version IDs and source hashes in evidence
- explicit document deadlines only when a parseable date appears with deadline/due/expiry/renewal language
- exact document ID, page number, excerpt, knowledge version, date, and days-until evidence
- historical dates are excluded
- repeated deadline findings deduplicate canonically
- document discovery remains knowledge-base/account scoped

## Phase 2D — Richer detectors

Add measured detector families only where the available schema supports them:

- category/product trend decomposition
- unusual spikes/drops
- concentration/customer risk
- margin opportunities where revenue/cost columns exist
- inventory movement/risk where temporal inventory data exists

Do not fabricate business semantics when the source schema does not support them.

## Phase 2D verification

Quality Gate run `35365820123` also passed the dedicated richer-detector proof.

Verified:

- time-series anomaly detection against a measured recent baseline
- customer revenue concentration without implying future customer loss
- product margin opportunity only when explicit product, revenue, and cost fields exist
- exact baseline mean/deviation, concentration share, weighted margin, margin lift, and source provenance
- richer findings participate in the same deterministic prioritization pipeline

## Phase 2E — Insights UI + final gate

Add a user-facing **Insights** surface focused on a few important findings rather than a BI dashboard.

Each insight must support:

- title and concise explanation
- type/severity/confidence
- “why this matters”
- evidence/provenance
- related dataset/source
- generated time
- drill into supporting records/calculation
- status lifecycle when Phase 2B is complete

The UI should hide detector/architecture jargon from normal users.
