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
