# Production Hardening B2B1 — Human Credential + Auth Session API

Status: **COMPLETE**

Authoritative hardened Quality Gate: **`35527482968`**

Date: 2026-09-20

---

## 1. Scope

B2B1 adds the first real human browser-authentication surface on top of the durable B2A identity/session foundation.

Implemented:

- durable password credential metadata
- salted scrypt password derivation
- durable one-time initial OWNER bootstrap
- browser login
- opaque session cookie issuance
- GET `/api/auth/me`
- logout + durable session revocation
- same-origin mutation checks
- double-submit CSRF protection
- focused real-PostgreSQL HTTP verification

B2B1 intentionally does **not** make the existing product routers session-authenticated yet.

---

## 2. Password credential boundary

Migration `008_human_password_credentials.sql` adds `user_password_credentials`.

Credential format:

- algorithm: `scrypt-v1`
- random per-user salt
- scrypt N = 32768
- r = 8
- p = 1
- derived key length = 64 bytes
- no plaintext password storage

The implementation uses Node's built-in asynchronous `crypto.scrypt()`.

Unknown-email login attempts still perform a dummy scrypt derivation before returning the same generic invalid-credentials response, reducing timing-based account enumeration.

Malformed login emails also resolve to the same generic authentication failure rather than exposing internal validation detail.

---

## 3. Initial OWNER bootstrap

B2B1 introduces a deliberately bounded bootstrap mechanism for an empty human-identity installation.

Required environment values:

- `KNOWLEDGE_AI_BOOTSTRAP_TOKEN`
- `KNOWLEDGE_AI_BOOTSTRAP_ACCOUNT_ID`

The bootstrap token must be at least 32 characters.

`POST /api/auth/bootstrap`:

- requires `x-bootstrap-token`
- validates the configured bootstrap secret with timing-safe comparison
- creates the initial account if necessary
- creates the first ACTIVE human user
- creates the user's scrypt credential
- creates an ACTIVE OWNER membership
- marks the durable singleton bootstrap state consumed
- fails if human identity already exists
- fails on any later bootstrap attempt

User + credential + membership + bootstrap-consumption are committed transactionally.

---

## 4. Browser login and session rotation

`POST /api/auth/login`:

- requires a same-origin browser request
- verifies the normalized email + scrypt credential
- requires at least one ACTIVE account membership
- creates the existing B2A high-entropy opaque browser session
- automatically selects the account only when exactly one active membership exists
- revokes a previous session cookie before issuing a new session when present

The browser receives the opaque session secret.

PostgreSQL continues to store only:

```text
SHA-256(session secret)
```

No password hash, session hash, or raw bearer secret is returned through `/api/auth/me`.

---

## 5. Cookie and CSRF boundary

Session cookie:

- name: `ka_session`
- HttpOnly
- SameSite=Lax
- Path=/
- Secure in production
- bounded to the B2A session expiry

CSRF cookie:

- name: `ka_csrf`
- SameSite=Lax
- Secure in production
- intentionally readable by the browser client

Cookie-authenticated mutation protection uses:

1. exact same-origin verification
2. double-submit CSRF equality between `ka_csrf` and `x-csrf-token`

Production browser authentication requires `KNOWLEDGE_AI_PUBLIC_ORIGIN`; the server does not silently derive a production origin from an untrusted Host header.

---

## 6. Auth API introduced

Mounted at:

`/api/auth`

Endpoints:

- `POST /bootstrap`
- `POST /login`
- `GET /me`
- `POST /logout`

These routes are mounted without changing the current identity contract of Workspace, Datasets, Insights, Actions, Watch, Integrations, Automation, Platform management, or other product routers.

That separation is intentional.

---

## 7. Logout behavior

`POST /api/auth/logout` requires:

- same-origin request
- valid double-submit CSRF token

It:

- revokes the durable B2A session
- clears the session cookie
- clears the CSRF cookie

A revoked cookie then fails closed on `GET /api/auth/me`.

---

## 8. Executable proof

Added:

`scripts/check-production-b2b1-auth-session-api.ts`

Added package command:

`npm run check:production:b2b1-auth-session-api`

The real PostgreSQL proof verifies:

- migration 008 exists and is repeatable
- wrong bootstrap token is rejected
- malformed bootstrap identity is rejected without consuming bootstrap
- valid bootstrap creates the configured OWNER
- password storage is salted scrypt rather than plaintext/fast password hashing
- bootstrap is durably one-time
- malformed login identity returns controlled invalid credentials
- cross-origin login is rejected
- wrong password does not issue cookies
- valid login issues the expected human session
- production session cookie is HttpOnly + Secure + SameSite
- only the session-token hash exists in PostgreSQL
- `GET /api/auth/me` resolves identity without leaking token hashes
- missing CSRF blocks logout without revoking the session
- valid CSRF + same origin revokes the session
- cleared/revoked session no longer authenticates

---

## 9. Quality Gate

Authoritative hardened workflow:

**`35527482968`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2B1 auth session API proof` — ✅ success

The full Phase 0–8 regression suite, TypeScript check, production build, prior PostgreSQL hardening proofs, and B2B1 auth proof all remained green.

---

## 10. B2B1 exit criteria

B2B1 is complete because:

- a production-safe password KDF is used
- a bounded first-owner bootstrap exists
- browser login creates a durable opaque session
- the session secret is HttpOnly and never stored raw
- same-origin and CSRF mutation controls exist
- `/api/auth/me` resolves the authenticated human safely
- logout revokes the durable session
- auth behavior is executable against PostgreSQL in CI
- existing product routers were not prematurely cut over

---

## 11. Next small phase

> **Production Hardening B2B2 — HUMAN_SESSION Request Identity + Production Fallback Removal**

B2B2 should only:

1. extend the request-identity model with a distinct `HUMAN_SESSION` source
2. carry authenticated `userId`, account membership role, selected account, and selected workspace context where applicable
3. resolve `ka_session` through the B2A/B2B1 session foundation
4. preserve API keys as a separate machine credential class
5. make missing browser identity fail closed in production instead of silently becoming `DEFAULT_WEB / acc_default`
6. keep `DEFAULT_WEB` only behind an explicit development/test compatibility switch
7. add focused identity-resolution and machine-vs-human boundary tests

Do **not** cut every browser product router over in B2B2.

That route-by-route cutover remains B2C.
