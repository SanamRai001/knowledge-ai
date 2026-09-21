# Production Hardening B2D3B2B — Tenant + SaaS Route Retirement

Status: **COMPLETE**

Authoritative implementation Quality Gate: **`35631363130`**

Date: 2026-09-21

---

## 1. Scope

B2D3B2B removes prototype HTTP registration for:

- `/api/v1/tenants/*`
- `/api/v1/saas/*`

This closes the legacy tenant/SaaS administration layer without deleting the underlying service modules.

Mediator/RAG/Cognitive/Phase 4 remains B2D3B3.

---

## 2. HTTP retirement

Updated:

`server.ts`

Removed legacy HTTP handlers for:

- tenant listing/details/provisioning
- self-service tenant onboarding
- tenant API-key list/create/revoke
- billing account reads
- invoice reads/generation
- quota reads
- tenant audit-log reads
- compliance export
- webhook list/register/delivery logs
- SaaS readiness status
- simulated billing cycle

No `/api/v1/tenants/*` or `/api/v1/saas/*` registration remains in `server.ts`.

---

## 3. Dead server imports removed

After retiring those handlers, the production server no longer imports:

- `multiTenancyService`
- `quotaAndBillingService`
- `tenantGovernanceService`
- `webhookService`
- `saasReadinessService`

`apiManagementService` remains intentionally imported because:

`GET /api/v1/api-docs/openapi`

still uses its read-only OpenAPI generation path.

---

## 4. Internal service capability preserved

The underlying modules remain directly importable:

- `server/mediator/multiTenancyService.ts`
- `server/mediator/quotaAndBillingService.ts`
- `server/mediator/tenantGovernanceService.ts`
- `server/mediator/webhookService.ts`
- `server/mediator/saasReadinessService.ts`

B2D3B2B proof verifies that tenancy, quota/billing, governance, webhook, and SaaS readiness APIs remain callable outside HTTP for scripts, tests, or a later supported migration.

---

## 5. Route disposition upgraded to RETIRED

Updated:

`server/legacyRouteQuarantine.ts`

Both families move from:

`DEVELOPMENT_ONLY`

to:

`RETIRED`

- `/api/v1/tenants/*`
- `/api/v1/saas/*`

The non-production compatibility flag cannot reopen these routes.

---

## 6. Legacy privileged surfaces closed

B2D3B2B removes the HTTP paths that previously allowed legacy tenant administration for:

- provisioning
- API-key administration
- billing/invoice administration
- quota inspection
- compliance/audit access
- webhook administration
- SaaS onboarding
- simulated billing

These prototype paths are no longer alternate administration planes.

---

## 7. Modern administration boundary preserved

B2D3B2B explicitly preserves the modern key-management boundary:

`/api/platform-management`

which requires:

- HUMAN_SESSION
- OWNER or ADMIN
- modern request identity
- PostgreSQL-authoritative API-key runtime services

The focused proof checks that `platformManagementRouter` still uses:

- `applicationIdentityMiddleware`
- `requireOwnerOrAdmin`
- `apiKeyRuntimeService`

Legacy tenant routes therefore cannot compete with or bypass the modern Platform Management control plane.

---

## 8. Historical proofs updated

Updated:

- `scripts/check-production-b2d3a-route-quarantine.ts`
- `scripts/check-production-b2d3b1-internal-quality-route-retirement.ts`
- `scripts/check-production-b2d3b2a-operations-observability-retirement.ts`

Changes:

- tenant/SaaS now expected as RETIRED
- mediator/Phase 4 families are used as remaining DEVELOPMENT_ONLY compatibility examples
- tenant/SaaS remain unavailable even when non-production compatibility is enabled

---

## 9. Executable B2D3B2B proof

Added:

`scripts/check-production-b2d3b2b-tenant-saas-retirement.ts`

Package command:

`npm run check:production:b2d3b2b-tenant-saas-retirement`

The proof verifies:

- no tenant/SaaS HTTP registration remains
- obsolete server imports are gone
- API docs remain supported
- modern Platform Management remains OWNER/ADMIN protected
- both route families are RETIRED
- tenancy service remains callable
- quota/billing service remains callable
- tenant governance service remains callable
- webhook service remains callable
- SaaS readiness service remains callable
- retired tenant/SaaS routes cannot be reopened by compatibility mode
- remaining mediator/RAG/cognitive/Phase 4 development compatibility is untouched

---

## 10. Quality Gate

Authoritative implementation workflow:

**`35631363130`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- TypeScript — ✅ success
- production build — ✅ success
- B2D3A route quarantine proof — ✅ success
- B2D3B1 internal quality route retirement proof — ✅ success
- B2D3B2A operations observability retirement proof — ✅ success
- B2D3B2B tenant SaaS retirement proof — ✅ success
- all previous Phase 0–8 regressions — ✅ success
- all previous Track B hardening proofs — ✅ success
- live Gemini benchmark — ✅ success

---

## 11. Exit criteria

B2D3B2B is complete because:

- legacy tenant/SaaS HTTP administration is removed
- legacy key/billing/quota/governance/webhook paths are closed
- tenant/SaaS supporting services remain internally available
- both route families are permanently retired
- compatibility config cannot reopen them
- modern account/membership/Platform Management boundaries remain authoritative
- API docs compatibility remains intact
- all quality and PostgreSQL gates are green

---

## 12. Next small phase

> **Production Hardening B2D3B3A — Mediator Route Retirement**

Keep the next slice limited to:

- `/api/v1/mediator/*`

B2D3B3A should:

1. inventory which mediator logic is still used by supported product/runtime code
2. remove prototype mediator HTTP registration
3. keep required mediator services available internally
4. remove obsolete `server.ts` imports
5. mark the mediator route family RETIRED
6. preserve RAG/Cognitive/Phase 4 for later slices
7. add focused retirement proof
8. stop before RAG/Cognitive/Phase 4 cleanup

Do **not** start B2D3B3B, B2D3B3C, Track C object storage, or workers in this slice.
