# Production I1 — Load, Abuse, and Security Test Foundation

Status: **COMPLETE** — authoritative implementation Quality Gate `36218326048`.

## Goal

I1 creates a repeatable, measurable adversarial/load-testing foundation without making unsupported production-capacity claims.

This phase validates existing production boundaries, closes one API-key abuse gap on modern product routes, and records the remaining distributed/deep-adversarial work explicitly.

## Surface inventory

I1 inventories and guards these production-facing surfaces:

- HUMAN_SESSION application identity
- API_KEY application identity
- browser Origin/CSRF mutation boundary
- general request-size guard
- JSON/urlencoded parser limits
- PDF multipart upload boundary
- CSV/XLSX import boundaries
- malformed PDF/CSV/XLSX parsers
- Google Drive OAuth state/callback
- Microsoft OneDrive OAuth state/callback + PKCE
- Google Drive provider request construction
- Microsoft Graph delta/download request construction
- web health endpoint
- worker health/readiness endpoint
- worker drain/readiness behavior

The reusable external-target harness intentionally targets only an explicitly configured isolated/staging origin.

It does not contain:

- production credentials
- production data
- embedded API keys
- a default remote target

## Measured thresholds

Canonical test thresholds live in:

`server/security/i1SecurityThresholds.ts`

### Isolated CI identity smoke

- requests: 64
- concurrency: 16
- p95 threshold: 750 ms
- maximum unexpected error rate: 0
- maximum isolation failures: 0

These are CI/test thresholds, not a statement of production capacity.

### API-key abuse

- 100 requests
- per 60-second window
- request 101 is rejected
- HTTP status: 429
- code: `RATE_LIMITED`
- `Retry-After`: 1–60 seconds

### Request and ingestion limits

- JSON body default: 1 MiB
- urlencoded body default: 256 KiB
- application edge default maximum body: 260 MiB
- PDF file: 25 MiB
- PDF files/request: 10
- CSV file: 10 MiB
- XLSX file: 15 MiB

CSV/XLSX parsers retain their additional row/column/cell/sheet safety limits.

## Modern API-key rate-limit cutover

Before I1, the existing 100 req/min API-key limiter was enforced on the older API-key HTTP surface, but modern application routers resolved API keys through `requestIdentity.ts` without consuming that bucket.

I1 closes that gap.

`resolveAuthenticatedRequestIdentity()` / API_KEY resolution now:

1. validates the API key
2. applies the existing per-key rate bucket
3. rejects over-limit requests with 429
4. propagates `Retry-After`
5. resolves tenant identity only when allowed

This protects modern product routers that use `applicationIdentityMiddleware`.

## Concurrent tenant-isolation measurement

Executable proof:

`scripts/check-production-i1-concurrent-isolation-postgres.ts`

Quality Gate `36218326048` measured:

- requests: **64**
- successes: **64**
- unexpected errors: **0**
- isolation/validation failures: **0**
- concurrency: **16**
- p50: **33.44 ms**
- p95: **87.89 ms**
- max: **98.95 ms**

Traffic is evenly mixed across:

- account A / HUMAN_SESSION
- account B / HUMAN_SESSION
- account A / API_KEY
- account B / API_KEY

Each request also supplies an opposite-account `x-account-id` hint to prove request headers cannot override authenticated tenant scope.

Mixed HUMAN_SESSION + API_KEY credentials are rejected as `AMBIGUOUS_CREDENTIALS`.

Again: this is a bounded CI isolation measurement, **not** an RPS/users production-scale claim.

## Adversarial boundary proof

Executable proof:

`scripts/check-production-i1-abuse-boundaries.ts`

It proves:

### API-key abuse
- requests 1–100 are accepted
- request 101 is rejected
- 429 + `RATE_LIMITED`
- `Retry-After` is emitted

### HTTP body boundaries
- parser-level JSON overflow returns 413
- application edge overflow returns 413 + `REQUEST_BODY_TOO_LARGE`
- malformed `Content-Length` fails closed with 400 + `INVALID_CONTENT_LENGTH`

### Malformed ingestion
- unclosed/malformed CSV fails as a bounded parser error
- CSV over 10 MiB is rejected before parsing
- XLSX over 15 MiB is rejected before workbook parsing
- malformed XLSX fails without producing a Dataset
- malformed PDF fails with an explicit parsing error

Existing C3/C5 durability/compensation proofs remain the source of truth that failed parsing cannot create a falsely completed durable document/Dataset state.

