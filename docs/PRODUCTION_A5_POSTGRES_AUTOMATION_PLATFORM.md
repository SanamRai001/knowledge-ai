# Knowledge AI — Production A5 PostgreSQL Automation + Platform State

Date: **2026-09-19**

## Verdict

# ✅ PRODUCTION HARDENING A5 COMPLETE

A5 relationalizes the remaining Phase 7 automation governance/runtime state and the Phase 8 platform installation/audit state.

Authoritative integrated workflow:

- **Workflow:** `35458936655`
- **Quality Gate:** PASS
- **PostgreSQL A2→A5 chain:** PASS

## Migration

`server/persistence/migrations/004_automation_platform.sql`

Tables:

- `automation_policies`
- `automation_policy_revisions`
- `automation_approvals`
- `automation_controls`
- `automation_control_revisions`
- `automation_runs`
- `platform_domain_pack_installations`
- `platform_tool_invocation_audit`

## Governance transaction guarantees

### Automation policy

Current policy state and its immutable versioned revision commit together.

The transaction:

1. locks the account's current policy row
2. verifies the expected previous version
3. validates policy/revision identity + version
4. updates current policy
5. appends immutable revision
6. commits atomically

Stale writers fail without changing either current state or history.

### Emergency automation control

The kill-switch state and control revision use the same optimistic transactional model.

This removes the crash window where emergency automation state could change without a matching audit revision.

## Database ownership guarantees

A5 proves:

- AutomationApproval must reference a same-account Phase 4 ActionProposal
- approval policy/version must reference an existing same-account policy revision
- AutomationRun must reference a same-account ActionProposal
- optional AutomationRun policy/version must reference the exact same-account revision
- optional execution/compensation references remain account-owned Action records
- ToolInvocationAudit must reference an API key owned by the same account

## Domain Pack state

PostgreSQL enforces at most one ACTIVE installation per account/pack through a partial unique index.

A removed installation may be followed by a new active pack version without rewriting installation history.

## Platform tool audit

Tool invocation audit keeps immutable invocation identity:

- account
- tool/version
- request
- API key
- input hash
- start time

Only terminal status/completion/error fields may change.

The database additionally enforces same-account API-key ownership.

## Legacy migration

`server/persistence/a5LegacyImporter.ts`

Supported legacy files:

- `automation-policies.json`
- `automation-approvals.json`
- `automation-runs.json`
- `automation-control.json`
- `platform_domain_packs.json`
- `platform_tool_invocations.json`

Properties:

- dry-run
- ID preservation
- account/reference validation
- idempotent repeated import
- source JSON remains unchanged
- semantic JSON comparison for omitted optional fields
- existing A3 Action proposals and A2 API keys are validated before dependent A5 rows import

The normal legacy migration command now executes:

```text
A2 → A3 → A4 → A5
```

and stops before later slices if any earlier slice reports conflicts.

## Exit evidence

Workflow `35458936655` passed:

- all Phase 0–8 product regression gates
- TypeScript
- production build
- unseen benchmark
- live Gemini benchmark
- Production A2 PostgreSQL proof
- Production A3 PostgreSQL proof
- Production A4 PostgreSQL proof
- Production A5 PostgreSQL proof

## Important boundary

A5 proves relational schemas/repositories/importers and critical transaction boundaries.

It does **not** mean every normal runtime service has already cut over from its file-backed store to PostgreSQL.

That cutover must remain explicit and tested.

## Next relational slice

**Production A6 — Discovery / Insights PostgreSQL persistence**

Discovery remains authoritative in:

`data/discovery.json`

A6 should relationalize:

- AnalysisRun
- Insight
- account/source ownership
- insight fingerprint recurrence
- status transitions
- legacy import

After the remaining relational state is modeled, a separate runtime cutover milestone should switch production mode to PostgreSQL-backed repositories deliberately instead of pretending repository existence already equals runtime durability.
