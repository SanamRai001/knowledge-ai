# Production Hardening B1 — Identity & Authorization Forensic Audit

Status: **COMPLETE — audit only**

Baseline audited: `37d1e5d6b557a0c579f92ddd211bfe1d113f6d31` (`docs: advance production handoff to B1 identity audit`)

Date: 2026-09-20

This checkpoint intentionally changes no authentication or authorization runtime behavior. Its purpose is to establish the current trust boundaries, enumerate production-facing gaps, and define the smallest safe implementation sequence for Track B.

---

## 1. Executive verdict

The relational tenant boundary is materially stronger than the browser identity boundary.

PostgreSQL-backed runtime services generally scope mutable product data by `accountId`, but the browser does not currently authenticate a human user. The normal request identity resolver treats absence of an Authorization header as:

```text
accountId = acc_default
source = DEFAULT_WEB
authenticated = false
```

As a result, account scoping prevents many cross-account object-ID attacks, but it does **not** establish who the browser user is, whether that user belongs to the account, or whether the user is allowed to perform privileged operations inside that account.

There are also older standalone `server.ts` route families that bypass the modern request-identity layer entirely.

Track B must therefore add a real human session/membership boundary before Knowledge AI can be considered safe for multi-user production deployment.

---

## 2. Current identity model

### 2.1 Normal product request identity

`server/requestIdentity.ts` exposes only two identity sources:

- `API_KEY`
- `DEFAULT_WEB`

A valid Bearer API key contributes:

- `accountId`
- `apiKeyId`
- authenticated machine identity

A request with no Authorization header contributes:

- hard-coded `acc_default`
- `DEFAULT_WEB`
- `authenticated: false`

Invalid Authorization headers fail closed, which is good. Caller-supplied account IDs are not trusted by this resolver, which is also good.

The critical issue is that **missing browser credentials fail open into the legacy account rather than fail closed**.

### 2.2 Human users and sessions

No production human identity/session implementation exists.

Evidence:

- no user model/table
- no account-membership table
- no browser-session table
- no login/logout/me auth router
- no installed session/auth framework in `package.json`
- frontend requests use ordinary same-origin `fetch()` calls and do not establish a human credential
- no user ID, membership role, or session ID exists in `RequestIdentity`

### 2.3 Existing account/workspace model

Migration `001_core_metadata.sql` defines:

- `accounts`
- `workspaces`
- `account_workspace_state`
- `api_keys`
- `api_usage`

An account is already the durable tenant/organization boundary. Introducing a second parallel “organization” aggregate would create unnecessary duplication unless product requirements later distinguish the two.

A workspace belongs to exactly one account, but there is no human membership relation.

The active workspace is stored **per account**, not per human user/session:

```text
account_workspace_state(account_id -> active_workspace_id)
```

The in-process compatibility layer mirrors the same assumption with an active-workspace map keyed by account.

That model is acceptable for the current single-user/demo account, but two humans in one account would share and overwrite the same active workspace selection.

---

## 3. Browser-facing modern route inventory

The following modern route families all use `resolveRequestIdentity()` and therefore inherit the current unauthenticated `DEFAULT_WEB -> acc_default` fallback.

### Workspace

Mounted at `/api/kb`.

Includes:

- list/get active workspace
- create/update/delete/switch workspace
- Specialized AI configuration
- versions and rollback
- evaluations and test cases
- document upload/sample/remove/retry
- chat and clear chat
- test execution

Account ownership checks exist, but there is no human membership or role check.

### Datasets

Mounted at `/api/datasets`.

Includes dataset listing, detail, version access, queries, period comparisons, preview/import flows.

Dataset access is account-scoped but not human-session scoped.

### Unified query

Mounted at `/api/query`.

The query path inherits account scope from `RequestIdentity`, including the browser fallback.

### Discovery / Insights

Mounted at `/api/insights`.

Analyze, list, read, and status-update operations are account-scoped but inherit the browser fallback.

### Company Knowledge

