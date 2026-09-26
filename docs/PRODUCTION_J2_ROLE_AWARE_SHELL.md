# Production J2 — Session + Role-Aware Application Shell

Status: **COMPLETE** — authoritative implementation Quality Gate `36233824606`.

## Goal

J2 turns the browser shell into a session-aware, membership-role-aware production entrypoint without redesigning core Phase 0–8 product workflows.

The backend remains the final authorization boundary.

## Session-first bootstrap

The application now resolves:

`GET /api/auth/me`

before loading account-scoped workspace/product data.

This prevents the browser from attempting product initialization before it knows:

- authenticated user
- selected account
- membership status
- OWNER / ADMIN / MEMBER role
- session state

## Explicit shell states

Added a reusable browser shell state model for:

- bootstrapping
- authenticated
- session required
- permission denied
- rate limited
- degraded dependency
- unexpected error

HTTP semantics remain visible to the shell:

- 401 → session required
- 403 → permission denied
- 429 → rate limited, including Retry-After when present
- 503 → degraded dependency

The browser no longer collapses these materially different production states into a generic startup failure.

## Login boundary

The unauthenticated shell now provides an explicit same-origin login path through:

`POST /api/auth/login`

After login, the app repeats the normal session bootstrap rather than bypassing the authenticated initialization path.

## Membership-role-aware navigation

The shell carries the authenticated membership role into `Header`.

Roles:

- OWNER
- ADMIN
- MEMBER

Developer Platform administration is visible only when:

`OWNER || ADMIN`

This is a frontend usability boundary only. Existing server-side HUMAN_SESSION + OWNER/ADMIN authorization remains authoritative.

## Developer deep-link protection

J2 protects direct browser navigation such as:

`?tab=developer`

A MEMBER cannot mount `DeveloperPlatform` merely by manipulating the query string.

The shell computes an allowed effective tab before rendering privileged content.

## Trust Checks disposition

J2 removes Trust Checks from the normal browser shell:

- no Trust Checks header button
- no TestSuiteModal mounting from App
- no normal-shell call to `/api/kb/run-tests`

The authenticated server route remains available for controlled/internal tooling and CI.

This preserves production regression capability without presenting engineering test tooling as a normal-user product feature.

## Preserved product surfaces

J2 intentionally keeps the following normal product areas available:

- Ask
- Insights
- Company Knowledge
- Actions
- Automation
- Watch
- Integrations
- Datasets
- Documents / Knowledge
- Specialized AI configuration
- Evaluation

Automation and Integrations are not hidden wholesale because only some controls inside those workspaces are privileged.

Fine-grained control separation belongs to J3.

## Historical proof advancement

Several earlier UI/cleanup guards were advanced so they validate the current shell instead of encoding the old flat-navigation implementation.

Updated guards include:

- Phase 1 UI contract
- Insights UI
- Company Knowledge UI
- Actions UI
- Watch UI
- Integrations UI
- Automation UI
- Phase 8E Developer Platform
- B2D3B4 retired frontend cleanup
- J1 UX/Admin forensic audit

These changes do not weaken the original product contracts. They recognize `effectiveTab`, role-aware Developer access, and the J2 Trust Checks disposition.

## Focused J2 proof

Added:

`scripts/check-production-j2-role-aware-shell.ts`

The proof verifies:

- `/api/auth/me` exposes membership role context
- session bootstrap precedes account-scoped product data
- explicit session/degraded shell states
- 401 / 403 / 429 / 503 mapping
- membership-role-aware Header
- MEMBER Developer deep-link protection
- Trust Checks removed from the normal shell
- Automation and Integrations remain product surfaces
- Developer workspace itself is preserved for J3 refinement

## Validation

Authoritative implementation Quality Gate:

`36233824606`

Verified green:

- TypeScript
- production build
- H2 production image smoke
- H4 supply-chain / image scan
- Phase 0–8 regression suite
- B/C/D/E/F/G/H/I production-hardening guards
- PostgreSQL runtime proofs
- J1 historical UX/admin guard
- J2 role-aware shell proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini unseen-corpus benchmark

## Scope intentionally left for J3

J2 does not separate privileged controls *inside* mixed-purpose workspaces.

That is the next slice.

## Next phase

**J3 — Admin/Developer Surface Separation**

J3 should:

1. separate Platform API-key administration from general Developer API documentation/explorer use
2. preserve the stable API explorer/documentation surface
3. make privileged Integration lifecycle controls OWNER/ADMIN-aware while keeping ordinary connection status/history visible where policy allows
4. make Automation policy/control affordances reflect `/api/automation/context` capabilities rather than exposing dead-end controls
5. keep backend authorization authoritative
6. avoid redesigning normal Ask/Insights/Knowledge/Actions/Watch/Dataset flows
