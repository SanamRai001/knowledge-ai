# Production Hardening B2D1 — Privileged Human Authorization + Platform Management

Status: **COMPLETE**

Implementation validation workflow: **`35609479920`**

Date: 2026-09-21

---

## 1. Scope

B2D1 introduces the reusable privileged HUMAN_SESSION authorization boundary and applies it only to Platform Management.

Covered:

- reusable OWNER / ADMIN human-role guard
- `/api/platform-management` human-session cutover
- MEMBER denial
- API-key denial for browser-admin authority
- same-origin + CSRF protection for privileged mutations
- PostgreSQL-authoritative key/usage management
- Developer Platform CSRF wiring
- explicit separation from the stable API-key-only `/api/platform/v1`

Not covered:

- legacy `/api/v1/developer/*` cleanup
- Automation policy administration role cleanup
- Integration management permission cleanup
- API-key `role:*` cleanup
- broad legacy/prototype route quarantine

Those remain later B2D slices.

---

## 2. Reusable privileged human authorization

Added:

`server/identity/privilegedAuthorization.ts`

The reusable role guard requires:

- resolved request identity
- `source === HUMAN_SESSION`
- durable user identity
- durable account membership role
- one of the explicitly allowed roles

B2D1 defines the initial privileged browser roles as:

- OWNER
- ADMIN

Failure behavior:

- no resolved identity -> 401
- API_KEY / DEFAULT_WEB -> 403 `PRIVILEGED_HUMAN_SESSION_REQUIRED`
- HUMAN_SESSION MEMBER -> 403 `PRIVILEGED_ROLE_REQUIRED`

Machine API keys therefore cannot become browser administrators through a scope.

---

## 3. Platform Management

Updated:

`server/platform/platformManagementRouter.ts`

The router now applies:

1. `applicationIdentityMiddleware`
2. `requireOwnerOrAdmin`

All Platform Management routes are therefore privileged human-session operations.

Protected surface:

- `GET /api/platform-management/keys`
- `POST /api/platform-management/keys`
- `DELETE /api/platform-management/keys/:id`
- `GET /api/platform-management/usage`

The previous special machine scope:

`platform-internal:developer:manage`

no longer grants access to this browser-admin control plane.

---

## 4. Credential-class separation

B2D1 establishes a clear boundary:

### Human control plane

`/api/platform-management`

Requires:

- HUMAN_SESSION
- OWNER or ADMIN membership

### Stable machine API

`/api/platform/v1`

Continues to require:

- API_KEY
- operation-specific stable Platform scopes

A valid human session does not authenticate the stable machine API.

A valid API key does not authenticate Platform Management.

This directly addresses the B1 credential-class confusion finding for Platform Management.

---

## 5. PostgreSQL-authoritative key management

Platform Management previously called the synchronous `apiKeyStore` list/create/revoke/usage methods directly.

B2D1 moves those operations to:

`apiKeyRuntimeService`

This preserves the A7G runtime contract:

- API-key metadata is PostgreSQL-authoritative
- key creation persists before success
- revocation updates PostgreSQL plus validation cache
- key inventory comes from the durable repository
- usage statistics come from PostgreSQL in production mode

`apiKeyStore.publicApiKey()` remains used only to sanitize the one-time create response.

Raw key hashes are not returned.

---

## 6. Browser CSRF wiring

Updated:

`src/components/DeveloperPlatform.tsx`

The browser reads the non-HttpOnly:

`ka_csrf`

cookie and sends:

`X-CSRF-Token`

for:

- Platform API-key creation
- Platform API-key revocation

The HttpOnly `ka_session` cookie continues to be sent automatically by same-origin fetch.

This keeps privileged mutations compatible with the same-origin + double-submit CSRF boundary introduced in B2C.

---

## 7. Phase 8E compatibility contract

Updated:

`scripts/check-phase8e-platform-ui.ts`

The historical Phase 8E proof no longer treats a special API key as developer-admin identity.

It now verifies the current contract:

- Developer Platform remains a first-class workspace
- UI uses `/api/platform-management`
- UI sends CSRF for privileged mutations
- Platform Management uses `applicationIdentityMiddleware`
- Platform Management uses `requireOwnerOrAdmin`
- Platform Management uses `apiKeyRuntimeService`
- old internal developer-management scope is absent from the control plane
- stable Platform manifest remains versioned and governed
- safe browser API explorer constraints remain intact

Runtime authorization is covered by the new PostgreSQL B2D1 proof.

---

## 8. Executable PostgreSQL proof

Added:

`scripts/check-production-b2d1-privileged-platform-management.ts`

Package command:

`npm run check:production:b2d1-privileged-platform-management`

The proof verifies:

- missing production identity -> 401
- API_KEY with legacy internal developer-management scope -> 403
- MEMBER -> 403
- OWNER -> allowed
- ADMIN -> allowed
- spoofed account header cannot change OWNER/ADMIN session account
- key metadata omits key hashes
- human key creation requires CSRF
- MEMBER remains denied even with valid CSRF
- stable Platform-scope allowlist remains enforced
- OWNER can create a scoped Platform API key
- ADMIN can create a scoped Platform API key
- foreign OWNER cannot see another account's keys
- foreign OWNER cannot revoke another account's key
- usage statistics remain account scoped
- stable `/api/platform/v1` accepts a properly scoped API key
- stable `/api/platform/v1` rejects HUMAN_SESSION as machine authentication
- Platform Management revocation updates the stable API validation boundary
- revoked privileged HUMAN_SESSION fails closed

---

## 9. Validation

Workflow:

**`35609479920`**

B2D1-specific and deterministic required checks passed:

- TypeScript ✅
- production build ✅
- Phase 8E developer platform proof ✅
- Production B2D1 privileged Platform Management proof ✅
- all prior PostgreSQL hardening proofs through B2C3 ✅
- full deterministic Phase 0–8 regression suite ✅

The external live Gemini benchmark is not an authorization exit criterion for B2D1.

---

## 10. B2D1 exit criteria

B2D1 is complete because:

- privileged browser authorization is reusable
- Platform Management is HUMAN_SESSION-only
- OWNER and ADMIN can administer Platform keys
- MEMBER cannot
- API keys cannot become Platform Management administrators
- privileged mutations have CSRF protection
- tenant isolation remains intact
- key metadata/usage mutations use PostgreSQL-authoritative runtime paths
- stable Platform API remains API-key-only

---

## 11. Next small phase

> **Production Hardening B2D2A — Legacy Developer-Key Route Closure**

Keep this slice only on the legacy developer-key endpoints in `server.ts`:

- `GET /api/v1/developer/keys`
- `POST /api/v1/developer/keys`
- `DELETE /api/v1/developer/keys/:id`
- `GET /api/v1/developer/usage`

B2D2A should:

1. remove the hard-coded `acc_default` administration path
2. prevent unauthenticated developer-key creation/list/revoke/usage
3. prevent arbitrary legacy key scopes from creating human-like privilege
4. preserve the modern `/api/platform-management` human OWNER/ADMIN control plane
5. preserve stable `/api/platform/v1` machine behavior
6. add focused regression/security proof
7. stop before Automation policy, Integration administration, and broad legacy-route quarantine

Do **not** start B2D2B, B2D3, Track C, or worker work in this slice.
