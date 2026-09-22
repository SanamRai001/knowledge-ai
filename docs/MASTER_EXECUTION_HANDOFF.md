# Knowledge AI — Master Execution Handoff

Last updated: **2026-09-18**

This is the **continuity source of truth** for continuing Knowledge AI development across chats/sessions.

If a new chat needs to continue this project, read this file first, then read the detailed phase file(s) referenced below.

---

# 1. Product north star

Knowledge AI is a living intelligence layer for a company.

It should:

```text
READ
  ↓
UNDERSTAND
  ↓
ACT
  ↓
WATCH
```

The product promise is:

> **Bring your company's information. Knowledge AI turns it into a living, explainable understanding of the business that can answer, discover, update, and monitor.**

The five user-facing product concepts are:

1. **Ask** — ask the company anything.
2. **Insights** — discover what the user did not know to ask.
3. **Knowledge** — inspect documents, datasets, entities, sources, relationships, conflicts, and history.
4. **Actions** — safely add/update company state through controlled natural-language operations.
5. **Watch** — continuously monitor deadlines, thresholds, anomalies, and important conditions.

Do not turn the product into a generic chatbot, generic BI dashboard, or giant ERP.

---

# 2. Non-negotiable architecture rules

These apply to every phase.

## Trust

- factual answers must be grounded in authorized evidence
- citations/provenance must point to evidence actually used
- unsupported questions should abstain
- source conflicts must remain visible
- AI inference must not silently become company fact
- account/workspace isolation must be enforced outside the LLM

## LLM boundary

Use LLMs for:

- language understanding
- flexible reasoning
- classification where rules are insufficient
- summarization
- explanation
- bounded parsing/planning

Use deterministic code for:

- arithmetic
- financial calculations
- thresholds
- state transitions
- permissions
- business validation
- database/state writes
- recurring watch evaluation
- audit/history
- idempotency

Core rule:

> **LLM for language and reasoning. Deterministic code for business truth.**

## Source truth

Original uploaded files remain immutable evidence where practical.

Confirmed company updates are stored separately as higher-authority company state rather than silently editing CSV/XLSX/PDF source bytes.

Historical source versions must remain historically reproducible.

## Testing

A phase is not complete because the UI looks correct.

Every phase must have executable regression/acceptance gates in CI.

---

# 3. Authoritative project documents

Read these when continuing development:

- `docs/MASTER_EXECUTION_HANDOFF.md` — this continuity document
- `docs/IMPLEMENTATION_ROADMAP.md` — detailed Phase 0–8 plan and exit gates
- `docs/LONG_TERM_PRODUCT_VISION.md` — long-term product/architecture vision
- `docs/PRODUCT_DIRECTION.md` — product direction/background
- `docs/EFFECTIVENESS_AUDIT.md` — earlier repository effectiveness audit

Completed phase records:

- `docs/PHASE_0_PROGRESS.md`
- `docs/PHASE_0_FINAL_AUDIT.md`
- `docs/PHASE_1_PROGRESS.md`
- `docs/PHASE_1_FINAL_AUDIT.md`
- `docs/PHASE_2_PROGRESS.md`
- `docs/PHASE_2_FINAL_AUDIT.md`
- `docs/PHASE_3_PROGRESS.md`
- `docs/PHASE_3_FINAL_AUDIT.md`
- `docs/PHASE_4_PROGRESS.md`
- `docs/PHASE_4_FINAL_AUDIT.md`

Current phase:

- `docs/PHASE_5_PROGRESS.md` once Phase 5 implementation begins

---

# 4. Current roadmap status

```text
Phase 0 — Trustworthy Knowledge Foundation          COMPLETE
Phase 1 — First-Class Structured Data               COMPLETE
Phase 2 — Discovery & Insights                      COMPLETE
Phase 3 — Living Company Knowledge                  COMPLETE
Phase 4 — Safe Natural-Language Actions             COMPLETE
Phase 5 — Watch & Proactive Intelligence            COMPLETE
Phase 6 — Integrations                              IN PROGRESS
Phase 7 — Controlled Automation                     PLANNED
Phase 8 — Extensible Company Intelligence Platform  FUTURE
```

Authoritative completed-phase gates:

| Phase | Final status | Authoritative gate |
|---|---|---|
| 0 | COMPLETE | Quality Gate `35356012529` |
| 1 | COMPLETE | Quality Gate `35363150876` |
| 2 | COMPLETE | Quality Gate `35366183054` |
| 3 | COMPLETE | Quality Gate `35368501600` |
| 4 | COMPLETE | Quality Gate `35371157626` |
| 5 | IN PROGRESS | not yet complete |
| 6 | PLANNED | — |
| 7 | PLANNED | — |
| 8 | FUTURE | — |

