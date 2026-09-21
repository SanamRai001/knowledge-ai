# Production Hardening B2C1 — Core Browser Route Cutover

Status: **COMPLETE**

Authoritative integrated Quality Gate: **`35555336358`**

Date: 2026-09-21

---

## 1. Scope

B2C1 migrates only the three core browser-facing route families to the B2B2 human-aware request-identity boundary:

- `/api/kb`
- `/api/datasets`
- `/api/query`

No other product router is migrated in this slice.

---

## 2. Shared application identity middleware

Added:

`server/requestIdentityMiddleware.ts`

The middleware:

1. resolves identity through `resolveAuthenticatedRequestIdentity()`
2. accepts API-key machine credentials where supported
3. accepts durable HUMAN_SESSION browser identity
4. rejects missing production identity
5. preserves explicit non-production DEFAULT_WEB compatibility
6. stores the resolved identity in `res.locals.requestIdentity`

For HUMAN_SESSION unsafe HTTP methods, it also enforces:

- exact same-origin verification
- double-submit CSRF validation

Safe methods are:

- GET
- HEAD
- OPTIONS

API-key machine requests remain outside browser CSRF requirements.

---

## 3. Routes migrated

### Knowledge Base

`server/workspaceRouter.ts`

Now uses:

`workspaceRouter.use(applicationIdentityMiddleware)`

Existing account/workspace isolation remains authoritative.

### Datasets

`server/datasets/datasetRouter.ts`

Now uses:

`datasetRouter.use(applicationIdentityMiddleware)`

Existing Dataset account isolation remains authoritative.

### Query

`server/querying/queryRouter.ts`

Now uses:

`queryRouter.use(applicationIdentityMiddleware)`

The account passed into the unified query service now comes from the validated HUMAN_SESSION or API_KEY identity boundary.

---

## 4. Human browser behavior

Valid HUMAN_SESSION requests can now access the three B2C1 route families.

Account scope comes only from the durable selected account in the session.

Workspace context remains bound to the durable session.

Caller-supplied account headers cannot override the session account.

Unsafe cookie-authenticated requests require both:

- allowed Origin
- matching `ka_csrf` cookie and `x-csrf-token` header

---

## 5. Machine API-key behavior

API-key behavior is preserved for these route families.

Machine credentials:

- remain `API_KEY`
- derive account from the key
- do not acquire user/session/role fields
- do not require browser CSRF tokens

This keeps machine and human credential models separate.

---

## 6. Production fallback behavior

Without HUMAN_SESSION or API_KEY credentials, production requests to the migrated route families return 401.

They no longer reach application logic as implicit `acc_default`.

Legacy regression tests may continue using explicitly enabled non-production DEFAULT_WEB compatibility until their remaining route families are migrated.

---

## 7. Executable proof

Added:

`scripts/check-production-b2c1-core-route-cutover.ts`

Added package command:

`npm run check:production:b2c1-core-route-cutover`

The real PostgreSQL proof verifies:

- production KB rejects missing identity
- production Datasets rejects missing identity
- production Query rejects missing identity before application processing
- HUMAN_SESSION can access KB
- spoofed account headers cannot move HUMAN_SESSION into another account
- HUMAN_SESSION can access Datasets
- KB human mutation without CSRF is rejected
- hostile-origin human Query mutation is rejected
- valid same-origin + CSRF HUMAN_SESSION can mutate KB
- valid same-origin + CSRF HUMAN_SESSION reaches Dataset application validation
- valid same-origin + CSRF HUMAN_SESSION reaches Query application validation
- API_KEY continues to access KB
- API_KEY continues to access Datasets
- API_KEY reaches Query application validation without browser CSRF
- revoked HUMAN_SESSION fails closed on KB and Datasets

The first test run correctly caught a fixture-order issue: the test attempted to create a membership before creating its account row. The fixture was corrected, and the exact updated head then passed.

---

## 8. Regression coverage

Existing Quality Gate coverage remained green, including:

- Workspace isolation
- Workspace HTTP isolation
- Dataset HTTP isolation
- analytical routing
- full Phase 0–8 regression suite
- all prior PostgreSQL hardening proofs
- B2A identity foundation
- B2B1 auth session API
- B2B2 request identity

---

## 9. Quality Gate

Authoritative corrected workflow:

**`35555336358`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2C1 core route cutover proof` — ✅ success

---

## 10. B2C1 exit criteria

B2C1 is complete because:

- KB accepts durable human browser identity
- Datasets accepts durable human browser identity
- Query accepts durable human browser identity
- machine API-key behavior remains intact
- human mutations have same-origin + CSRF enforcement
- production no-credential requests fail closed
- account spoofing does not cross the session boundary
- revoked browser sessions fail closed
- existing route isolation proofs still pass

---

## 11. Next small phase

> **Production Hardening B2C2 — Insights + Company Knowledge Route Cutover**

B2C2 should migrate only:

- `/api/insights`
- `/api/company-knowledge`

to `applicationIdentityMiddleware`.

B2C2 should:

1. preserve API-key behavior where intentional
2. accept HUMAN_SESSION account scope
3. enforce same-origin + CSRF for human unsafe methods
4. preserve discovery/company-knowledge account isolation
5. reject missing production identity
6. add focused real-PostgreSQL route-cutover coverage

Do **not** migrate Actions, Watch, Integrations, Automation, or Platform Management in B2C2.
