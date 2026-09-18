# Knowledge AI — Phased Implementation Roadmap

Status: **Execution roadmap for the main GitHub product**  
Last updated: **2026-09-17**

> This file turns `LONG_TERM_PRODUCT_VISION.md` into an implementation sequence.
>
> The long-term vision explains **what Knowledge AI should become**. This roadmap explains **what to build first, what to delay, and what must be true before moving to the next phase**.
>
> Builder Fest is a separate, intentionally smaller proof-of-concept. Do not collapse the main repository into hackathon shortcuts.

---

## 1. Roadmap philosophy

Knowledge AI should evolve in this order:

```text
TRUST
  ↓
STRUCTURED DATA
  ↓
DISCOVERY
  ↓
LIVING COMPANY KNOWLEDGE
  ↓
SAFE ACTIONS
  ↓
WATCH
  ↓
INTEGRATIONS
  ↓
CONTROLLED AUTOMATION
  ↓
PLATFORM
```

The sequence matters.

We should not build proactive alerts on top of unreliable facts. We should not allow natural-language writes before validation, permissions, and auditability exist. We should not add integrations until the internal source and provenance model can represent them consistently.

A phase is complete only when its **exit gate** is satisfied.

---

## 2. Global rules for every phase

These rules apply throughout the entire project.

### 2.1 Preserve the trust contract

- factual answers must be grounded in authorized evidence
- citations/provenance must point to evidence actually used
- unsupported questions should abstain rather than guess
- AI inference must not silently become company fact
- conflicting sources must be surfaced
- important writes must be auditable
- permissions must be enforced outside the LLM

### 2.2 LLMs are not calculators or databases

Use models for:

- language understanding
- flexible reasoning
- interpretation
- classification where deterministic rules are insufficient
- summarization
- planning

Prefer deterministic code for:

- arithmetic
- financial calculations
- thresholds
- state transitions
- permissions
- database writes
- recurring rule evaluation
- validation
- audit logs

### 2.3 Do not widen scope before the current phase works

A partially working Phase 0 plus ten Phase 4 experiments is worse than a finished Phase 0.

### 2.4 Every phase must add tests

A feature is not complete because it looks correct in the UI.

At minimum add:

- unit tests for deterministic logic
- integration tests for persistence and API boundaries
- regression tests for bugs fixed during the phase
- evaluation cases for AI/retrieval behavior

### 2.5 Migrations must be incremental

Do not rewrite the entire repository in one step.

Existing retrieval, citations, evaluation, conversational resolution, and document work should be strengthened and reused.

---

# PHASE 0 — Trustworthy Knowledge Foundation

## Goal

Turn the current document assistant into a trustworthy, measurable foundation that future phases can safely build on.

This phase is primarily about **correctness before expansion**.

The current repository already contains real grounded retrieval, reranking, citations, corrective retrieval, structured-table access, conversational query resolution, multilingual work, evaluation tooling, and Gemini generation. It also contains known audit gaps that must be resolved before broader product expansion.

## Main workstreams

### 0.1 Remove benchmark contamination

Required:

- remove corpus-specific expected answers from generic production reasoning paths
- keep benchmark fixtures isolated inside benchmark/test code
- prevent future benchmark facts from leaking into production branches
- keep or strengthen `check:benchmark-leakage`

### 0.2 Establish clean evaluation

Create repeatable evaluation sets for:

- known-answer factual questions
- unsupported questions
- misleading/false-premise questions
- conversational follow-ups
- multilingual questions
- unseen private corpus

Track:

- retrieval recall/hit rate
- answer correctness
- citation precision
- claim grounding
- refusal accuracy
- false-refusal rate
- hallucination rate
- follow-up accuracy
- latency

Do not publish one vague overall AI score.

### 0.3 Stabilize provider architecture

Introduce a real provider abstraction before multiplying providers.

Target shape:

```text
LLMProvider
  generate()
  healthCheck()
  capabilities()

ProviderRouter
  primary
  fallback
  optional verifier later
```

Gemini can remain the initial primary provider.

A deterministic grounded fallback can remain for local development and provider failure, but it must be clearly distinguishable from live-model behavior.

### 0.4 Honest telemetry

- directly measure stage timings where possible
- label estimates as estimates
- distinguish LIVE vs SIMULATED provider behavior
- record real provider failures/rate limits/timeouts
- do not expose synthetic metrics as production evidence