Do not mark a later phase complete until its exit gate is genuinely satisfied.

---

# 5. Phase 0 — Trustworthy Knowledge Foundation

## Goal

Make document Q&A trustworthy and measurable before expanding the product.

## Required work

- remove benchmark contamination from production reasoning
- clean unseen-corpus evaluation
- real LLM provider abstraction/router
- honest LIVE vs SIMULATED telemetry
- persistence/security baseline
- workspace isolation
- prompt-injection/evidence boundaries
- reduce user-facing architecture jargon
- modularize only where it reduces risk
- CI for core trust invariants

## Exit gate

Complete when:

- unseen-corpus evaluation has no corpus shortcuts
- citations are tied to evidence
- unsupported questions abstain reliably
- provider abstraction is authoritative
- live/simulated telemetry cannot be confused
- workspace isolation has executable proof
- lint/build/critical quality gates pass

## Current status

**COMPLETE**

See `docs/PHASE_0_FINAL_AUDIT.md`.

---

# 6. Phase 1 — First-Class Structured Data

## Goal

Treat CSV/XLSX as queryable structured business data, not text chunks.

## Required work

- CSV ingestion
- XLSX ingestion
- multi-sheet support
- schema inference/correction
- Dataset / DatasetVersion / table / column model
- immutable source versions
- deterministic filtering/aggregation/grouping/comparison
- safe natural-language analytical planning
- structured analytical provenance
- Datasets UI
- Ask routing between document RAG and structured analytics

## Exit gate

Complete when:

- structured imports remain queryable
- calculations are reproducible
- LLM is not doing row-by-row arithmetic
- exact dataset/version is visible
- malformed imports fail safely
- schema can be corrected
- document vs analytical routing is correct

## Current status

**COMPLETE**

See `docs/PHASE_1_FINAL_AUDIT.md`.

---

# 7. Phase 2 — Discovery & Insights

## Goal

Move from:

> “ask me something”

to:

> “I found something worth your attention.”

## Required work

- AnalysisRun model
- Insight model
- deterministic detectors
- trend/change detection
- overdue/outstanding detection
- inventory thresholds
- document deadlines
- data quality findings
- statistical anomaly detection
- customer concentration
- margin opportunities
- canonical deduplication
- deterministic priority
- OPEN / ACKNOWLEDGED / RESOLVED lifecycle
- first-class Insights UI
- evidence drill-down

## Exit gate

Complete when:

- findings come from real source data
- each finding has evidence
- detector results are reproducible
- false positives are controlled
- lifecycle works
- UI prioritizes a small useful attention feed

## Current status

**COMPLETE**

See `docs/PHASE_2_FINAL_AUDIT.md`.

---

# 8. Phase 3 — Living Company Knowledge

## Goal

Model company meaning independently of raw file format.

## Required work

- entities
- aliases
- relationships
- claims
- FACT / OBSERVATION / INFERENCE distinction
- source authority
- cross-source linking
- conflict preservation
- business events
- temporal history
- source snapshot/version identity
- deterministic “What changed?”
- first-class Knowledge UI

## Important architecture already implemented

Core company knowledge objects:

- `CompanyEntity`
- `CompanyRelationship`
- `KnowledgeClaim`
- `BusinessEvent`
- `KnowledgeProjectionRun`
- `KnowledgeConflict`

Initial entity types include:

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

Authority model includes:

- SIGNED_OR_APPROVED
- USER_CONFIRMED
- AUTHORITATIVE_SYSTEM
- STRUCTURED_SOURCE
- DOCUMENT_SOURCE
- USER_OBSERVATION
- AI_INFERENCE

## Exit gate

Complete when:

- business concepts exist independently of source file
- conflicts stay visible
- source/history is inspectable
- temporal questions work
- What Changed is based on real diffs/events
- at least one cross-source workflow has traceable evidence

## Current status

**COMPLETE**

See `docs/PHASE_3_FINAL_AUDIT.md`.

---

# 9. Phase 4 — Safe Natural-Language Actions

## Goal

Let users safely change company state using natural language without letting the LLM directly control business truth.

## Authoritative write path

