# Knowledge AI — Phase 4 Progress

Last updated: **2026-09-18**

Phase 4 adds safe natural-language actions on top of the living company knowledge layer.

## Goal

> Turn a user instruction into a validated, reviewable company-state change without allowing the LLM to write business truth directly.

## Non-negotiable write path

```text
natural language
      ↓
intent parsing
      ↓
entity/state resolution
      ↓
deterministic validation + calculations
      ↓
PROPOSED CHANGE
      ↓
explicit user confirmation
      ↓
precondition re-check
      ↓
authoritative company-state write
      ↓
audit/business event
      ↓
discovery + knowledge refresh
```

The LLM may help interpret language. It is not the transaction engine.

## Execution slices

```text
4A Proposal / approval / execution foundation          IN PROGRESS
4B Payment + inventory action contracts                NOT STARTED
4C Hybrid language parsing + ambiguity handling        NOT STARTED
4D Safe execution + audit + downstream re-analysis     NOT STARTED
4E Actions UI / Ask integration + final audit          NOT STARTED
```

## Phase 4A — Proposal foundation

Add account-scoped durable records for:

- ActionProposal
- ProposedMutation
- ActionExecution
- ActionAuditEntry

Required proposal states:

- PROPOSED
- NEEDS_INPUT
- CONFIRMED
- CANCELLED
- STALE
- FAILED

Every material write must preserve:

- original user instruction
- parsed intent
- target entities
- before values
- proposed after values
- deterministic calculations
- source/effective-state evidence
- parser source (deterministic or LLM-assisted)
- creation/confirmation time
- actor/account scope
- idempotent execution reference

## Phase 4B — Initial business actions

Start with bounded actions where the effects can be validated deterministically.

### Record payment

Example:

> Suman paid another NPR 10,000 today.

The system should:

- resolve customer/order conservatively
- read effective current balance
- optionally derive/read amount paid
- reject payment <= 0
- reject payment above remaining balance unless overpayment is explicitly supported later
- preview the exact before/after values
- require confirmation
- write USER_CONFIRMED state
- record PAYMENT_RECEIVED event

### Receive inventory

Example:

> Received 20 oak boards today.

The system should:

- resolve one product
- read effective current stock
- add a positive quantity deterministically
- preview stock before/after
- require confirmation
- write USER_CONFIRMED current stock
- record INVENTORY_RECEIVED event

## Phase 4C — Hybrid natural-language parsing

Use deterministic parsing for common safe forms first.

An LLM may be used as a language parser fallback, but its output must:

- be strict JSON
- conform to a bounded action schema
- never choose final business values that deterministic code can calculate
- never execute directly
- pass entity resolution and validation
- fall back safely when provider access is unavailable

Ambiguous targets must produce NEEDS_INPUT rather than guessing.

## Phase 4D — Execution safety

Before confirmation executes:

- re-read effective current state
- compare proposal preconditions
- mark stale if relevant state changed
- execute each mutation exactly once
- use USER_CONFIRMED authority
- preserve source observations instead of deleting them
- write an action audit trail
- emit business events
- run downstream discovery when an affected source/workspace is known
- ensure repeated confirmation is idempotent

## Phase 4E — Product surface

The user should be able to type a natural update from the main experience and receive a clear change preview.

Example:

```text
Suman paid another NPR 10,000 today.

Proposed change
Order O-104

Balance due
42,000 → 32,000

Amount paid
30,000 → 40,000

[Confirm change] [Cancel]
```

The UI must clearly distinguish:

- proposed vs executed
- calculated vs user-provided values
- target entity
- evidence/current state
- confirmation requirement
- stale/ambiguous/error states
- resulting audit event

No hidden auto-write behavior.