### 0.5 Persistence baseline

Identify current in-memory/file-backed prototype state and classify it:

- acceptable for current prototype
- must move to relational persistence now
- may wait for later phase

Do not migrate everything blindly. Prioritize workspace, source metadata, evaluation-relevant state, and durable user-facing data.

### 0.6 Security baseline

Document and test:

- workspace isolation
- authorized document access
- upload validation
- API input validation
- secret handling
- prompt injection boundaries
- model access to evidence

An assistant must not retrieve another workspace's evidence.

### 0.7 Reduce product-surface architecture jargon

Normal users should primarily see:

- Ask
- Documents/Knowledge
- Sources
- Settings

Advanced retrieval diagnostics may remain available separately.

### 0.8 Begin server modularization only where it reduces risk

`server.ts` is already a large integration surface.

Do not perform a giant aesthetic refactor.

Extract bounded modules when touching related functionality, such as:

```text
server/
  providers/
  retrieval/
  ingestion/
  evaluation/
  workspaces/
```

Preserve behavior with tests during extraction.

## Phase 0 deliverables

- benchmark leakage removed from production reasoning
- clean unseen-corpus benchmark
- provider interface/router
- honest live/simulated telemetry distinction
- measured retrieval/citation/refusal baseline
- documented workspace security boundaries
- regression suite for core grounded Q&A
- CI runs lint/build/critical checks

## Phase 0 exit gate

Do **not** start major Phase 1 work until:

- unseen-corpus evaluation runs without corpus-specific shortcuts
- citations are measurably tied to supporting evidence
- unsupported questions reliably abstain
- normal grounded Q&A uses the provider abstraction
- simulated metrics cannot be mistaken for live metrics
- core workspace isolation has executable coverage
- lint and build pass consistently

## Explicitly postpone

- large integration marketplace
- autonomous actions
- watch rules
- sophisticated BI dashboards
- multiple model providers just for variety
- custom foundation model work

---

# PHASE 1 — First-Class Structured Data

## Goal

Make spreadsheets and tabular business data a first-class knowledge source instead of treating them as text documents.

This phase creates the analytical foundation for later insights and actions.

## Main workstreams

### 1.1 XLSX and CSV ingestion

Support:

- CSV
- XLSX
- multiple sheets
- header detection
- basic delimiter/encoding handling
- preview before import
- file/version metadata

### 1.2 Schema inference

Infer:

- text
- integer
- decimal
- currency
- date/time
- boolean
- categorical fields
- likely identifiers
- missing values
- duplicates

Provide user correction when inference is uncertain.

### 1.3 Dataset model

Introduce durable concepts such as:

```text
Dataset
DatasetVersion
DatasetTable
DatasetColumn
ImportRun
DatasetSource
```

Every derived result must point to the exact dataset/version used.

### 1.4 Structured analytical storage

Use a real queryable structured representation.

Initial implementation may use PostgreSQL and/or DuckDB depending on workload.

Requirements:

- deterministic aggregation
- filtering
- grouping
- date-range comparisons
- safe derived metrics
- query timeout/row limits

Do not send entire large tables to an LLM for arithmetic.

### 1.5 Safe natural-language analytics

Question examples:

- How much revenue did we make last month?
- Which product sold the most?
- Which customers still owe money?
- Compare August and September revenue.

Execution should resemble:

```text
question
  ↓
intent / analytical plan
  ↓
validated structured query
  ↓
calculation
  ↓
result
  ↓
LLM explanation
```

### 1.6 Dataset evidence/provenance

Answers must show analytical provenance such as:

- dataset name
- dataset version
- sheet/table
- filters/date range
- metric/calculation
- affected row count

Where practical allow users to inspect contributing records.

### 1.7 Structured-data UI

Introduce a **Knowledge > Datasets** surface with:

- uploaded datasets
- import status
- schema preview
- tables/sheets
- column metadata
- data preview
- version/history

Avoid turning this into a full spreadsheet editor.

## Phase 1 deliverables

- production-quality CSV import
- practical XLSX import
- schema inference with correction UI
- durable dataset/version metadata
- safe structured query layer
- analytical Q&A routed separately from document RAG
- dataset provenance in answers
- test datasets covering messy real-world inputs

## Phase 1 exit gate

Phase 1 is complete when:

- uploaded CSV/XLSX data remains queryable as structured data
- common analytical questions return reproducible numbers
- calculations are not performed by free-form LLM arithmetic
- dataset version/source is visible for analytical claims
- malformed imports fail safely
- schema inference can be corrected by the user
- document questions and analytical questions route to the appropriate subsystem

---

# PHASE 2 — Discovery & Insights

## Goal

Move from **"ask me a question"** to **"I found something worth your attention."**

This is the first major step toward proactive company intelligence.

## Main workstreams

### 2.1 AnalysisRun model

Every discovery pass should be a recorded run with:

- source versions analyzed
- detectors executed
- start/end time
- status
- errors
- produced insight IDs

Runs should be repeatable and observable.

### 2.2 Insight model

Create a durable Insight entity including:

- type
- severity
- title
- human-readable explanation
- machine-readable metrics
- evidence/provenance
- confidence
- createdAt
- status
- acknowledgement/resolution
- related entities/records

### 2.3 Initial deterministic detectors

Start with understandable, testable detectors:

- TrendDetector
- PeriodComparisonDetector
- OverdueDetector
- DeadlineExtractor
- ThresholdDetector
- LowStockDetector where inventory semantics exist
- ChangeDetector

Only later add more exploratory detectors.

### 2.4 Anomaly detection

Introduce basic statistical anomaly detection once baseline data quality is known.

Do not label every fluctuation an anomaly.

Measure false positives.

### 2.5 LLM explanation layer

Detectors produce structured findings first.

Then the LLM may generate:

- concise explanation
- why it matters
- useful next questions

The LLM must not invent the underlying metric.

### 2.6 Insight ranking

Rank findings using factors such as:

- urgency
- severity
- financial impact
- confidence
- novelty
- affected records
- recency
- already acknowledged state

The goal is **few useful insights**, not hundreds of cards.

### 2.7 New Home and Insights UI

Begin evolving product navigation toward:

```text
Home
Ask
Insights
Knowledge
```

Home should prioritize:

- things needing attention
- important recent changes
- quick Ask entry

Documents/datasets move under Knowledge.

## Phase 2 deliverables

- AnalysisRun persistence
- Insight persistence
- initial detector framework
- 4–6 reliable detectors
- evidence-backed explanations
- insight ranking
- Home attention feed
- Insights filtering and evidence view

## Phase 2 exit gate

Phase 2 is complete when:

- insights are generated from real source data rather than hard-coded cards
- every insight can explain its evidence
- the same data produces reproducible detector output
- obvious false positives are measured and controlled
- users can acknowledge/resolve insights
- the Home page can surface a small prioritized set of useful findings

---

# PHASE 3 — Living Company Knowledge

## Goal

Move beyond disconnected files/tables and create an explicit model of company entities, relationships, facts, history, and source authority.

This phase enables cross-source reasoning and meaningful "what changed?" behavior.

## Main workstreams

### 3.1 Entity layer

Introduce normalized entities such as:

- Customer
- Supplier
- Product
- Project
- Employee
- Contract
- Order
- Invoice
- Policy

The generic knowledge layer should support domain-specific entity types without assuming every company has the same schema.

### 3.2 Relationship layer

Examples:

```text
Customer → placed → Order
Order → contains → Product
Product → suppliedBy → Supplier
Supplier → governedBy → Contract
Project → ownedBy → Employee
```

A dedicated graph database is optional. Start with relational structures unless evidence proves otherwise.

### 3.3 Fact / Observation / Inference model

Explicitly distinguish:

- Fact
- Observation
- Inference
- Prediction

Each must include provenance and confidence/authority where relevant.

### 3.4 Source authority

Implement configurable source authority and conflict representation.

Do not silently resolve disagreement by retrieval rank alone.

Example:

- approved policy says price = 5,000
- employee message says price = 4,000

System should surface the discrepancy.

### 3.5 Versioning

Version sources whose historical state matters:

- documents
- datasets
- policies
- important extracted facts

### 3.6 Business event history

Introduce events such as:

- DocumentUpdated
- DatasetImported
- OrderCreated
- PaymentReceived
- PolicyChanged
- DeadlineMoved

Initially some event types may come only from internal system changes; later integrations will contribute more.

### 3.7 "What changed?"

Build first-class comparison across source versions and business events.

Example output:

```text
Since Monday:
- revenue +8.3%
- 17 new orders
- 3 invoices became overdue
- 2 deadlines changed
```

