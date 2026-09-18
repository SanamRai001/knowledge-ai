# Knowledge AI — Phase 3 Progress

Last updated: **2026-09-18**

Phase 3 turns isolated documents/datasets into a living, provenance-preserving company knowledge layer.

## Goal

> Model what the company knows, where each claim came from, how things relate, and how that knowledge changes over time.

## Execution slices

```text
3A Entity / fact / relationship / event foundation   COMPLETE
3B Source authority + structured-data projection     COMPLETE
3C Cross-source linking + document observations      COMPLETE
3D Temporal history + "What changed?"                COMPLETE
3E Knowledge UI + final Phase 3 audit                COMPLETE
```

## Phase 3A — Company knowledge foundation

Introduce durable account-scoped records for:

- Entity
- EntityAlias
- Relationship
- KnowledgeClaim
- BusinessEvent
- KnowledgeProjectionRun

Claims must explicitly distinguish:

- FACT
- OBSERVATION
- INFERENCE

Every claim/relationship/event must preserve source provenance and the source version that produced it.

The Phase 3 knowledge layer is separate from the existing experimental GraphRAG engine. The old graph may remain useful for retrieval experiments, but it is not authoritative company memory.

## Phase 3B — Source authority + structured-data projection

Project supported structured dataset semantics into company knowledge without turning arbitrary columns into invented business meaning.

Initial explicit entity semantics:

- customer / client
- product / item / SKU
- supplier / vendor
- order / invoice
- branch / location

Initial explicit relationships when both sides are present in the same source row:

- CUSTOMER —PLACED→ ORDER
- ORDER —CONTAINS→ PRODUCT
- PRODUCT —SUPPLIED_BY→ SUPPLIER
- ORDER —BELONGS_TO→ BRANCH

Structured facts may include explicitly named values such as:

- revenue / total
- balance due / outstanding
- quantity
- status
- dates

Source authority must be explicit and configurable later. Phase 3 defaults should be conservative and transparent.

## Phase 3C — Cross-source linking + document observations

Add:

- normalized entity matching
- aliases
- conflict-safe linking across datasets and documents
- conservative document entity/claim observations with exact page evidence
- no silent promotion of document text or AI extraction to authoritative fact
- conflict representation when two sources disagree

## Phase 3D — Temporal history + What changed?

Add a temporal change service that can answer:

- what entities appeared/disappeared?
- which facts changed?
- which relationships were added/removed?
- what source/version caused the change?
- what changed between two projection runs or since a timestamp?

History must be append-friendly and must not destroy prior truth.

## Phase 3E — Knowledge UI + final gate

User-facing Knowledge should evolve beyond Documents/Datasets into:

- Entities
- Relationships
- Facts/observations
- Source authority
- Timeline/history
- What changed?

The UI should favor understandable business concepts over graph-engine terminology.


## Phase 3 verification

### 3A / 3B

Quality Gate run `35367700186` passed the living-company-knowledge foundation proof.

Verified:

- deterministic account-scoped entity identity
- explicit identifiers separated from human display names
- aliases and provenance
- persistent relationships
- OBSERVATION / FACT / INFERENCE claim contract
- explicit source authority model
- structured dataset projection
- order/product/customer/supplier/branch relationships
- order facts and business-event history
- inventory state observations only when product rows are unambiguous
- immutable source-version claim history
- older-version replay cannot roll current knowledge backward
- same-version replay does not duplicate company knowledge objects
- HTTP account isolation

### 3C

Quality Gate run `35367869316` passed cross-source knowledge behavior.

Verified:

- conservative document projection
- exact page/excerpt provenance
- unique name/alias matching across document and structured sources
- merged multi-source relationship evidence
- explicit cross-source conflicts
- higher-authority preference without hiding disagreement
- document workspace isolation
- GraphRAG experiment remains separate from authoritative company memory

### 3D

Final integrated Quality Gate run `35368501600` passed deterministic temporal-history behavior.

Verified:

- source-scoped projection-run comparisons
- entity additions/removals
- relationship additions/removals
- observation additions/removals/changes
- changes-since timestamp
- unrelated source comparisons rejected
- dataset source-version identity
- content-derived document snapshot identity
- document changes remain distinguishable even when the human version label is unchanged
- historical claims are preserved rather than overwritten

### 3E

Quality Gate run `35368501600` also passed the living Knowledge UI contract.

The main application now exposes a first-class **Knowledge** workspace with:

- entity catalog and search/type filters
- current observations
- OBSERVATION/FACT/INFERENCE labeling
- source authority
- explicit conflict display
- relationships
- exact evidence sources
- historical observations
- entity timeline
- company timeline
- Refresh knowledge
- deterministic **What changed?**
- dataset deep-links
- business-facing language instead of GraphRAG implementation jargon

**Phase 3 status: COMPLETE.**