```text
user instruction
      ↓
language parsing
      ↓
entity/effective-state resolution
      ↓
deterministic validation + calculation
      ↓
PROPOSAL
      ↓
explicit confirmation
      ↓
stale-state re-check
      ↓
USER_CONFIRMED company-state write
      ↓
BusinessEvent + action audit
      ↓
analytics / Insights refresh
```

## Implemented bounded actions

- RECORD_PAYMENT
- RECEIVE_INVENTORY
- UPDATE_STATUS

`CREATE_ORDER` exists in the type vocabulary but is **not yet executable**.

## Safety already implemented

- proposal causes no write
- exact before/after preview
- ambiguity becomes NEEDS_INPUT
- explicit candidate selection
- Confirm / Cancel
- stale-state blocking
- overpayment rejection
- idempotent repeated confirmation
- partial-write crash recovery
- action audit history
- account isolation
- immutable original source files
- USER_CONFIRMED authority
- effective-state overlays for analytics
- Discovery re-analysis after confirmation
- overlay provenance in Ask and Insights
- historical dataset versions remain immutable
- HTTP structured imports auto-project into Living Knowledge

## Exit gate

Complete when:

- supported actions work end-to-end
- ambiguity never silently updates wrong state
- important writes preview exact effects
- invalid writes are deterministically blocked
- every write is auditable
- duplicate/retry safety exists
- downstream state reflects successful writes

## Current status

**COMPLETE**

See `docs/PHASE_4_FINAL_AUDIT.md`.

---

# 10. Phase 5 — Watch & Proactive Intelligence

## Goal

Make Knowledge AI monitor important conditions over time instead of requiring the user to repeatedly ask.

This phase begins the **WATCH** part of the product.

## Required work

### 5A — Watch foundation

Introduce durable account-scoped:

- `WatchRule`
- `WatchEvaluation`
- `WatchAlert`
- `WatchDelivery` or in-app delivery state where useful

A watch must include:

- structured condition
- source/entity scope
- enabled/disabled state
- evaluation cadence/trigger mode
- current condition state
- last evaluated time
- last triggered time
- evidence/provenance
- rule version
- creator/origin
- lifecycle timestamps

Initial rule states should distinguish:

- ACTIVE
- PAUSED
- INVALID
- ARCHIVED

Initial alert states:

- OPEN
- ACKNOWLEDGED
- SNOOZED
- RESOLVED

### 5B — Deterministic rule evaluator

Start with conditions that can be evaluated reliably without recurring LLM calls.

Initial recommended conditions:

1. aggregate threshold
   - unpaid/outstanding total > X
2. entity numeric threshold
   - product stock <= reorder level
   - balance due > X
3. deadline window
   - contract/deadline within N days
4. state transition / change
   - status changed
   - fact changed
5. existing Insight condition
   - new HIGH severity insight of selected type

Do **not** begin with arbitrary free-form agents.

### 5C — Natural-language watch creation

Examples:

> Tell me if unpaid invoices exceed NPR 500,000.

> Warn me when Chair stock drops below its reorder level.

> Tell me 30 days before this contract expires.

Flow:

```text
language
  ↓
bounded parser / LLM parser fallback
  ↓
structured WatchRule draft
  ↓
deterministic validation
  ↓
preview
  ↓
save watch
```

Recurring evaluation should use the stored structured rule, not repeatedly call the LLM.

### 5D — Durable evaluation / worker model

Support recurring/background evaluation that is:

- idempotent
- observable
- retryable
- restart-safe

For the current repository architecture, first build the durable job/evaluation contract and deterministic evaluator.

Do not introduce heavy infrastructure until needed.

### 5E — Alert lifecycle and deduplication

A watch should not create a new alert every evaluation while the same condition remains true.

Expected behavior:

```text
condition false
   ↓
condition becomes true
   ↓
OPEN alert created
   ↓
next evaluation still true
   ↓
same alert updated / occurrence tracked
   ↓
condition becomes false
   ↓
alert resolves or becomes eligible for resolution
   ↓
condition becomes true again later
   ↓
new alert episode
```

Support:

- acknowledge
- resolve
- snooze
- reopen/new episode where appropriate
- occurrence count
- first triggered
- last triggered
- evidence

### 5F — Watch UI

Primary product direction:

```text
Home
Ask
Insights
Knowledge
Watch
```

Watch UI should include:

- active watches
- triggered alerts
- alert evidence
- last evaluation
- current condition state
- pause/resume
- acknowledge/resolve/snooze
- “create watch” natural-language flow
- rule details in business language