### 3.8 Cross-source reasoning

Enable bounded flows such as:

- contract deadline + unpaid ledger
- sales velocity + inventory level
- specification requirement + project tracker absence

Cross-source conclusions must expose both source chains.

## Phase 3 deliverables

- entity/relationship model
- fact/observation/inference distinction
- source authority/conflict model
- source versioning
- business event log
- "What changed?" API and UI
- first cross-source reasoning workflows

## Phase 3 exit gate

Phase 3 is complete when:

- key company concepts can be represented independently of their original file format
- conflicting facts remain visible rather than being overwritten
- users can inspect historical versions
- the system can answer meaningful temporal questions
- "What changed?" is based on real diffs/events
- at least one cross-source workflow works with traceable evidence

---

# PHASE 4 — Safe Natural-Language Actions

## Goal

Allow language to become a safe interface for changing company state.

Knowledge AI moves from read-only intelligence to controlled operations.

## Main workstreams

### 4.1 Intent and action planning

Support a small initial action vocabulary, for example:

- create order
- record payment
- receive inventory
- update delivery date
- create task/reminder

Do not start with arbitrary CRUD over the entire database.

### 4.2 ProposedAction model

Every material operation should become a structured proposal before execution.

Store:

- parsed intent
- target entity
- proposed field changes
- calculated consequences
- source user message
- validation results
- risk level
- required approval

### 4.3 Entity resolution

Resolve references such as:

> Suman paid another 10,000.

The system must identify the correct Suman/order/payment target and ask when ambiguous.

### 4.4 Validation

Validate outside the LLM:

- numeric ranges
- record existence
- permissions
- allowed state transitions
- duplicate actions
- currency/business rules
- referential integrity

### 4.5 Approval flow

Risk classes:

- low
- medium
- high

Important writes show before/after preview and require explicit confirmation.

### 4.6 Transactional execution

Writes should be transactional where applicable.

A successful action should:

```text
validate
  ↓
write
  ↓
create BusinessEvent
  ↓
create AuditLog
  ↓
recompute affected metrics/insights
```

### 4.7 Audit history

Every material action includes:

- actor
- time
- original instruction
- before state
- after state
- approval
- execution result
- correlation ID

### 4.8 Export/sync boundary

Excel/CSV may be exported or synchronized where useful, but internal canonical structured state should not depend on mutating arbitrary uploaded spreadsheets directly.

## Phase 4 deliverables

- bounded action planner
- ProposedAction persistence
- entity resolution
- deterministic validation layer
- confirmation UI
- transactional write path
- BusinessEvent + AuditLog generation
- affected insights recalculated after writes

## Phase 4 exit gate

Phase 4 is complete when:

- supported actions work end-to-end from natural language
- ambiguous targets do not silently update the wrong record
- important writes show clear previews
- invalid writes are blocked deterministically
- every write is auditable
- repeat submissions are protected from accidental duplicate execution
- downstream state reflects successful updates

---

# PHASE 5 — Watch & Proactive Intelligence

## Goal

Make Knowledge AI monitor important conditions over time instead of requiring users to repeatedly ask.

## Main workstreams

### 5.1 WatchRule model

Represent persisted conditions such as:

```text
WHEN contract.expiry <= 30 days
WHEN unpaidInvoiceTotal > 500000
WHEN projectedStockDays < 7
WHEN weeklySalesDeviation > configured threshold
```

### 5.2 Natural-language watch creation

Example:

> Tell me if unpaid invoices exceed NPR 500,000.

LLM translates intent into a structured rule.

A deterministic validator ensures the rule is executable and safe.

### 5.3 Scheduler/background worker

Introduce durable background processing for:

- watch evaluation
- re-analysis
- deadline scans
- source refresh jobs

Jobs should be:

- idempotent
- observable
- retryable

### 5.4 Smart reminders

Support:

- time-based reminders
- source-relative reminders
- state-aware reminders
- condition-aware reminders

### 5.5 Alert lifecycle

Alerts need:

- created
- delivered/in-app surfaced
- acknowledged
- resolved
- snoozed where appropriate

### 5.6 Notification policy

Initially keep notifications in-app.

External email/push/Slack delivery can wait until integrations.

The first goal is correct monitoring, not notification-channel count.

## Phase 5 deliverables