Mounted at `/api/company-knowledge`.

Projection, temporal change, entities, relationships, claims, conflicts, events, and projection-run routes inherit the browser fallback.

### Actions

Mounted at `/api/actions`.

Proposal, target selection, confirmation, cancellation, and audit routes inherit the browser fallback.

This is security-sensitive because manual confirmation can commit `USER_CONFIRMED` company-state claims.

### Watch

Mounted at `/api/watch`.

Draft, rule, scheduler/job, alert acknowledgement/resolution/snooze operations inherit the browser fallback.

### Integrations

Mounted at `/api/integrations`.

OAuth start, connection health, disconnect, list/read, sync, cursor reset, pause, resume, and revoke operations inherit the browser fallback.

OAuth callback state itself is random, one-time, expiring, and binds the originating account in the server-side OAuth state record. The callback mechanism is not the primary B1 problem; **who is allowed to initiate/manage the connection is**.

### Automation

Mounted at `/api/automation`.

Dashboard, policy, emergency control, run, approval, execution, compensation, and quality routes inherit the same request identity.

Some automation services correctly enforce actor roles, but those roles are not human membership roles. They are synthesized from the request source and API-key scopes.

### Platform management

Mounted at `/api/platform-management`.

Developer-key list/create/revoke and usage routes use `resolveRequestIdentity()`.

API-key callers must possess the internal developer-management scope, but `DEFAULT_WEB` is allowed through without authentication or role enforcement.

This means the browser fallback can manage platform credentials for `acc_default`.

---

## 4. Machine API boundary

The stable `/api/platform/v1` platform API has the strongest current credential boundary.

`server/platform/platformApiAuth.ts`:

- requires Bearer API keys
- validates key status
- enforces operation scopes
- applies per-operation rate limits
- derives `accountId` from the key
- records API usage

This boundary should remain machine-credential-only.

Older `/api/v1/chat`, AI status/knowledge, and several `/api/v1/ai/:ai_id/*` flows also use the legacy API-key authentication helper.

Track B should not replace these machine credentials with browser sessions. It should make the distinction explicit.

---

## 5. Critical authorization findings

### B1-F1 — unauthenticated browser fallback can manage developer keys

Severity: **CRITICAL**

Two surfaces expose developer-key management without a human session:

1. `/api/platform-management/*` accepts `DEFAULT_WEB`.
2. Legacy `/api/v1/developer/*` routes bypass request identity and hard-code `acc_default`.

The legacy routes can list, create, revoke, and inspect usage for `acc_default`.

### B1-F2 — legacy key creation accepts arbitrary scopes

Severity: **CRITICAL**

`apiKeyStore.createApiKey()` persists caller-provided scopes without an allow-list.

The legacy unauthenticated developer-key creation endpoint forwards request scopes to this service.

### B1-F3 — API-key scopes can synthesize automation OWNER/ADMIN authority

Severity: **CRITICAL**

`server/automation/automationActor.ts` maps scopes such as:

- `role:owner`
- `role:admin`
- `role:approver`

to automation actor roles.

Therefore the current legacy developer-key path can mint a key with a human-like privileged automation role. That key can then satisfy role checks such as emergency automation control.

This is exactly the credential-class confusion Track B says must not survive: **machine API-key scopes must not become human/browser admin authority**.

### B1-F4 — automation policy administration has no role guard

Severity: **CRITICAL**

`PUT /api/automation/policy` validates policy input but does not require OWNER/ADMIN/APPROVER authority before persisting the policy.

A `DEFAULT_WEB` request can therefore alter:

- whether automation is enabled
- automation mode
- allowed action intents
- maximum risk
- amount/quantity limits
- allowed identity sources
- allowed actor roles
- approval roles
- target restrictions

Emergency-stop changes, approval resolution, and compensation have stronger service-level role checks. Policy administration does not.

### B1-F5 — integration management has account scoping but no management permission

Severity: **HIGH**

Any accepted normal request identity for an account can currently:

- initiate cloud OAuth
- sync
- reset cursor
- pause/resume
- disconnect/revoke connections

There is no separate integration-admin permission.

### B1-F6 — strong source authority can be produced without a real human identity

Severity: **HIGH**

Manual Action confirmation produces `USER_CONFIRMED` claims with authority rank 90.

The manual execution fallback records the actor as:

```text
user:explicit-confirmation
```

but the confirming request currently contains no authenticated `userId`.

The system therefore knows that “a user confirmed” something without knowing which user actually did it.

`SIGNED_OR_APPROVED` is not inferred automatically, which is a sound invariant. No source-authority administration route was found in the current product surface. Future authority-management APIs must be explicitly admin-protected.

### B1-F7 — normal product routers accept both browser fallback and API keys

Severity: **HIGH**

The same `RequestIdentity` is accepted across normal product routers.

That means a machine API key can call many browser/product mutation paths as the key's account, even when those routes were designed as interactive app operations.

The stable platform API already has a proper machine contract. Browser and machine credential classes should stop sharing an implicit “either is fine” boundary.

### B1-F8 — active workspace selection is account-global

Severity: **HIGH for multi-user rollout**

`account_workspace_state` stores a single active workspace per account.

With real organization membership, one user's workspace switch could change another user's active context.

The human-session design must make active workspace selection user/session scoped, or browser requests must carry an explicit workspace selection that is validated against membership.

### B1-F9 — internal normalization still falls back to `acc_default`

Severity: **MEDIUM**

`WorkspaceAccessService.normalizeAccountId()` returns `acc_default` for an empty account ID.

Once human sessions exist, internal authorization-sensitive services should fail closed when account scope is absent. Legacy defaulting should be confined to explicit development/test compatibility code.

---

## 6. Legacy and prototype route exposure

`server.ts` still contains a large standalone route surface outside the modern router identity middleware.

### Duplicate legacy workspace routes

Legacy `/api/kb/*` handlers remain below the authoritative `workspaceRouter` mount.

For matching routes, the earlier router currently handles the request first, so the old handlers are effectively shadowed. This ordering is useful compatibility protection, but duplicate unscoped handlers should not be treated as a permanent security control.

They should eventually be deleted or production-disabled.

### Unguarded developer/admin/diagnostic families

The standalone server exposes route families including:

- `/api/v1/developer/*`
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

Many are test/demo/operations/prototype surfaces rather than the modern Phase 0–8 product routers, but there is no global authentication middleware protecting them.

Of special concern, the legacy tenant-management routes accept tenant identifiers from route parameters and expose tenant key/billing/quota/audit/webhook operations without the modern account identity boundary.

Track B must either:

1. put a real privileged identity boundary in front of production-relevant routes, or
2. make prototype/internal-only families unavailable in production.

A network perimeter must not be the only assumed authorization layer unless that is explicitly designed and enforced.

---

## 7. Existing controls worth preserving

B1 is not a claim that authorization is absent everywhere. Several pieces are already sound building blocks:

- object lookup is generally account-scoped in modern repositories/services
- caller-supplied account headers/query/body values are not used by `resolveRequestIdentity()`
- invalid Bearer credentials fail closed
- stable Platform API scopes and rate limits are explicit
- OAuth state is high-entropy, expiring, one-time, and account-bound
- automation emergency control requires OWNER/ADMIN actor role
- automation approval resolution enforces eligible roles
- automation compensation requires OWNER/ADMIN/APPROVER
- automation execution policy evaluates identity source and actor role
- `SIGNED_OR_APPROVED` source authority is not inferred automatically

Track B should reuse these boundaries rather than replacing them wholesale.

---

## 8. Organization and membership decision

For Track B, use the existing `accounts` table as the organization/tenant boundary.

Do **not** add a second “organizations” table in the first identity slice.

Recommended initial human model:

```text
User
  -> AccountMembership (OWNER | ADMIN | MEMBER)
      -> Account
          -> Workspaces
```