Avoid exposing scheduler/worker implementation jargon.

## Phase 5 exit gate

Phase 5 is complete when:

- watch conditions persist
- conditions evaluate reliably over time
- simple rules do not require repeated LLM calls
- alerts link to exact evidence/state
- duplicate alerts are controlled
- acknowledge/resolve/snooze work
- evaluation jobs survive normal restart/retry behavior
- account/workspace isolation is executable
- Watch UI exposes real persisted state rather than mock cards

## Current status

**COMPLETE**

### Completion evidence

- Final Phase 5 audit: `docs/PHASE_5_FINAL_AUDIT.md`
- Final integrated Quality Gate: `35376209226`
- Watch false-alert regression corpus: 8 cases, 0 false positives, 0 false negatives

Phase 5 is closed. Continue with Phase 6.
# 11. Phase 6 — Integrations

## Goal

Reduce manual uploads by connecting Knowledge AI to systems businesses already use.

## Recommended order

1. cloud files
2. spreadsheets
3. communications
4. databases
5. CRM/accounting/project systems
6. generic REST/webhook framework

## Required architecture

Every connector must map into:

- Source
- SourceVersion
- Provenance
- Permissions
- SyncRun
- BusinessEvent

Required capabilities:

- OAuth/token lifecycle where relevant
- least privilege
- cursor/checkpoint
- incremental refresh
- retry/idempotency
- deletion/revocation handling
- permission mapping where possible
- visible sync state

## Exit gate

Complete when:

- at least two integrations share one connector abstraction
- sync is incremental/recoverable
- provenance identifies external source/record
- revocation fails safely
- authorization boundaries are enforced

## Current status

**COMPLETE**

### Completion evidence

- Final Phase 6 audit: `docs/PHASE_6_FINAL_AUDIT.md`
- Final integrated Quality Gate: `35423633294`
- Live providers: Google Drive + Microsoft OneDrive
- Shared connector/sync/retry/recovery/UI architecture: PASS

Phase 6 is closed. Continue with Phase 7.

---
# 12. Phase 7 — Controlled Automation

## Goal

Allow trusted low-risk actions to execute automatically under explicit workspace policy.

This is not unrestricted autonomy.

## Required work

- policy engine
- action-type permissions
- role controls
- amount/risk thresholds
- escalation rules
- modes:
  - SUGGEST ONLY
  - REQUIRE APPROVAL
  - AUTO-EXECUTE LOW RISK
- rollback/compensating actions where supported
- automation quality analytics

Track:

- success
- rejection
- rollback
- human corrections
- false triggers
- time saved

## Exit gate

Complete when:

- automation is governed by explicit policy
- high-risk actions cannot bypass approval by prompt
- automatic actions remain auditable
- failures have recovery paths
- workspace admins can immediately disable automation

## Current status

**COMPLETE**

### Exact next implementation task

Start **Phase 7A — Automation policy foundation**.

1. audit the existing Phase 4 action types, risk classes, validation, confirmation, audit, and idempotency boundaries
2. define one authoritative `AutomationPolicy` model scoped by account/workspace
3. define policy modes:
   - SUGGEST_ONLY
   - REQUIRE_APPROVAL
   - AUTO_EXECUTE_LOW_RISK
4. keep the default mode conservative
5. define role/action/risk/amount/target constraints outside the LLM
6. add a deterministic policy evaluator that returns ALLOW / REQUIRE_APPROVAL / DENY with reasons
7. prove prompt text cannot override policy
8. prove unsupported/high-risk actions cannot auto-execute
9. add account isolation and immutable policy audit history
10. only after the policy engine is green, connect it to one existing low-risk Phase 4 action path

Continue from `docs/PHASE_7_PROGRESS.md`.

---


### Completion evidence

- Final Phase 7 audit: `docs/PHASE_7_FINAL_AUDIT.md`
- Final integrated Quality Gate: `35429595070`
- Controlled automatic action: RECEIVE_INVENTORY
- Emergency kill switch / recovery / compensation / quality analytics / Automation UI: PASS

Phase 7 is closed. Continue with Phase 8.

---
# 13. Phase 8 — Extensible Company Intelligence Platform

## Goal

Turn the mature product into a platform that others can extend without bypassing trust/safety.

## Required work

### Developer APIs

Expose stable APIs for:

- sources
- Ask
- insights
- actions
- watches
- audit events

### Plugin/tool framework

Require:

- schemas
- permissions
- rate limits
- risk classification
- audit integration

### Custom detectors

