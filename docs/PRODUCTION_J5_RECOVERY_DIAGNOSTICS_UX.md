# Production J5 — Production Recovery/Diagnostics UX

Status: **COMPLETE** — authoritative implementation Quality Gate `36254240629`.

## Goal

J5 exposes production diagnostics safely inside the authenticated product without turning the browser into an infrastructure control plane.

The slice consumes the real G2 readiness contract and the G3/H4 recovery/release policy, while preserving their deployment-operated execution model.

## Visibility model

Diagnostics are available only to authenticated HUMAN_SESSION users whose selected account membership is:

- OWNER
- ADMIN

MEMBER users do not receive the Diagnostics navigation surface and direct `?tab=diagnostics` selection falls back to the normal product workspace.

The backend independently enforces the same boundary using `requireOwnerOrAdmin`.

## Sanitized diagnostics contract

Added:

`server/operations/operatorDiagnosticsService.ts`

The service consumes:

`productionReadinessService.checkWebReadiness()`

but deliberately does **not** expose the raw readiness report.

Allow-listed browser categories are:

- application runtime
- data service
- application data compatibility
- durable file storage
- protected credentials

Each category exposes only:

- safe category ID
- safe display label
- OPERATIONAL / DEGRADED
- fixed user/operator guidance

The browser contract excludes:

- raw readiness `detail`
- probe duration
- process role
- migration versions/checksums
- database URL/host/name
- object-storage bucket/key
- KMS/keyring details
- credentials/secrets
- stack traces
- deployment topology

Unknown future readiness checks are dropped rather than automatically exposed.

## Privileged HTTP surface

Added:

`GET /api/organization/diagnostics`

The route:

- uses the existing authenticated organization router
- requires OWNER or ADMIN
- is GET/read-only
- accepts no body
- accepts no raw-detail/fresh/debug toggle
- returns only the sanitized diagnostics summary

No recovery or deployment mutation endpoint was added.

## Ordinary degraded-state redaction

J2 already represented HTTP 503 as the explicit `degraded` shell state.

J5 preserves that semantic but stops echoing arbitrary backend messages/codes to the browser.

503 now maps to:

- code: `SERVICE_DEGRADED`
- safe message explaining a required service is temporarily unavailable
- retry guidance
- organization-administrator escalation guidance

This prevents infrastructure/configuration detail from leaking through ordinary-member error states.

## Diagnostics workspace

Added:

`src/components/DiagnosticsWorkspace.tsx`

The workspace includes:

- overall operational/degraded status
- sanitized readiness cards
- last checked time
- Refresh action
- recovery policy summary
- release/rollback policy summary
- explicit read-only boundary

The browser does **not** contain:

- Restore button
- Promote button
- Rollback button
- Migration button
- infrastructure mutation request

## Recovery policy

J5 surfaces safe G3 recovery objectives:

- relational RPO target
- relational RTO target
- minimum recoverable-delete window
- recovery-validation freshness requirement

It explicitly states:

- recovery is deployment-operated
- restore validation runs against an isolated target
- there is no in-app restore action

J5 does not invoke `recovery:validate` from the browser.

## Release policy

J5 exposes only safe H4 policy facts:

- build-once immutable promotion
- web readiness required
- worker readiness required
- recovery evidence required
- automatic database down migration disabled

It explicitly states:

- release/promotion/rollback are deployment-operated
- there is no in-app promote/rollback/migration action

J5 does not invoke the H4 release gate from browser traffic.

## Legacy operator UI boundary

The historical components remain unmounted:

- `Phase7ReadinessView.tsx`
- `Phase8OperationalDashboard.tsx`
- `Phase9SaaSPlatformView.tsx`

J5 adds a new supported diagnostics surface rather than reviving prototype/phase-numbered operational UI.

Their source-tree cleanup belongs to J6.

## Executable proofs

### Sanitization + authorization contract

`scripts/check-production-j5-recovery-diagnostics.ts`

Injects a synthetic readiness report containing secret-looking/raw values such as:

- database connection material
- migration drift identifiers
- private bucket names
- KMS-like identifiers
- future unknown check data

and verifies none can reach the sanitized output.

It also verifies:

- unknown checks are dropped
- route is OWNER/ADMIN-only
- route is read-only
- no raw-detail query/body contract exists
- recovery/release remain deployment-operated

### UI + degraded-state proof

`scripts/check-production-j5-recovery-diagnostics-ui.ts`

Verifies:

- privileged Diagnostics navigation
- MEMBER direct-URL fallback
- supported diagnostics endpoint only
- generic/safe 503 browser state
- Refresh as the only operational action
- no restore/promote/rollback/migration controls
- no infrastructure configuration terms in the UI
- Phase7/8 legacy operator components remain unmounted

### J1 historical audit advancement

The J1 drift proof now recognizes the supported J5 diagnostics surface while continuing to guard:

- legacy phase-numbered components remain unmounted
- stale phase-numbered product copy remains tracked for J6
- normal product/admin separation remains intact

## Validation

Authoritative implementation Quality Gate:

`36254240629`

Verified green:

- TypeScript
- production build
- complete Phase 0–8 regression suite
- all production-hardening guards through J4
- J5 sanitization/authorization contract proof
- J5 diagnostics UI/degraded-state proof
- full PostgreSQL production suite
- immutable production image smoke
- dependency vulnerability gate
- CycloneDX SBOM generation/verification
- production image HIGH/CRITICAL scan
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Next phase

**J6 — Copy + Dead Surface Cleanup**

J6 should complete the remaining frontend cleanup recorded by J1:

- remove phase-numbered product copy
- remove/archive orphan Phase7/8/9 components after confirming they are not imported
- clean prototype wording from supported product UI
- preserve engineering phase terminology in docs/tests only

J6 must not broaden into new product capability or backend behavior.
