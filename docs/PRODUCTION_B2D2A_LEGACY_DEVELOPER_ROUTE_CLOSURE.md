# Production Hardening B2D2A — Legacy Developer-Key Route Closure

Status: **COMPLETE**

Authoritative implementation Quality Gate: **`35610867425`**

Date: 2026-09-21

---

## 1. Scope

B2D2A closes only the legacy developer-key administration endpoints in `server.ts`:

- `GET /api/v1/developer/keys`
- `POST /api/v1/developer/keys`
- `DELETE /api/v1/developer/keys/:id`
- `GET /api/v1/developer/usage`

No Automation policy, Integration administration, API-key role-scope cleanup, or broad legacy-route quarantine is included.

---

## 2. Legacy administration removal

The old handlers were removed from `server.ts`.

They previously:

- hard-coded `acc_default`
- allowed unauthenticated key listing
- allowed unauthenticated key creation
- accepted caller-supplied scopes
- allowed unauthenticated key revocation
- exposed account-default usage metrics

That administration path no longer exists.

---

## 3. Explicit retirement boundary

Added:

`server/platform/legacyDeveloperRouteClosureRouter.ts`

Mounted at:

`/api/v1/developer`

The four retired endpoints now return:

- HTTP `410 Gone`
- code `LEGACY_DEVELOPER_ROUTE_RETIRED`
- replacement `/api/platform-management`
- stable machine API `/api/platform/v1`

The retirement router contains no API-key create/revoke/list/usage logic.

---

## 4. Arbitrary legacy scope creation closed

The focused proof attempts legacy creation with privileged-looking scopes including:

- `role:owner`
- `role:admin`
- `role:approver`
- `platform-internal:developer:manage`
- `platform:automation:execute`

The request returns `410` and produces no API-key mutation.

This removes the specific legacy unauthenticated path that could mint machine credentials carrying human-like privilege labels.

Broader API-key role-scope semantics outside this retired route remain B2D2B1 work.

---

## 5. Modern boundaries preserved

B2D2A preserves:

### Human control plane

`/api/platform-management`

- HUMAN_SESSION only
- OWNER / ADMIN
- CSRF protected
- PostgreSQL-aware API-key runtime services

### Stable machine API

`/api/platform/v1`

- API_KEY authenticated
- explicit stable Platform scopes
- unchanged by this slice

The Developer Platform UI already uses only the modern control plane.

---

## 6. Executable proof

Added:

`scripts/check-production-b2d2a-legacy-developer-route-closure.ts`

Package command:

`npm run check:production:b2d2a-legacy-developer-route-closure`

The proof verifies:

- legacy key listing -> 410
- legacy key creation -> 410
- legacy key revocation -> 410
- legacy usage -> 410
- attempted arbitrary privileged scopes create no key
- `server.ts` no longer contains active legacy developer handlers
- hard-coded `acc_default` developer administration is absent
- retirement router is non-mutating
- modern Platform Management still uses human OWNER/ADMIN authorization
- stable Platform API remains API-key authenticated
- Developer Platform UI remains on `/api/platform-management`

---

## 7. Quality Gate

Workflow:

**`35610867425`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2D2A legacy developer route closure proof` — ✅ success
- Phase 8E Developer Platform — ✅ success
- B2D1 privileged Platform Management — ✅ success
- all prior B2A–B2C3 proofs — ✅ success
- live Gemini benchmark — ✅ success

---

## 8. Exit criteria

B2D2A is complete because:

- no active legacy developer-key handlers remain
- no legacy hard-coded `acc_default` developer administration remains
- legacy arbitrary-scope key creation is impossible
- callers receive an explicit retirement response
- modern OWNER/ADMIN Platform Management remains authoritative
- stable machine API behavior is preserved

---

## 9. Next small phase

> **Production Hardening B2D2B1 — Automation Privileged Authorization + API-Key Role Separation**

Keep this slice limited to Automation privilege semantics.

B2D2B1 should:

1. require HUMAN_SESSION OWNER/ADMIN for Automation policy administration
2. prevent API-key `role:owner/admin/approver` scopes from becoming human membership roles
3. preserve legitimate machine Automation behavior as SERVICE where intended
4. preserve tenant isolation
5. preserve existing approval/execution safety invariants
6. add focused OWNER/ADMIN/MEMBER/API_KEY authorization proof
7. stop before Integration-management privilege cleanup

Do **not** start B2D2B2, B2D3, Track C, or worker work in this slice.
