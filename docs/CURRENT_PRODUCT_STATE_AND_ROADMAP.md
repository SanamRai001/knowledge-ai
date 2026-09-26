# Knowledge AI — Current Product State & Post-Hardening Roadmap

Status: **Canonical roadmap after completion of Product Phases 0–8 and Production Hardening A–J**  
Updated: **2026-09-26**

This document answers three different questions clearly:

1. **What exists today?**
2. **What are we definitely doing next?**
3. **What might we add later if evidence justifies it?**

These categories must not be mixed.

A future idea is not a commitment.  
A committed roadmap item is not implemented until its exit gate passes.  
A completed capability should not be described as experimental unless it truly is.

---

# 1. Current product position

Knowledge AI is no longer only a document-chat prototype.

The product has matured into a private company intelligence platform built around five user-facing concepts:

1. **Ask** — evidence-grounded questions over authorized company knowledge.
2. **Insights** — deterministic and explainable findings from company data.
3. **Knowledge** — documents, datasets, entities, relationships, provenance, history, and conflicts.
4. **Actions** — governed natural-language proposals and confirmed writes.
5. **Watch** — durable proactive monitoring, alerts, and controlled automation.

Supporting product capabilities now also include:

- structured CSV/XLSX analytics
- Living Company Knowledge
- source/version provenance
- safe Action confirmation
- Watch rules
- Google Drive / Microsoft OneDrive integration flows
- controlled Automation policies
- developer/platform APIs
- organization/member administration
- privileged administration boundaries
- recovery/diagnostics UI

The original Product Phases **0–8 are complete**.

The Production Hardening roadmap **A–J is also complete**.

---

# 2. What is implemented today

## 2.1 Trustworthy Ask

Implemented:

- document-grounded Q&A
- retrieval + reranking
- hierarchical indexing
- knowledge-graph-assisted retrieval
- corrective/re-retrieval paths
- claim grounding checks
- citations/provenance
- abstention when evidence is insufficient
- conversational follow-up handling
- multilingual query support
- deterministic grounded fallback generation
- live Gemini generation path
- unseen-corpus and live-provider effectiveness gates

Trust remains a product invariant:

> The model may explain evidence, but it must not silently replace missing company evidence with general model knowledge.

## 2.2 Structured data and analytics

Implemented:

- CSV/XLSX ingestion
- typed Dataset/DatasetVersion state
- deterministic table arithmetic
- current and historical analytical versions
- durable source-byte storage
- durable analytical payload storage
- integrity verification
- restart reconstruction
- tenant isolation
- historical source/version provenance

## 2.3 Discovery and Living Company Knowledge

Implemented:

- deterministic insight/discovery infrastructure
- entities and relationships
- facts / observations / inferences
- source authority and conflict handling
- business event history
- cross-source reasoning foundations
- post-Action discovery refresh

## 2.4 Safe Actions

Implemented:

- structured Action proposals
- deterministic validation
- explicit confirmation
- idempotent execution
- transactional business mutation
- proposal/execution/audit persistence
- downstream refresh linkage
- concurrent duplicate protection
- crash-safe retry behavior

## 2.5 Watch and Automation

Implemented:

- Watch rules
- scheduled evaluation
- alert lifecycle
- deduplication / episode handling
- transactional Watch completion
- controlled Automation policies
- governed execution modes
- durable Automation jobs
- restart/retry safety
- policy and actor revalidation

Automation is intentionally controlled.

Knowledge AI is **not** designed as unrestricted autonomous software.

## 2.6 Integrations

Implemented production foundations include:

- shared integration contracts
- Google Drive
- Microsoft OneDrive
- OAuth lifecycle handling
- protected OAuth attempt state
- encrypted account-scoped secret storage
- immutable source snapshots
- provider version provenance
- incremental cursor/checkpoint behavior
- crash recovery
- durable worker execution
- exact-source idempotency

## 2.7 Durable production state

