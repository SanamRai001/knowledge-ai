# Knowledge AI — Phase 3 Final Audit

Date: **2026-09-18**

## Verdict

# ✅ PHASE 3 COMPLETE

Phase 3 gives Knowledge AI its first explicit **living company knowledge layer**.

The product no longer has only:

- documents
- datasets
- answers
- analytical findings

It can now preserve company objects and history across those sources:

```text
Documents + Datasets
        ↓
source-aware projection
        ↓
Entities
Relationships
Claims / observations
Business events
        ↓
authority + provenance
        ↓
conflicts + history
        ↓
What changed?
```

The final integrated Quality Gate is:

- **Run:** `35368501600`
- **Result:** PASS

---

## 1. Authoritative Phase 3 model

PASS.

Phase 3 introduces a separate company-memory subsystem under `server/companyKnowledge/`.

Core records:

- `CompanyEntity`
- `CompanyRelationship`
- `KnowledgeClaim`
- `BusinessEvent`
- `KnowledgeProjectionRun`
- `KnowledgeConflict`
- temporal change reports

This layer is deliberately separate from the older experimental in-memory GraphRAG engine.

The GraphRAG experiment may still help retrieval research, but it is not treated as authoritative business memory.

---

## 2. Entity identity

PASS.

Entities are account scoped and typed.

Initial types include:

- CUSTOMER
- PRODUCT
- SUPPLIER
- ORDER
- INVOICE
- BRANCH
- LOCATION
- CONTRACT
- PROJECT
- EMPLOYEE
- ORGANIZATION
- OTHER

Entity identity separates:

```text
identity key
    ≠
display name
```

Example:

```text
customer_id   C-1
customer_name Acme Stores
```

becomes one CUSTOMER entity anchored by `C-1`, while `Acme Stores` remains the readable canonical name.

This prevents stable identifiers from being discarded merely to make the UI readable.

---

## 3. Conservative cross-source identity linking

PASS.

When a new source has no explicit identifier, Knowledge AI may link it to an existing entity by name/alias only when the match is:

- same account
- same entity type
- normalized exact name/alias match
- unambiguous

If multiple same-type entities could match, the system does not silently merge them.

This is intentionally safer than fuzzy automatic entity merging.

---

## 4. Aliases and source provenance

PASS.

Entities can retain:

- canonical display name
- identity key
- aliases
- every source reference that observed the entity
- first observed timestamp
- last observed timestamp

A single product can therefore accumulate evidence from:

- orders CSV
- inventory XLSX
- supplier document
- later source versions

without losing where each observation came from.

---

## 5. Relationship model

PASS.

Phase 3 stores relationships as explicit company-knowledge records.

Initial structured relations include:

```text
CUSTOMER --PLACED--> ORDER
ORDER --CONTAINS--> PRODUCT
PRODUCT --SUPPLIED_BY--> SUPPLIER
ORDER --BELONGS_TO--> BRANCH
```

Conservative document projection can also preserve explicitly worded relations such as:

```text
CONTRACT --COVERS--> PRODUCT
```

Relationship evidence is mergeable across independent sources.

If both a spreadsheet and a document state the same relationship, the relationship remains one canonical connection with multiple source references.

---

## 6. Claim truth model

PASS.

Knowledge claims explicitly distinguish:

- `FACT`
- `OBSERVATION`
- `INFERENCE`

Phase 3 source projection intentionally creates **OBSERVATION** claims.

That is important.

An uploaded spreadsheet or document proves:

> “this source states this value”

It does **not automatically prove**:

> “this is the final unquestionable company truth.”

FACT and INFERENCE are available in the model, but projection does not silently promote evidence into either category.

---

## 7. Source authority

PASS.

Phase 3 has an explicit authority model.

Current levels:

```text
SIGNED_OR_APPROVED
USER_CONFIRMED
AUTHORITATIVE_SYSTEM
STRUCTURED_SOURCE
DOCUMENT_SOURCE
USER_OBSERVATION
AI_INFERENCE
```

Each has:

- authority label
- deterministic rank
- explanation

Important safety behavior:

- imported structured data defaults to `STRUCTURED_SOURCE`
- document extraction defaults to `DOCUMENT_SOURCE`
- the system does not infer that an upload is signed, approved, or a configured system of record

Higher authority can help interpret disagreement, but does not erase lower-authority evidence.

---

## 8. Structured-data projection

PASS.

CSV/XLSX versions can be projected into living company knowledge.

Projection recognizes only bounded business semantics rather than inventing meaning for arbitrary columns.

Initial entity semantics:

- customer/client
- product/item/SKU
- supplier/vendor
- order
- invoice
- branch/location

Initial structured observations include explicit fields such as:

- total/revenue amount
- balance due/outstanding
- quantity
- status
- payment status
- order date
- due date

Product-state observations may include:

- current stock
- reorder level
- unit price
- unit cost

