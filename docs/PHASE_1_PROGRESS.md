# Knowledge AI — Phase 1 Progress

Last updated: **2026-09-18**

Phase 1 turns structured business files into first-class queryable company data.

## Execution slices

```text
1A Dataset foundation + CSV ingestion      COMPLETE
1B XLSX + schema correction                IN PROGRESS
1C Deterministic analytical query layer    NOT STARTED
1D Analytical routing + provenance         NOT STARTED
1E Dataset UI + final Phase 1 audit        NOT STARTED
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

## Phase 1C — Deterministic analytical query layer

Add:

- filter
- sort
- group
- sum/count/average/min/max
- date range comparisons
- row limits and time limits
- no free-form LLM arithmetic

## Phase 1D — Analytical routing + provenance

Add:

- classify document question vs structured analytical question
- generate validated analytical plans
- execute deterministic query
- let the LLM explain the computed result
- return dataset/version/table/filter/row-count provenance

## Phase 1E — UI + final gate

Add **Knowledge > Datasets**:

- upload
- preview
- schema
- import status
- data preview
- versions/history
- provenance drill-down

The UI is not a spreadsheet editor.
