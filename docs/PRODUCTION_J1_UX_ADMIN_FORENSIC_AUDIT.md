# Production J1 — UX/Admin Forensic Audit

Status: **COMPLETE** — authoritative integrated Quality Gate `36231584786`.

## Goal

Track J starts with an audit, not a redesign.

J1 inventories the current browser shell against the production authorization, source-authority, readiness, and operator boundaries already hardened in Tracks B–I.

The core finding is:

> **The backend is role-aware and production-hardened, but the primary frontend shell still behaves like a single-role engineering console.**

That mismatch is now the highest-value production UX/admin cleanup target.

## Current browser navigation

The primary header exposes one flat top-level navigation bar containing:

- Ask
- Insights
- Knowledge
- Actions
- Automation
- Watch
- Integrations
- Documents
- Datasets
- Assistant Settings
- Quality
- Developers

The header also exposes:

- workspace selection
- create workspace
- **Trust Checks**

There is no membership-role or capability input to `Header`.

`App.tsx` accepts direct `?tab=` selection for every tab, including `developer`.

## Identity context already available from the backend

`GET /api/auth/me` already returns:

- user identity
- selected account/session context
- membership account ID
- membership role
- membership status

Current roles include:

- OWNER
- ADMIN
- MEMBER

The frontend shell does not consume this endpoint and therefore cannot tailor navigation or admin affordances to the authenticated membership.

This is a UX/capability-disclosure gap, not an authorization bypass: protected backend routes still enforce their own role checks.

## Privileged surfaces currently exposed in the common shell

### Developer Platform

The `Developers` tab is visible to every browser user.

`DeveloperPlatform.tsx` calls:

- `/api/platform-management/keys`
- `/api/platform-management/usage`
- key creation
- key revocation

The entire `/api/platform-management` router requires:

`OWNER | ADMIN`

Therefore MEMBER users are invited into a top-level surface whose key-management operations are guaranteed to reject them.

The stable `/api/platform/v1` API itself remains API-key scoped and is correctly separate from human key administration.

### Automation

The Automation workspace contains both ordinary operational visibility and privileged policy/control behavior.

Backend behavior is already capability-aware:

- automation context returns actor role/capabilities
- policy changes require OWNER/ADMIN
- emergency/control operations have role-specific capability checks
- approval/execution capabilities differ by actor role

The navigation itself does not communicate these distinctions.

J2 should preserve the Automation product surface while making privileged controls capability-aware rather than hiding the whole feature.

### Integrations

The Integrations workspace is also mixed-purpose.

Ordinary account-scoped reads/sync visibility exist, while lifecycle administration includes OWNER/ADMIN-only operations such as:

- Google Drive OAuth start/callback
- OneDrive OAuth start/callback
- disconnect
- reset cursor
- pause/resume
- revoke

The common shell currently shows one Integrations surface without membership context.

J2+ should distinguish connection consumption/visibility from connection administration.

## Trust Checks are production engineering tooling

The header exposes a prominent **Trust Checks** button.

It invokes:

`POST /api/kb/run-tests`

and renders the internal regression suite in `TestSuiteModal`.

This is valuable engineering/acceptance tooling but is not a normal end-user product workflow.

The route currently requires account identity but is not OWNER/ADMIN-only.

Recommended disposition:

- remove it from normal-user primary navigation
- retain it as developer/operator diagnostics if still useful
- decide separately whether its server route should gain a privileged boundary or be removed from browser production UI entirely

Do not remove the executable CI trust gates; this finding concerns the browser-facing test runner only.

## Organization/member administration gap

The backend has membership roles and role-aware authorization, but the current React component inventory contains no dedicated:

- organization settings
- member list
- invite/member lifecycle
- role-management
- current-user/account switcher surface

This leaves OWNER/ADMIN authorization real but not administrable from the product UI.

J1 does not add membership endpoints or invent workflows. It records this as a product-admin gap for a later slice.

## Source-authority UX

The Company Knowledge workspace does a good job of **displaying** provenance:

- evidence source
- source version
- authority level
- conflicts
- deterministic source diffs
- current vs historical observations

However, there is no separate source-authority administration surface in the current frontend.

Users can inspect authority outcomes, but there is no obvious production admin workflow for:

- reviewing authority policy
- explaining why one source outranks another
- managing source-level authority configuration if/when configurable policy is introduced

Recommended J slice:

- first expose an authority explanation/inspection model
- only add mutable source-authority administration if a supported backend policy contract exists
- do not invent client-side authority controls

## Authentication/onboarding gap

The backend supports:

- initial OWNER bootstrap
- login
- `GET /api/auth/me`
- logout
- secure session cookies
- CSRF
- shared login throttling

The primary React shell has no corresponding authentication/onboarding component in the current component inventory.

`App.tsx` starts by calling product APIs and falls back to a generic global error banner.

As a result, these materially different production states can collapse into generic failure text:

- no session / 401
- permission denied / 403
- throttled / 429
- dependency/readiness problem / 503
- storage misconfiguration
- ordinary server failure

