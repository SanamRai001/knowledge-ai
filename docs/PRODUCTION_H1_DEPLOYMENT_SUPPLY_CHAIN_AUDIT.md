# Production H1 — Deployment & Supply-Chain Forensic Audit

Date: **2026-09-25**

Status: **COMPLETE** — authoritative implementation Quality Gate `36163177196`.

## Verdict

Knowledge AI has a strong production **application/runtime contract**, but it does not yet have a repeatable hardened deployment artifact.

The repository is now materially ahead of a typical prototype:

- separate web and worker entrypoints
- explicit production process roles
- PostgreSQL-authoritative state
- durable object storage
- managed OAuth SecretStore/KMS boundary
- real liveness/readiness checks
- durable workers with lease/retry semantics
- forward migrations with checksums
- isolated recovery validation
- extensive production-hardening CI

However, deployment and supply-chain controls are still incomplete.

The highest-priority H1 conclusion is:

> Do not ship the current build layout directly as a public production image. First make dependency resolution reproducible, separate public client assets from private backend artifacts, define a non-root immutable image, add graceful shutdown and edge-security contracts, and promote one scanned artifact through staging to production.

H1 is forensic/audit work only. It does **not** add Docker, choose a hosting vendor, or deploy staging.

---

# 1. Current entrypoint inventory

## Web

Package script:

`npm start`

Current command:

`node dist/server.cjs`

Source entrypoint:

`server.ts`

Production process role:

`KNOWLEDGE_AI_PROCESS_ROLE=web`

Current startup sequence:

1. resolve/validate process role
2. bootstrap API-key runtime state
3. bootstrap Dataset runtime state
4. mount production static client
5. call `app.listen(...)`
6. start background runtime only if the selected role includes workers

Production recommendation:

- use **web** role only
- do not use `combined` as normal production topology

Liveness:

`GET /api/health`

Readiness:

`GET /api/ready`

Readiness checks:

- process role
- PostgreSQL reachability
- migration/checksum state
- object-storage configuration
- SecretStore/KMS configuration

External Gemini/Drive/OneDrive provider availability does not globally fail readiness.

## Worker

Package script:

`npm run start:worker`

Current command:

`node dist/worker.cjs`

Source entrypoint:

`worker.ts`

Production process role:

`KNOWLEDGE_AI_PROCESS_ROLE=worker`

Worker startup already fails before loops when:

- PostgreSQL persistence is not enabled
- required Watch/worker schema tables are unavailable
- required SecretStore table is unavailable

Worker runtime includes:

- Watch scheduler
- generic durable worker job loop
- Action Discovery handler
- Integration sync handler
- Automation execution handler

Worker readiness is currently emitted as operational telemetry rather than exposed over an HTTP endpoint.

## Migration job

Package script:

`npm run db:migrate`

Current command:

`tsx scripts/db-migrate.ts`

Important deployment constraint:

- migration execution currently depends on **tsx**, which is a dev dependency
- migration runner reads `server/persistence/migrations/*.sql` at runtime

Therefore a future minimal runtime image cannot contain only `dist/` and pruned production dependencies if it is also expected to run migrations.

H2 must either:

1. compile a migration CLI into the immutable release artifact and include migration SQL, or
2. build a separate immutable operations/migration image

Do not make ordinary web/worker startup auto-run migrations.

## Recovery validation job

Package script:

`npm run recovery:validate`

Current command:

`tsx scripts/recovery-validate.ts`

Like migration, the recovery validator currently requires:

- TypeScript source
- `tsx`
- runtime dependencies

This should become either:

- a compiled operational CLI in the immutable release artifact, or
- a dedicated immutable operations image

Recovery validation correctly blocks:

- production targets
- the configured production database
- the configured production object bucket

---

# 2. Build artifact audit

Current build:

`vite build`

then:

`esbuild server.ts ... --outfile=dist/server.cjs`

and:

`esbuild worker.ts ... --outfile=dist/worker.cjs`

Backend dependencies are marked external, so runtime `node_modules` are still required.