- WatchRule model
- validated rule evaluator
- durable scheduler/worker
- smart reminders
- alert lifecycle
- Watch UI
- false-alert evaluation

## Phase 5 exit gate

Phase 5 is complete when:

- watch conditions persist and evaluate reliably over time
- simple rules do not require repeated LLM calls
- alerts link to the evidence/state that triggered them
- duplicate alerts are controlled
- users can acknowledge/resolve/snooze as appropriate
- background jobs survive normal application restarts/retries

---

# PHASE 6 — Integrations

## Goal

Reduce manual uploads by connecting Knowledge AI to systems businesses already use.

## Integration order

Do not add ten integrations at once.

Recommended progression:

1. cloud file source (Google Drive or similar)
2. spreadsheet source (Google Sheets / Microsoft workbook)
3. communication source (Gmail/Outlook/Slack/Teams depending user demand)
4. database connector
5. business systems such as CRM/accounting/project management
6. generic REST/webhook framework

## Core architecture requirements

Every integration must map into the same internal concepts:

```text
Source
SourceVersion
Provenance
Permissions
SyncRun
BusinessEvent
```

Do not create isolated one-off integration data models.

## Required capabilities

- OAuth/token lifecycle where applicable
- least-privilege scopes
- sync cursor/checkpoint
- incremental refresh
- retry/idempotency
- deletion/revocation handling
- source-level permission mapping where possible
- visible last-sync state

## Phase 6 exit gate

- at least two integrations use the same connector abstraction
- sync is incremental and recoverable
- provenance identifies the external record/source
- disconnected/revoked integrations fail safely
- authorization boundaries are enforced

---

# PHASE 7 — Controlled Automation

## Goal

Allow trusted low-risk actions to execute automatically under explicit workspace policy.

This is **not** unrestricted autonomy.

## Main workstreams

### 7.1 Policy engine

Define:

- which action types can auto-execute
- which roles may configure automation
- amount/risk thresholds
- target systems
- approval escalation rules

### 7.2 Automation modes

Possible modes:

```text
SUGGEST ONLY
REQUIRE APPROVAL
AUTO-EXECUTE LOW RISK
```

Default should remain conservative.

### 7.3 Rollback/recovery

Where the target system supports it, provide:

- inverse operation
- compensating action
- clear failure state

### 7.4 Automation quality analytics

Track:

- success rate
- rejection rate
- rollback rate
- human corrections
- false triggers
- time saved

## Phase 7 exit gate

- automation is governed by explicit policy
- high-risk actions cannot bypass approval by prompt instruction
- automatic actions remain fully auditable
- failures have defined recovery paths
- workspace admins can disable automation immediately

---

# PHASE 8 — Extensible Company Intelligence Platform

## Goal

Turn the mature product into a platform others can extend safely.

## Main workstreams

### 8.1 Developer APIs

Expose stable APIs for:

- sources
- Ask
- insights
- actions
- watches
- audit events

### 8.2 Tool/plugin framework

Allow custom tools with:

- schemas
- permission requirements
- rate limits
- risk classification
- audit integration

### 8.3 Custom detectors

Allow teams/developers to create domain-specific discovery logic.

Examples:

- restaurant food-cost detector
- SaaS churn-risk detector
- construction deadline detector

### 8.4 Domain packs

Package:

- schemas
- detectors
- suggested watches
- entity types
- prompts
- UI configuration

without forking the core product.

### 8.5 Deployment options

Explore only when product maturity justifies it:

- managed cloud
- BYOK
- enterprise provider controls
- self-hosted deployment

## Phase 8 exit gate

The platform phase is successful when extensions can add domain value without bypassing core provenance, permission, audit, and safety rules.

---

# 3. UI evolution by phase

The UI should evolve with capability rather than being redesigned from scratch every phase.

## Phase 0

```text
Ask
Documents
Sources
Settings
Quality/Admin
```

## Phase 1

```text
Ask
Knowledge
  Documents
  Datasets
Sources
Settings
```

## Phase 2–3

```text
Home
Ask
Insights
Knowledge
Settings
```

## Phase 4

Add:

```text
Actions / Approvals
Activity / Audit
```

## Phase 5+

Primary direction:

```text
Home
Ask
Insights
Knowledge
Watch
```

Advanced/admin:

```text
Actions
Integrations
Audit
Quality
Workspace Settings
Developer Settings
```

