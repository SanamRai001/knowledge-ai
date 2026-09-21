# Production Hardening B2D3B1 — Test / Stress / Evaluation / Audit Route Retirement

Status: **COMPLETE**

Authoritative implementation Quality Gate: **`35626642229`**

Date: 2026-09-21

---

## 1. Scope

B2D3B1 removes internal quality-execution HTTP registration for:

- `/api/v1/tests/*`
- `/api/v1/stress/*`
- `/api/v1/eval/*`
- `/api/v1/audit/*`

This slice intentionally does not touch operations/observability, tenant/SaaS, mediator/RAG/cognitive, or Phase 4 route groups.

---

## 2. HTTP retirement

Updated:

`server.ts`

Removed route registration for:

- Phase 3 API acceptance execution
- Phase 4 acceptance execution
- mediator Phase 3/4/5/6 aliases under `/api/v1/tests/*`
- Phase 7/8/9 acceptance HTTP execution
- stress concurrency/isolation/state-machine HTTP execution
- evaluation dataset/run/human evaluation HTTP control surface
- comprehensive audit HTTP trigger

The separate:

`/api/v1/mediator/tests/phase6`

route remains intentionally untouched because the mediator family is B2D3B3 scope.

---

## 3. Obsolete server imports removed

After retiring those handlers, `server.ts` no longer imports HTTP-only references to:

- `runApiAcceptanceTests`
- `runPhase4AcceptanceTests`
- mediator Phase 3/4/5/7/8/9 test runners
- `integratedStressHarness`
- `goldenDatasetService`
- `executeComprehensiveAudit`

`runMediatorPhase6Tests` remains because the separate mediator route still exists.

---

## 4. CLI / CI capability preserved

The underlying modules remain available outside the HTTP server.

B2D3B1 proof imports and verifies:

- API acceptance runner
- Phase 4 runner
- mediator Phase 3/4/5/7/8/9 runners
- integrated stress harness
- golden dataset/evaluation service
- comprehensive audit runner

It directly executes the stress state-machine audit and evaluation read methods to prove these services remain callable without HTTP exposure.

---

## 5. Route disposition upgraded to RETIRED

Updated:

`server/legacyRouteQuarantine.ts`

The following families move from:

`DEVELOPMENT_ONLY`

to:

`RETIRED`

- `/api/v1/tests/*`
- `/api/v1/stress/*`
- `/api/v1/eval/*`
- `/api/v1/audit/*`

The compatibility flag now reopens **only** `DEVELOPMENT_ONLY` families.

It cannot reopen:

- `RETIRED`
- `RETIRED_FALLBACK`

This means retired quality routes stay closed even during explicit local compatibility mode.

---

## 6. Historical quarantine proof updated

Updated:

`scripts/check-production-b2d3a-route-quarantine.ts`

It now verifies:

- these four families are RETIRED
- later cleanup groups remain DEVELOPMENT_ONLY
- development remains default-deny
- explicit compatibility can still reopen DEVELOPMENT_ONLY routes
- retired routes remain 404 even with compatibility enabled
- retired KB fall-through also remains closed

---

## 7. Executable B2D3B1 proof

Added:

`scripts/check-production-b2d3b1-internal-quality-route-retirement.ts`

Package command:

`npm run check:production:b2d3b1-internal-quality-route-retirement`

The proof verifies:

- no target route registration remains in `server.ts`
- no obsolete server-only imports remain
- separate mediator Phase 6 route remains untouched
- all four route families are classified RETIRED
- acceptance-test runners remain importable
- stress harness remains callable
- evaluation service remains callable
- comprehensive audit runner remains importable
- retired routes cannot be reopened with compatibility flag
- later DEVELOPMENT_ONLY route groups still preserve explicit non-production compatibility

---

## 8. Quality Gate

Authoritative implementation workflow:

**`35626642229`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- TypeScript — ✅ success
- production build — ✅ success
- B2D3A route quarantine proof — ✅ success
- B2D3B1 internal quality route retirement proof — ✅ success
- all prior Phase 0–8 regressions — ✅ success
- all previous Track B hardening proofs — ✅ success
- live Gemini benchmark — ✅ success

---

## 9. Exit criteria

B2D3B1 is complete because:

- test/stress/eval/audit HTTP execution is removed
- their supporting services remain script-callable
- retired families cannot be reopened by compatibility config
- later route groups remain untouched
- existing regression and PostgreSQL gates remain green

---

## 10. Next small phase

> **Production Hardening B2D3B2A — Operations + Observability Route Retirement**

Keep the next slice limited to:

- `/api/v1/operations/*`
- `/api/v1/observability/*`

B2D3B2A should:

1. classify which operational/observability logic remains useful as internal services
2. remove prototype HTTP registration
3. keep required service logic script-callable
4. remove obsolete server imports
5. mark these route families RETIRED
6. preserve system/provider read-only compatibility paths
7. add focused retirement proof
8. stop before tenant/SaaS cleanup

Do **not** start B2D3B2B, B2D3B3, Track C object storage, or workers in this slice.
