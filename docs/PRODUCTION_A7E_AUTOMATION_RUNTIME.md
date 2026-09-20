# Knowledge AI — Production A7E Automation Runtime

Date: **2026-09-20**

## Status

# ✅ COMPLETE

Authoritative integrated workflow: **`35520860881`**

Both required jobs passed:

- `quality` — full Phase 0–8 regression suite, TypeScript, production build, unseen benchmark, live Gemini benchmark
- `Production A2 PostgreSQL` — A2–A7E relational runtime proofs including the dedicated Automation cutover test

## Runtime cutover delivered

When:

```text
KNOWLEDGE_AI_PERSISTENCE_MODE=postgres
```

normal Automation runtime paths now use PostgreSQL for:

- current automation policy
- immutable policy revisions
- approval requests and resolution state
- emergency automation control state
- immutable control revisions
- AutomationRun lifecycle
- execution/recovery metadata
- compensation metadata
- human quality feedback

File mode continues to use the original Phase 7 JSON stores.

## Shared deterministic policy engine

The existing Phase 7 evaluator was refactored so the policy decision logic is shared:

```text
file stores ───────┐
                   ├─ evaluateWithState(...)
PostgreSQL state ──┘
```

The storage backend changes, but the deterministic risk, actor, target, threshold, policy-mode, and kill-switch rules do not.

## A7D Action transaction reuse

Automatic execution does not create a second write engine.

In PostgreSQL mode:

```text
Automation policy allow
        ↓
AutomationRun
        ↓
A7D actionRuntimeExecutionService.confirm(...)
        ↓
A3 confirmed-action PostgreSQL transaction
        ↓
USER_CONFIRMED company state + event + execution + audit
```

Compensation likewise creates a selected Action proposal and executes it through the same A7D relational confirmation path.

## Schema compatibility correction

A7E exposed an older schema/domain mismatch.

Phase 7 intentionally records blocked AutomationRuns with:

```text
attemptCount = 0
maxAttempts = 0
```

because policy/kill-switch/unsupported denials never attempt a write.

Migration 004 had constrained `automation_runs.max_attempts > 0`.

Migration:

`006_automation_runtime_compat.sql`

changes that invariant to:

```text
max_attempts >= 0
```

This preserves established Phase 7 semantics instead of falsifying a blocked run as having an execution attempt.

## A7E executable proof

`scripts/check-production-a7e-automation-runtime.ts`

Verified:

- policy + revision transactional PostgreSQL persistence
- REQUIRE_APPROVAL request persistence
- approval resolution by eligible role
- policy version history
- emergency kill switch persistence
- kill-switch blocked durable run
- low-risk RECEIVE_INVENTORY automatic execution
- A7D relational Action transaction reuse
- authoritative USER_CONFIRMED stock update
- idempotent automation execution replay
- AutomationRun persistence
- human feedback persistence
- audited compensation
- restored effective company state
- PostgreSQL quality metrics
- cross-account run/policy isolation
- pool/persistence reconstruction
- policy/control/approval/run restart durability
- zero mutation of:
  - `data/automation-policies.json`
  - `data/automation-approvals.json`
  - `data/automation-control.json`
  - `data/automation-runs.json`

## File-mode compatibility

The full existing Phase 7 suite remains green:

- policy
- approvals
- auto-execution
- recovery
- kill switch
- compensation
- quality analytics
- Automation UI

## Next task

**Production Hardening A7F — Platform runtime PostgreSQL cutover**

Route Phase 8 mutable Platform state through the already-existing A5 PostgreSQL repositories, starting with:

- domain-pack installations
- registered-tool invocation audit

Preserve the Phase 8 developer-platform contracts and file mode.