For the first production identity slice, account membership may grant access to all workspaces in that account. Do not introduce per-workspace ACLs until a real private/restricted-workspace requirement exists.

However, active workspace selection must no longer be shared account-global state once multiple humans can use one account.

---

## 9. Smallest safe Track B implementation sequence

To keep implementation small and reviewable, split B2 rather than attempting the whole Track B in one change.

### B2A — Human identity persistence foundation — **NEXT**

Only add the durable identity substrate:

- `users`
- `account_memberships`
- `browser_sessions`
- repository/service contracts
- secure opaque session-token hashing
- membership role enum: OWNER / ADMIN / MEMBER
- session fields for selected account and selected workspace, validated against membership/account ownership
- focused PostgreSQL migration and repository tests

B2A must **not** yet rewrite every product router.

B2A exit:

- schema migrates from empty DB
- user/session secrets are never stored in plaintext
- a session can resolve exactly one user
- selected account is membership-bound
- selected workspace belongs to selected account
- logout/revocation state is representable durably
- no existing runtime behavior regresses

### B2B — Auth endpoints + human request identity

Then add the smallest browser auth flow:

- bootstrap the initial OWNER through an explicit one-time production bootstrap mechanism
- login
- logout
- `/api/auth/me`
- HttpOnly, Secure-in-production, SameSite session cookie
- session rotation on login
- same-origin protection for session-authenticated mutations
- `HUMAN_SESSION` request identity

Production requests with no valid browser session must fail closed. `DEFAULT_WEB` may survive only behind an explicit development/test compatibility switch.

### B2C — Browser route cutover

Cut the modern browser route families to human sessions:

- Workspace
- Datasets
- Query
- Insights
- Company Knowledge
- Actions
- Watch
- Integrations
- Automation
- Platform management

Machine-only `/api/platform/v1` and intended API-key `/api/v1/ai/*` paths remain API-key authenticated.

API keys must not automatically satisfy human-session-only routes.

Move active workspace selection away from account-global browser state.

### B2D — Privileged authorization + legacy quarantine

After identity is real, enforce roles/permissions and close legacy exposure:

- developer-key management: OWNER/ADMIN
- integration management: OWNER/ADMIN initially
- automation policy administration: OWNER/ADMIN
- emergency automation control: OWNER/ADMIN
- approval resolution: explicit permitted human roles
- source-authority administration: OWNER/ADMIN when introduced
- manual action confirmation records the authenticated human actor
- remove API-key `role:*` -> human admin equivalence
- restrict API-key scopes to an explicit machine-scope allow-list
- delete, gate, or production-disable unneeded legacy/prototype route families
- audit membership/role/key/integration/policy changes

---

## 10. B1 exit criteria

B1 is complete when the audit can answer all of the following without guessing:

- What authenticates a browser today? **Nothing; it falls back to DEFAULT_WEB/acc_default.**
- Where does `acc_default` still enter production paths? **RequestIdentity fallback, internal normalization, legacy developer/Phase 4 routes, and other prototype defaults.**
- Are there real users/sessions/memberships? **No.**
- What is the organization boundary? **Account.**
- What is the workspace membership assumption? **All access is account-based; no human membership exists; active workspace is account-global.**
- Are API keys cleanly separate from browser admin authority? **No; stable Platform API is clean, but general RequestIdentity and automation role scopes blur the boundary.**
- Which current privileged surfaces are insufficiently protected? **Developer-key management, automation policy administration, integration management, USER_CONFIRMED attribution, and several legacy admin/prototype families.**
- Is there a bounded next implementation slice? **Yes: B2A human identity persistence foundation.**

---

## 11. B1 close-out

**B1 forensic audit: COMPLETE.**

No authentication code was introduced in this checkpoint.

The next exact phase is intentionally small:

> **Production Hardening B2A — Human Identity Persistence Foundation**

Do B2A only. Do not simultaneously cut every browser route, redesign object storage, add workers, or broaden the product role model.