## Critical current packaging defect

Vite client output and private backend artifacts share the same:

`dist/`

directory.

Production server then runs:

`express.static(distPath)`

against that entire directory.

Therefore a deployed build can expose private build artifacts such as:

- `/server.cjs`
- `/worker.cjs`
- `/server.cjs.map`
- `/worker.cjs.map`

The source maps may expose implementation source/context and should never be part of the public static root.

Classification:

**PRODUCTION BLOCKER**

Required H2 fix:

- client assets must live in a dedicated public directory
- backend/worker/ops artifacts must live outside the public static root
- server source maps must not be publicly served

---

# 3. Production image contract

H1 adds the provider-neutral target contract:

`server/deployment/productionDeploymentContract.ts`

A production image must eventually satisfy:

- Node.js 22 runtime contract
- immutable build artifact
- non-root runtime user
- separate web and worker process commands
- `combined` role not used as the normal production topology
- public client root separated from server/worker artifacts
- backend source maps not public
- build tools absent from steady-state web/worker runtime where practical
- migration SQL available to the migration job
- migration/recovery CLIs executable without mutable source installation
- application filesystem read-only except explicitly required temporary paths
- no production dependency on `data/` as authoritative state

H1 does not add the Dockerfile yet.

---

# 4. Dependency and lockfile audit

Current repository contains:

- `bun.lock`

Current repository does **not** contain:

- `package-lock.json`

Current Quality Gate installs dependencies with:

`npm install`

This means the committed Bun lockfile is not the lockfile used by CI's npm resolver.

The package manifest also lacks an explicit:

`packageManager`

contract.

Classification:

**PRODUCTION BLOCKER — NON-REPRODUCIBLE DEPENDENCY INSTALL**

H2 must choose exactly one release package-manager contract.

Acceptable examples:

- npm + committed `package-lock.json` + `npm ci`
- Bun + committed `bun.lock` + frozen install

Do not keep a Bun lockfile while npm resolves semver ranges independently in release CI.

---

# 5. GitHub Actions / supply-chain audit

Current CI strengths:

- Node 22 is explicitly selected
- secret-hygiene guard exists
- TypeScript/build gates exist
- full Phase 0–8 regression suite exists
- production-hardening proofs exist
- PostgreSQL integration suite exists
- unseen-corpus benchmark exists
- live Gemini benchmark is isolated as optional provider validation

Current gaps:

## Action pinning

Workflow uses moving major tags such as:

- `actions/checkout@v4`
- `actions/setup-node@v4`

Target release workflows should pin third-party actions to immutable commit SHAs.

## Workflow token permissions

The workflow does not currently declare an explicit least-privilege top-level:

`permissions:`

contract.

Target:

- default `contents: read`
- grant additional permissions only per job when needed

## Dependency/security scanning

No release-blocking dependency vulnerability scan is currently defined.

No container scan exists because no image exists yet.

No release SBOM is currently produced.

No provenance/signing contract is currently enforced.

## Dependency update automation

No `.github/dependabot.yml` is currently present.

This is not itself a release blocker, but automated dependency update visibility is recommended.

## Service image pinning

PostgreSQL CI uses:

`postgres:16`

This follows a moving major tag.

A release-grade supply-chain policy should use an exact tested version/digest where practical.

---

# 6. Environment contract

H1 classifies production configuration into five groups.

## A. Required baseline runtime configuration

### Security/runtime

- `NODE_ENV=production`
- `KNOWLEDGE_AI_PROCESS_ROLE=web|worker`
- `KNOWLEDGE_AI_PUBLIC_ORIGIN=https://...`
- `KNOWLEDGE_AI_PERSISTENCE_MODE=postgres`

### PostgreSQL

- `DATABASE_URL`
- `DATABASE_SSL`
- `DATABASE_POOL_MAX`

### Durable object storage

- `SOURCE_STORAGE_BACKEND=s3`
- `SOURCE_STORAGE_BUCKET`
- `SOURCE_STORAGE_REGION`

Optional depending on provider:

