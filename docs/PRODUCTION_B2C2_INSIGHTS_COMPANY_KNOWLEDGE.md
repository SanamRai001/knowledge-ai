# Production Hardening B2C2 — Insights + Company Knowledge Route Cutover

Status: **COMPLETE**

Authoritative integrated Quality Gate: **`35556818820`**

Date: 2026-09-21

---

## 1. Scope

B2C2 migrates exactly two normal product route families to the shared human-aware application identity boundary:

- `/api/insights`
- `/api/company-knowledge`

No Actions, Watch, Integrations, Automation, Platform Management, or legacy/admin routes are migrated in this slice.

---

## 2. Routes migrated

### Insights

`server/discovery/discoveryRouter.ts`

Now uses:

`discoveryRouter.use(applicationIdentityMiddleware)`

Existing Discovery/Insights account isolation remains authoritative.

### Company Knowledge

`server/companyKnowledge/companyKnowledgeRouter.ts`

Now uses:

`companyKnowledgeRouter.use(applicationIdentityMiddleware)`

Existing Company Knowledge persistence and account isolation remain authoritative.

---

## 3. Human browser behavior

Valid HUMAN_SESSION requests can now access Insights and Company Knowledge.

Account scope comes only from the durable selected account in the session.

Caller-supplied account headers cannot override session scope.

Unsafe HUMAN_SESSION methods are protected by the B2C shared middleware:

- exact same-origin verification
- double-submit CSRF validation

This applies to operations such as:

- Insight status mutations
- Company Knowledge projection mutations

---

## 4. Machine API-key behavior

API-key behavior is preserved.

Machine requests:

- remain `API_KEY`
- derive account scope from the key
- do not acquire human user/session/role fields
- do not require browser CSRF tokens

Human and machine credential classes remain separate.

---

## 5. Production behavior

Without HUMAN_SESSION or API_KEY credentials, production requests to:

- `/api/insights`
- `/api/company-knowledge`

fail closed with 401.

They do not become implicit `acc_default`.

---

## 6. Executable proof

Added:

`scripts/check-production-b2c2-insights-company-knowledge.ts`

Added package command:

`npm run check:production:b2c2-insights-company-knowledge`

The real PostgreSQL proof verifies:

- production Insights rejects missing identity
- production Company Knowledge rejects missing identity
- HUMAN_SESSION reads only its own Insights
- spoofed account headers cannot move HUMAN_SESSION into another account
- HUMAN_SESSION reads only its own Company Knowledge entities
- human Insight mutation without CSRF is rejected
- hostile-origin Company Knowledge mutation is rejected
- valid HUMAN_SESSION + CSRF can mutate its own Insight
- HUMAN_SESSION cannot mutate another account Insight by raw ID
- valid HUMAN_SESSION + CSRF reaches Company Knowledge application validation
- API_KEY reads only its own Insights
- API_KEY Insight mutation works without browser CSRF
- API_KEY reads only its own Company Knowledge entities
- API_KEY Company Knowledge mutation reaches application validation without browser CSRF
- HUMAN_SESSION cannot read another account entity by raw ID
- revoked HUMAN_SESSION fails closed on both route families

The first proof run exposed an incorrect cleanup-table name in the new test fixture. The reset list was corrected to the actual migration table `discovery_analysis_run_insights`, after which the exact updated head passed.

---

## 7. Regression coverage

The integrated Quality Gate remained green across:

- TypeScript
- production build
- workspace isolation
- workspace HTTP isolation
- dataset HTTP isolation
- discovery proofs
- company-knowledge proofs
- full Phase 0–8 regression suite
- A2–A7G PostgreSQL hardening proofs
- B2A
- B2B1
- B2B2
- B2C1
- B2C2

---

## 8. Quality Gate

Authoritative corrected workflow:

**`35556818820`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2C2 Insights and Company Knowledge proof` — ✅ success

---

## 9. B2C2 exit criteria

B2C2 is complete because:

- Insights accepts durable human browser identity
- Company Knowledge accepts durable human browser identity
- API-key machine behavior remains intact
- human unsafe methods use same-origin + CSRF protection
- production missing identity fails closed
- account-header spoofing does not cross tenant boundaries
- raw-ID cross-account reads/writes remain denied
- revoked browser sessions fail closed
- existing Discovery and Company Knowledge regressions remain green

---

## 10. Next small phase

> **Production Hardening B2C3 — Actions + Watch + Integrations + Automation Route Cutover**

Keep B2C3 limited to normal product-route identity cutover.

B2C3 should migrate:

- `/api/actions`
- `/api/watch`
- `/api/integrations`
- `/api/automation`

to `applicationIdentityMiddleware`.

B2C3 should:

1. preserve intentional API-key behavior
2. accept HUMAN_SESSION account scope
3. enforce same-origin + CSRF for HUMAN_SESSION unsafe methods
4. preserve tenant isolation
5. reject missing production identity
6. add focused route-cutover coverage
7. avoid changing privileged role authorization semantics beyond what is required for identity cutover

Do **not** migrate Platform Management or legacy route families in B2C3.

Those remain B2D work.
