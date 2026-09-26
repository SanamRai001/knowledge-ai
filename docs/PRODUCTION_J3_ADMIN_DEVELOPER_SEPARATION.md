# Production J3 — Admin/Developer Surface Separation

Status: **COMPLETE** — authoritative implementation Quality Gate `36236249878`.

## Goal

J3 removes privilege dead ends from the authenticated product shell without hiding safe read-only product surfaces from normal members.

The backend authorization boundaries already existed. J3 makes the frontend reflect them accurately.

## Developer Platform separation

The Developer workspace remains available to authenticated members for safe platform documentation and inspection.

Preserved:

- stable Platform API v1 manifest
- published scopes
- governed tools inventory
- governed detector inventory
- governed domain-pack inventory
- bounded GET-only read explorer
- API documentation/overview

OWNER/ADMIN-only controls:

- Platform API key creation
- key revocation
- API usage administration

The workspace now receives the authenticated membership role and derives:

`canManageDeveloperPlatform(role)`

MEMBER users do not receive key-management or usage-administration tabs.

The server boundary remains authoritative:

`/api/platform-management/*`

continues to require OWNER/ADMIN human authorization.

## Integration lifecycle separation

The Integration workspace now receives:

`canManageLifecycle`

derived from the authenticated membership role.

Ordinary members retain supported read/operational visibility:

- connection status
- synchronized source/import history
- sync run history
- worker sync job status
- supported `Sync now` operation

Privileged lifecycle controls are only rendered for OWNER/ADMIN members:

- connect provider
- reauthorize
- reset cursor
- pause/resume
- revoke/disconnect

Server-side OWNER/ADMIN enforcement on privileged lifecycle routes is unchanged.

J3 therefore removes the previous UX pattern where ordinary members discovered authorization only after clicking a control that could never succeed.

## Automation capability awareness

Added capability data to:

`GET /api/automation/context`

The Automation workspace now consumes the authenticated backend capability contract rather than inferring dangerous-control permissions from UI assumptions.

Capability-aware controls include:

- policy management
- emergency stop
- approval resolution
- compensation
- automation execution
- feedback recording

Ordinary run/history visibility remains available where the backend permits it.

OWNER/ADMIN policy-write authorization remains server-enforced.

## J2 shell preservation

J3 preserves the J2 session-first application shell:

- `GET /api/auth/me` bootstrap
- membership role in frontend state
- explicit 401 session-required state
- explicit 403 permission state
- explicit 429 rate-limit state
- explicit 503 degraded state
- CSRF-aware privileged browser mutations

J3 does not weaken any backend identity or authorization boundary.

## Scope boundary

J3 does **not** redesign:

- Ask
- Insights
- Company Knowledge
- Actions
- Watch
- Datasets
- Documents
- core Integration synchronization
- core Automation execution

J3 also does not introduce organization/member administration.

## Executable proof

Added:

`scripts/check-production-j3-admin-developer-separation.ts`

It verifies:

- Developer docs remain member-accessible
- key/usage administration is OWNER/ADMIN-only
- stable Platform manifest/extensions/read explorer remain present
- Platform Management server routes remain OWNER/ADMIN-protected
- Integration lifecycle capability is passed through the shell
- ordinary Integration sync/status/history remains available
- privileged Integration controls are gated
- privileged Integration server routes retain OWNER/ADMIN enforcement
- Automation consumes backend capabilities
- policy/emergency/approval/compensation controls follow those capabilities
- Automation policy writes remain OWNER/ADMIN-protected
- J2 session/error boundaries remain intact

Historical UI proofs for Phase 6E, Phase 7E, Phase 8E, J1, and J2 were advanced narrowly to the J3 surface contract.

## Validation

Authoritative implementation Quality Gate:

`36236249878`

Verified green:

- TypeScript
- production build
- Phase 0–8 regression gates
- all production-hardening historical guards
- J1/J2 compatibility
- focused J3 privilege-surface drift proof
- PostgreSQL production lane
- unseen-corpus benchmark
- live Gemini benchmark

## Next phase

**J4 — Organization/Member Administration**

J4 must first audit and define the supported server-side organization/member contracts.

Only then should the frontend add supported workflows for:

- member list
- invite/join lifecycle
- role changes
- membership status
- account selection

Do not invent UI mutations on top of nonexistent backend contracts.
