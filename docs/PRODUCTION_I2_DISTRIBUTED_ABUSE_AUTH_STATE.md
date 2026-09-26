# Production I2 — Distributed Abuse & Auth-State Hardening

Status: **COMPLETE** — authoritative implementation Quality Gate `36221948773`.

## Goal

I2 removes the process-local security assumptions exposed by I1 without changing the proven identity, OAuth, secret-management, deployment, or production-routing contracts.

The phase specifically hardens:

- API-key abuse throttling across multiple web replicas
- human-login brute-force throttling
- Google Drive OAuth one-time state across replicas
- Microsoft OneDrive OAuth one-time state + PKCE across replicas
- bounded cleanup/retention for transient abuse/auth state

I2 does **not** claim application cluster capacity or production RPS.

## Canonical thresholds

Defined in:

`server/security/i2SecurityThresholds.ts`

### API keys

- 100 requests
- per 60-second window
- per API key
- shared across web replicas

The I1 threshold is intentionally preserved.

### Human login

- 10 attempts
- per 15-minute window
- normalized by login identifier
- shared across web replicas

Successful authentication clears that identifier's distributed login bucket.

### OAuth state

- 10-minute lifetime
- one-time consumption
- account-bound
- shared across web replicas

### Cleanup batches

- rate-limit events: 128 rows/batch by default
- expired OAuth attempts: 64 rows/batch by default

Cleanup APIs remain explicitly bounded.

## Migration 020

Added:

`server/persistence/migrations/020_distributed_security_state.sql`

### security_rate_limit_events

Stores shared rate-limit events using:

- scope: `API_KEY` or `HUMAN_LOGIN`
- SHA-256 subject hash
- event timestamp

Raw API keys and raw login identifiers are not stored in the table.

### integration_oauth_attempts

Stores shared OAuth attempt state:

- provider
- hashed OAuth state
- account
- display name
- redirect URI
- optional tenant
- optional existing connection ID
- optional SecretStore reference
- created/expiry timestamps

It does **not** store:

- access tokens
- refresh tokens
- OneDrive PKCE verifier plaintext

### SecretStore extension

`account_secrets.purpose` now also permits:

`INTEGRATION_OAUTH_ATTEMPT`

This reuses the existing F2 managed-secret boundary for transient sensitive OAuth attempt material.

## Distributed rate-limit boundary

Added:

`server/security/distributedSecurityState.ts`

Each rate-limit decision:

1. derives a SHA-256 subject hash
2. acquires a PostgreSQL advisory transaction lock for that logical subject
3. removes expired events for that subject/window
4. counts current events
5. rejects if the shared quota is exhausted
6. otherwise records the accepted event
7. returns remaining/reset metadata

Because the lock and counter state are in PostgreSQL, independent web processes share one quota.

## API-key cutover

The modern API-key runtime now consumes the shared I2 PostgreSQL quota in production.

The externally visible contract remains:

- request 1–100: accepted
- request 101: rejected
- status: 429
- code: `RATE_LIMITED`
- `Retry-After`: bounded to the remaining window

Non-PostgreSQL development compatibility remains local/in-memory.

## Human-login abuse throttling

Added:

`server/identity/humanLoginThrottleService.ts`

Production login attempts now reserve from a distributed `HUMAN_LOGIN` quota before credential success/failure is exposed.

Properties:

- email/identifier is normalized before quota use
- existing constant-work missing-user password behavior is preserved
- invalid credentials remain non-enumerating
- throttling does not require proving whether the user exists
- `Retry-After` propagates through the human-auth error boundary
- successful authentication clears the shared identifier bucket

Therefore the throttle itself does not become a user-enumeration oracle.

## Shared Google Drive OAuth state

Google OAuth production runtime now uses PostgreSQL one-time state.

Flow:

1. web replica A creates random state
2. only a derived state hash is persisted
3. account/display/redirect/connection metadata is stored with expiry
4. callback may arrive at web replica B
5. the row is locked transactionally
6. account mismatch is rejected **without consuming the state**
7. correct account consumes/deletes the state
8. replay is rejected before token exchange

Preserved Google requirements include:

- 10-minute state expiry
- account binding
- one-time replay rejection
- configured Google scopes
- required refresh-token behavior
- existing privileged-session callback binding

## Shared OneDrive OAuth state + PKCE

OneDrive preserves the same distributed one-time state properties while keeping PKCE verifier material out of plaintext relational OAuth-attempt rows.

Flow:

1. web replica A generates OAuth state + PKCE verifier
2. S256 challenge is placed in the authorization URL
3. state metadata is persisted in `integration_oauth_attempts`
4. PKCE verifier is encrypted through the F2 SecretStore using purpose `INTEGRATION_OAUTH_ATTEMPT`
5. web replica B locks/consumes the shared attempt
6. the protected verifier is recovered for token exchange
7. consumed transient PKCE secret is deleted
8. replay is rejected

