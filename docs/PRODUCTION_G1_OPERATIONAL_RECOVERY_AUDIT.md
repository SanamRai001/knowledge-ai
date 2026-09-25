# Production G1 — Observability, Backup, and Operational Recovery Forensic Audit

Date: **2026-09-25**

Status: **IMPLEMENTED — awaiting integrated Quality Gate validation.**

## Verdict

Knowledge AI now has strong **durable operational state**, but it does not yet have a complete production observability and recovery plane.

The repository currently contains three very different classes of operational data:

1. **authoritative durable state** in PostgreSQL:
   - worker jobs
   - Integration sync runs/import journal/checkpoints
   - Watch jobs/evaluations/alerts
   - Action executions/audit
   - Automation runs/approvals/control
   - SecretStore audit events
2. **real but ephemeral runtime signals**:
   - process startup/shutdown logs
   - worker-cycle errors
   - per-call provider latency/failure results
3. **prototype/synthetic observability fixtures**:
   - mediator Phase 7/8 readiness/telemetry data
   - simulated provider health profiles
   - seeded in-memory SLI/SLO traces

The third class must **not** be presented as production-observed health.

The highest-priority G1 conclusion is:

> Production observability should be derived from real request/provider/database/worker/domain events and durable state, while the existing mediator readiness/telemetry harness remains test/research infrastructure.

G1 does not choose a monitoring vendor and does not implement deployment.

---

# 1. Current signal inventory

## 1.1 HTTP

Current production-compatible surface:

- `GET /api/health`
  - returns process-level `status: ok`
  - no PostgreSQL check
  - no object-storage check
  - no SecretStore/KMS check
  - no worker state
  - classification: **LIVENESS ONLY**

Other compatibility endpoints:

- `GET /api/v1/system/health`
- `GET /api/v1/system/readiness`
- `GET /api/v1/system/readiness-report`

These use `SystemReadinessService`, which currently contains hard-coded/synthetic values such as:

- fixed API latency
- `in-memory-with-audit-ledger`
- fixed performance/reliability statistics
- legacy active-kb assumptions

Classification:

**PROTOTYPE / NON-AUTHORITATIVE FOR PRODUCTION HEALTH**

They may remain compatibility surfaces, but G2 must not use them as the production readiness source without replacing their internals.

### Missing HTTP production signals

No global production middleware currently guarantees:

- route-template request counts
- latency histograms
- status-class error counts
- global request/trace correlation
- normalized error categories
- privacy-safe tenant correlation

Some compatibility routes create request IDs, but the behavior is not a global product contract.

---

# 2. Provider signals

## Gemini

`GeminiProvider.generate()` already returns real per-call:

- latency
- measured token counts when the SDK supplies them
- success/failure
- normalized failure category
- retryability
- status code where available

Failure categories include:

- RATE_LIMITED
- AUTHENTICATION
- TIMEOUT
- UNAVAILABLE
- INVALID_REQUEST
- PROVIDER_ERROR

This is a strong instrumentation seam.

Current gap:

The measurements are returned to callers but are not aggregated into a production metric/event sink.

`GeminiProvider.healthCheck()` only verifies whether configuration exists. It intentionally performs no billable provider probe.

Classification:

**REAL PER-CALL SIGNAL, NOT YET AGGREGATED**

## Legacy mediator provider health

`RealProviderAdapter` explicitly identifies itself as a simulation harness.

Its health profiles use:

`validationSource: SIMULATED`

The `/api/v1/providers/health` compatibility route reads those simulated profiles.

Classification:

**SIMULATED — DO NOT USE FOR PRODUCTION PROVIDER SLOs**

---

# 3. Retrieval/query signals

The current product query path has strong correctness/effectiveness tests, but there is no production-wide runtime metric contract for:

- retrieval stage latency
- retrieval-stage failures
- grounding fallback frequency
- deterministic-vs-provider answer mode
- evidence/verification-stage duration

Existing RAG/Cognitive telemetry stores are intentionally retired/prototype surfaces and must not be revived as the production monitoring backend.

Classification:

**QUALITY-PROVEN; PRODUCTION RUNTIME TELEMETRY INCOMPLETE**

---

# 4. PostgreSQL signals

Current PostgreSQL runtime provides:

- bounded pool size
- application name
- explicit transactions
- deterministic migration/checksum tracking
- fail-closed configuration validation

Current missing production instrumentation:

- active/idle/waiting pool gauges
- connection acquisition latency
- query duration
- slow-query threshold/event
- transaction duration
- database error category/count
- statement timeout policy
- readiness timeout contract

Raw SQL and bound values must never become metric labels.

Classification:

**STRONG DATA LAYER; OBSERVABILITY GAP**

---

# 5. Durable worker/queue signals

The E2 worker foundation is one of the strongest current operational seams.

`worker_jobs` durably tracks:

- account
- job type
- status
- priority
- attempt count
- max attempts
- next-attempt time
- lease owner/token/expiry
- heartbeat time
- start/completion time
- last error
- idempotency key
- concurrency key

Statuses:

- PENDING
- RUNNING
- SUCCEEDED
- FAILED
- DEAD_LETTER

The worker runtime additionally identifies:

- stale jobs recovered
- jobs claimed
- jobs succeeded
- jobs retrying
- jobs failed
- dead letters
- lease loss

Current gaps:

- no standardized queue-depth metric
- no job-age metric
- no persistent worker-process heartbeat/readiness record
- worker-cycle failures are console-only
- no canonical alert threshold for dead letters or queue lag

Classification:

**AUTHORITATIVE DURABLE STATE; METRIC/ALERT CONTRACT NOT YET WIRED**

---

# 6. Integration sync signals

Integration hardening already provides durable operational truth through:

- connection status
- durable sync runs
- external import journal
- provider cursor/checkpoint
- sourceVersion linkage
- worker jobs
- retry state
- attention reason
- failure classification

Failure categories distinguish:

- authorization
- permission
- rate limit
- transient/provider failure
- cursor invalid
- conflict
- unsupported/data invalid
- unknown

This is enough to derive real production Integration health.

Current gaps:

- no canonical aggregate success/failure metric
- no last-success / sync-lag gauge contract wired
- no standardized alerting threshold
- no cross-provider operational dashboard/event stream

Classification:

**AUTHORITATIVE DURABLE STATE; OBSERVABILITY AGGREGATION MISSING**

---

# 7. Watch signals

Durable Watch state includes:

- rule status
- WatchJob status/attempts/schedule
- WatchEvaluation success/failure
- observed condition/evidence
- WatchAlert status and occurrence history
- scheduling/retry state

This can derive:

- evaluation success rate
- job lag
- failed-job rate
- open-alert count

Important limitation:

A WatchAlert is currently a product-domain alert episode. G1 does not assume an external notification-delivery subsystem exists.

Therefore “Watch alert delivery” monitoring currently means:

- scheduled evaluation completed
- alert episode mutation committed

not email/SMS/push delivery.

Classification:

**AUTHORITATIVE DURABLE STATE**

---

# 8. Action and Automation signals

Confirmed Actions durably expose:

- proposal status
- execution identity
- execution mode
- authorization context
- downstream worker linkage/warnings
- Action audit entries

Automation durably exposes:

- run status
- attempts/max attempts
- failure category
- retryability
- policy/version
- execution identity
- compensation/recovery state
- human feedback

Automation already has a product quality summary.

Current gap:

These are not yet emitted through one operational metric/log contract.

Classification:

**AUTHORITATIVE DURABLE STATE**

---

# 9. SecretStore/KMS operational signals

F2 provides durable SecretStore audit events with:

- account
- secret ID
- purpose/provider
- operation
- secret version
- timestamp
- outcome
- error code

Secret values are not part of the audit row.

This is an excellent production audit seam.

## Recovery dependency

The PostgreSQL backup contains encrypted secret versions.

The key material does **not** live in PostgreSQL.

The current KMS implementation depends on deployment-managed:

- `KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID`
- `KNOWLEDGE_AI_SECRET_KEYRING_JSON`

If a required historical key ID is missing, restore/decryption fails closed.

Therefore:

> A PostgreSQL backup alone is not a complete OAuth-credential backup.

Required recovery set:

1. PostgreSQL encrypted SecretStore records
2. separately protected keyring/KMS key versions required by those records
3. application configuration identifying the active key
4. SecretStore audit/version metadata

Never copy plaintext OAuth tokens into a backup/runbook artifact.

Classification:

**DURABLE ENCRYPTED STATE + EXTERNAL KEY-LIFECYCLE DEPENDENCY**

---

# 10. Object-storage durability and retention

C3–C6 make original/derived document and Dataset/provider snapshot bytes durable through the S3-compatible storage contract.

Relational source metadata tracks:

