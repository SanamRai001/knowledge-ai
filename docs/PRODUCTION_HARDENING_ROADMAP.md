# Knowledge AI — Production Hardening Roadmap

Status: **Current execution roadmap after Phase 0–8 product completion**  
Started: **2026-09-19**

## Why this roadmap exists

The original product capability roadmap is complete:

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
EXTENSIBLE PLATFORM
```

The next risk is no longer missing features.

The next risk is **prototype infrastructure underneath mature product behavior**.

Production hardening should therefore improve durability, authentication, transactions, worker safety, secret handling, deployment, and operational recovery while preserving every Phase 0–8 trust contract.

---

# Track A — Relational persistence backbone

## Goal

Move authoritative mutable application state from local JSON/file persistence into a transactional relational database.

Preferred initial target:

```text
PostgreSQL
```

## Start with an inventory, not a rewrite

Classify every current store as:

- relational migration required now
- object-storage metadata
- cache/ephemeral only
- benchmark/test only
- legacy/experimental
- may remain local for development

Likely first migration candidates:

1. accounts/workspaces
2. API keys / usage metadata
3. Datasets / DatasetVersions metadata
4. company entities / claims / relationships / events
5. Action proposals / audit
6. Watch rules / evaluations / alerts / jobs
7. integration connections / sync runs / import mappings
8. automation policy / execution / recovery / quality records
9. platform tool invocation audit
10. domain-pack installation state

## Required architecture

Introduce repository/service boundaries where missing.

Avoid business logic directly depending on SQL queries.

Target shape:

```text
service/domain logic
      ↓
repository interface
      ↓
PostgreSQL repository
      ↓
