# Knowledge AI — Phase 3 Progress

Last updated: **2026-09-18**

Phase 3 turns isolated documents/datasets into a living, provenance-preserving company knowledge layer.

## Goal

> Model what the company knows, where each claim came from, how things relate, and how that knowledge changes over time.

## Execution slices

```text
3A Entity / fact / relationship / event foundation   IN PROGRESS
3B Source authority + structured-data projection     NOT STARTED
3C Cross-source linking + document observations      NOT STARTED
3D Temporal history + "What changed?"                NOT STARTED
3E Knowledge UI + final Phase 3 audit                NOT STARTED
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