- SHA-256
- size
- backend/key
- immutable source version
- ACTIVE / TOMBSTONED / PURGE_PENDING state

The application verifies payload integrity after read.

## Current recovery gap

The repository does not currently verify or configure:

- bucket/object versioning
- recoverable-delete window
- replication
- backup policy
- lifecycle policy
- object-lock/legal-hold behavior

Application workflows may physically delete an object after transitioning metadata through `PURGE_PENDING`.

That is correct application lifecycle behavior, but it is not sufficient protection against:

- accidental administrative deletion
- credential misuse
- provider-side corruption
- bucket-level configuration mistakes

Minimum future policy:

- versioning or equivalent recoverable-delete mechanism
- at least **30 days** recoverability for accidentally deleted/non-current user payloads
- integrity sampling against relational SHA-256
- restore drill that reconstructs a workspace/Dataset from restored database + restored object bytes

Classification:

**DURABLE OBJECTS; BACKUP/VERSIONING POLICY NOT YET ENFORCED**

---

# 11. PostgreSQL backup/restore audit

The repository currently has:

- ordered forward migrations
- migration checksums
- transactional migration application
- PostgreSQL-authoritative production state

The repository currently does **not** contain:

- a PostgreSQL backup command/job
- PITR/WAL configuration
- backup retention configuration
- automated restore script
- restoration runbook
- periodic restore test
- backup freshness metric

PITR capability therefore depends entirely on the eventual deployment/database provider and is not yet a Knowledge AI production guarantee.

## Restore compatibility contract

A supported restore must:

1. restore PostgreSQL to an isolated target
2. make all required KMS/key versions available separately
3. restore/verify required object-storage versions
4. verify `schema_migrations` checksums
5. run only forward migrations required by the target application build
6. verify source/payload references and hashes
7. verify SecretStore decryption for a safe test credential fixture
8. verify worker jobs/leases recover safely
9. run focused production-hardening smoke checks
10. switch traffic only after readiness passes

Do not run an older application build against a newer restored schema unless that compatibility was explicitly proven.

---

# 12. Health vs readiness contract

## Liveness

Purpose:

“Is this process/event loop alive enough for the supervisor to decide whether to restart it?”

The current `/api/health` may remain a liveness endpoint.

Liveness must not depend on external providers.

## Web readiness

A production web process should be ready only when:

- process role is valid
- production persistence configuration is valid
- PostgreSQL responds within a bounded timeout
- required schema for the running build exists
- durable object-storage configuration is valid
- SecretStore/KMS configuration required by enabled Integration features is usable
- startup/bootstrap state completed

External Gemini/Drive/OneDrive availability should **not** normally make the whole web process unready.

Those providers should instead produce degraded feature state.

## Worker readiness

A production worker should be ready only when:

- worker process role is valid
- PostgreSQL is reachable
- required worker/schema tables exist
- required job handlers are registered
- object storage and SecretStore/KMS dependencies required by registered jobs are configured
- worker loop has not fatally stopped

Current `worker.ts` already performs useful startup schema probes.

Missing:

- steady-state worker readiness/heartbeat contract
- supervisor-consumable worker readiness surface

---

# 13. Minimum production metric contract

G1 adds the provider-neutral contract:

`server/operations/productionOperationsContract.ts`

Minimum metrics:

## HTTP

- `http_requests_total`
- `http_request_duration_ms`

## Providers

- `provider_requests_total`
- `provider_request_duration_ms`

## Retrieval

- `retrieval_stage_duration_ms`
- `retrieval_failures_total`

## PostgreSQL

- `db_query_duration_ms`
- `db_pool_connections`

## Worker

- `worker_queue_depth`
- `worker_job_attempts_total`
- `worker_job_age_ms`
- `worker_dead_letter_total`

## Integration

- `integration_sync_total`
- `integration_sync_lag_seconds`

## Watch

- `watch_evaluation_total`
- `watch_job_lag_seconds`

## Action / Automation

- `action_execution_total`
- `automation_run_total`

## SecretStore

- `secret_store_operation_total`

G1 intentionally does not specify Prometheus, OpenTelemetry, Datadog, Grafana Cloud, CloudWatch, or another vendor.

---

# 14. Structured operational log contract

Required fields:

- timestamp
- level
- event_name
- component
- process_role
- outcome

Optional correlation:

- request_id
- trace_id
- tenant_correlation_id
- worker job ID
- sync run ID
- Watch job ID
- Action execution ID
- Automation run ID