Allow domain-specific discovery logic.

Examples:

- restaurant food-cost detector
- SaaS churn detector
- construction deadline detector

### Domain packs

Package:

- schemas
- detectors
- suggested watches
- entity types
- prompts
- UI configuration

### Deployment options

Explore only when mature:

- managed cloud
- BYOK
- enterprise provider controls
- self-hosted deployment

## Exit gate

Complete when extensions can add domain value without bypassing:

- provenance
- permissions
- audit
- safety
- source authority

## Current status

**COMPLETE**

### Completion evidence

- Final Phase 8 audit: `docs/PHASE_8_FINAL_AUDIT.md`
- Final integrated Quality Gate: `35433633151`
- Stable Platform API guide: `docs/PLATFORM_API_V1.md`

The original Phase 0–8 product capability roadmap is complete.

### Exact next implementation task

Continue with **Production Hardening A1 — persistence forensic audit**.

Read `docs/PRODUCTION_HARDENING_ROADMAP.md` and inventory every mutable runtime store before introducing PostgreSQL.

1. audit existing public/developer endpoints, API-key auth, scopes, and DeveloperPlatform UI
2. define versioned external contracts for Sources, Ask, Insights, Actions, Watch, and Audit
3. keep experimental/admin-only cognitive/mediator internals out of the stable API
4. add capability metadata and explicit permission requirements per endpoint
5. enforce rate-limit / scope boundaries before exposing mutation-capable operations
6. add a stable API manifest/OpenAPI-style contract generated from authoritative definitions
7. add executable cross-account/scope regression coverage
8. only after the external contract is green, begin the plugin/tool framework

---

# 14. Current major technical limitations

These are important so a future chat does not falsely assume the system is production-complete.

## Persistence

Several newer subsystems still use ignored local JSON/file-backed runtime persistence.

Long-term production target remains transactional relational persistence, likely PostgreSQL.

## Cross-store transactions

Phase 4 implements idempotent recovery, but company knowledge + action execution are not yet one relational ACID transaction.

## Create Order

Not yet executable in Phase 4 despite existing in the action intent vocabulary.

## General semantic document writes

Not implemented.

## Authority administration

Authority levels exist, but there is not yet a full admin UI for configuring authoritative systems/sources.

## General entity resolution

Automatic cross-source matching remains deliberately conservative.

## Continuous monitoring

Implemented in Phase 5 for the bounded deterministic Watch rule set. Production persistence and distributed worker infrastructure remain future hardening work.

## External integrations

Phase 6 is complete for the first two cloud-file providers: Google Drive and Microsoft OneDrive. Production persistence/secret infrastructure remains future hardening work.

## Autonomous execution

Phase 7 is complete for the bounded RECEIVE_INVENTORY automation path. Broader autonomous write authority is not implied; every new automatic action must earn its own deterministic policy/validation/recovery coverage.

---

# 15. Current product/navigation state

Current main product surfaces include:

- Ask
- Update mode inside Ask
- Insights
- Knowledge
- Actions
- Watch
- Documents
- Datasets
- existing advanced/experimental/admin surfaces

**Watch is now a first-class product surface.**

Long-term normal-user navigation should converge toward:

```text
Home
Ask
Insights
Knowledge
Watch
```

with Actions/Audit/Integrations/Quality/Settings available as appropriate advanced surfaces.

---

# 16. Important implementation boundaries to preserve

## Experimental GraphRAG

The older `server/cognitiveEngine/knowledgeGraphEngine.ts` remains experimental.

Do not treat it as authoritative company memory.

The authoritative company-memory subsystem is under:

`server/companyKnowledge/`

## Confirmed state vs imported sources

Never mutate imported source bytes just to make current operational state appear updated.

Use higher-authority confirmed company-state claims and effective read overlays.

## Historical analytics

Do not apply current confirmed-state overlays to explicitly selected historical DatasetVersions.

## Discovery

Underlying measurements are deterministic.

The LLM may explain findings but does not invent the metric.

## Actions

Never add a hidden direct-write endpoint to normal product flows.

Material changes remain proposal → explicit confirmation unless Phase 7 policy explicitly and safely permits otherwise.

## Watch

Recurring simple rules should be evaluated deterministically from stored structured rules.

Do not pay for or depend on an LLM call every scheduled evaluation.

---

# 17. Branch/work discipline

For each phase/slice:

1. inspect current `main`
2. identify KEEP / MODIFY / REMOVE / ADD
3. implement the smallest coherent milestone
4. keep backend truth authoritative
5. wire frontend to real APIs
6. add executable proof
7. add proof to Quality Gate
8. fix regressions
9. update phase progress doc
10. mark complete only after integrated CI is green

Useful branch naming if branches are used:

- `phase-5/watch-foundation`
- `phase-5/rule-evaluator`
- `phase-5/natural-language-watch`
- `phase-5/alert-lifecycle`
- `phase-5/watch-ui`

Small coherent merges are preferred over large speculative rewrites.

---

# 18. How a new chat should continue

If the user says:

> “Continue Knowledge AI.”

or:

> “Continue where we left off.”

Do this:

1. open this file
2. check current GitHub `main`
3. check latest GitHub Actions Quality Gate
4. read the current phase progress file
5. continue from the **Exact next implementation task** in the current phase
6. do not redo completed phases unless a regression requires it

As of this document version:

> **Continue with Production Hardening C3 — Durable Object Backend + Document Source Migration.**

Phases 0–8 are complete.

Track A relational milestones:

- A1 forensic audit — COMPLETE
- A2 core PostgreSQL metadata — COMPLETE
- A3 Living Knowledge + Actions schema/repositories — COMPLETE
- A4 Watch + Integrations schema/repositories — COMPLETE
- A5 Automation + Platform schema/repositories — COMPLETE
- A6 Discovery / Insights schema/repositories — COMPLETE
- A7A Discovery / Insights runtime cutover — COMPLETE, workflow `35460199628`
- A7B Integrations runtime cutover — COMPLETE, workflow `35517514449`
- A7C Watch runtime cutover — COMPLETE, workflow `35518107862`
- A7D Living Knowledge + Actions runtime cutover — COMPLETE, workflow `35520216547`
- A7E Automation runtime cutover — COMPLETE, workflow `35520860881`
- A7F Platform runtime cutover — COMPLETE, workflow `35522567852`
- A7G Core metadata runtime cutover — COMPLETE, workflow `35523721395`
- B1 Identity & Authorization Forensic Audit — COMPLETE, evidence commit `7d001b38`
- B2A Human Identity Persistence Foundation — COMPLETE, workflow `35526535634`
- B2B1 Human Credential + Auth Session API — COMPLETE, workflow `35527482968`
- B2B2 HUMAN_SESSION Request Identity + Production Fallback Removal — COMPLETE, workflow `35528053793`
- B2C1 Core Browser Route Cutover: KB + Datasets + Query — COMPLETE, workflow `35555336358`
- B2C2 Insights + Company Knowledge Route Cutover — COMPLETE, workflow `35556818820`
- B2C3 Actions + Watch + Integrations + Automation Route Cutover — COMPLETE, workflow `35557668826`
- B2D1 Privileged Human Authorization + Platform Management — COMPLETE, implementation validation `35609479920`
- B2D2A Legacy Developer-Key Route Closure — COMPLETE, workflow `35610867425`
- B2D2B1 Automation Privileged Authorization + API-key Role Separation — COMPLETE, workflow `35614246876`
- B2D2B2 Integration Management Privileged Authorization — COMPLETE, workflow `35620617850`
- B2D3A Legacy/Prototype Route Quarantine Foundation — COMPLETE, workflow `35623669505`
- B2D3B1 Test / Stress / Evaluation / Audit Route Retirement — COMPLETE, workflow `35626642229`
- B2D3B2A Operations + Observability Route Retirement — COMPLETE, workflow `35629641464`
- B2D3B2B Tenant + SaaS Route Retirement — COMPLETE, workflow `35631363130`
- B2D3B3A Mediator Route Retirement — COMPLETE, workflow `35635059024`
- B2D3B3B RAG + Cognitive Route Retirement — COMPLETE, workflow `35736152396`
- B2D3B3C Phase 4 Route Retirement — COMPLETE, workflow `35742006196`
- B2D3B4 Retired Experimental Frontend Surface Cleanup — COMPLETE, workflow `35746192253`
- C1 Durable Source File/Object Storage Forensic Audit — COMPLETE, workflow `35749439403`
- C2 Source Object Metadata + Storage Abstraction Foundation — COMPLETE, workflow `35754956014`
- C3 Durable Object Backend + Document Source Migration — NEXT

A7G evidence: `docs/PRODUCTION_A7G_CORE_METADATA_RUNTIME.md`.

B1 evidence: `docs/PRODUCTION_B1_IDENTITY_AUTHORIZATION_AUDIT.md`.

