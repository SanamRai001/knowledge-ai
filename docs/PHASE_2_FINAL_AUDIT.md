# Knowledge AI — Phase 2 Final Audit

Date: **2026-09-18**

## Verdict

# ✅ PHASE 2 COMPLETE

Phase 2 turns Knowledge AI from an on-demand answer system into an initial proactive discovery system.

The product can now inspect supported company data and documents, generate structured evidence-backed findings, prioritize them, preserve lifecycle state, and present a concise “things worth your attention” experience.

The final authoritative Quality Gate run is:

- **Run:** `35366183054`
- **Result:** PASS
- **Integrated code state:** Phase 2A–2E + Insights UI

---

## 1. What changed conceptually

Before Phase 2:

```text
user asks
   ↓
Knowledge AI retrieves/calculates
   ↓
answer
```

After Phase 2:

```text
company data + documents
        ↓
deterministic discovery
        ↓
structured candidate findings
        ↓
deduplication + prioritization
        ↓
evidence-backed Insights
        ↓
user investigates / acknowledges / resolves
```

Knowledge AI can therefore create value before the user knows the exact question to ask.

---

## 2. Analysis-run model

PASS.

Discovery now has persisted, account-scoped analysis runs.

An AnalysisRun records:

- account
- source type: DATASET or DOCUMENT
- exact dataset version or knowledge-base version
- reference time
- detector versions used
- generated insight IDs
- run status
- start/completion time
- failure state when applicable

The reference time makes time-sensitive findings reproducible and testable.

---

## 3. Insight contract

PASS.

Insights are structured records, not free-form LLM messages.

Each insight records:

- stable fingerprint
- account scope
- analysis run
- source scope
- type
- severity
- status
- title
- summary
- confidence
- detector/version
- deterministic calculation description
- evidence values
- source provenance
- supporting row references where applicable
- priority score/reasons
- first seen
- last seen
- occurrence count
- lifecycle update time

Supported user-facing types:

- RISK
- OPPORTUNITY
- CHANGE
- DEADLINE
- ANOMALY
- DATA_QUALITY

---

## 4. Deterministic trend/change detection

PASS.

The trend detector:

- requires a real DATE/DATETIME column
- requires a supported numeric business measure
- groups complete calendar months
- compares the latest two complete months
- requires sufficient rows
- emits only when absolute percentage change crosses the configured materiality threshold

The underlying measurement is produced by code, not the LLM.

---

## 5. Outstanding and overdue balance detection

PASS.

The detector activates only when supported balance columns exist.

If a due-date column exists:

- positive balances are checked against the analysis reference time
- only overdue balances contribute to the overdue finding

Evidence can include:

- total outstanding
- affected records
- largest outstanding value
- largest related customer/entity
- supporting rows

The system does not invent a receivables concept when the source schema does not support one.

---

## 6. Inventory threshold detection

PASS.

Inventory risk requires both:

- explicit stock/on-hand field
- explicit reorder/minimum/safety-stock field

The detector checks:

```text
stock <= configured threshold
```

It does not estimate “days remaining” without consumption/time-series evidence.

Stockout records increase severity.

This is deliberately narrower and more trustworthy than an AI guess about future inventory.

---

## 7. Data-quality findings

PASS.

Discovery can surface material ingestion-quality issues such as:

- duplicate rows
- materially incomplete columns

These findings reuse deterministic ingestion measurements rather than reinterpreting raw data with an LLM.

This helps users understand when later analysis may be less reliable.

---

## 8. Canonical deduplication

PASS.

Repeated analysis of the same immutable evidence no longer creates endless duplicate cards.

Canonical behavior:

- stable fingerprint
- same canonical insight ID
- occurrence count increments
- firstSeenAt preserved
- lastSeenAt refreshed
- lifecycle state preserved
- latest evidence/run remains linked

Historical analysis runs still resolve the canonical finding.

---

## 9. Deterministic prioritization

PASS.

Insights are prioritized using a transparent bounded heuristic based on:

- severity
- finding type
- confidence
- measured breadth/materiality
- large change magnitude
- stockout evidence
- number of affected records

The LLM does **not** decide what ranks first.

The UI intentionally does not expose internal numeric priority scores as normal product jargon.

---

## 10. Insight lifecycle

PASS.

Insights support:

- OPEN
- ACKNOWLEDGED
- RESOLVED
- reopen back to OPEN

Lifecycle state survives repeated analysis of the same canonical finding.

HTTP mutation remains account scoped.

---

## 11. Dataset version-change detection

PASS.

Consecutive immutable dataset versions can produce evidence-backed CHANGE findings.

Current measured changes include:

- material row-count increase/decrease
- added columns
- removed columns

Evidence preserves:

- previous/current dataset version IDs
- version numbers
- source hashes
- old/new row counts
- percentage difference
- schema differences

A real regression was found and fixed during this phase:

> CSV re-imports can have different filenames, and filename-derived table names initially prevented the same logical single-table CSV dataset from matching across versions.

Single-table CSV versions are now treated as the same logical table for version comparison. XLSX sheet names remain semantically meaningful.

---

## 12. Document deadline detection

PASS for the bounded Phase 2 contract.

Deadline discovery is deterministic and evidence constrained.

A document finding requires:

1. a processed document page
2. an explicit parseable calendar date
3. deadline/due/expiry/renewal/validity language in the same sentence or line
4. a date between the reference day and 90 days ahead

Supported explicit date shapes currently include:

- YYYY-MM-DD
- Month Day, YYYY
- Day Month YYYY

Evidence preserves:

- knowledge base
- knowledge version
- document ID
- filename
- page number
- exact excerpt
- parsed deadline date
- days until deadline

Historical dates are excluded.

