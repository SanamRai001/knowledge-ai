# Knowledge AI — Phase 7 Progress

Last updated: **2026-09-19**

## Status

# 🚧 PHASE 7 IN PROGRESS

Phase 7 introduces controlled automation over the already-audited Phase 4 action system.

This phase does **not** give an LLM unrestricted authority to mutate company state.

## Goal

> Allow trusted low-risk actions to execute automatically only when explicit deterministic workspace policy permits it.

## Execution slices

```text
7A Automation policy foundation                         COMPLETE
7B Approval / role / risk / amount enforcement          COMPLETE
7C First bounded low-risk auto-execution path           IN PROGRESS
7D Recovery / compensating actions / kill switch        NOT STARTED
7E Automation analytics + UI + final audit              NOT STARTED
```

## Non-negotiable safety architecture

```text
natural-language instruction
        ↓
existing Phase 4 action planner
        ↓
deterministic action validation
        ↓
AutomationPolicyEvaluator
        ↓
DENY
  or
REQUIRE_APPROVAL
  or
ALLOW_AUTO_EXECUTE
        ↓
existing audited execution path
        ↓
BusinessEvent + AuditLog
```

The LLM may help interpret intent.

It must never choose its own automation permission.

## Policy modes

Initial authoritative modes:

- `SUGGEST_ONLY`
- `REQUIRE_APPROVAL`
- `AUTO_EXECUTE_LOW_RISK`

Default:

`SUGGEST_ONLY`

## Phase 7A — policy foundation

### Required durable concepts

Introduce account-scoped records such as:

- `AutomationPolicy`
- policy version
- policy mode
- allowed action types
- allowed roles / actors where applicable
- maximum risk class
- amount/value thresholds where applicable
- allowed target/source constraints
- createdBy / updatedBy
- active/disabled state
- audit/version history

### Deterministic decision result

The evaluator should return a structured decision such as:

```text
ALLOW_AUTO_EXECUTE
REQUIRE_APPROVAL
DENY
```

with deterministic reason codes.

### Required invariants

- prompt text cannot override policy
- LLM output cannot raise its own risk allowance
- unsupported actions cannot auto-execute
- high-risk actions cannot auto-execute
- missing policy defaults conservatively
- disabled automation denies automatic execution
- foreign accounts cannot inspect/change policy
- policy changes are auditable/versioned
- ordinary action validation still runs after policy approval

## Phase 7B — enforcement

Add:

- actor/role controls
- action-type allowlists
- risk thresholds
- amount/value thresholds
- target-system constraints
- explicit approval escalation

Policy evaluation stays outside the language model.

## Phase 7C — first low-risk automation

Do not enable all action types.

Choose one existing Phase 4 action with:

- deterministic validation
- strong idempotency
- clear rollback/compensation story
- low financial/operational risk

Execute only through the existing Phase 4 write/audit path.

## Phase 7D — recovery and kill switch

Required:

- workspace-wide automation disable switch
- immediate effect
- action failure state
- retry boundary
- compensating action where meaningful
- clear operator recovery path

## Phase 7E — quality and product surface

Track at minimum:

- automatic execution count
- success rate
- failure rate
- approval escalation rate
- policy denials
- human overrides/corrections
- rollback/compensation
- time saved estimate where defensible

UI must clearly distinguish:

- suggested
- approval required
- automatically executed
- blocked by policy

## Phase 7 exit gate

Phase 7 is complete only when:

- auto-execution is governed by explicit deterministic policy
- policy defaults conservative
- high-risk/unsupported actions cannot bypass approval by prompt
- automatic actions use the existing audited action execution path
- every automatic action is attributable and auditable
- failures have defined recovery
- workspace automation can be disabled immediately
- policy/account isolation is executable
- automation quality has measurable regression coverage

## Current exact next work

**Phase 7A — Automation policy foundation**

First audit the existing action contracts, risk classification, execution service, audit trail, and user identity/role model. Then implement the smallest authoritative AutomationPolicy store/evaluator and prove its denial/approval/allow decisions in CI before connecting it to any live auto-execution path.


## Phase 7A verification

Quality Gate `35426383338` passed the automation-policy foundation.

Verified:

- versioned account-scoped AutomationPolicy persistence
- conservative missing-policy default
- SUGGEST_ONLY / REQUIRE_APPROVAL / AUTO_EXECUTE_LOW_RISK modes
- deterministic DENY / REQUIRE_APPROVAL / ALLOW_AUTO_EXECUTE decisions
- action allowlists
- risk-class thresholds
- amount and quantity thresholds
- request-identity-source restrictions
- disabled policy deny
- prompt-injection text cannot raise automation permission
- RECORD_PAYMENT remains approval-routed
- UPDATE_STATUS remains approval-routed
- unsupported CREATE_ORDER is hard-denied
- immutable policy history
- authenticated actor attribution
- cross-account policy/evaluation isolation
- no live auto-execution path exists yet

## Current exact next work

**Phase 7B — Approval / role / target enforcement**

1. add bounded automation actor roles derived from authenticated identity metadata
2. add optional allowed-role constraints to AutomationPolicy
3. add target entity/type constraints
4. persist explicit approval-escalation requests for REQUIRE_APPROVAL decisions
5. support approve/reject lifecycle without auto-executing the action yet
6. ensure approval authority itself is role-constrained and account-scoped
7. keep policy decisions deterministic and independent of prompt wording
8. add executable 7B proof
9. only after 7B is green, connect one low-risk action in Phase 7C


## Phase 7B verification

Quality Gate `35427776401` passed approval/role/target enforcement.

Verified:

- bounded automation actor roles derived from authenticated identity metadata
- legacy API keys without role scopes resolve conservatively as SERVICE
- optional policy role allowlists
- optional approval-role allowlists
- target entity-ID allowlists
- target entity-type allowlists
- amount and quantity escalation
- durable PENDING / APPROVED / REJECTED approval requests
- approval request captures immutable policy ID/version and decision reasons
- repeated escalation is idempotent for the same proposal/policy version
- requester cannot self-approve unless their role is explicitly eligible
- cross-account approval inspection/resolution is denied
- later policy edits do not silently rewrite an existing approval request
- approval does not execute the action
- TypeScript, production build, all Phase 0–7A proofs, unseen benchmark, and live Gemini benchmark remain green

## Current exact next work

**Phase 7C — first bounded low-risk auto-execution path**

1. choose RECEIVE_INVENTORY only
2. create an AutomationExecutionService that re-evaluates policy immediately before execution
3. permit execution only for ALLOW_AUTO_EXECUTE
4. call the existing Phase 4 ActionExecutionService rather than a new write path
5. add execution-mode/policy metadata to ActionExecution and audit detail
6. preserve idempotency and stale-precondition protection
7. prove disabled/changed policy blocks execution even after an earlier allow decision
8. prove RECORD_PAYMENT / UPDATE_STATUS / CREATE_ORDER cannot use the auto path
9. prove cross-account auto execution is denied
10. add executable 7C CI proof
