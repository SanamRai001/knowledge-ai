# Knowledge AI — Phase 1 Progress

Last updated: **2026-09-18**

Phase 1 turns structured business files into first-class queryable company data.

## Execution slices

```text
1A Dataset foundation + CSV ingestion      COMPLETE
1B XLSX + schema correction                COMPLETE
1C Deterministic analytical query layer    COMPLETE
1D Analytical routing + provenance         COMPLETE
1E Dataset UI + final Phase 1 audit        COMPLETE
```

## Phase 1A — Dataset foundation + CSV ingestion

Goal:

```text
CSV bytes
  ↓
safe parser
  ↓
header/delimiter detection
  ↓
schema inference
  ↓
preview
  ↓
validated import
  ↓
account-scoped Dataset + DatasetVersion
```

Required before 1A closes:

- quoted CSV fields and embedded delimiters parse correctly
- malformed CSV fails safely
- file/row/column/cell limits are enforced
- schema inference distinguishes common business types
- missing values and duplicate rows are measured
- imports create immutable dataset versions
- dataset source metadata includes a file hash
- datasets are account-scoped at the store/service boundary
- runtime dataset state remains under ignored `data/`
- executable CI tests cover parser, inference, versioning, and cross-account isolation

## Phase 1A verification

Quality Gate run `35356803019` passed with:

- structured data foundation proof
- dataset HTTP isolation proof
- TypeScript and production build
- all Phase 0 trust/security regression gates
- unseen-corpus benchmark
- live-provider benchmark step

The CI proof caught and fixed a real schema bug where `order_date` was initially misclassified as an identifier. Identifier inference now requires actual ID/code semantics rather than the word "order" alone.

## Phase 1B — XLSX + schema correction

Add:

- XLSX workbook parsing
- multiple sheets
- safe workbook limits
- schema preview across sheets
- user-supplied column type corrections
- import mapping/correction model

## Phase 1B verification

Quality Gate run `35357261116` passed with the dedicated XLSX/schema-correction proof plus every existing regression gate.

Verified behavior includes:

- bounded multi-sheet XLSX parsing
- no spreadsheet formula execution; only cached scalar formula results are read
- CSV and XLSX share the same Dataset/DatasetVersion model
- user schema overrides are recorded as `USER_OVERRIDE`
- impossible type corrections fail safely
- XLSX source hashes and sheet provenance are retained
- account isolation remains enforced

The server-side XLSX parser dependency is pinned to an exact version because this repository currently does not use an npm lockfile.

## Phase 1C — Deterministic analytical query layer

Add:

- filter
- sort
- group
- sum/count/average/min/max
- date range comparisons
- row limits and time limits
- no free-form LLM arithmetic

## Phase 1C verification

Quality Gate run `35357717230` passed with the dedicated deterministic analytics proof plus every existing regression gate.

Verified behavior includes:

- safe closed analytical query plans rather than raw SQL
- deterministic filters, projection, grouping, sorting, and limits
- `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, and `DISTINCT_COUNT`
- deterministic date-period comparisons
- historical DatasetVersion reproducibility
- dataset/source/version/filter/row-count calculation provenance
- query/time/result safety limits
- type mismatch and unknown-column rejection
- mounted dataset analytics API account isolation

## Phase 1D — Analytical routing + provenance

Add:

- classify document question vs structured analytical question
- generate validated analytical plans
- execute deterministic query
- let the LLM explain the computed result
- return dataset/version/table/filter/row-count provenance

## Phase 1E — UI + final gate

Implemented a first-class **Datasets** workspace with:

- CSV/XLSX drag-and-drop and file selection
- preview before import
- inferred schema inspection
- user type corrections with validation
- missing/duplicate warnings
- import progress/error/success states
- data preview
- source filename/format/hash metadata
- immutable version history
- lightweight summary/history APIs so the UI does not download full 50k-row datasets just to render a preview
- direct **Ask this dataset** handoff

The primary **Ask** workspace now uses `POST /api/query/ask` rather than the legacy document-only chat endpoint. It:

- carries both dataset and document source context
- automatically distinguishes structured analytics from document knowledge
- displays deterministic analytical results and provenance
- displays document evidence separately
- exposes the hybrid trust model: LLM for language, deterministic code for business calculations

The UI remains an intelligence/query experience rather than a spreadsheet editor.

## Phase 1E verification

Final Quality Gate run `35363150876` passed on the latest main commit.

The run passed:

- benchmark leakage guard
- provider-boundary guard
- secret/runtime-state hygiene
- telemetry integrity
- TypeScript
- production build
- workspace service isolation
- workspace HTTP isolation
- structured-data foundation
- dataset HTTP isolation, including lightweight UI summary/history endpoints
- XLSX/schema correction proof
- deterministic structured analytics
- analytical question routing
- Phase 1 UI contract proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini unseen-corpus benchmark step

**Phase 1 status: COMPLETE.**