Recommended J slice:

- introduce a small session bootstrap state machine
- render login/session-required separately from product failure
- retain server error codes rather than flattening everything into one message
- add explicit permission-denied and degraded-dependency states

## Operator/readiness diagnostics

Production now has hardened operational boundaries including:

- `/api/health`
- `/api/ready`
- worker readiness
- provider/query/database/queue metrics
- backup/recovery evidence
- release/build/image gates

The current main browser shell does not present a supported operator diagnostics surface.

At the same time, stale historical components remain in the source tree:

- `Phase7ReadinessView.tsx`
- `Phase8OperationalDashboard.tsx`
- `Phase9SaaSPlatformView.tsx`

They are not mounted by the current `App.tsx`.

These should not be casually re-enabled. Their presence is cleanup debt and can confuse future implementation work.

Recommended disposition:

- define one supported operator/admin diagnostics surface from current G/H contracts
- remove or archive obsolete phase-numbered UI after confirming nothing imports it

## Stale implementation wording

Production-facing code still contains internal phase language, including examples such as:

- “Memory Retrieval Governance (Phase 4)”

Historical phase naming is useful in engineering docs and tests, but should not leak into normal product copy.

Track J should replace phase-numbered product language with capability language.

## Navigation structure problem

The current top bar has twelve product/developer tabs in one horizontally scrolling row.

This mixes three different information architectures:

### Core work

- Ask
- Insights
- Company Knowledge
- Documents
- Datasets

### Operations

- Actions
- Automation
- Watch
- Integrations

### Workspace/quality configuration

- Assistant Settings
- Quality

### Developer/admin

- Developers
- Trust Checks
- future organization/member administration
- future operator diagnostics

Recommended direction:

- preserve all core flows
- group rather than redesign
- make admin/developer groups role/capability aware
- keep normal user navigation focused on day-to-day knowledge/operations work

## Security interpretation

No J1 finding establishes a backend authorization bypass.

The hardened routers continue to enforce:

- HUMAN_SESSION requirements where required
- OWNER/ADMIN privileged roles
- API-key scopes
- account isolation

The problem is that the frontend does not reflect those contracts, creating confusing dead-end controls and overexposing engineering/admin concepts.

## Recommended implementation slices

### J2 — Session + Role-Aware Application Shell

Smallest high-value slice:

1. load `/api/auth/me` before product shell initialization
2. retain user + membership role/capabilities in frontend state
3. add session-required/login/permission/degraded states
4. make `Header` role/capability aware
5. prevent direct `?tab=developer` selection when the membership cannot administer platform keys
6. remove Trust Checks from normal-user header
7. preserve backend authorization as the final enforcement layer

Do not redesign workspace contents in J2.

### J3 — Admin/Developer Surface Separation

1. move Platform API key management into an explicit admin/developer area
2. preserve stable API explorer/documentation
3. split privileged Integration lifecycle controls from ordinary connection status/history
4. make Automation controls reflect `/api/automation/context` capabilities
5. keep ordinary operational visibility available where server policy allows it

### J4 — Organization/Member Administration

Only after auditing/defining supported server contracts:

- member list
- invite/join lifecycle
- role changes
- membership status
- account selection

Do not build a UI on top of nonexistent backend mutation contracts.

### J5 — Production Recovery/Diagnostics UX

- structured 401/403/429/503 states
- provider/storage degraded-state explanation
- operator readiness diagnostics
- safe recovery links/actions
- no secrets or low-level infrastructure detail exposed to ordinary members

### J6 — Copy + Dead Surface Cleanup

- remove phase-numbered product copy
- remove/archive orphan Phase7/8/9 components
- clean old prototype wording
- preserve engineering phase language in docs/tests only

## J1 exit criteria

J1 is complete when:

- browser navigation and privileged surfaces are inventoried
- server role boundaries are mapped to those surfaces
- auth/onboarding/admin/diagnostics gaps are explicit
- stale/orphan frontend surfaces are recorded
- J2+ slices are ordered
- an executable drift proof protects these findings until implementation begins

No production UI behavior is intentionally changed in J1.


## Validation

Authoritative integrated Quality Gate:

`36231584786`

Verified green:

- TypeScript
- production build
- Phase 0–8 product regression suite
- PostgreSQL production proofs through I3
- J1 UX/Admin forensic drift proof
- immutable production image smoke
- dependency vulnerability gate
- CycloneDX SBOM verification
- production image vulnerability scan
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini benchmark

## Next phase

**J2 — Session + Role-Aware Application Shell**

J2 should implement only the smallest high-value shell cutover identified by this audit:

1. bootstrap the browser shell from `GET /api/auth/me`
2. represent loading/authenticated/session-required/permission/degraded states explicitly
3. make Header navigation membership-role aware
4. remove normal-user exposure of Trust Checks
5. prevent unauthorized direct Developer tab selection
6. preserve all backend authorization as the final enforcement layer
7. avoid redesigning the actual Ask/Knowledge/Actions/Watch/Integration workspaces