- `SOURCE_STORAGE_ENDPOINT`
- `SOURCE_STORAGE_ACCESS_KEY_ID`
- `SOURCE_STORAGE_SECRET_ACCESS_KEY`
- `SOURCE_STORAGE_FORCE_PATH_STYLE`

Prefer workload identity/IAM over static S3 credentials where available.

### SecretStore/KMS

- `KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID`
- `KNOWLEDGE_AI_SECRET_KEYRING_JSON`

The keyring is a deployment secret and must not enter images, logs, or source control.

## B. One-time bootstrap deployment secret

- `KNOWLEDGE_AI_BOOTSTRAP_TOKEN`
- `KNOWLEDGE_AI_BOOTSTRAP_ACCOUNT_ID`

The token should be removed/rotated after the initial owner bootstrap is consumed.

## C. Conditional provider configuration

### Gemini

- `GEMINI_API_KEY` — secret
- `KNOWLEDGE_AI_GEMINI_MODEL` — non-secret

Gemini remains optional because deterministic/evidence-only fallback exists.

### Google Drive OAuth application

- `GOOGLE_DRIVE_CLIENT_ID` — non-secret application metadata
- `GOOGLE_DRIVE_CLIENT_SECRET` — deployment secret
- `GOOGLE_DRIVE_REDIRECT_URI` — non-secret

### Microsoft OneDrive OAuth application

- `MICROSOFT_ONEDRIVE_CLIENT_ID` — non-secret
- `MICROSOFT_ONEDRIVE_CLIENT_SECRET` — deployment secret
- `MICROSOFT_ONEDRIVE_REDIRECT_URI` — non-secret
- `MICROSOFT_ONEDRIVE_TENANT_ID` — non-secret

### Browser build-time public config

- `VITE_GOOGLE_DRIVE_CLIENT_ID`
- `VITE_GOOGLE_DRIVE_APP_ID`

These are public build metadata, not runtime secrets.

## D. Operational tuning

H1 adds these missing items to `.env.example`:

- `KNOWLEDGE_AI_OPERATIONAL_JSON_LOGS`
- `KNOWLEDGE_AI_READINESS_TIMEOUT_MS`
- `KNOWLEDGE_AI_DB_SLOW_QUERY_MS`
- `KNOWLEDGE_AI_WORKER_READINESS_INTERVAL_MS`
- `KNOWLEDGE_AI_WORKER_READINESS_MAX_STALENESS_MS`

Production already emits structured JSON operational events automatically when `NODE_ENV=production`.

## E. Recovery-job-only configuration

Recovery validation uses an isolated operational environment:

- `KNOWLEDGE_AI_BUILD_ID`
- `KNOWLEDGE_AI_RECOVERY_ALLOW`
- `KNOWLEDGE_AI_RECOVERY_TARGET_ENV`
- `KNOWLEDGE_AI_RECOVERY_DATABASE_URL`
- `KNOWLEDGE_AI_RECOVERY_DATABASE_SSL`
- `KNOWLEDGE_AI_RECOVERY_STORAGE_*`
- `KNOWLEDGE_AI_RECOVERY_RELATIONAL_EVIDENCE_JSON`
- `KNOWLEDGE_AI_RECOVERY_RESTORE_EVIDENCE_JSON`

These belong to the recovery job, not ordinary web/worker containers.

## Legacy compatibility secret

`INTEGRATION_CREDENTIAL_KEY`

is only for pre-F2 credential-file migration compatibility.

Steady-state production should not depend on it once legacy credential migration is complete.

---

# 7. Startup ordering audit

## Current web behavior

Web startup does **not** run database migrations.

This is correct.

The web process:

1. validates process role
2. bootstraps runtime metadata/state
3. begins HTTP listening
4. relies on `/api/ready` to report schema/storage/KMS readiness

Deployment implication:

> The reverse proxy/orchestrator MUST NOT route production traffic until `/api/ready` returns 200.

The application can technically accept TCP/HTTP requests before readiness succeeds.

## Current worker behavior

Worker startup:

1. validates role
2. requires PostgreSQL mode
3. verifies required tables
4. starts loops
5. emits recurring worker readiness telemetry

This is fail-closed for missing worker schema.

## Required production rollout order

H1 target ordering:

1. build one immutable artifact
2. complete dependency/secret/security gates
3. inject deployment configuration/secrets
4. run exactly one migration job
5. verify migration checksums/schema
6. start new web replicas without traffic
7. require web readiness
8. start/verify worker replicas
9. require worker readiness/health signal
10. shift traffic
11. observe post-deploy health before removing old replicas

Migration execution must be single-writer unless an explicit advisory-lock mechanism is added.

---

# 8. Graceful shutdown audit

## Web

Current web entrypoint does not:

- retain the returned HTTP server handle
- listen for `SIGTERM`
- stop accepting new connections
- drain active requests
- stop background runtime when running in combined mode
- close PostgreSQL pool on shutdown

Classification:

**PRODUCTION BLOCKER**

H2 must add bounded graceful shutdown.

## Worker

Worker currently handles:

- `SIGTERM`
- `SIGINT`
- readiness timer cleanup
- background loop stop
- PostgreSQL pool close

However, the underlying worker/watch `stop()` methods only stop future timer cycles.

They do not currently await an already-running cycle/job.

Durable leases/idempotency make abrupt termination recoverable, but this is **crash safety**, not graceful drain.

H2 should add a bounded drain contract:

- stop claiming new jobs
- await current cycle/job up to shutdown timeout
- then close PostgreSQL
- allow lease recovery only after timeout/forced termination

---

# 9. HTTP edge / reverse-proxy audit

## Current browser security strengths

Session cookie:

- HttpOnly
- Secure in production
- SameSite=Lax

CSRF:

- double-submit cookie/header
- timing-safe comparison

Human-session mutations:

- require same-origin
- require CSRF through application identity middleware

Production browser origin:

- `KNOWLEDGE_AI_PUBLIC_ORIGIN` required by auth security

No wildcard CORS layer is currently enabled.

## Missing app-level security headers

No application-level contract currently sets:

- Content-Security-Policy
- Strict-Transport-Security
- X-Content-Type-Options
- frame-ancestors / X-Frame-Options
- Referrer-Policy
- Permissions-Policy

No `helmet` or equivalent security-header middleware is present.

These may ultimately be enforced at the reverse proxy, the app, or both, but H2 must make the ownership explicit and testable.

## HTTPS termination

Production cookies assume HTTPS because `Secure` is set when `NODE_ENV=production`.

H1 target:

- TLS terminates at trusted load balancer/reverse proxy or the application boundary
- HTTP must redirect to HTTPS before browser auth
- HSTS must be emitted at the TLS boundary

## Trust proxy

The application currently does not configure:

`app.set('trust proxy', ...)`

Do not blindly enable `true`.

H2 must set an explicit trusted-proxy topology only when the deployment network is known.

## Port

Web currently binds:

`0.0.0.0:3000`

using a hard-coded port.

The deployment can map an external/service port to 3000, but the runtime currently has no `PORT` configuration contract.

Classification:

**DEPLOYMENT CONSTRAINT**

---

# 10. Request and upload limits

## Global body parser

Current:

- JSON: **50 MB**
- URL encoded: **50 MB**

This is large for normal authenticated API mutations.

Classification:

**HARDENING GAP**

H2 should lower general request-body limits and keep larger content behind route-specific multipart limits.

## PDF uploads

Current multipart limits:

- 25 MB per file
- up to 10 files
- Multer memory storage

Worst-case raw upload memory before parsing can therefore approach **250 MB per request**, excluding multipart/parser overhead and PDF processing allocations.

Track I must measure concurrency/memory limits.

H2 should align reverse-proxy body limits with application limits and consider streaming/direct object storage for large production ingestion.

## Dataset uploads

CSV:

- 10 MB
- 50,000 rows
- 100 columns
- 10,000 chars/cell

XLSX:

- 15 MB
- 20 sheets
- 50,000 rows/sheet
- 100,000 total rows
- 100 columns
- 10,000 chars/cell

Dataset router accepts one upload file per request.

These are useful bounded parser contracts.

---

# 11. Readiness and supervisor contract

Web has supervisor-consumable:

- `/api/health`
- `/api/ready`

Worker has internal readiness telemetry but no HTTP surface.

A production worker supervisor therefore still needs one explicit mechanism, for example:

- platform process health + structured readiness heartbeat
- sidecar/exec readiness command
- tiny private health server

H1 does not choose one.

H2 must make worker readiness consumable by the selected runtime platform.

---

# 12. Migration audit and rollback rules

Migration strengths:

- ordered SQL migrations
- transactional application
- persistent `schema_migrations`
- filename + SHA-256 checksum
- drift fails closed
- web/worker startup does not auto-migrate

There are no down migrations.

H1 classifies migrations as:

**FORWARD-ONLY**

## Rollback rules

1. Do not run an older build against a newer schema merely because the container can start.
2. Application rollback across a schema advancement requires explicit compatibility proof.
3. Do not automatically execute reverse/down SQL.
4. Prefer a forward fix when schema/data remain compatible.
5. If rollback requires an older schema or prior data state, use the G3 backup/PITR + isolated recovery-validation process.
6. SecretStore historical key versions required by restored rows must remain available.
7. Restored object-storage payload versions must match relational metadata/integrity checks.
8. Worker jobs in the restored target must be inspected before execution.
9. Traffic resumes only after the restored build passes real readiness.

## Migration concurrency

Current runner has no deployment-level advisory lock.

Production contract:

- exactly one migration job per release

or later add an explicit database advisory lock.

---

# 13. Staging topology contract

H1 does not pick AWS, GCP, Azure, Fly.io, Render, Railway, Kubernetes, ECS, Cloud Run, or another vendor.

Staging must nevertheless mirror production topology logically:

- separate web process
- separate worker process
- migration job
- PostgreSQL
- S3-compatible object storage
- SecretStore/KMS deployment key boundary
- reverse proxy/TLS
- real G2 readiness
- G3-compatible isolated recovery validation

Required separation:

- staging database must not be production database
- staging object bucket must not be production bucket
- staging SecretStore/KMS material must be distinct where practical
- OAuth redirect URIs must be environment-specific

Artifact promotion rule:

> Build once, scan once, promote the same immutable image digest from staging to production.

Do not rebuild production from source after staging validation.

---

# 14. Release-gate contract

A release should not be promotable until all required gates pass.

## Existing reusable gates

- secret hygiene
- provider boundary
- telemetry integrity
- TypeScript
- production build
- Phase 0–8 regression suite
- production hardening proofs
- PostgreSQL integration suite
- deterministic synthesis/grounding
- unseen benchmark

## H2+ required additions

- frozen lockfile install
- dependency vulnerability policy
- immutable GitHub Action pinning
- container image build
- container vulnerability scan
- SBOM generation
- non-root image assertion
- static-public-root leakage assertion
- graceful-shutdown proof
- security-header/CSP proof
- migration-job smoke proof
- staging web readiness
- staging worker readiness
- post-migration smoke checks

The live Gemini benchmark may remain a useful external-provider signal but should not be the only correctness gate because provider/network availability is external.

---

# 15. Current blocker summary

## BLOCKER H1-01 — public/private build artifact collision

Client static root currently shares `dist/` with server/worker bundles and source maps.

## BLOCKER H1-02 — dependency install is not reproducible

`bun.lock` is committed while CI uses `npm install`.

## BLOCKER H1-03 — no immutable production image contract implemented

No Dockerfile/container build exists yet.

## BLOCKER H1-04 — web has no graceful shutdown

No HTTP drain / pool shutdown on SIGTERM.

## BLOCKER H1-05 — migration/recovery jobs depend on dev tooling/source

Current operational commands require `tsx` and source files.

## BLOCKER H1-06 — security-header/TLS-proxy ownership not enforced