Implemented:

- PostgreSQL-authoritative relational state
- account/workspace isolation
- per-account active workspace selection
- durable source/version metadata
- S3-compatible source/object storage
- durable document payloads
- durable Dataset payloads
- relational workspace AI/chat/version/evaluation state
- integration checkpoint hardening
- transactional Action / Automation / Watch boundaries

Legacy local JSON paths are compatibility/development surfaces rather than production authority.

## 2.8 Identity and administration

Implemented:

- human users
- password authentication
- revocable/expiring browser sessions
- OWNER / ADMIN / MEMBER memberships
- API-key machine identity
- human-vs-machine authorization separation
- CSRF protection for browser mutations
- privileged platform administration
- organization/member administration
- role-aware application shell
- safe developer surface separation
- retired prototype/legacy HTTP surfaces

## 2.9 Workers and asynchronous execution

Implemented:

- PostgreSQL-backed durable worker jobs
- idempotent enqueue
- concurrency lanes
- SKIP LOCKED claim
- fenced leases
- heartbeat
- retry/backoff
- dead-letter state
- worker health/readiness
- graceful drain
- Action post-commit discovery workers
- Integration sync workers
- Automation execution workers

## 2.10 Secrets and operational security

Implemented:

- provider-neutral SecretStore/KMS boundary
- encrypted OAuth credential storage
- key rotation support
- secret lifecycle audit
- no plaintext OAuth credential persistence
- distributed API-key throttling
- distributed human-login throttling
- shared OAuth replay/expiry protection
- tenant-isolation stress coverage
- adversarial/race/idempotency testing

## 2.11 Observability and recovery

Implemented:

- request correlation
- HTTP/query/provider/PostgreSQL/worker telemetry
- privacy-safe tenant correlation
- real liveness/readiness boundaries
- dependency-aware readiness
- degraded-mode reporting
- backup/PITR evidence contracts
- object-storage protection checks
- isolated recovery validation
- restore/reconstruction drills
- recovery diagnostics UI

## 2.12 Build and release

Implemented:

- canonical npm lockfile
- exact Node/npm runtime expectations
- frozen CI installs
- reproducible production build
- non-root multi-stage production image
- separate web/worker runtime roles
- security headers and request-size controls
- graceful shutdown/drain
- immutable build-once release identity
- single-writer migration gate
- staging promotion gate
- SBOM generation/verification
- dependency/security gates
- container vulnerability checks
- forward-only rollback/recovery policy

## 2.13 UX/admin hardening

Implemented:

- session-aware shell
- role-aware navigation
- admin/developer separation
- organization/member management
- account switching
- recovery/diagnostics workspace
- dead experimental surface removal
- capability-oriented product copy

---

# 3. Completed roadmap history

## Product capability roadmap

```text
Phase 0  Trustworthy Knowledge Foundation       COMPLETE
Phase 1  First-Class Structured Data           COMPLETE
Phase 2  Discovery & Insights                  COMPLETE
Phase 3  Living Company Knowledge              COMPLETE
Phase 4  Safe Natural-Language Actions         COMPLETE
Phase 5  Watch & Proactive Intelligence        COMPLETE
Phase 6  Integrations                          COMPLETE
Phase 7  Controlled Automation                 COMPLETE
Phase 8  Extensible Platform                   COMPLETE
```

## Production hardening roadmap

```text
A  Relational persistence/runtime authority    COMPLETE
B  Identity, authorization, route hardening    COMPLETE
C  Durable object/source/workspace state       COMPLETE
D  Transaction boundaries                     COMPLETE
E  Worker/queue runtime separation             COMPLETE
F  Secret/KMS boundaries                       COMPLETE
G  Observability, backup, recovery             COMPLETE
H  Deployment and release engineering          COMPLETE
I  Load, abuse, adversarial stress             COMPLETE
J  Production UX/admin cleanup                 COMPLETE
```

