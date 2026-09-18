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
4A Proposal / approval / execution foundation          COMPLETE
4B Payment + inventory action contracts                COMPLETE
4C Hybrid language parsing + ambiguity handling        COMPLETE
4D Safe execution + audit + downstream re-analysis     COMPLETE
4E Actions UI / Ask integration + final audit          COMPLETE
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


## Phase 4 verification

### 4A / 4B — proposal foundation and bounded actions

Quality Gate run `35369821259` passed the initial safe-action execution proof.

Verified:

- proposal creation does not mutate company state
- payment proposals calculate exact balance/paid before-and-after values
- inventory receipt proposals calculate exact stock before-and-after values
- order-status changes remain explicit SET operations
- payment amounts <= 0 are rejected
- overpayments are rejected
- original imported observations remain preserved
- confirmed actions write higher-authority USER_CONFIRMED FACT claims
- PAYMENT_RECEIVED and INVENTORY_RECEIVED business events are recorded
- repeated confirmation is idempotent
- cancelled proposals cannot execute
- foreign accounts cannot inspect or confirm another account's actions

### 4C — hybrid parsing and ambiguity

Implemented:

- deterministic parser first for common payment, inventory, and status wording
- bounded LLM JSON parser fallback for unusual language
- LLM cannot calculate business effects
- LLM cannot choose final entity targets
- LLM cannot execute writes
- provider failure degrades safely
- ambiguous customer/order references become NEEDS_INPUT
- explicit candidate selection generates a new proposal instead of silently executing

### 4D — execution safety and downstream consistency

Quality Gate runs `35370618875`, `35370898283`, and `35371052855` verified:

- stale-state precondition checks before confirmation
- crash-safe/idempotent recovery when company state was written before execution bookkeeping completed
- confirmed company state is layered over imported evidence rather than rewriting source files
- structured analytics sees USER_CONFIRMED overlays on the current dataset version
- analytical provenance exposes overlay claim IDs and authority
- Discovery re-runs after affected confirmed actions
- Insight evidence exposes the exact confirmed-state overlay used by the detector
- detector evidence includes only overlays that actually affect its calculation
- historical dataset-version reads remain immutable and do not receive current-state overlays
- HTTP CSV/XLSX imports automatically project into living company knowledge
- newly imported structured data is immediately usable by natural-language Actions without a manual Knowledge refresh

### 4E — product surface

Quality Gate run `35370801316` passed the Actions UI contract.

The application now includes:

- Ask / Update mode in the main business workspace
- natural-language update entry
- exact proposal preview cards
- before → after values
- calculated vs user-provided value labeling
- ambiguity candidate selection
- stale proposal handling
- Confirm change
- Cancel
- explicit “Nothing is written until you confirm” messaging
- first-class Actions navigation
- persistent Actions history
- audit trail
- execution status
- confirmed-state overlay disclosure in Ask analytics
- confirmed-state overlay disclosure in Insight evidence

### Final integrated gate

Final code state Quality Gate:

- **Run:** `35371157626`
- **Result:** PASS

It passed:

- benchmark leakage guard
- provider boundary guard
- secret/runtime-state hygiene
- telemetry integrity
- TypeScript
- production build
- workspace isolation
- dataset isolation
- CSV/XLSX structured-data gates
- deterministic analytics
- analytical natural-language routing
- all Phase 1 UI/regression gates
- all Phase 2 Discovery gates
- all Phase 3 Living Knowledge gates
- Phase 4 safe actions proof
- Phase 4E Actions UI proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus benchmark
- live Gemini unseen-corpus benchmark

**Phase 4 status: COMPLETE.**