Product-state facts are only projected when the product is unique in that table/version.

This avoids treating repeated transactional rows as authoritative product master state.

---

## 9. Projection performance

PASS for the local Phase 3 persistence model.

Knowledge projection can generate many mutations from one dataset.

The store therefore uses a mutation batch boundary so projection does not rewrite the persistence file after every entity, relationship, claim, and event.

One projection commits the accumulated state together.

Long-term relational persistence remains future work.

---

## 10. Structured business events

PASS.

Phase 3 begins an append-friendly company timeline.

Current event examples include:

- `ORDER_OBSERVED`
- `INVOICE_OBSERVED`
- `INVENTORY_STATE_OBSERVED`
- `DATASET_VERSION_PROJECTED`
- `DOCUMENT_VERSION_PROJECTED`

The event naming intentionally says **OBSERVED** when the source only proves an observation.

For example, importing an old order export does not let Knowledge AI pretend it witnessed the original order creation in real time.

---

## 11. Historical claim preservation

PASS.

When a newer source version reports a changed value, the previous observation is retained.

Example:

```text
orders v1
O-100 BALANCE_DUE = 16,000
        ↓
orders v2
O-100 BALANCE_DUE = 6,000
```

The old claim becomes historical.

The new claim references the prior claim through supersession metadata.

The history is not overwritten.

---

## 12. Older-version replay safety

PASS.

A critical temporal invariant is enforced:

> Re-projecting an older dataset version must not roll the current claim backward.

If the current known source observation is from a newer version, an older replay can be retained historically but does not replace the newer current value.

This is executable CI behavior.

---

## 13. Replay idempotency

PASS for derived knowledge objects.

Re-projecting the same immutable source version does not duplicate:

- entities
- canonical relationships
- claims
- business events

Source evidence is deduplicated.

Projection-run audit records may still record execution history.

---

## 14. Conservative document projection

PASS.

Document knowledge extraction is intentionally narrow.

Current deterministic patterns support:

- explicit entity labels
- explicit relationship sentences
- explicit order/invoice status statements
- explicit order balance statements
- explicit product stock/reorder statements

Examples that can be projected:

```text
Customer: Acme Stores
Customer Acme Stores placed order O-100.
Order O-100 contains product Chair.
Product Chair is supplied by Timber Co.
Order O-100 balance due is NPR 5,000.
Contract SUP-2026-01 covers product Chair.
```

Every projected document observation preserves:

- knowledge base
- document
- page number
- exact excerpt
- document snapshot identity
- authority level

The extractor does not use an LLM to invent unspoken relationships.

---

## 15. Document snapshot identity

PASS.

Human version labels alone are not reliable enough for temporal identity.

A workspace could still say `v1.0` even after document contents change.

Phase 3 therefore derives a content-based document snapshot ID from:

- current knowledge-base label
- document IDs
- filenames
- upload timestamps
- processing status
- page numbers
- page text

Two different document states therefore remain distinguishable even when both are labeled `v1.0`.

CI verifies an explicit example:

```text
v1.0 snapshot A: Order O-200 status is OPEN.
v1.0 snapshot B: Order O-200 status is PAID.
```

The snapshots receive different source identities and “What changed?” reports `OPEN → PAID`.

---

## 16. Cross-source linking

PASS.

Phase 3 proves that a structured entity and a document mention can become the same canonical entity.

Example:

```text
orders.csv
customer_id = C-1
customer_name = Acme Stores

document
Customer: Acme Stores
```

The document name links to the existing CUSTOMER when that match is unambiguous.

The resulting entity retains both source references.

---

## 17. Cross-source relationship evidence

PASS.

The same relationship can accumulate independent evidence.

Example:

```text
dataset row:
P-1 / Chair → Timber Co

document:
“Product Chair is supplied by Timber Co.”
```

The relationship remains canonical and contains both dataset and document provenance.

---

## 18. Conflicting knowledge

PASS.

Knowledge AI no longer has to silently overwrite one source when another disagrees.

A conflict is generated when current claims for the same:

```text
entity + predicate
```

contain different values.

Example:

```text
orders.csv:
O-100 balance due = 16,000
authority: STRUCTURED_SOURCE (70)

account-update.pdf:
O-100 balance due = 5,000
authority: DOCUMENT_SOURCE (60)
```

Both observations remain visible.

The conflict service reports:

- all conflicting claim IDs
- distinct values
- highest authority rank
- whether a unique higher-authority claim exists
- authority tie when no unique preference exists

The higher-authority observation may be identified as preferred, but the lower-authority contradictory evidence is not deleted.

---

## 19. “What changed?” engine

PASS.

Phase 3 adds deterministic temporal comparison between two completed projection runs from the same source scope.

It reports:

- entities added
- entities no longer present in the later source
- relationships added
- relationships removed
- observations added
- observations removed
- observation values changed
- new source events
- exact source/version window