## Tenant privacy

Do not use raw user content as correlation.

A future `tenant_correlation_id` should be a stable non-content operational identifier. It must not expose:

- tenant name
- user email
- prompt
- document content
- Dataset rows

Raw `account_id` should not be a high-cardinality public metric label.

## Forbidden operational log payloads

Never emit:

- prompt text
- document/page content
- Dataset rows
- OAuth access/refresh tokens
- API keys
- session tokens
- passwords
- secret ciphertext
- KMS key material
- raw Authorization headers

Provider error messages must be sanitized before entering a long-lived log/event system.

---

# 15. Initial recovery objectives

These are **targets**, not claims about current infrastructure.

## PostgreSQL / relational state

- target RPO: **5 minutes**
- target RTO: **60 minutes**

A managed production database should provide PITR or equivalent continuous backup capable of meeting this RPO.

## Durable object payloads

- target RPO: **5 minutes**
- target RTO: **60 minutes**
- accidental-delete recoverability: **30 days minimum**

## SecretStore metadata

- target RPO: **5 minutes**
- target RTO: **60 minutes**

Required KMS/key versions must have lifecycle retention compatible with every still-restorable secret version.

## Committed worker jobs

- target RPO: **0 minutes** after the enqueue transaction commits
- target worker processing recovery: **15 minutes**

## Restore validation

- automated isolated restore test: at least every **30 days**
- full application recovery exercise: at least every **90 days**

---

# 16. Degraded-mode expectations

## Gemini unavailable

- keep deterministic/evidence-only paths available where supported
- classify provider failure truthfully
- never fabricate a provider response

## Google Drive / OneDrive unavailable

- already imported durable knowledge remains usable
- sync jobs retry only when classification permits
- provider cursor/checkpoint must not advance on failure

## Object storage unavailable

- source/payload-dependent reads or writes fail/degrade truthfully
- no upload/import is marked successful without durable bytes
- do not substitute missing bytes with local ephemeral state

## PostgreSQL unavailable

- web readiness fails
- worker readiness fails
- stateful work is not accepted as successful

## SecretStore/KMS unavailable

- Integration credential resolution fails closed
- no plaintext/local production fallback
- retry only where safe

---

# 17. Alerting principles for G2+

Minimum operational alert classes should eventually include:

- HTTP error-rate / latency SLO burn
- PostgreSQL unavailable / pool saturation
- object-storage unavailable
- SecretStore/KMS configuration/decryption failure
- worker queue age/depth breach
- dead-letter creation
- repeated worker lease loss
- Integration sync lag/failure/reauthorization required
- Watch job lag/failure
- Action technical execution failure
- Automation RECOVERY_REQUIRED / repeated technical failure
- backup stale/missing
- restore validation failed

Thresholds should be measured and tuned during Track I load testing rather than invented as final scale claims in G1.

---

# 18. What G1 does not implement

G1 intentionally does not:

- select an observability vendor
- add Docker
- add staging
- configure a managed PostgreSQL provider
- configure PITR
- enable S3 bucket versioning
- implement backup jobs
- implement a restore command
- expose a public metrics endpoint
- redesign product dashboards
- run load tests

Those belong to later slices.

---

# 19. Recommended Track G slices

## G2 — Production Observability + Real Readiness Foundation

Implement:

- global structured request correlation
- HTTP request metrics
- provider/retrieval metrics
- PostgreSQL pool/query metrics
- worker queue/job metrics and worker heartbeat/readiness
- real web readiness service
- secret-safe structured operational event sink
- derived Integration/Watch/Action/Automation health metrics

Keep vendor-neutral adapters.

## G3 — Backup/Restore + Recovery Drill Foundation

Implement:

- provider-neutral backup/restore runbook
- deployment-target PostgreSQL PITR requirements
- object-storage versioning/retention verification
- backup freshness evidence
- isolated restore verification
- SecretStore/KMS restore validation
- automated recovery smoke proof

Track H deployment should consume these contracts rather than invent them independently.

---

# 20. G1 validation

G1 is complete only when:

- the production operations contract exists
- the forensic inventory matches current source behavior
- synthetic mediator health/telemetry is explicitly excluded from production SLO claims
- recovery targets and degraded modes are explicit
- backup/restore gaps are explicit
- the executable G1 drift proof is in the Quality Gate
- all existing Phase 0–8 and production-hardening gates remain green