Do not create a speculative **J7**.

Completed phases reopen only for a demonstrated regression.

---

# 4. Committed next roadmap — definitely planned

This is the next roadmap we intend to execute.

It is deliberately about **using the production machinery we already built** before inventing more architecture.

## L1 — Real staging promotion

Goal:

Run an actual staging release through the existing H4 build/promotion contract.

Required evidence:

- immutable source/build/image identity
- real managed PostgreSQL staging target
- real durable object-storage target
- configured SecretStore/KMS boundary
- separate web and worker roles
- migration single-writer success
- web readiness green
- worker readiness green
- no production credentials or resources reused in staging

Exit gate:

A reproducible release is promoted to staging using the same artifacts intended for production.

## L2 — Staging recovery and failure rehearsal

Goal:

Prove the deployed system behaves correctly under real infrastructure failure.

Required drills:

- web restart during normal traffic
- worker restart with queued jobs
- PostgreSQL reconnect/degraded state
- object-storage failure/degraded state
- provider outage
- OAuth secret rotation
- failed worker job / retry / dead-letter visibility
- backup/PITR restore rehearsal
- restored source/document/Dataset reconstruction

Exit gate:

The staging deployment meets the existing G2/G3/H3/H4 recovery contracts using real deployed infrastructure.

## L3 — Real pilot onboarding

Goal:

Put the complete product in front of a small number of real users/teams.

Definitely required:

- clear organization creation/onboarding
- account/member setup
- first workspace flow
- first document/Dataset import
- first grounded Ask
- first Insight
- first Watch
- first safe Action proposal/confirmation
- integration connection where useful
- useful empty/error/recovery states
- privacy/security expectations explained clearly

Exit gate:

A new pilot team can reach meaningful value without developer intervention for normal setup.

## L4 — Measured pilot quality loop

Goal:

Stop guessing which improvements matter.

Measure:

- grounded-answer success
- citation usefulness
- false refusal / unsupported-answer rate
- Dataset import failures
- Insight usefulness
- Watch false alerts
- Action rejection/correction rate
- Automation failure/recovery rate
- integration sync reliability
- queue latency/retries/dead letters
- onboarding drop-off
- slow/confusing product surfaces

Rules:

- prioritize measured pilot pain over speculative architecture
- do not add infrastructure just because it is fashionable
- preserve evidence, tenant isolation, idempotency, and auditability

Exit gate:

The highest-impact pilot problems have evidence-backed fixes and regression coverage.

## L5 — Production launch readiness

Goal:

Make an explicit release decision rather than treating “main is green” as equivalent to production readiness.

Required evidence:

- staging promotion evidence fresh
- recovery evidence fresh
- backups/PITR validated
- readiness green
- worker queues healthy
- security/adversarial gate green
- production configuration reviewed
- secret/KMS rotation path verified
- rollback/recovery procedure documented
- operator diagnostics usable
- launch smoke suite green

Exit gate:

Production launch is a deliberate, auditable promotion using the existing H4 release boundary.

---

# 5. Committed engineering rule after launch

After launch, new work must come from one of:

1. measured user/pilot evidence
2. a demonstrated reliability/security regression
3. a clearly approved product-capability roadmap

Do not restart speculative hardening just because the previous roadmap ended.

---

# 6. Future product options — not committed yet

These are valuable possibilities, but they are **not promises** and should not be described as active roadmap work until prioritized.

## 6.1 More integrations

Candidates:

- Google Sheets
- Microsoft workbook-specific workflows
- Gmail
- Outlook
- Slack
- Microsoft Teams
- PostgreSQL/MySQL read connectors
- CRM systems
- accounting systems
- project-management systems
- generic REST/webhook connector framework

Add integrations based on real user demand, not connector count.

## 6.2 External notification delivery

Current Watch/alert correctness matters more than channel count.

Possible later delivery:

- email
- Slack
- Teams
- push/mobile notifications
- webhooks