This is set/value comparison—not an LLM-generated impression.

---

## 20. Changes-since timeline

PASS.

The temporal service can also answer:

> What company knowledge activity has happened since timestamp X?

It can return IDs for:

- projection runs
- business events
- observed claims
- entities observed

This becomes useful groundwork for later WATCH and notification systems.

---

## 21. Invalid temporal comparisons

PASS.

“What changed?” refuses to compare unrelated projection scopes.

For example:

```text
orders.csv version 1
    vs
inventory.csv version 1
```

is not treated as a meaningful version diff.

Both runs must belong to the same:

- account
- source type
- source ID

Foreign-account runs remain inaccessible.

---

## 22. First-class Knowledge product surface

PASS.

The main application now includes a **Knowledge** workspace separate from:

- Ask
- Insights
- Documents
- Datasets

This is important product-wise.

Documents and datasets are source-management surfaces.

Knowledge is the interpreted company-memory surface.

---

## 23. Knowledge UI — entity view

PASS.

The entity workspace includes:

- entity search
- type filtering
- canonical name
- aliases
- identity key
- first/last observed time
- current observations
- claim kind
- source authority
- exact source reference
- document excerpts
- relationships
- source counts
- conflicts
- historical observations
- entity event timeline
- dataset deep-links

---

## 24. Knowledge UI — conflict behavior

PASS.

When sources disagree, the UI explicitly tells the user that different current sources disagree.

It shows:

- each observation
- authority
- source
- evidence
- unique higher-authority observation when available

It does not present the preferred observation as if the conflict never existed.

---

## 25. Knowledge UI — What changed?

PASS.

The UI groups projection runs by source and compares the latest two **distinct source versions**.

It avoids comparing duplicate executions of the same version.

The view shows:

- entity additions/removals
- relation change count
- observation changes
- previous values
- current values

When two document snapshots share the same human label, the UI disambiguates them with the content snapshot identity.

---

## 26. Knowledge UI — timeline

PASS.

A company timeline presents append-friendly events and their source.

This is deliberately framed as observed history rather than claiming the AI witnessed every real-world event directly.

---

## 27. Account/workspace isolation

PASS.

Executable tests verify that foreign accounts cannot:

- inspect entities
- project another account dataset
- project another account document workspace
- inspect entity conflicts
- compare another account projection runs

Caller-supplied account headers do not override authenticated identity.

---

## 28. Existing GraphRAG relationship

The repository still contains the prior experimental:

`server/cognitiveEngine/knowledgeGraphEngine.ts`

Phase 3 does not delete it.

However:

- it remains retrieval/graph experimentation
- it is not the authoritative company-memory store
- normal Phase 3 UI does not expose “GraphRAG” jargon
- future retrieval can consume the new company-knowledge layer instead of treating the experimental graph as truth

This preserves useful prior work without conflating prototypes with the product truth model.

---

## 29. Current limitations — not hidden as completed

### Persistence

The Phase 3 store still uses ignored local JSON runtime persistence.

Long-term architecture should move durable entities, claims, relationships, events, and projections into PostgreSQL or another transactional database.

### Entity resolution

Automatic linking is deliberately conservative.

There is no fuzzy probabilistic entity merge yet.

Ambiguous identities need a future review/merge workflow.

### Source authority configuration

Authority ranks are transparent defaults.

Workspace administrators cannot yet configure systems of record or mark a source as signed/approved through a complete UI.

### Document extraction

Document projection supports bounded explicit language patterns.

It does not yet perform general semantic extraction of arbitrary prose.

This is intentional until precision can be evaluated.

### Canonical domain state

Most imported claims are still observations.

The system does not yet provide the Phase 4 confirmation/action flow required to promote or write authoritative company state.

### Ask integration

The existing Ask system still primarily routes between deterministic dataset analytics and grounded document RAG.

General natural-language traversal over the new entity/relationship/event layer is future work.

### Continuous watch

Phase 3 stores history but does not continuously monitor it.

Durable Watch conditions and notifications belong to Phase 5.

---

## 30. Phase 3 exit decision

The Phase 3 objective was:

> **Model company entities, relationships, events, versions, source authority, and change over time.**

The repository now has a trustworthy minimum implementation:

```text
SOURCE
  ↓
versioned projection
  ↓
ENTITY + RELATIONSHIP + OBSERVATION + EVENT
  ↓
authority + provenance
  ↓
conflict preservation
  ↓
temporal history
  ↓
WHAT CHANGED?
```

This creates the foundation required for the next major capability:

```text
natural language
      ↓
proposed company change
      ↓
validation
      ↓
preview
      ↓
approval
      ↓
transactional write
      ↓
audit event
      ↓
re-analysis
```

**Final decision: Phase 3 is complete and the repository can advance to Phase 4 — Safe Natural-Language Actions.**
