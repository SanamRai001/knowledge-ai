# Production J4 — Organization/Member Administration

Status: **COMPLETE** — authoritative implementation Quality Gate `36252491424`.

## Goal

J4 closes the product-admin gap identified by J1 without inventing unsupported onboarding flows.

The slice adds supported organization/member administration for existing durable memberships while preserving the J2/J3 session, role, and capability boundaries.

## Server contract

Added organization administration routes under:

`/api/organization`

Supported endpoints:

- `GET /members`
- `PATCH /members/:userId/role`
- `PATCH /members/:userId/status`
- `GET /membership-audit`

Every route resolves account scope from authenticated HUMAN_SESSION identity. The frontend never supplies an arbitrary account ID for membership mutation.

## Organization visibility

OWNER, ADMIN, and MEMBER users can list members in the selected account.

The response includes:

- user ID
- email
- optional display name
- user status
- membership role
- membership status
- membership created/updated timestamps
- explicit capability flags:
  - `canManageMembers`
  - `canManageOwners`

No credentials, session secrets, API keys, OAuth secrets, or storage/internal infrastructure locators are exposed.

## Supported mutation model

J4 intentionally manages **existing memberships only**.

Supported membership roles:

- OWNER
- ADMIN
- MEMBER

Supported membership statuses:

- ACTIVE
- REVOKED

The release does **not** expose an invitation/join workflow because the backend does not yet define a durable invitation/onboarding state machine. The UI states this explicitly rather than presenting a fake or frontend-only invite action.

## Authorization and safety

Role/status mutations require OWNER or ADMIN.

Server-side repository validation enforces:

- account-scoped target lookup
- ADMIN cannot mutate OWNER memberships
- users cannot mutate their own membership
- unsafe OWNER loss is prevented
- inactive membership role mutation is rejected
- invalid roles/statuses are rejected
- cross-account target IDs resolve as not found in the selected account boundary

OWNER users can promote/demote supported non-self targets subject to owner-safety rules.

ADMIN users can manage non-OWNER members but cannot take ownership-governance actions.

MEMBER users have read-only organization visibility and no privileged mutation controls.

## Membership revocation and sessions

Membership revocation is durable.

When a selected account membership is revoked:

- that account selection is cleared from affected browser sessions
- the session itself is not destroyed when the user still has other active account memberships
- the user may select another account only when an ACTIVE membership exists there

Restoring a membership preserves the membership role rather than silently rewriting authorization.

## Account selection boundary

J4 extends the authenticated session overview with active memberships and supports account switching only through the existing membership-bound identity service.

The session cannot select an arbitrary account ID.

The PostgreSQL proof verifies:

- valid multi-account switching
- selected membership context changes with the session
- selection outside active memberships is rejected

## Membership administration audit

Added:

`account_membership_admin_audit`

Successful privileged mutations record:

- account ID
- actor user ID
- target user ID
- action type
- previous/next role
- previous/next membership status
- occurrence time

Rejected attempts are not written as successful mutation audit events.

The organization UI exposes recent audit history only to users who can manage members.

## Frontend

Added:

`src/components/OrganizationWorkspace.tsx`

The application shell now includes an Organization surface driven by current session/account/membership state.

The workspace provides:

- account/member list
- role/status badges
- role selection for allowed targets
- revoke/restore controls for allowed targets
- explicit self-management protection
- explicit OWNER protection
- read-only MEMBER state
- membership audit history for privileged users
- clear no-invite-contract notice

Account switching in the header remains tied to the authenticated membership list returned by the session API.

## J4 executable proofs

### Server/UI contract

`scripts/check-production-j4-organization-member-admin.ts`

Verifies the organization router, authorization middleware, role/status contracts, audit boundary, session overview/account selection wiring, and route mounting.

### PostgreSQL behavior

`scripts/check-production-j4-organization-member-admin-postgres.ts`

Verifies:

- strict account-scoped member listing
- OWNER/ADMIN mutation invariants
- ADMIN → OWNER protection
- self-mutation protection
- supported role promotion
- durable revocation/restoration
- selected-account clearing after revocation
- preservation of other-account sessions
- successful-mutation audit entries
- rejected mutation exclusion from the success audit
- membership-bound account switching
- arbitrary account selection rejection

### UI drift proof

`scripts/check-production-j4-organization-member-ui.ts`

Verifies:

- Organization navigation/surface exists
- MEMBER users remain read-only
- privileged controls are capability-gated
- account switching uses active session memberships
- audit visibility is privileged
- invitation UI is intentionally absent
- J2/J3 capability-aware shell boundaries remain intact

## Validation

Authoritative implementation Quality Gate:

`36252491424`

Verified green:

- TypeScript
- production build
- all Phase 0–8 regression gates
- all production-hardening proofs through J3
- J4 organization/member contract proof
- J4 PostgreSQL authorization/isolation proof
- J4 organization UI drift proof
- PostgreSQL production suite
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Next phase

**J5 — Production Recovery/Diagnostics UX**

J5 should expose the already-supported production readiness/recovery contracts in a safe browser surface:

- provider/storage degraded-state explanations
- operator readiness diagnostics
- safe recovery links/actions backed by real G/H contracts
- no secrets or low-level infrastructure detail exposed to ordinary members

J5 must not invent recovery operations that do not exist on the server.