The normal UI should never become a menu of internal AI architecture names.

---

# 4. Suggested engineering modules over time

Do not create empty folders for every future idea immediately. Introduce modules as their phase begins.

Directional target:

```text
server/
  auth/
  workspaces/
  sources/
  ingestion/
  retrieval/
  providers/
  datasets/
  analytics/
  insights/
  knowledge/
  actions/
  watch/
  integrations/
  audit/
  jobs/
  evaluation/
```

Frontend direction:

```text
src/
  features/
    home/
    ask/
    insights/
    knowledge/
    actions/
    watch/
    settings/
  components/
  lib/
```

Do not reorganize solely to match this tree. Use it as a direction while extracting tested boundaries.

---

# 5. Data architecture progression

## Now / Phase 0

Use the current system while identifying persistence gaps.

## Phase 1 target

Introduce a relational persistence backbone for durable application/data state.

Preferred direction:

- PostgreSQL for application state and structured business data
- pgvector or a dedicated vector engine based on measured needs
- object storage for original files when moving beyond prototype scale
- DuckDB for analytical file workloads where useful

## Later

Add dedicated infrastructure only when justified:

- queue/worker system
- specialized vector database
- OLAP engine
- graph database

Infrastructure complexity is not a success metric.

---

# 6. Branch / work discipline

For each phase:

1. create a short phase audit before coding
2. list what already exists
3. mark components as KEEP / MODIFY / REMOVE / ADD
4. define the smallest coherent milestone
5. implement backend truth first where applicable
6. add frontend on real APIs, not fake duplicate state
7. add tests before declaring completion
8. update this roadmap with actual status

Recommended branch naming examples:

```text
phase-0/provider-abstraction
phase-0/benchmark-cleanup
phase-1/xlsx-ingestion
phase-1/analytics-query-layer
phase-2/insight-model
```

Large phases should be many small merges, not one giant branch.

---

# 7. Phase status tracking

Use this section as the high-level progress board.

| Phase | Name | Status |
|---|---|---|
| 0 | Trustworthy Knowledge Foundation | **Complete** |
| 1 | First-Class Structured Data | **Complete** |
| 2 | Discovery & Insights | **Complete** |
| 3 | Living Company Knowledge | **Complete** |
| 4 | Safe Natural-Language Actions | **Complete** |
| 5 | Watch & Proactive Intelligence | **Complete** |
| 6 | Integrations | **In Progress** |
| 7 | Controlled Automation | Planned |
| 8 | Extensible Platform | Future |

Update statuses only when phase exit gates are genuinely met.

Suggested status values:

- Planned
- In Progress
- Blocked
- Exit Gate Review
- Complete

---

# 8. Immediate next work — Phase 6

Phases 0–5 have passed their exit gates.

Continue with:

```text
6A. Shared IntegrationConnector + connection/sync models ← CURRENT
        ↓
6B. First live cloud-file connector
        ↓
6C. Second connector through the same abstraction
        ↓
6D. Incremental sync / retry / revocation / permission hardening
        ↓
6E. Integrations UI + final Phase 6 exit-gate audit
```

Phase 6A must establish the shared internal contract before provider-specific code spreads through the repository.

The continuity source of truth is:

`docs/MASTER_EXECUTION_HANDOFF.md`

Detailed current execution notes:

`docs/PHASE_6_PROGRESS.md`

---

# 9. Relationship to Builder Fest

The Emergent Builder Fest app is deliberately a thin vertical slice inspired by later phases:

```text
seeded/imported structured data     → Phase 1 concept
calculated insights                 → Phase 2 concept
natural-language payment update     → Phase 4 concept
activity history                    → Phase 3/4 concept
```

That does **not** mean the main repository should skip directly to Phase 4.

The hackathon is validating whether the product experience is valuable.

The main repository is building the trustworthy architecture required to make that experience real and scalable.

Useful lessons from the hackathon should be brought back into the main product as:

- UX findings
- user flows
- naming
- detector ideas
- action patterns
- demo datasets

Do not copy hackathon shortcuts into production architecture without review.

---

# 10. North-star checkpoint

At every phase review, ask:

> Does this move Knowledge AI closer to becoming a living, explainable intelligence layer for a company that can safely **read, understand, act, and watch**?

If a feature does not improve:

- trustworthy knowledge
- useful understanding
- safe action
- proactive attention

then it should be questioned before being added.