The proof verifies the recovered verifier hashes to the original S256 challenge.

## Account-mismatch behavior

Google and OneDrive preserve the existing service contract:

- callback with state owned by another account: 403 account-mismatch
- the mismatched attempt is **not consumed**
- the owning account can still complete it afterward
- provider token exchange is not reached for the rejected account

This matters for both abuse resistance and recoverable user flow.

## Bounded cleanup

### Rate-limit events

Old rate events are deleted in bounded batches.

Per-subject expired events are also removed during normal quota consumption.

### OAuth attempts

Expired OAuth rows are selected with:

- bounded LIMIT
- `FOR UPDATE SKIP LOCKED`

Rows are deleted transactionally.

Referenced transient OAuth SecretStore entries are then removed safely, and orphan cleanup is also available for attempts whose row disappeared during a race.

The final I2 fix ensures expired OAuth attempt secrets are deleted without introducing an orphan race.

## Executable proof — contract

`scripts/check-production-i2-distributed-abuse-auth-state-contract.ts`

Verifies:

- migration 020 shared state tables
- preserved API-key threshold
- distributed API-key runtime path
- human-login distributed throttle
- non-enumerating login behavior
- Google shared state runtime
- OneDrive shared state runtime
- F2 SecretStore PKCE protection
- no plaintext PKCE/tokens in OAuth-attempt schema
- bounded OAuth + orphan-secret cleanup

## Executable proof — PostgreSQL / cross-replica

`scripts/check-production-i2-distributed-abuse-auth-state-postgres.ts`

Using multiple independent runtime/service instances against one PostgreSQL database, verifies:

### API-key quota

- two independent `ApiKeyRuntimeService` instances alternate requests
- requests 1–100 share one quota
- request 101 from another instance is denied
- remaining/reset metadata is correct

### Human login

- two independent throttle instances share one normalized login bucket
- attempts 1–10 are accepted
- attempt 11 is rejected
- successful-login reset is shared across instances

### Google OAuth

- start on web A
- callback on web B
- successful completion
- replay denial before provider exchange
- cross-account denial without consuming state
- later correct-account completion

### OneDrive OAuth

- start on web A
- callback on web B
- encrypted transient PKCE secret persisted behind F2 SecretStore
- recovered verifier matches the original S256 challenge
- transient secret removed after consume
- replay denial
- cross-account denial without consuming state

### Retention

- expired OAuth attempt cleanup
- transient secret cleanup
- bounded rate-event cleanup honoring its limit

## Historical proof advancement

I2 advances the older I1/B2B2 guards narrowly:

- I1 no longer expects API-key quota or OAuth state to be process-local
- B2B2 recognizes the distributed API-key quota path
- all existing identity/session/API-key separation remains intact
- F2 OAuth credential SecretStore remains authoritative for long-lived OAuth bundles
- H4 release/supply-chain gates remain unchanged

## Validation

Authoritative implementation Quality Gate:

`36221948773`

Green jobs:

- `quality`
- `Production A2 PostgreSQL`
- `Production H2 Image Smoke`
- `Production H4 Supply Chain`

Verified in that gate:

- TypeScript
- production build
- Phase 0–8 regression suite
- A2–I1 production-hardening proofs
- I2 distributed abuse/auth-state contract proof
- I2 PostgreSQL cross-replica proof
- immutable production image smoke
- dependency/SBOM/Trivy supply-chain gates
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## What I2 does not prove

I2 proves distributed **security-state correctness**, not capacity.

It does not claim:

- maximum cluster RPS
- maximum concurrent users
- long-duration queue throughput
- resistance to every prompt-injection strategy
- full race coverage across every transactional subsystem

## Next phase — I3

**I3 — Deep Adversarial, Race/Idempotency & Sustained Worker Stress**

Keep I3 limited to the remaining Track I matrix:

1. prompt-injection/evidence-boundary adversarial corpus against document, Dataset, and mixed-source queries
2. source-authority/evidence-conflict attacks that try to make lower-authority text override stronger facts
3. cross-tenant prompt/evidence isolation under adversarial retrieval inputs
4. concurrent race/idempotency stress for D1 Action confirmation
5. concurrent race/idempotency stress for D2 Automation execution
6. concurrent race/idempotency stress for D3 Watch completion
7. sustained Watch worker load with lease/retry/dead-letter measurement
8. sustained Integration worker load with C6 checkpoint/cursor correctness measurement
9. sustained Automation worker load with D2 mutation idempotency measurement
10. bounded queue/retry/dead-letter pressure measurements using explicit thresholds

Use measured CI/staging thresholds only.

Do not start Track J UX/admin cleanup or make broad production-scale claims during I3.
