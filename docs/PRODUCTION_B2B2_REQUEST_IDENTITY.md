# Production Hardening B2B2 — HUMAN_SESSION Request Identity + Production Fallback Removal

Status: **COMPLETE**

Authoritative integrated Quality Gate: **`35528053793`**

Date: 2026-09-20

---

## 1. Scope

B2B2 introduces the durable request-identity boundary that B2C browser routes can consume.

Implemented:

- distinct `HUMAN_SESSION` request identity source
- human user ID propagation
- active account membership role propagation
- durable session ID propagation
- selected account propagation
- selected workspace propagation
- async human-aware request identity resolution
- explicit human-vs-machine credential separation
- explicit account-selection requirement
- production fail-closed behavior for missing credentials
- opt-in non-production `DEFAULT_WEB` compatibility
- focused real-PostgreSQL identity-boundary verification

B2B2 intentionally does **not** rewire every product router yet.

---

## 2. Request identity model

`RequestIdentity.source` now distinguishes:

- `API_KEY`
- `HUMAN_SESSION`
- `DEFAULT_WEB`

Human-session identity can carry:

- `userId`
- `membershipRole`
- `sessionId`
- `accountId`
- `workspaceId`

Machine API-key identity continues to carry:

- `apiKeyId`
- machine-owned `accountId`

These fields are not cross-populated.

---

## 3. New async resolver

Added:

`resolveAuthenticatedRequestIdentity(req)`

Resolution order is intentionally explicit:

1. reject mixed API-key + human-session credentials
2. resolve Bearer API key as `API_KEY`
3. otherwise resolve `ka_session` as `HUMAN_SESSION`
4. otherwise allow `DEFAULT_WEB` only when the explicit non-production compatibility switch is enabled
5. otherwise fail with 401

The durable human session is resolved through the B2A/B2B1 PostgreSQL-backed session foundation.

---

## 4. Human account/workspace scope

A human session used for account-scoped application requests must have a selected account.

If it does not:

- identity resolution returns `ACCOUNT_SELECTION_REQUIRED`
- status is 409
- the request does **not** fall back to `acc_default`

When selected account exists, session resolution also validates that the membership remains ACTIVE.

Selected workspace is carried only from the durable session state and is already constrained to the selected account by B2A.

Caller-supplied account headers are ignored.

---

## 5. Machine vs human credential separation

Requests cannot combine:

- `Authorization: Bearer <API_KEY>`
- `ka_session=<human session>`

Mixed credential classes return:

`AMBIGUOUS_CREDENTIALS`

This avoids unclear privilege composition between machine scopes and human roles.

API keys remain machine credentials and do not gain:

- `userId`
- human membership role
- human session ID

Human sessions do not gain:

- `apiKeyId`
- API-key scopes

---

## 6. Production fallback removal

Legacy `DEFAULT_WEB / acc_default` now requires:

`KNOWLEDGE_AI_ALLOW_DEFAULT_WEB=true`

and is permitted only when:

`NODE_ENV !== production`

Therefore setting the compatibility switch in production still does not permit unauthenticated `acc_default` identity.

The default in `.env.example` is:

`KNOWLEDGE_AI_ALLOW_DEFAULT_WEB=false`

CI explicitly opts legacy regression tests into compatibility until their route families are cut over in B2C.

---

## 7. Sync resolver behavior before B2C

The existing synchronous `resolveRequestIdentity()` remains temporarily available for product routers that have not yet been migrated.

It still supports API keys.

It may support explicit non-production `DEFAULT_WEB` compatibility.

If a real human session cookie reaches a router that still uses the sync resolver, it fails rather than silently downgrading that human to `DEFAULT_WEB`.

This is deliberate transitional behavior.

B2C will migrate browser product routers to the async resolver in small route-family slices.

---

## 8. Executable proof

Added:

`scripts/check-production-b2b2-request-identity.ts`

Added package command:

`npm run check:production:b2b2-request-identity`

The real PostgreSQL proof verifies:

- non-production does not implicitly enable `DEFAULT_WEB`
- explicit dev/test compatibility enables `DEFAULT_WEB`
- production rejects missing credentials even when compatibility is configured
- valid human session resolves as `HUMAN_SESSION`
- human identity carries user, OWNER role, session, account, and workspace
- caller-supplied account header cannot override human session scope
- the pre-B2C sync resolver rejects a human session instead of downgrading it
- authenticated human without selected account returns `ACCOUNT_SELECTION_REQUIRED`
- invalid human session fails closed
- API key remains `API_KEY`
- machine identity has no human authority fields
- existing sync API-key resolution remains valid
- mixed API key + human session is rejected
- revoked human session fails closed

---

## 9. Quality Gate

Workflow:

**`35528053793`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2B2 request identity proof` — ✅ success

The full Phase 0–8 regression suite, TypeScript, production build, A2–A7G PostgreSQL proofs, B2A, B2B1, and B2B2 all remained green.

---

## 10. B2B2 exit criteria

B2B2 is complete because:

- human and machine credentials are distinct identity classes
- human session context is durable and attributable
- account/workspace context comes from validated session state
- production no longer has an implicit `acc_default` fallback in the identity resolver
- legacy `DEFAULT_WEB` is explicit and non-production-only
- invalid/revoked human sessions fail closed
- mixed credential classes fail closed
- the async resolver is ready for route-by-route B2C migration

---

## 11. Next small phase

> **Production Hardening B2C1 — Core Browser Route Cutover**

Keep the next phase deliberately small.

B2C1 should migrate only:

- `/api/kb`
- `/api/datasets`
- `/api/query`

to the async human-aware resolver.

B2C1 should:

1. preserve API-key behavior where these routes intentionally support machine credentials
2. accept valid `HUMAN_SESSION`
3. preserve account/workspace isolation
4. reject missing production identity
5. keep explicit dev/test compatibility for legacy regression coverage
6. add focused HTTP tests for all three route families

Do **not** migrate Insights, Company Knowledge, Actions, Watch, Integrations, Automation, or Platform Management in B2C1.
