# Production Hardening B2A — Human Identity Persistence Foundation

Status: **COMPLETE**

Implementation commit: `08e5e4a7dfb589717126dfc84633676be6455291`

Authoritative integrated Quality Gate: **`35526535634`**

Date: 2026-09-20

---

## 1. Scope

B2A intentionally implements only the durable human-identity substrate required before browser authentication can safely exist.

Implemented:

- durable human users
- durable account memberships
- durable browser sessions
- OWNER / ADMIN / MEMBER membership roles
- opaque high-entropy browser-session secrets
- SHA-256-only persisted session-token hashes
- membership-bound selected account state
- session-scoped selected workspace state
- PostgreSQL repository contracts
- identity/session foundation service
- migration and runtime verification in the PostgreSQL Quality Gate

Not implemented in B2A:

- password or SSO credential scheme
- initial-owner bootstrap endpoint
- login/logout HTTP endpoints
- browser cookies
- CSRF protection
- `HUMAN_SESSION` request identity
- browser route cutover
- admin permission enforcement
- API-key cleanup
- legacy/prototype route quarantine

Those remain later Track B slices.

---

## 2. Migration 007

Added:

`server/persistence/migrations/007_human_identity_foundation.sql`

### users

Durable human identity:

- `id`
- original email
- normalized unique email
- optional display name
- ACTIVE / DISABLED status
- created/updated timestamps

B2A deliberately does **not** choose a password hashing/auth-provider design. Authentication credentials belong to B2B1.

### account_memberships

Uses the existing `accounts` table as the organization/tenant boundary.

Membership contains:

- `account_id`
- `user_id`
- OWNER / ADMIN / MEMBER role
- ACTIVE / REVOKED status
- lifecycle timestamps

The compound key prevents duplicate user membership inside one account.

### browser_sessions

Stores:

- session ID
- user ID
- **token hash only**
- selected account
- selected workspace
- ACTIVE / REVOKED status
- created / last-seen / expiry / revocation timestamps

The raw session secret is never persisted.

---

## 3. Database ownership constraints

The session schema enforces important ownership relationships even if application code is bypassed.

### Selected account

`(selected_account_id, user_id)` must reference an existing account-membership row.

A session therefore cannot directly select an unrelated account.

### Selected workspace

`(selected_account_id, selected_workspace_id)` must reference an existing workspace owned by that account.

A session therefore cannot pair account A with a workspace from account B.

Application/service logic additionally requires the membership to be ACTIVE.

---

## 4. Identity repository and service

Added:

- `server/identity/types.ts`
- `server/identity/postgresIdentityFoundationRepository.ts`
- `server/identity/humanIdentityFoundationService.ts`

The repository owns PostgreSQL access.

The service owns identity/session invariants including:

- email normalization
- active-user checks
- membership checks
- session-secret generation
- session-token hashing
- bounded session TTL
- selected-account validation
- selected-workspace validation
- session resolution
- session revocation
- all-session revocation for a user

No HTTP route consumes this service yet.

---

## 5. Session security model

Generated session secrets use 32 random bytes encoded as base64url with a `kaisess_` prefix.

Persistence stores:

```text
SHA-256(session secret)
```

This is appropriate for a high-entropy random bearer secret because offline guessing is not practical in the way it is for human passwords.

Human passwords are **not** hashed with raw SHA-256 and are not introduced in this phase.

The session service currently caps session TTL at 30 days and defaults to 7 days.

---

## 6. Account/workspace selection behavior

B1 found the old active-workspace model to be account-global.

B2A introduces the replacement browser identity state on each session:

```text
browser session
  -> selected account
  -> selected workspace
```

This means two sessions belonging to the same human/account can select different workspaces without overwriting each other.

The old account-global workspace state remains in place for existing runtime compatibility until browser routes are cut over in B2C.

---

## 7. Executable proof

Added:

`scripts/check-production-b2a-identity-foundation.ts`

Added package command:

`npm run check:production:b2a-identity-foundation`

Added the proof to the real PostgreSQL Quality Gate.

The proof verifies:

- migration 007 applies and is repeatable
- normalized email identity is stable
- OWNER membership persists
- a user without membership cannot create a session selecting that account
- raw session secrets are not stored
- stored token hash matches the generated secret hash
- session resolution returns user + membership + selection
- cross-account workspace selection is rejected
- account switching clears stale workspace selection
- workspace selection is session-scoped
- direct SQL cannot create a session selecting an account without a membership row
- revoked membership invalidates selected-account session resolution
- revoked sessions fail closed
- expired sessions fail closed

---

## 8. Quality Gate

Workflow:

**`35526535634`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2A identity foundation proof` — ✅ success

The full Phase 0–8 regression suite, TypeScript build checks, prior production PostgreSQL proofs, and the new B2A proof all remained green.

---

## 9. B2A exit criteria

B2A is complete because:

- durable users exist
- durable account memberships exist
- durable browser sessions exist
- account roles exist
- session bearer secrets are not persisted raw
- selected account is membership-bound
- selected workspace is account-bound
- browser workspace choice can now be session-scoped
- revocation and expiry are representable and enforced by the foundation service
- the implementation is proven against PostgreSQL in CI

---

## 10. Next small phase

> **Production Hardening B2B1 — Human Credential + Auth Session API**

Keep this next slice small.

B2B1 should only:

1. define one production-safe human credential format using a password KDF, not raw SHA-256
2. add a one-time initial OWNER bootstrap path
3. add login
4. issue the existing opaque browser session through a secure HttpOnly cookie
5. add logout/revocation
6. add `GET /api/auth/me`
7. add same-origin/CSRF protection appropriate to cookie-authenticated mutations
8. add focused authentication tests

Do **not** cut all product routers to sessions in B2B1.

`HUMAN_SESSION` request identity and production fallback removal should be B2B2.