The system does not currently ask an LLM to infer implicit deadlines.

---

## 13. Time-series anomaly detection

PASS.

The anomaly detector compares the latest complete month against a measured recent baseline.

Current v1 behavior:

- aggregate supported business measure by complete month
- require at least 3 baseline months
- baseline is previous 3–6 complete months
- calculate mean
- calculate population standard deviation
- calculate z-score where variance exists
- use a material deviation fallback when the baseline is perfectly flat

The test suite verifies exact baseline/deviation arithmetic.

---

## 14. Customer concentration detection

PASS.

When explicit customer/client and revenue-like fields exist, Discovery can identify measured revenue concentration.

Current v1:

- group by customer
- sum the measure
- calculate top-customer share
- emit at a defined concentration threshold

The insight explicitly describes a **concentration signal**.

It does not predict that a customer will leave and does not claim causation.

---

## 15. Margin opportunity detection

PASS.

This detector only activates when the schema contains:

- explicit product/item field
- explicit revenue field
- explicit cost field

It calculates:

```text
product margin = (product revenue - product cost) / product revenue
overall margin = (total revenue - total cost) / total revenue
margin lift = product margin - overall margin
```

A product must clear both a measured margin-lift threshold and a minimum revenue-share threshold.

The resulting OPPORTUNITY is a measured pattern worth investigation, not an automatic business recommendation.

---

## 16. Source model

PASS.

Discovery evidence explicitly distinguishes:

```text
DATASET
DOCUMENT
```

Dataset insights can preserve:

- dataset ID
- exact version
- source SHA-256
- table
- rows
- calculations

Document insights can preserve:

- knowledge base
- knowledge version
- document
- page
- excerpt

Document findings are not disguised as dataset records.

---

## 17. Tenant/workspace isolation

PASS.

Discovery uses the existing authoritative identity boundary.

Verified protections include:

- foreign dataset analysis/read denial
- foreign knowledge-base discovery/read denial
- direct insight read denial
- lifecycle mutation denial
- caller-supplied account headers cannot override authenticated identity

Another real regression was caught during Phase 2:

> Workspace access validation correctly threw a 404, but the discovery HTTP router did not initially recognize WorkspaceAccessError and converted it into 500.

The router now preserves authoritative workspace access status.

---

## 18. Insights product surface

PASS.

The main navigation now includes a first-class **Insights** workspace.

The UX deliberately emphasizes:

> **Things worth your attention**

rather than exposing a detector console or BI dashboard.

The view supports:

- prioritized findings feed
- source filter
- status filter
- insight-type filter
- severity
- confidence
- source
- first/last-seen context
- occurrence count
- evidence drill-down
- calculation explanation
- exact document excerpt/page
- source hash/version provenance
- row-level supporting evidence
- Analyze now
- acknowledge
- resolve
- reopen
- deep-link to source dataset

Normal UI does not expose detector IDs or architecture jargon.

---

## 19. Discovery execution model

Phase 2 intentionally uses explicit on-demand analysis.

```text
Analyze now
    ↓
one or more source-scoped analysis runs
    ↓
deterministic detectors
    ↓
canonical findings
    ↓
priority feed
```

This is not yet continuous WATCH behavior.

Continuous re-analysis, conditions, reminders, and notifications remain a later phase.

---

## 20. Final CI gate

Quality Gate `35366183054` passed:

- benchmark leakage guard
- provider boundary guard
- secret/runtime-state hygiene
- telemetry integrity
- TypeScript
- production build
- workspace isolation
- workspace HTTP isolation
- structured-data foundation
- dataset HTTP isolation
- XLSX/schema correction
- deterministic analytics
- analytical question routing
- Phase 1 UI contract
- Phase 2A discovery
- Phase 2B prioritization/lifecycle
- Phase 2C change/deadline detection
- Phase 2D richer detectors
- Phase 2E Insights UI contract
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini unseen-corpus benchmark step

---

## 21. Current limitations — not hidden as completed features

These are intentionally outside the Phase 2 completion claim.

### Persistence

Discovery currently uses the repository’s local runtime persistence model under ignored `data/`.

Long-term durable relational persistence remains future architecture work.

### Continuous monitoring

Analysis is currently triggered explicitly.

There are no durable Watch rules, scheduled re-analysis jobs, or notifications yet.

### Document deadline understanding

Deadline extraction is deliberately conservative.

It does not yet understand:

- “within 30 days of signing”
- “three business days after delivery”
- dates requiring cross-page interpretation
- semantic deadlines without an explicit nearby date

Those should be added only with strong evidence/evaluation.

### Cross-source causal investigation

Discovery can independently find dataset and document signals.

It does not yet make general causal claims across arbitrary sources.

### Entity layer

Customer/product/supplier mentions are still source-schema values, not durable cross-source canonical entities.

That belongs to Phase 3.

### Natural-language business updates

Insights are read/discovery objects.

They do not yet mutate authoritative company state.

That belongs to Phase 4.

### Forecasting

Inventory threshold findings use explicit thresholds.

The system does not yet forecast stock depletion without suitable historical movement data.

### Detector calibration

Current v1 thresholds are transparent deterministic defaults.

Real production deployments should eventually support measured calibration and workspace/domain configuration.

---

## 22. Phase 2 exit decision

The Phase 2 objective was:

> **Find important things automatically.**

The repository now has the full minimum architecture required to make that claim honestly:

```text
company evidence
      ↓
analysis run
      ↓
deterministic detectors
      ↓
structured findings
      ↓
deduplication
      ↓
priority
      ↓
evidence-backed Insights UI
```

**Final decision: Phase 2 is complete and the repository can advance to Phase 3 — Living Company Knowledge.**
