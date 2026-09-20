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
A7 Production runtime PostgreSQL cutover              🚧 IN PROGRESS
  A7A Discovery / Insights runtime                     ✅ COMPLETE
  A7B Integrations runtime                             ✅ COMPLETE
  A7C Watch runtime                                    ✅ COMPLETE
  A7D Living Knowledge + Actions runtime                🚧 IN PROGRESS
```

A4 authoritative integrated workflow: `35458772829`.

A4 completion evidence:

`docs/PRODUCTION_A4_POSTGRES_WATCH_INTEGRATIONS.md`

## Current exact task

**Production Hardening A7D — Living Knowledge + Actions runtime PostgreSQL cutover**

A7A Discovery / Insights runtime is complete — workflow `35460199628`.

A7B Integrations runtime is complete — workflow `35517514449`.

A7C Watch runtime is complete — workflow `35518107862`.

Continue with the highest-risk remaining write path:

1. add selected Living Knowledge persistence for `KNOWLEDGE_AI_PERSISTENCE_MODE=postgres`
2. route structured Dataset projection into PostgreSQL Living Knowledge
3. route normal Company Knowledge HTTP reads through PostgreSQL
4. add async effective-company-state resolution over PostgreSQL claims
5. route normal Action proposal/refinement/list/detail/audit through PostgreSQL
6. execute production Action confirmation through the existing A3 relational transaction
7. preserve stale-state checks, source authority, idempotent replay, and audit semantics
8. prove integration-synchronized Dataset projection feeds PostgreSQL Living Knowledge
9. prove restart persistence and cross-account isolation
10. prove production mode does not mutate `data/company-knowledge.json` or `data/company-actions.json`
11. preserve file-mode Phase 3/4 behavior
12. after A7D, continue with Automation runtime cutover

A6 completion evidence:

`docs/PRODUCTION_A6_POSTGRES_DISCOVERY.md`
