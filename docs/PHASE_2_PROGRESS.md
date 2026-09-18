# Knowledge AI — Phase 2 Progress

Last updated: **2026-09-18**

Phase 2 turns queryable company data into proactive, evidence-backed findings.

## Goal

> Find important things the user did not know to ask about.

The Discovery Engine must calculate candidate findings deterministically first. An LLM may later explain or summarize a finding, but it must not invent the underlying measurement.

## Execution slices

```text
2A Insight + analysis-run foundation         IN PROGRESS
2B Ranking, deduplication, prioritization    NOT STARTED
2C Deadlines + version change detection      NOT STARTED
2D Richer anomaly/opportunity detectors      NOT STARTED
2E Insights UI + final Phase 2 audit         NOT STARTED
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

## Phase 2B — Ranking and prioritization

Add:

- stable fingerprints
- deduplication across repeated runs
- severity/impact/urgency/confidence scoring
- resolved/acknowledged lifecycle
- suppression of noisy low-value findings
- bounded “things worth your attention” output

## Phase 2C — Deadlines + change detection

Add:

- document deadline/date candidate extraction with source citations
- deterministic version-to-version dataset changes
- “what materially changed?” candidates
- explicit distinction between fact, calculation, and inference

## Phase 2D — Richer detectors

Add measured detector families only where the available schema supports them:

- category/product trend decomposition
- unusual spikes/drops
- concentration/customer risk
- margin opportunities where revenue/cost columns exist
- inventory movement/risk where temporal inventory data exists

Do not fabricate business semantics when the source schema does not support them.

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
