# Production Hardening B2D2B1 — Automation Privileged Authorization + API-Key Role Separation

Status: **COMPLETE**

Authoritative implementation Quality Gate: **`35614246876`**

Date: 2026-09-21

---

## 1. Scope

B2D2B1 hardens Automation privilege semantics only.

Covered:

- HUMAN_SESSION OWNER / ADMIN authorization for Automation policy administration
- MEMBER denial
- API_KEY denial for policy administration
- removal of API-key `role:*` -> human-like Automation role mapping
- preservation of legitimate API-key Automation as SERVICE when policy explicitly allows SERVICE
- CSRF preservation for browser mutations
- Automation UI CSRF repair for its existing POST controls
- focused PostgreSQL authorization proof
- regression updates for Phase 7A and B2C3

Not covered:

- Integration management privileged authorization
- broad legacy/prototype route quarantine
- Track C object storage
- worker/queue work

---

## 2. Policy administration is now human privileged

Updated:

`server/automation/automationRouter.ts`

`PUT /api/automation/policy` now requires:

1. `applicationIdentityMiddleware`
2. `requireOwnerOrAdmin`

Allowed policy administrators:

- HUMAN_SESSION OWNER
- HUMAN_SESSION ADMIN

Denied:

- HUMAN_SESSION MEMBER
- API_KEY
- missing identity
- revoked human session

Policy reads remain account-scoped and available to authenticated machine integrations where intentionally supported.

---

## 3. API keys no longer synthesize human roles

Updated:

`server/automation/automationActor.ts`

Before B2D2B1, API-key scopes such as:

- `role:owner`
- `role:admin`
- `role:approver`
- `role:operator`

could be mapped into Automation actor roles.

That mapping is removed.

Current behavior:

- HUMAN_SESSION uses durable membership role
- API_KEY is always `SERVICE`
- DEFAULT_WEB compatibility remains `MEMBER` in explicit non-production compatibility only

Machine scopes may authorize machine capabilities elsewhere, but they do not create human membership authority.

---

## 4. Privileged Automation effects of role separation

Because Automation control, approval resolution, compensation, and execution capability checks derive from `resolveAutomationActorRole()`, an API key carrying human-looking `role:*` scopes can no longer gain:

- OWNER/ADMIN emergency-control authority
- OWNER/ADMIN/APPROVER approval authority
- OWNER/ADMIN/APPROVER compensation authority
- OWNER/ADMIN/OPERATOR human execution role

The machine actor remains `SERVICE`.

Existing deterministic policy and approval/execution safety services remain otherwise unchanged.

---

## 5. Legitimate machine Automation remains supported

B2D2B1 does not disable machine Automation.

A machine API key can still participate when an OWNER/ADMIN-authored policy explicitly permits:

- identity source `API_KEY`
- actor role `SERVICE`

The focused proof verifies a low-risk `RECEIVE_INVENTORY` evaluation remains `ALLOW_AUTO_EXECUTE` under an explicit API_KEY + SERVICE policy.

This preserves machine functionality without allowing machine credentials to impersonate human authority.

---

## 6. Browser CSRF compatibility

Updated:

`src/components/AutomationWorkspace.tsx`

The Automation UI now reads the non-HttpOnly `ka_csrf` cookie and sends `X-CSRF-Token` for existing human-session POST mutations including:

- emergency control enable/disable
- approval approve/reject
- compensation
- run feedback

This repairs the browser path under the B2C human-session same-origin + CSRF boundary.

Updated UI contract proof:

`scripts/check-phase7e-automation-ui-contract.ts`

now asserts the CSRF wiring is present.

---

## 7. Regression updates

### Phase 7A

`scripts/check-phase7a-automation-policy.ts`

The historical test no longer uses an API key to administer policy.

It now verifies:

- API-key policy PUT -> 403 `PRIVILEGED_HUMAN_SESSION_REQUIRED`
- policy evaluator fixtures are seeded directly for deterministic policy behavior tests
- machine evaluator behavior uses SERVICE
- immutable policy-history coverage remains intact

### B2C3

`scripts/check-production-b2c3-product-route-cutover.ts`

Updated expectation:

- API_KEY may read its account Automation policy
- API_KEY policy mutation -> 403 privileged-human-session required

This keeps the original B2C3 identity/account-isolation intent while matching the hardened privilege boundary.

---

## 8. Executable PostgreSQL proof

Added:

`scripts/check-production-b2d2b1-automation-privileged-auth.ts`

Package command:

`npm run check:production:b2d2b1-automation-privileged-auth`

The proof verifies:

- missing production identity cannot administer Automation policy
- OWNER without CSRF is rejected
- API_KEY policy write is rejected
- MEMBER policy write is rejected
- OWNER policy write succeeds
- ADMIN policy update succeeds
- spoofed account headers do not cross tenant boundaries
- privileged policy writes record attributable `user:<userId>` actors
- an API key containing `role:owner/admin/approver/operator` resolves to `SERVICE`
- that API key receives no privileged Automation capabilities
- that API key cannot use OWNER/ADMIN emergency control
- API-key Automation evaluation still works when policy explicitly permits API_KEY + SERVICE
- revoked privileged HUMAN_SESSION fails closed

---

## 9. Quality Gate

Workflow:

**`35614246876`**

Result:

- `quality` — ✅ success
- `Production A2 PostgreSQL` — ✅ success
- `Production B2D2B1 Automation privileged authorization proof` — ✅ success
- Phase 7A Automation policy proof — ✅ success
- Phase 7E Automation UI proof — ✅ success
- all prior B2A–B2D2A hardening proofs — ✅ success

---

## 10. Exit criteria

B2D2B1 is complete because:

- Automation policy administration is HUMAN_SESSION OWNER/ADMIN-only
- MEMBER cannot administer policy
- API keys cannot administer policy
- API-key `role:*` scopes cannot synthesize human Automation roles
- machine Automation remains supported as SERVICE when explicitly policy-allowed
- tenant isolation remains intact
- browser Automation mutations remain CSRF-compatible
- existing policy / approval / execution regression suites remain green

---

## 11. Next small phase

> **Production Hardening B2D2B2 — Integration Management Privileged Authorization**

Keep the next slice limited to Integration management authority.

B2D2B2 should:

1. classify Integration read vs management operations
2. require HUMAN_SESSION OWNER/ADMIN for privileged Integration connection administration
3. prevent API keys from acting as browser Integration administrators
4. preserve intentional machine sync/runtime paths where required
5. preserve OAuth state/account binding
6. preserve tenant isolation
7. add focused OWNER/ADMIN/MEMBER/API_KEY authorization proof
8. stop before broad legacy/prototype route quarantine

Do **not** start B2D3, Track C object storage, or workers in this slice.
