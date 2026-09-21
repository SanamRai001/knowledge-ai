# Production Hardening B2D3A — Legacy/Prototype Route Quarantine Foundation

Status: **COMPLETE**

Authoritative implementation Quality Gate: **`35623669505`**

Date: 2026-09-21

---

## 1. Scope

B2D3A establishes one reusable quarantine boundary for the remaining inline legacy/prototype HTTP surface in `server.ts`.

This slice does **not** migrate or delete every legacy subsystem.

Covered:

- complete route-family inventory for remaining legacy/prototype surfaces
- production-supported vs development-only vs retired classification
- reusable route-family classifier
- production fail-closed middleware
- explicit non-production compatibility flag
- quarantine placement after modern routers and before old inline handlers
- retired legacy `/api/kb` fall-through protection
- focused route-quarantine proof

Not covered:

- individual retirement/migration of every legacy family
- Track C object storage
- worker/queue infrastructure

---

## 2. Reusable quarantine registry

Added:

`server/legacyRouteQuarantine.ts`

Each legacy family is classified as one of:

- `PRODUCTION_SUPPORTED`
- `DEVELOPMENT_ONLY`
- `RETIRED`
- `RETIRED_FALLBACK`

The registry is the authoritative B2D3A classification source used by the middleware and proof.

---

## 3. Production-supported compatibility families

The following legacy compatibility families remain deliberately reachable for now:

- `/api/v1/health`
- `/api/v1/chat`
- `/api/v1/ai/*`
- `/api/v1/system/*`
- `/api/v1/providers/*`
- `/api/v1/api-docs/*`

Reasons:

- `/api/v1/chat` and `/api/v1/ai/*` remain intended API-key compatibility surfaces identified during B1
- system/provider health and API docs are retained compatibility/read-only surfaces pending later migration

B2D3A does not silently retire these routes.

---

## 4. Development-only families

The following families are now quarantined from normal production HTTP access:

- `/api/v1/tests/*`
- `/api/v1/stress/*`
- `/api/v1/operations/*`
- `/api/v1/observability/*`
- `/api/v1/eval/*`
- `/api/v1/audit/*`
- `/api/v1/tenants/*`
- `/api/v1/saas/*`
- `/api/v1/mediator/*`
- `/api/v1/rag/*`
- `/api/v1/cognitive/*`
- `/api/phase4/*`

These are test, benchmark, prototype admin, research, simulator, or legacy phase surfaces that predate the modern identity/authorization architecture.

In production they now fail before their inline handlers execute.

---

## 5. Retired families

### Legacy developer management

`/api/v1/developer/*`

is classified `RETIRED`.

The explicit B2D2A 410 retirement router is mounted before the generic quarantine boundary, so callers continue to receive the migration response rather than the generic quarantine response.

### Legacy workspace fall-through

`/api/kb/*`

is classified `RETIRED_FALLBACK` **only when traffic reaches the quarantine boundary**.

The modern `workspaceRouter` is mounted first.

Therefore:

- modern supported KB routes execute normally
- any `/api/kb` path not handled by the modern router cannot fall through into the old inline `kbStore` handlers in production

This closes the duplicate-workspace fallback identified during B1 without deleting the old code in the foundation slice.

---

## 6. Middleware placement

Updated:

`server.ts`

Order is now:

1. modern auth/product routers
2. stable Platform API
3. human Platform Management
4. explicit retired developer-management router
5. **legacy/prototype quarantine middleware**
6. remaining old inline routes

This ordering is intentional.

Supported modern routes get first chance.

Old inline routes cannot bypass the quarantine.

---

## 7. Fail-closed behavior

Quarantined routes return:

- HTTP `404`
- code `LEGACY_ROUTE_QUARANTINED`
- family id
- disposition

Production remains fail-closed even if a compatibility flag is mistakenly enabled.

This prevents configuration from reopening prototype routes in production.

---

## 8. Explicit non-production compatibility

Added environment flag:

`KNOWLEDGE_AI_ALLOW_LEGACY_PROTOTYPE_ROUTES=false`

Documented in:

`.env.example`

Rules:

- default is false
- development/test is still blocked by default
- explicit non-production opt-in requires the flag to be exactly `true`
- `NODE_ENV=production` ignores the flag and remains quarantined

This preserves a deliberate escape hatch for old local/demo/regression work without making legacy exposure implicit.

---

## 9. Executable proof

Added:

`scripts/check-production-b2d3a-route-quarantine.ts`

Package command:

`npm run check:production:b2d3a-route-quarantine`

The proof verifies:

- every B1 prototype family is classified DEVELOPMENT_ONLY
- retired workspace fallback is classified
- retired developer management remains inventoried
- intended API-key compatibility families remain classified production-supported
- all quarantined families return 404 in production
- production ignores a true compatibility flag
- modern KB handler mounted before quarantine remains reachable
- unhandled KB traffic cannot reach retired inline handlers
- non-production remains default-deny
- explicit non-production compatibility allows old routes
- server mount order is correct
- compatibility flag is documented and defaults false

---

## 10. Quality Gate

Authoritative implementation workflow:

**`35623669505`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- TypeScript — ✅ success
- production build — ✅ success
- Production B2D3A route quarantine proof — ✅ success
- all previous Phase 0–8 regressions — ✅ success
- all previous Track B hardening proofs — ✅ success
- live Gemini benchmark — ✅ success

---

## 11. Exit criteria

B2D3A is complete because:

- remaining legacy/prototype route families have an explicit classification
- development/prototype families are no longer reachable in production
- production behavior is fail-closed
- non-production compatibility is explicit rather than implicit
- modern route precedence is preserved
- old KB fall-through cannot bypass modern workspace authorization
- explicit developer retirement behavior is preserved
- existing regressions remain green

---

## 12. Next small phase

> **Production Hardening B2D3B1 — Test / Stress / Evaluation / Audit Route Retirement**

Keep the next slice limited to internal quality-execution families:

- `/api/v1/tests/*`
- `/api/v1/stress/*`
- `/api/v1/eval/*`
- `/api/v1/audit/*`

B2D3B1 should:

1. remove production server registration for these internal-only execution routes
2. keep their underlying test/evaluation services available to CLI/CI where still needed
3. preserve CI coverage without HTTP exposure
4. remove obsolete server imports made unnecessary by route retirement
5. add focused proof that the internal tools remain callable from scripts while HTTP routes are gone/quarantined
6. stop before operations/observability/tenant/SaaS cleanup

Do **not** start B2D3B2, Track C object storage, or workers in this slice.