Any channel must preserve:

- tenant isolation
- deduplication
- delivery audit
- retry/idempotency
- user notification policy

## 6.3 Domain packs and custom detectors

Possible packs:

- restaurants
- SaaS
- retail/inventory
- construction/projects
- professional services
- HR/policy

A pack may bundle:

- entity schemas
- detectors
- watches
- action vocabulary
- recommended dashboards/views
- evaluation corpus

Core provenance/permissions/audit rules must still apply.

## 6.4 Forecasting and predictive intelligence

Possible later work:

- cash-flow trend forecasts
- stock-out projections
- churn/risk scoring
- deadline risk
- anomaly forecasting

Prediction must remain distinct from fact/observation.

Do not add predictive claims without calibration and error measurement.

## 6.5 Commercial features

If Knowledge AI becomes a commercial SaaS, possible additions include:

- usage visibility
- plan/entitlement management
- billing
- quota policy
- organization-level provider controls
- enterprise audit/export controls

Billing should not be built simply because the platform supports tenants.

## 6.6 BYOK / enterprise / self-hosting

Possible later deployment models:

- managed cloud
- BYOK model providers
- customer-managed KMS
- enterprise provider allowlists
- private networking
- self-hosted deployment

Only commit to these when a real customer/deployment requirement exists.

## 6.7 Specialized infrastructure only when measured

Possible future infrastructure:

- pgvector
- dedicated vector database
- graph database
- OLAP engine
- specialized queue system

Current rule:

> Do not replace working PostgreSQL/object-storage/worker foundations unless measurements prove the current design is the bottleneck.

Infrastructure complexity is not a product feature.

## 6.8 Broader source/file support

Potential later ingestion:

- DOCX
- PPTX
- images/scans with OCR
- email attachments
- additional structured exports

Each new format needs the same provenance, source-version, integrity, authorization, and reconstruction guarantees as existing sources.

---

# 7. Explicitly deferred / not a goal right now

Do not turn Knowledge AI into:

- a generic chatbot
- a giant ERP
- an unrestricted autonomous agent
- a generic BI dashboard
- an infrastructure-demo project
- a benchmark-gaming system

Do not prioritize:

- training a custom foundation model
- a graph database rewrite without evidence
- a vector-database rewrite without evidence
- dozens of shallow integrations
- autonomous high-risk writes
- cosmetic rewrites of stable product flows

---

# 8. Product decision filter

Before starting a new feature, ask:

1. Does a user or measured system signal justify it?
2. Does it improve **Ask, Insights, Knowledge, Actions, or Watch**?
3. Can it preserve evidence/provenance?
4. Can permissions be enforced outside the LLM?
5. Can retries be idempotent?
6. Can the state survive restart/redeploy?
7. Can the behavior be measured?
8. Is there a simpler way to achieve the same user value?

If the answer is mostly “no,” do not add it yet.

---

# 9. Canonical document roles

Use the documentation set like this:

- `README.md` — public technical/product overview
- `docs/PRODUCT_DIRECTION.md` — product contract and positioning
- `docs/LONG_TERM_PRODUCT_VISION.md` — long-range north star
- `docs/IMPLEMENTATION_ROADMAP.md` — historical Product Phase 0–8 roadmap
- `docs/PRODUCTION_HARDENING_ROADMAP.md` — historical A–J hardening roadmap
- `docs/CURRENT_PRODUCT_STATE_AND_ROADMAP.md` — **current implemented state + committed launch roadmap + optional future ideas**
- `docs/MASTER_EXECUTION_HANDOFF.md` — exact continuity/handoff for the next coding session

When documents disagree about what is current, this file and the latest merged evidence on `main` take precedence over older roadmap language.

---

# 10. Exact next objective

**L1 — Real staging promotion**

Do not start another speculative feature phase first.

The next meaningful proof is that the already-hardened system can be promoted into a real staging environment using the production release contract we built.