B2A evidence: `docs/PRODUCTION_B2A_HUMAN_IDENTITY_FOUNDATION.md`.

B2B1 evidence: `docs/PRODUCTION_B2B1_AUTH_SESSION_API.md`.

B2B2 evidence: `docs/PRODUCTION_B2B2_REQUEST_IDENTITY.md`.

B2C1 evidence: `docs/PRODUCTION_B2C1_CORE_ROUTE_CUTOVER.md`.

B2C2 evidence: `docs/PRODUCTION_B2C2_INSIGHTS_COMPANY_KNOWLEDGE.md`.

B2C3 evidence: `docs/PRODUCTION_B2C3_PRODUCT_ROUTE_CUTOVER.md`.

B2D1 evidence: `docs/PRODUCTION_B2D1_PRIVILEGED_PLATFORM_MANAGEMENT.md`.

B2D2A evidence: `docs/PRODUCTION_B2D2A_LEGACY_DEVELOPER_ROUTE_CLOSURE.md`.

B2D2B1 evidence: `docs/PRODUCTION_B2D2B1_AUTOMATION_PRIVILEGED_AUTH.md`.

B2D2B2 evidence: `docs/PRODUCTION_B2D2B2_INTEGRATION_PRIVILEGED_AUTH.md`.

B2D3A evidence: `docs/PRODUCTION_B2D3A_ROUTE_QUARANTINE.md`.

B2D3B1 evidence: `docs/PRODUCTION_B2D3B1_INTERNAL_QUALITY_ROUTE_RETIREMENT.md`.

B2D3B2A evidence: `docs/PRODUCTION_B2D3B2A_OPERATIONS_OBSERVABILITY_RETIREMENT.md`.

B2D3B2B evidence: `docs/PRODUCTION_B2D3B2B_TENANT_SAAS_RETIREMENT.md`.

B2D3B3A evidence: `docs/PRODUCTION_B2D3B3A_MEDIATOR_ROUTE_RETIREMENT.md`.

B2D3B3B evidence: `docs/PRODUCTION_B2D3B3B_RAG_COGNITIVE_ROUTE_RETIREMENT.md`.

B2D3B3C evidence: `docs/PRODUCTION_B2D3B3C_PHASE4_ROUTE_RETIREMENT.md`.

B2D3B4 evidence: `docs/PRODUCTION_B2D3B4_RETIRED_FRONTEND_SURFACE_CLEANUP.md`.

C1 evidence: `docs/PRODUCTION_C1_OBJECT_STORAGE_FORENSIC_AUDIT.md`.

C2 evidence: `docs/PRODUCTION_C2_SOURCE_OBJECT_FOUNDATION.md`.

B2A provides durable human users, OWNER/ADMIN/MEMBER account memberships, revocable/expiring opaque browser sessions, membership-bound account selection, and session-scoped workspace selection.

B2B1 provides salted scrypt human credentials, one-time OWNER bootstrap, same-origin login, Secure/HttpOnly browser sessions, `GET /api/auth/me`, CSRF-protected logout, and durable session revocation.

B2B2 provides a distinct HUMAN_SESSION request identity carrying user, role, selected account/workspace, and session context. API keys remain a separate machine credential class. Production missing credentials fail closed; DEFAULT_WEB is explicit and non-production-only.

B2C1 migrates `/api/kb`, `/api/datasets`, and `/api/query` to the shared human-aware application identity middleware.

B2C2 now migrates `/api/insights` and `/api/company-knowledge` to the same boundary. HUMAN_SESSION mutations enforce same-origin + CSRF protection, machine API-key behavior remains intact, and cross-account raw-ID/header-spoofing checks remain denied.

B2C3 now migrates `/api/actions`, `/api/watch`, `/api/integrations`, and `/api/automation` to the shared human-aware boundary. HUMAN_SESSION Automation actors now carry durable user attribution and membership role, while API-key behavior remains separate.

Normal product-route browser identity cutover is now complete.

B2D1 now provides reusable HUMAN_SESSION OWNER/ADMIN authorization. `/api/platform-management` is human-admin-only, MEMBER and API_KEY are denied, key management uses PostgreSQL-authoritative runtime services, and `/api/platform/v1` remains API-key-only.

B2D2A now retires all legacy `/api/v1/developer/*` key-management endpoints with explicit 410 responses. The old hard-coded `acc_default` administration path and unauthenticated arbitrary-scope key creation are closed.

