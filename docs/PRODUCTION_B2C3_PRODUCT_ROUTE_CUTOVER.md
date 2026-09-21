# Production Hardening B2C3 — Actions + Watch + Integrations + Automation Route Cutover

Status: **COMPLETE**

Authoritative integrated Quality Gate: **`35557668826`**

Date: 2026-09-21

---

## 1. Scope

B2C3 completes normal product-route migration to the shared human-aware application identity boundary for:

- `/api/actions`
- `/api/watch`
- `/api/integrations`
- `/api/automation`

This slice intentionally does **not** perform privileged authorization redesign.

Platform Management, developer-key administration, automation-policy privilege cleanup, API-key role-scope cleanup, and legacy/prototype route quarantine remain B2D work.

---

## 2. Shared route identity cutover

The four route families now use:

`applicationIdentityMiddleware`

This provides:

- durable HUMAN_SESSION resolution
- separate API_KEY machine identity
- production fail-closed behavior
- explicit non-production DEFAULT_WEB compatibility only
- same-origin + double-submit CSRF protection on unsafe HUMAN_SESSION methods

API-key requests remain outside browser CSRF requirements.

---

## 3. Actions

`server/actions/actionRouter.ts`

Actions now accept HUMAN_SESSION identity while preserving API-key access.

Verified boundaries include:

- account-scoped proposal lists
- cross-account proposal raw-ID denial
- HUMAN_SESSION CSRF protection on mutation
- API-key mutation without browser CSRF

The existing proposal → explicit confirmation safety model is unchanged.

---

## 4. Watch

`server/watch/watchRouter.ts`

Watch now accepts HUMAN_SESSION identity while preserving API-key access.

Verified boundaries include:

- account-scoped Watch rules
- cross-account Watch raw-ID denial
- HUMAN_SESSION CSRF protection on mutation
- API-key mutation without browser CSRF

The deterministic Watch evaluation model is unchanged.

---

## 5. Integrations

`server/integrations/integrationRouter.ts`

Integrations now accept HUMAN_SESSION identity while preserving API-key access.

Verified boundaries include:

- account-scoped connection lists
- cross-account connection raw-ID denial
- HUMAN_SESSION CSRF protection on connection mutation
- API-key mutation without browser CSRF

Existing OAuth state validation and provider-specific logic remain unchanged.

---

## 6. Automation identity adaptation

B2C3 required one minimal compatibility change beyond router middleware because Automation previously understood only API_KEY and DEFAULT_WEB actors.

Updated:

`server/automation/automationActor.ts`

HUMAN_SESSION now maps:

- OWNER membership → OWNER automation actor
- ADMIN membership → ADMIN automation actor
- MEMBER membership → MEMBER automation actor

Human actor labels are now attributable:

`user:<userId>`

instead of the anonymous legacy:

`web:default`

API-key actor behavior remains unchanged.

---

## 7. Automation policy identity-source compatibility

`server/automation/automationRouter.ts`

`HUMAN_SESSION` is now an accepted policy identity-source value.

This is required so legitimate human-session automation policy data can represent the new credential class.

This does **not** fix the separate B1 finding that policy administration itself needs privileged role protection. That remains explicitly deferred to B2D.

---

## 8. Executable proof

Added:

`scripts/check-production-b2c3-product-route-cutover.ts`

Added package command:

`npm run check:production:b2c3-product-route-cutover`

The real PostgreSQL proof seeds separate human and machine account records for all four domains.

It verifies:

- production Actions rejects missing identity
- production Watch rejects missing identity
- production Integrations rejects missing identity
- production Automation rejects missing identity
- HUMAN_SESSION sees only its own Action proposals
- HUMAN_SESSION sees only its own Watch rules
- HUMAN_SESSION sees only its own Integration connections
- HUMAN_SESSION sees only its own Automation policy
- spoofed account headers do not move HUMAN_SESSION across tenants
- Automation context reports HUMAN_SESSION
- Automation context reports durable human actor `user:<userId>`
- OWNER membership is carried into Automation as OWNER
- HUMAN_SESSION Action mutation requires CSRF
- HUMAN_SESSION Watch mutation requires CSRF
- HUMAN_SESSION Integration mutation requires CSRF
- HUMAN_SESSION Automation mutation requires CSRF
- valid HUMAN_SESSION + CSRF can mutate its own Action
- valid HUMAN_SESSION + CSRF can mutate its own Watch rule
- valid HUMAN_SESSION + CSRF can mutate its own Integration
- HUMAN_SESSION is accepted by Automation policy input
- cross-account Action raw IDs remain denied
- cross-account Watch raw IDs remain denied
- cross-account Integration raw IDs remain denied
- API_KEY remains account-scoped for all four route families
- API_KEY mutations do not require browser CSRF
- API_KEY Automation mutation reaches application validation rather than browser CSRF
- revoked HUMAN_SESSION fails closed on all four route families

---

## 9. Regression coverage

The integrated gate remained green across:

- TypeScript
- production build
- full Phase 0–8 quality suite
- Actions proofs
- Watch proofs
- Integration proofs
- Automation proofs
- A2–A7G PostgreSQL hardening proofs
- B2A
- B2B1
- B2B2
- B2C1
- B2C2
- B2C3

---

## 10. Quality Gate

Authoritative workflow:

**`35557668826`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2C3 product route cutover proof` — ✅ success

---

## 11. B2C route-cutover completion

Normal browser-facing product route families are now migrated:

- KB
- Datasets
- Query
- Insights
- Company Knowledge
- Actions
- Watch
- Integrations
- Automation

The remaining identity/authorization work is no longer ordinary route cutover. It is privileged/admin hardening.

---

## 12. Known privileged findings intentionally preserved for B2D

B2C3 does not resolve:

- Platform Management human admin authorization
- unauthenticated legacy developer-key management
- API-key `role:owner/admin/approver` privilege escalation semantics
- missing human permission boundary for Integration management
- Automation policy administration role protection
- attributable human confirmation authority cleanup
- legacy/prototype route quarantine

These remain explicit Track B work rather than hidden debt.

---

## 13. Next small phase

> **Production Hardening B2D1 — Privileged Human Authorization Foundation + Platform Management**

Keep B2D1 deliberately small.

B2D1 should:

1. add reusable privileged HUMAN_SESSION role guards
2. define OWNER / ADMIN privileged browser semantics
3. cut `/api/platform-management` to HUMAN_SESSION identity
4. require appropriate privileged human role for Platform Management mutations
5. keep stable `/api/platform/v1` API-key-only
6. preserve account isolation
7. add focused PostgreSQL authorization tests
8. stop before legacy developer-key route cleanup and broad legacy-route quarantine

Do **not** solve all B2D findings in one slice.