No CSP/HSTS/header middleware or deployment config exists.

## BLOCKER H1-07 — release supply-chain gates incomplete

No dependency vulnerability gate, container scan, SBOM, or immutable Action pinning.

## BLOCKER H1-08 — no staging/promotion/rollback implementation

G2/G3 contracts exist, but no release topology consumes them yet.

## HIGH H1-09 — worker shutdown is crash-safe, not gracefully drained

Timer loops stop, but current in-flight cycles are not awaited.

## HIGH H1-10 — general request limits are too broad

50 MB JSON/urlencoded globally; PDF memory upload can reach 250 MB raw/request.

## MEDIUM H1-11 — hard-coded port

Runtime currently binds 3000 only.

## MEDIUM H1-12 — worker readiness is not directly supervisor-consumable

The readiness signal exists in telemetry but requires deployment integration.

---

# 16. Recommended Track H slices

## H2 — Reproducible Build + Production Image Foundation

Keep H2 limited to:

- choose one package manager
- frozen lockfile install
- explicit Node/package-manager version
- split public client assets from private backend artifacts
- compile or package migration/recovery operational commands
- production multi-stage image
- non-root user
- separate web/worker commands
- minimal runtime files/dependencies
- image smoke proof

Do not deploy staging yet.

## H3 — Runtime Edge + Graceful Shutdown Hardening

Implement:

- web graceful drain
- worker bounded drain
- explicit trusted proxy contract
- CSP/security headers
- HTTPS/TLS assumptions
- tighter general body limits
- reverse-proxy upload alignment
- supervisor-consumable worker readiness

## H4 — Staging Promotion + Rollback Release Gate

Implement:

- staging topology
- migration job orchestration
- immutable artifact promotion
- dependency/container scans + SBOM
- readiness smoke
- G3 recovery gate integration
- documented forward-only rollback/restore procedure

Track I begins only after H2–H4 make deployment repeatable.

---

# 17. H1 executable drift proof

Added:

`scripts/check-production-h1-deployment-supply-chain-audit.ts`

The proof locks in the audit facts and target contract without pretending the missing deployment controls are already implemented.

It verifies:

- web/worker/migration/recovery entrypoints
- process-role separation
- readiness and migration ownership
- worker shutdown baseline
- auth cookie/CSRF boundary
- current request/upload limits
- current build/static-root collision
- lockfile/package-manager mismatch
- current unpinned Action references
- absence of final Docker/deployment implementation
- forward-only migration/checksum behavior
- environment inventory
- H1 target deployment/image/release/rollback contract

---

# 18. Exit criteria

H1 is complete when:

- the deployment/runtime/supply-chain inventory is explicit
- environment classes are explicit
- blockers are severity-classified
- target image/process/startup contracts are explicit
- rollback rules are explicit
- staging topology is defined without choosing a vendor
- a focused drift proof is in the Quality Gate
- integrated CI is green

H1 must stop before adding the final Docker/staging deployment.


---

# 19. Validation

Authoritative implementation Quality Gate:

`36163177196`

Verified green:

- TypeScript
- production build
- full Phase 0–8 regression suite
- all production-hardening contract proofs through G3
- H1 deployment/supply-chain drift proof
- full PostgreSQL production suite through G3
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Next phase

**H2 — Reproducible Build + Production Image Foundation**

H2 should implement the smallest deployment artifact slice from the H1 audit:

1. choose one package manager and commit/enforce its lockfile
2. use frozen dependency installation in CI/release builds
3. declare the Node/package-manager version contract
4. split public client assets from private web/worker artifacts
5. compile/package migration and recovery CLIs for immutable execution
6. add a multi-stage non-root production image
7. provide separate web/worker commands from the same immutable artifact
8. minimize runtime files/dependencies and keep private source maps out of the public root
9. add image/package-layout smoke proofs
10. stop before staging rollout, proxy/security-header hardening, and graceful-shutdown work

H3 remains responsible for runtime edge + graceful shutdown. H4 remains responsible for staging promotion + rollback release gates.