B2D2B1 now makes Automation policy administration HUMAN_SESSION OWNER/ADMIN-only. API-key `role:owner/admin/approver/operator` scopes no longer synthesize human Automation roles; machine actors remain SERVICE and can still participate only when an OWNER/ADMIN-authored policy explicitly allows API_KEY + SERVICE.

B2D2B2 now makes Integration lifecycle administration HUMAN_SESSION OWNER/ADMIN-only. API keys remain able to perform account-scoped reads and synchronization, but cannot act as browser Integration administrators. OAuth callback completion is additionally bound to the authenticated privileged session account, and Integration browser mutations send CSRF tokens.

B2D3A now inventories the remaining legacy/prototype HTTP families and enforces one reusable fail-closed quarantine boundary. Prototype/test/admin/research families are unavailable in production, explicit non-production compatibility is opt-in, intended API-key compatibility paths remain reachable, and legacy `/api/kb` fall-through cannot bypass the modern workspace router.

B2D3B1 now removes the legacy test/stress/eval/audit HTTP execution routes entirely while keeping their underlying runners/services available for CLI/CI. These families are now RETIRED and cannot be reopened by the non-production compatibility flag.

B2D3B2A now removes the prototype operations/observability HTTP control surfaces entirely while keeping operational and telemetry services directly importable. Both families are RETIRED and cannot be reopened by compatibility mode. Read-only `/api/v1/system/*` and `/api/v1/providers/*` compatibility remains intact.

B2D3B2B now removes the prototype tenant/SaaS HTTP administration layer entirely. Legacy tenant provisioning, API-key, billing, quota, governance, webhook, onboarding, and simulated-billing paths are RETIRED and cannot be reopened by compatibility mode. Supporting services remain internal, while modern HUMAN_SESSION OWNER/ADMIN Platform Management remains the authoritative key-admin boundary.

B2D3B3A now removes all prototype mediator HTTP exposure. The mediator family is RETIRED and cannot be reopened by compatibility mode; reusable orchestration, planning, disagreement, verification, adaptive, and benchmark internals remain directly importable. Supported API-docs/provider/system dependencies under `server/mediator/` remain intact.

B2D3B3B now removes all prototype RAG/Cognitive HTTP exposure. Both families are RETIRED and cannot be reopened by compatibility mode. The supported identity-aware `/api/query/ask` product contract remains intact, while RAG/Cognitive engines, telemetry, graph/index, and benchmark modules remain internally importable.

B2D3B3C now removes all legacy `/api/phase4/*` active-workspace convenience routes. The family is RETIRED and cannot be reopened by compatibility mode. Authenticated `/api/v1/ai/:ai_id/*`, modern workspace AI configuration, `/api/query/ask`, and governed memory/sandbox/learning internals remain intact.

B2D3B4 now removes retired Learning Lab, Advanced Orchestration, and Answer Diagnostics from the normal browser shell, deletes their isolated frontend component trees plus unused legacy ChatArea, repairs Trust Checks to use `/api/kb/run-tests`, and adds a source-wide guard against retired frontend API calls while preserving backend engines.

C1 now inventories every current source-byte/large-payload durability boundary, separates original bytes from derived document/Dataset payloads and structured state, documents Drive/OneDrive checkpoint risk, defines a provider-neutral SourceObject/SourceVersion contract, and adds an executable drift proof without changing runtime behavior.

C2 now provides PostgreSQL source object/version metadata, account-scoped repositories, database-enforced immutable source-version byte identity, provider-neutral byte-storage contracts, tenant-safe generated keys, and SHA-256/size integrity verification. Browser uploads, Dataset imports, and integration sync remain intentionally uncut-over.

Next, do **C3 only — Durable Object Backend + Document Source Migration**:

1. select/configure one production object-storage adapter behind `SourceByteStorage`
2. validate required storage environment/credentials without persisting or logging secrets
3. persist original PDF bytes and verify SHA-256/size before document processing is committed
4. create/link SourceObject + SourceVersion metadata to each uploaded document
5. expose only `sourceVersionId` to document domain state, never provider object keys
6. make document retry fetch exact durable bytes and genuinely re-run PDF parsing
7. preserve HUMAN_SESSION account/workspace authorization and deny arbitrary key access
8. define compensation for storage/metadata/parse failures
9. prove source-byte survival independently of local runtime `data/`
10. stop before Dataset or integration migration

Do not migrate Dataset analytical payloads, Drive/OneDrive source snapshots, workers/queues, or Track D workflows in C3.
