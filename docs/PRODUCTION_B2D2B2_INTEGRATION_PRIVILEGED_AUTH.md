# Production Hardening B2D2B2 — Integration Management Privileged Authorization

Status: **COMPLETE**

Authoritative implementation Quality Gate: **`35620269855`**

Date: 2026-09-21

---

## 1. Scope

B2D2B2 hardens Integration connection-management authority while preserving machine sync/runtime behavior.

Covered:

- privileged human authorization for Integration lifecycle management
- OWNER / ADMIN allow
- MEMBER deny
- API-key browser-admin deny
- API-key read/sync preservation
- OAuth callback account binding
- browser CSRF wiring
- tenant isolation
- focused PostgreSQL authorization proof
- regression updates for A7B and Phase 6A/6B/6C/6E

Not covered:

- broad legacy/prototype route quarantine
- Track C object storage
- worker/queue infrastructure

---

## 2. Integration route classification

### Authenticated read/runtime inspection

These remain available to authenticated HUMAN_SESSION and API_KEY identities within their own account scope:

- `GET /api/integrations/connections`
- `GET /api/integrations/connections/:id`
- `GET /api/integrations/connections/:id/runs`
- `GET /api/integrations/connections/:id/imports`
- provider health endpoints

### Operational machine-capable path

`POST /api/integrations/connections/:id/sync`

remains separate from browser-administration authorization.

API keys can continue to run account-scoped synchronization.

HUMAN_SESSION requests remain protected by the shared same-origin + CSRF middleware.

### Privileged connection administration

The following now require HUMAN_SESSION OWNER/ADMIN:

- `POST /api/integrations/google-drive/oauth/start`
- `GET /api/integrations/google-drive/oauth/callback`
- `POST /api/integrations/google-drive/connections/:id/disconnect`
- `POST /api/integrations/onedrive/oauth/start`
- `GET /api/integrations/onedrive/oauth/callback`
- `POST /api/integrations/onedrive/connections/:id/disconnect`
- `POST /api/integrations/connections/:id/reset-cursor`
- `POST /api/integrations/connections/:id/pause`
- `POST /api/integrations/connections/:id/resume`
- `POST /api/integrations/connections/:id/revoke`

The reusable `requireOwnerOrAdmin` guard from B2D1 is used.

---

## 3. Credential-class separation

Integration lifecycle administration now follows the same browser-admin model as Platform Management and Automation policy administration.

Allowed:

- HUMAN_SESSION OWNER
- HUMAN_SESSION ADMIN

Denied:

- HUMAN_SESSION MEMBER
- API_KEY
- missing identity
- revoked session

An API key cannot become an Integration administrator through scopes such as:

- `role:owner`
- `role:admin`
- `integrations:manage`

Machine credentials remain machine credentials.

---

## 4. Machine sync remains supported

B2D2B2 intentionally does **not** convert synchronization into a human-only path.

`POST /connections/:id/sync` remains API-key capable.

The focused proof verifies a machine API key reaches Integration runtime/state validation rather than the privileged-human guard.

This keeps background and external-machine synchronization possible without granting lifecycle administration authority.

---

## 5. OAuth callback account binding

Existing provider protections were preserved:

- high-entropy random state
- expiry
- single-use consumption
- account stored in OAuth state
- OneDrive PKCE S256
- bounded provider scopes

B2D2B2 adds an additional callback check.

Updated:

- `server/integrations/googleDriveOAuthService.ts`
- `server/integrations/microsoftOneDriveOAuthService.ts`

OAuth completion can now receive:

`expectedAccountId`

The Integration HTTP callbacks pass the durable account from the privileged HUMAN_SESSION.

If the OAuth state belongs to another account, completion fails before token exchange with:

- Google: `OAUTH_ACCOUNT_MISMATCH` / 403
- OneDrive: `ONEDRIVE_OAUTH_ACCOUNT_MISMATCH` / 403

This prevents a callback held by one signed-in privileged account from mutating a connection owned by another account.

---

## 6. Browser CSRF compatibility

Updated:

`src/components/IntegrationsWorkspace.tsx`

The UI now reads the non-HttpOnly:

`ka_csrf`

cookie and sends:

`X-CSRF-Token`