transaction boundary
```

Development-only file repositories may remain temporarily behind the same interface where useful.

## Migration rules

- migrations are versioned
- migrations are repeatable in CI
- existing local state is not silently discarded
- tenant/account ID is explicit in every tenant-owned table
- foreign keys enforce ownership relationships where appropriate
- uniqueness constraints enforce idempotency keys/fingerprints
- money uses exact decimal/integer representation
- timestamps use a consistent timezone strategy
- JSONB is used only where the schema is legitimately flexible

## Exit gate

Track A is complete when:

- authoritative user-facing state survives process/container replacement
- primary mutable state is PostgreSQL-backed
- account isolation is enforced both in code and database queries/constraints
- migrations run from an empty database in CI
- representative legacy file state can be migrated or intentionally abandoned through a documented migration path
- Phase 0–8 executable behavior remains green

---

# Track B — Real identity, organizations, and admin authorization

## Goal

Replace the legacy unauthenticated `acc_default` browser fallback for production deployments.

## Required work

- user identity
- organization/workspace membership
- authenticated sessions
- role model
- admin role
- developer-key management permission
- integration-management permission
- automation-policy administration permission
- source/authority administration permission

## B1 forensic audit checkpoint

Status: **COMPLETE** — evidence: `docs/PRODUCTION_B1_IDENTITY_AUTHORIZATION_AUDIT.md`.

B1 confirmed:

- browser requests currently have no real human session; missing credentials become unauthenticated `DEFAULT_WEB / acc_default`
- the existing `accounts` table is the correct initial organization/tenant boundary
- there are no user, account-membership, or browser-session tables yet
- active workspace selection is account-global rather than user/session scoped
- normal product routers blur browser and API-key credential classes through one `RequestIdentity`
- unauthenticated developer-key management and arbitrary legacy key scopes create a concrete machine-key privilege-escalation path
- automation policy administration is not role protected
- integration management has no dedicated management permission
- manual Action confirmation can create `USER_CONFIRMED` authority without an attributable human user
- multiple legacy/prototype admin and diagnostic route families remain outside the modern identity boundary

The implementation sequence is deliberately split into small slices:

1. **B2A — Human Identity Persistence Foundation** — COMPLETE, workflow `35526535634`
2. **B2B1 — Human Credential + Auth Session API** — COMPLETE, workflow `35527482968`
3. **B2B2 — HUMAN_SESSION request identity + production fallback removal** — COMPLETE, workflow `35528053793`
4. **B2C1 — Core browser route cutover: KB + Datasets + Query** — COMPLETE, workflow `35555336358`
5. **B2C2 — Insights + Company Knowledge route cutover** — COMPLETE, workflow `35556818820`
6. **B2C3 — Actions + Watch + Integration + Automation route cutover** — COMPLETE, workflow `35557668826`
7. **B2D1 — Privileged Human Authorization Foundation + Platform Management** — COMPLETE, implementation validation `35609479920`
8. **B2D2A — Legacy Developer-Key Route Closure** — COMPLETE, workflow `35610867425`
9. **B2D2B1 — Automation Privileged Authorization + API-key Role Separation** — COMPLETE, workflow `35614246876`
10. **B2D2B2 — Integration Management Privileged Authorization** — COMPLETE, workflow `35620617850`
11. **B2D3A — Legacy/Prototype Route Quarantine Foundation** — COMPLETE, workflow `35623669505`
12. **B2D3B1 — Test / Stress / Evaluation / Audit Route Retirement** — COMPLETE, workflow `35626642229`
13. **B2D3B2A — Operations + Observability Route Retirement** — COMPLETE, workflow `35629641464`
14. **B2D3B2B — Tenant + SaaS Route Retirement** — COMPLETE, workflow `35631363130`
15. **B2D3B3A — Mediator Route Retirement** — COMPLETE, workflow `35635059024`
16. **B2D3B3B — RAG + Cognitive Route Retirement or Migration** — COMPLETE, workflow `35736152396`
17. **B2D3B3C — Phase 4 Route Retirement or Migration** — COMPLETE, workflow `35742006196`
18. **B2D3B4 — Retired Experimental Frontend Surface Cleanup** — COMPLETE, workflow `35746192253`
19. **C1 — Durable Source File/Object Storage Forensic Audit** — COMPLETE, workflow `35749439403`
20. **C2 — Source Object Metadata + Storage Abstraction Foundation** — COMPLETE, workflow `35754956014`
21. **C3 — Durable Object Backend + Document Source Migration** — COMPLETE, workflow `35757955890`
22. **C4 — Durable Derived Document Payload + Workspace Reconstruction** — COMPLETE, workflow `35762662087`
23. **C5 — Dataset Source + Analytical Payload Migration** — COMPLETE, workflow `35886051635`
24. **C6 — Integration Snapshot + Checkpoint Commit Ordering** — COMPLETE, workflow `35892271035`
25. **C7 — Workspace Structured State Relational Migration** — NEXT

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

C3 evidence: `docs/PRODUCTION_C3_DOCUMENT_SOURCE_MIGRATION.md`.

C4 evidence: `docs/PRODUCTION_C4_DERIVED_DOCUMENT_RECONSTRUCTION.md`.

C5 evidence: `docs/PRODUCTION_C5_DATASET_DURABILITY.md`.

C6 evidence: `docs/PRODUCTION_C6_INTEGRATION_CHECKPOINT_HARDENING.md`.

B2A added durable users, OWNER/ADMIN/MEMBER account memberships, hashed opaque browser sessions, membership-bound selected accounts, and session-scoped selected workspaces.

B2B1 added salted scrypt human credentials, one-time OWNER bootstrap, same-origin browser login, secure HttpOnly session cookies, `/api/auth/me`, CSRF-protected logout, and durable session revocation.

B2B2 added distinct HUMAN_SESSION request identity, preserved API_KEY as a separate machine credential class, made DEFAULT_WEB explicit/non-production-only, and removed implicit production `acc_default` fallback from the identity boundary.

B2C1 migrated KB, Datasets, and Query to the human-aware application identity middleware while preserving API-key behavior and adding same-origin/CSRF protection for HUMAN_SESSION mutations.

B2C2 migrated Insights and Company Knowledge to the same human-aware application identity middleware while preserving machine API-key behavior and tenant isolation.

B2C3 migrated Actions, Watch, Integrations, and Automation to the same boundary, added HUMAN_SESSION Automation actor attribution, and completed normal product-route browser identity cutover.

B2D1 added reusable HUMAN_SESSION OWNER/ADMIN authorization, made Platform Management human-admin-only, moved key management to PostgreSQL-authoritative runtime services, and preserved `/api/platform/v1` as an API-key-only machine boundary.

B2D2A retired the legacy `/api/v1/developer/*` key-management routes with explicit 410 responses, removed hard-coded `acc_default` administration, and closed unauthenticated arbitrary-scope key creation.

B2D2B1 made Automation policy administration HUMAN_SESSION OWNER/ADMIN-only, removed API-key human-role synthesis, preserved machine Automation as SERVICE when explicitly allowed, and repaired Automation UI CSRF for human mutations.

B2D2B2 made Integration lifecycle administration HUMAN_SESSION OWNER/ADMIN-only, preserved account-scoped API-key reads/sync, added OAuth callback account matching, and repaired Integration UI CSRF.

B2D3A added an explicit legacy-route inventory and reusable fail-closed quarantine boundary, preserved intended API-key compatibility paths, blocked prototype/internal route families in production, and prevented legacy `/api/kb` fall-through.

B2D3B1 removed test/stress/eval/audit HTTP execution, retained the underlying quality services for CLI/CI, and made those route families permanently retired rather than compatibility-reopenable.

B2D3B2A removed prototype operations/observability HTTP exposure, retained reusable operational/telemetry services for internal use, permanently retired both route families, and preserved system/provider read-only compatibility.

B2D3B2B removed legacy tenant/SaaS HTTP administration, closed prototype tenant key/billing/quota/governance/webhook paths, retained the supporting services internally, and preserved modern Platform Management as the privileged key-admin boundary.

B2D3B3A removed all prototype mediator HTTP exposure, permanently retired the mediator route family, retained reusable orchestration/planning/verification/benchmark internals, and preserved supported API-docs/provider/system dependencies.

B2D3B3B removed all prototype RAG/Cognitive HTTP exposure, permanently retired both route families, preserved the identity-aware `/api/query/ask` product contract, and kept RAG/Cognitive engines, telemetry, graph/index, and benchmark modules available internally.

B2D3B3C removed all legacy `/api/phase4/*` active-workspace convenience routes, permanently retired the family, preserved authenticated `/api/v1/ai/:ai_id/*` compatibility, preserved modern workspace AI configuration and `/api/query/ask`, and kept governed memory/sandbox/learning internals available.

B2D3B4 removed retired experimental Learning Lab / Orchestration / Diagnostics entry points and their isolated component trees, removed the unused legacy ChatArea, repaired Trust Checks to use `/api/kb/run-tests`, preserved Unified Ask on `/api/query/ask`, and added a repository-wide frontend retired-API guard.

C1 inventoried browser uploads, Dataset imports, Drive/OneDrive sync, local workspace/document payloads, Dataset analytical payloads, retries/reprocessing, sample fixtures, and shadowed legacy upload handlers; defined the provider-neutral SourceObject/SourceVersion contract; and proved the current durability boundaries without changing runtime behavior.

C2 added PostgreSQL `source_objects` / immutable `source_versions`, account-scoped repositories, database-enforced source-version immutability, provider-neutral byte-storage contracts, tenant-safe generated storage keys, SHA-256/size verification, and cross-account PostgreSQL proofs while intentionally leaving all current upload/import/sync runtime paths unchanged.

C3 added an S3-compatible production object-storage adapter, durable PDF source persistence before parsing, opaque `sourceVersionId` document linkage, real retry/reprocessing from integrity-verified stored bytes, account/workspace-scoped source lookup, and tombstone/cleanup compensation while keeping Dataset/integration migration out of scope.

C4 added PostgreSQL-backed derived-document payload metadata, integrity-verified parsed-document JSON in durable object storage, PostgreSQL-mode document-corpus hydration before Unified Ask, opaque `derivedPayloadId` linkage, non-duplicating KnowledgeVersion refs, historical ref resolution, and durable version rollback while leaving chat/config/evaluation state and Dataset/integration payloads unchanged.

C5 added immutable durable CSV/XLSX SourceVersions, durable integrity-verified Dataset analytical payloads, PostgreSQL DatasetVersion linkage to source/payload integrity metadata, restart reconstruction of current and historical Dataset rows from object storage, cross-account/tamper guards, and failed-import compensation while keeping legacy local payloads compatibility-readable.

C6 linked external imports to immutable provider source snapshots, made exact provider versions idempotently reusable, added crash recovery from committed SourceVersion/DatasetVersion identity, repaired pre-C6 source linkage, and hardened the existing PostgreSQL checkpoint transaction so cursor movement requires READY/TOMBSTONE journal state, committed Dataset/source identity, and an exact completed Living Knowledge projection.

## Security rules

- browser identity must come from a session/auth boundary
- account/org selection must not trust request body/query/header fields
- API keys remain separate machine credentials
- API-key privileges must never imply browser admin privileges
- privileged admin operations require explicit role checks
- session invalidation/logout is supported
- audit privileged membership/role changes

## Exit gate

- no production request silently becomes `acc_default`
- normal browser routes are organization scoped
- admin-only controls are actually role protected
- account switching cannot cross membership boundaries
- API keys and human sessions remain distinct credential types

---

# Track C — Durable files and object storage

## Goal

Move original uploads and externally synchronized file bytes to durable object storage.

Candidates:

- S3-compatible object storage
- managed cloud object storage

## Required properties

- immutable source object/version identity
- SHA-256 content hash
- content type
- size limits
- tenant namespace
- retention policy
- safe deletion/tombstone handling
- signed/authorized retrieval
- no public bucket assumptions

## Exit gate

- source bytes survive application-container replacement
- Dataset/Document provenance points to durable source versions
- cross-tenant object access is denied
- object metadata is relationally linked to Source/SourceVersion

---

# Track D — Transaction boundaries and consistency

## Goal

Replace recovery-only consistency where a relational transaction can provide stronger correctness.

Priority workflows:

### Confirmed Action

Target:

```text
idempotency claim
+ company-state mutation
+ Action status
+ audit record
= one transaction where technically possible
```

### Controlled Automation

Target:

```text
policy decision
+ execution claim
+ state mutation
+ audit/recovery state
= explicit transactional workflow
```

### Integration checkpoint

A provider cursor must advance only after all required durable imports for that checkpoint are committed.

### Watch scheduling

Job claim/lease/evaluation state should have atomic database semantics.

## Exit gate

- crash points have documented outcomes
- duplicate processing is prevented by database-enforced idempotency where possible
- partial commits cannot silently report success
- compensation is used only where a single transaction cannot span the real external system

---

# Track E — Durable worker / queue infrastructure

## Goal

Move background work from in-process scheduling to a production worker model when deployment becomes multi-replica.

Candidate direction:

- PostgreSQL-backed job queue first, or
- Redis/managed queue only if justified by measured load

Workloads:

- Watch evaluation
- integration sync
- re-analysis
- detector runs
- scheduled reminders
- automation execution/recovery jobs

Requirements:

- atomic job claim
- lease/heartbeat
- retry/backoff
- dead-letter/failure state
- idempotency
- concurrency policy
- observability
- graceful shutdown
- restart recovery

## Exit gate

- multiple application replicas cannot duplicate the same job
- workers can restart without lost work
- failed jobs remain inspectable/retryable
- user-visible job state is truthful

---

# Track F — Production secret/KMS boundary

## Goal

Replace local encrypted credential files with managed secret storage.

Secrets include:

- OAuth refresh tokens
- provider client secrets
- LLM API keys where account/provider specific
- webhook signing secrets
- encryption keys

Requirements:

- secret values never enter ordinary application metadata
- key rotation
- credential deletion/revocation
- environment separation
- audit access where supported
- no secret material in logs
- no secret material in API responses

---

# Track G — Observability, backups, and operational recovery

## Required observability

Track:

- HTTP latency/error rates
- provider latency/failure/rate limit
- retrieval stages
- database pool/slow queries
- queue depth
- job failures/retries
- integration sync health
- Watch alert delivery
- Action/automation execution failure
- tenant-specific incident correlation without leaking data

## Backups

- PostgreSQL backup strategy
- object-storage version/retention strategy
- restoration runbook
- periodic restoration test

## Recovery objectives

Define:

- RPO
- RTO
- acceptable provider outage behavior
- degraded-mode behavior

---

# Track H — Deployment and supply-chain hardening

## Goal

Create repeatable production deployment.

Required work:

- production Docker image
- non-root runtime where practical
- health/readiness endpoints
- migration job
- immutable build
- environment validation
- dependency/security scanning
- lockfile discipline
- CSP/security headers
- HTTPS termination assumptions
- upload limits
- graceful shutdown
- reverse-proxy configuration
- staging environment
- deployment rollback

---

# Track I — Load, abuse, and security testing

Before broad public production use, add:

- concurrent tenant isolation tests
- API-key abuse/rate-limit tests
- large-file ingestion limits
- malformed XLSX/PDF tests
- OAuth callback abuse tests
- SSRF regression tests
- prompt-injection/evidence-boundary tests
- webhook signature tests when webhooks are introduced
- race-condition/idempotency tests
- sustained Watch/integration worker tests

Use measured thresholds rather than vague “handles scale” claims.

---

# Track J — Production UX/admin cleanup

Only after the infrastructure boundary is strong:

- consolidate normal-user navigation
- separate normal user vs admin/developer surfaces
- organization/member administration
- source-authority administration
- usage/billing visibility if commercialized
- production onboarding
- empty/error/recovery states
- deployment/provider diagnostics

Do not redesign core product flows merely for novelty.

---

# Exact next implementation task

## Production Hardening A1 — persistence forensic audit

Do **not** start by installing PostgreSQL and converting files blindly.

First:

1. enumerate every mutable persistence store in the repository
2. identify file path, owning module, record types, account scoping, write frequency, cross-store dependencies, and tests
3. classify each store:
   - migrate in first relational slice
   - migrate later
   - object storage
   - ephemeral/cache
   - test/experimental
   - legacy/remove
4. identify the smallest relational vertical slice that removes meaningful production risk
5. define initial PostgreSQL schema/migration/repository contracts for that slice
6. add migration tests before switching runtime behavior
7. preserve all Phase 0–8 gates during migration

Recommended first vertical slice:

```text
accounts/workspaces
+ API keys
+ Dataset metadata/version metadata
```

This establishes tenancy, credential ownership, and a major data-source backbone before migrating higher-level Actions/Watch/Automation state.

---

# Completion principle

Production hardening is successful when Knowledge AI can be deployed, restarted, scaled, recovered, and administered without violating the trust contracts already proven by the product roadmap.

Infrastructure maturity—not feature count—is now the priority.


## A1 completion evidence

Persistence forensic audit:

`docs/PRODUCTION_PERSISTENCE_AUDIT.md`

A1 findings:

- current JSON stores must not be migrated 1:1
- workspace metadata must be split from document/chat/evaluation payloads
- global `activeKbId` must become per-account active-workspace state
- Dataset metadata must be split from full analytical row payload
- API keys are a first-slice relational target
- integration OAuth secrets remain outside ordinary relational tables
- telemetry/rate limits/OAuth state remain separate ephemeral infrastructure concerns

## Previous milestone

**Production Hardening A2 — PostgreSQL foundation + repository contracts — COMPLETE**

See the A2 completion evidence below.


## A2 completion evidence

Production Hardening A2 is complete.

Authoritative integrated workflow:

`35435257972`

Both required jobs passed:

- `quality` — all Phase 0–8 regression gates, TypeScript, production build, unseen benchmark, and live Gemini benchmark
- `Production A2 PostgreSQL` — real PostgreSQL 16 migration/import/isolation proof

Verified:

- optional PostgreSQL runtime configuration preserves file-mode development
- connection pool + transaction helper
- checksum-safe versioned migration runner
- migration `001_core_metadata.sql`
- accounts / workspaces / per-account active workspace
- API-key metadata / usage
- Dataset / DatasetVersion metadata / import-run metadata
- explicit `account_id` ownership on tenant-owned DatasetVersion rows
- relational current-version ownership constraints
- account-scoped PostgreSQL repositories
- legacy metadata snapshot adapter
- legacy Dataset payload compatibility adapter
- dry-run legacy importer
- ID-preserving idempotent legacy import
- source JSON remains unchanged
- raw API secrets are absent from PostgreSQL
- cross-account workspace/key/dataset metadata access is blocked
- cross-account DatasetVersion/import-run relationships are rejected by the database
- migrations are repeatable against an empty PostgreSQL database

A2 intentionally does **not** switch every runtime service to PostgreSQL yet.

## Current exact next work

**Production Hardening A3 — Living Knowledge + Actions relational persistence**

1. audit CompanyKnowledgeStore and ActionStore record/write dependencies
2. add migration 002 for company entities, relationships, claims, business events, projection runs, action proposals, action executions, and action audit entries
3. put account ownership and idempotency/relationship constraints in PostgreSQL
4. define repository contracts and PostgreSQL adapters for Living Knowledge + Actions
5. create explicit legacy importer for A3 records
6. introduce transaction boundaries for confirmed action execution where relational state can be committed together
7. preserve effective-state authority semantics and Action stale/idempotency behavior
8. add an isolated PostgreSQL A3 proof
9. keep the full Phase 0–8 Quality Gate green


---

# Current relational execution status — 2026-09-19

```text
A1 Persistence forensic audit                         ✅ COMPLETE
A2 Core PostgreSQL metadata                           ✅ COMPLETE
A3 Living Knowledge + Actions PostgreSQL              ✅ COMPLETE
A4 Watch + Integrations PostgreSQL                    ✅ COMPLETE
A5 Automation + Platform state PostgreSQL             ✅ COMPLETE
A6 Discovery + Insights PostgreSQL                    ✅ COMPLETE
A7 Production runtime PostgreSQL cutover              ✅ COMPLETE
  A7A Discovery / Insights runtime                     ✅ COMPLETE
  A7B Integrations runtime                             ✅ COMPLETE
  A7C Watch runtime                                    ✅ COMPLETE
  A7D Living Knowledge + Actions runtime               ✅ COMPLETE
  A7E Automation runtime                               ✅ COMPLETE
  A7F Platform runtime                                 ✅ COMPLETE
  A7G Core metadata runtime                            ✅ COMPLETE
```

A4 authoritative integrated workflow: `35458772829`.

A4 completion evidence:

`docs/PRODUCTION_A4_POSTGRES_WATCH_INTEGRATIONS.md`

## A7G completion evidence

Core metadata runtime cutover:

`docs/PRODUCTION_A7G_CORE_METADATA_RUNTIME.md`

Authoritative integrated workflow:

`35523721395`

A7G verifies PostgreSQL-authoritative API-key/usage metadata, workspace metadata + per-account active selection, and Dataset/DatasetVersion/import-run metadata with restart reconstruction and account isolation.

### Track A verdict

**Core relational backbone: COMPLETE.**

Remaining local workspace/document and analytical row payloads are explicit **Track C** durability work rather than hidden relational metadata debt.

## Current exact task

**Production Hardening C7 — Workspace Structured State Relational Migration**

Keep this slice limited to removing the remaining production dependency on local `data/knowledge_bases.json` structured workspace state.

1. add PostgreSQL models/repositories for KnowledgeVersion metadata + durable document refs
2. add account/workspace-scoped relational chat history persistence
3. add relational Specialized AI configuration persistence
4. add relational evaluation test-case and evaluation-run persistence
5. treat PostgreSQL workspace metadata + C4 durable document payloads + C7 structured state as sufficient to reconstruct a workspace shell when the local compatibility file is absent
6. retire production authority of legacy global active-workspace state; session/account selection remains authoritative
7. preserve file-mode development compatibility without letting local JSON override PostgreSQL in production
8. preserve existing Unified Ask, historical version, rollback, AI config, chat, and evaluation API behavior
9. add restart reconstruction + cross-account isolation proofs for every migrated structured-state family
10. stop before worker/queue, secret-manager, or broad Track D workflow work

Do not re-migrate C3/C4 document bytes/payloads, C5 Dataset payloads, C6 integration snapshots, workers/queues, or unrelated Track D workflows in C7.
---

# Track A closure note

Track A's relational metadata/state objective is complete. Full production durability still depends on Track C for user payload bytes and on later tracks for identity, workers, secrets, observability, deployment, and abuse testing.