### OAuth callback abuse
Google Drive and OneDrive state:
- use cryptographically random state
- store state by hash
- expire after 10 minutes
- are deleted when consumed
- reject replay
- reject cross-account callback state before token exchange

OneDrive additionally keeps PKCE S256.

### Browser mutation abuse
- cross-origin browser mutation is rejected
- matching configured Origin is accepted
- mismatched double-submit CSRF token is rejected
- matching CSRF cookie/header is accepted

## SSRF regression boundary

I1 verifies current provider URL construction.

Google Drive:
- Drive requests are constructed from fixed `https://www.googleapis.com/drive/v3`
- OAuth token/revoke endpoints are fixed Google HTTPS constants
- external file IDs are URL encoded
- provider-returned `webUrl` is not used as a download target

Microsoft OneDrive:
- Graph requests are rooted at fixed `https://graph.microsoft.com/v1.0`
- external IDs are URL encoded
- provider delta continuation URLs are accepted only when:
  - origin is exactly `https://graph.microsoft.com`
  - path begins with `/v1.0/me/drive/root/delta`
- arbitrary off-origin delta URLs are rejected

OAuth redirect URIs are deployment configuration, not request-controlled remote-fetch destinations.

## Reusable isolated-environment harness

Added:

- `scripts/support/i1HttpLoadHarness.ts`
- `scripts/i1-load-security-harness.ts`
- package script: `i1:load-security:dev`

Required environment:

`KNOWLEDGE_AI_I1_TARGET_ORIGIN`

The CLI:
- requires an explicit origin
- rejects URLs containing embedded credentials
- runs a bounded health smoke
- reports p50/p95/max/errors
- labels output as synthetic smoke
- does not claim production capacity

## Important limitations exposed by I1

### 1. API-key rate limiting is process-local

The existing limiter uses an in-memory timestamp bucket.

I1 extends it to all modern API_KEY application routes, but it is still **per web process**.

Therefore:

- one process enforces 100/min/key correctly
- multiple web replicas do not yet share one global quota bucket
- I1 does not claim cluster-wide throttling

This is an I2 hardening target.

### 2. OAuth state is process-local

Google and OneDrive OAuth state stores are in-memory Maps.

The states are cryptographically strong, one-time, expiring, and account-bound, but with multiple web replicas:

- OAuth start on replica A
- callback on replica B

cannot reliably resolve the state without sticky routing.

This is an I2 hardening target.

### 3. Human login has no dedicated attempt throttle

Human authentication has:

- same-origin enforcement
- salted scrypt credentials
- constant-work missing-user password burn
- non-enumerating invalid-credential response
- secure session cookies

but there is no explicit distributed login-attempt throttling/lockout boundary yet.

This is an I2 hardening target.

## Remaining Track I matrix

I1 deliberately does not claim these deeper adversarial areas are complete:

- distributed API-key quota enforcement
- shared/durable OAuth state
- login brute-force throttling
- prompt-injection/evidence-boundary adversarial corpus
- concurrent race/idempotency stress beyond the existing transaction proofs
- sustained Watch worker testing
- sustained Integration worker testing
- sustained Automation worker testing
- long-running queue/retry/dead-letter pressure
- multi-replica load characterization

No webhook signature test is required yet because no production webhook ingress exists.

## Validation

Authoritative implementation Quality Gate:

`36218326048`

Verified green:

- TypeScript
- production build
- Phase 0–8 regressions
- A2–H4 production-hardening proofs
- H2 immutable image smoke
- H4 dependency/SBOM/Trivy supply-chain gate
- I1 load/abuse/security contract proof
- I1 adversarial boundary proof
- I1 PostgreSQL concurrent identity isolation proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini benchmark

## Next phase

**I2 — Distributed Abuse & Auth-State Hardening**

I2 should remove the process-local security assumptions exposed by I1:

1. shared/durable API-key rate-limit state across web replicas
2. deterministic cluster-wide quota tests using two independent application instances
3. dedicated human-login abuse throttling without user enumeration
4. shared one-time OAuth state suitable for callback on another replica
5. OneDrive PKCE verifier handling through the existing managed-secret boundary where required
6. bounded state/quota retention and cleanup
7. cross-replica OAuth replay/cross-account tests
8. preserve B2/F2/H4 identity, secret, and deployment contracts

A later I3 slice should cover prompt-injection/evidence adversaries, transaction race/idempotency stress, and sustained Watch/Integration/Automation worker load.

Do not start Track J UX/admin cleanup during I2.