for Integration browser mutations, including:

- OAuth start
- manual sync
- pause
- resume
- reset cursor
- disconnect

This restores correct browser behavior under the B2C same-origin + double-submit CSRF boundary.

Updated:

`scripts/check-phase6e-integrations-ui-contract.ts`

to require this CSRF wiring.

---

## 7. Historical regression updates

B2D2B2 intentionally changes the HTTP authorization contract, so older tests that used API keys as connection administrators were adjusted without weakening their original domain coverage.

### A7B Integration runtime

`scripts/check-production-a7b-integration-runtime.ts`

A recoverable SYNC_FAILED connection now resumes through the PostgreSQL runtime service directly.

The A7B proof remains focused on:

- PostgreSQL authority
- persistence
- reconstruction
- checkpoints
- failure/recovery state

HTTP admin authorization is now owned by B2D2B2.

### Phase 6A Integration foundation

Connection revocation and revoked-resume behavior are tested at the Integration runtime layer.

API-key HTTP sync remains tested.

### Phase 6B Google Drive

OAuth start/callback/replay and disconnect are exercised directly through the Google OAuth service.

API-key HTTP read/sync account isolation remains tested.

### Phase 6C OneDrive

OAuth/PKCE callback/replay and disconnect are exercised directly through the OneDrive OAuth service.

API-key HTTP read/sync account isolation remains tested.

These changes preserve original provider/runtime guarantees without preserving the insecure machine-as-browser-admin assumption.

---

## 8. Executable PostgreSQL proof

Added:

`scripts/check-production-b2d2b2-integration-privileged-auth.ts`

Package command:

`npm run check:production:b2d2b2-integration-privileged-auth`

The proof verifies:

- missing production identity cannot administer a connection
- MEMBER cannot administer a connection
- OWNER without CSRF is rejected
- OWNER can pause its own connection
- ADMIN can resume its own connection
- spoofed account headers cannot change tenant scope
- privileged user in another account cannot administer a foreign raw connection ID
- API_KEY can still read machine-account connections
- API_KEY cannot pause/administer connections
- API_KEY sync reaches Integration runtime/state validation
- API_KEY cannot initiate browser OAuth
- MEMBER cannot complete browser OAuth
- OWNER reaches OAuth state validation
- Google callback state/account mismatch is rejected
- OneDrive callback state/account mismatch is rejected
- revoked ADMIN HUMAN_SESSION fails closed
- privileged routes are statically guarded
- sync route remains deliberately separate from the privileged guard
- Integration UI contains CSRF wiring

---

## 9. Quality Gate

Authoritative implementation workflow:

**`35620269855`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- Phase 6A Integration foundation — ✅ success
- Phase 6B Google Drive — ✅ success
- Phase 6C OneDrive — ✅ success
- Phase 6D Integration hardening — ✅ success
- Phase 6E Integrations UI — ✅ success
- Production A7B Integration runtime — ✅ success
- Production B2D2B2 Integration privileged authorization — ✅ success
- all previous Track B hardening proofs — ✅ success
- live Gemini benchmark — ✅ success

---

## 10. Exit criteria

B2D2B2 is complete because:

- Integration lifecycle administration is HUMAN_SESSION OWNER/ADMIN-only
- MEMBER cannot administer Integration connections
- API keys cannot become browser Integration administrators
- authenticated API-key reads remain account scoped
- machine sync remains intentionally supported
- OAuth callbacks remain random/expiring/single-use and are additionally account matched
- tenant isolation remains intact
- browser Integration mutations are CSRF compatible
- existing provider/runtime regression suites remain green

---

## 11. Next small phase

> **Production Hardening B2D3A — Legacy/Prototype Route Quarantine Foundation**

Keep the next slice small.

B2D3A should:

1. inventory the remaining legacy/prototype route families in `server.ts`
2. classify them as production-supported, development-only, or retired
3. add one reusable production quarantine boundary for development/prototype endpoints
4. fail closed in production
5. preserve explicit non-production compatibility only where required by existing regression suites
6. add focused route-quarantine proof
7. do not individually redesign every legacy subsystem in the same slice

B2D3B can then retire or migrate remaining route families in smaller groups.

Do **not** start Track C object storage or worker work in B2D3A.
