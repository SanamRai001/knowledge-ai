# Knowledge AI — Phase 5 Progress

Last updated: **2026-09-18**

Phase 5 adds durable WATCH behavior: persisted monitoring rules, deterministic recurring evaluation, stateful alert episodes, and a first-class Watch product surface.

## Goal

> Monitor important company conditions over time and surface an alert when a meaningful condition becomes true without requiring the user to keep asking.

## Execution slices

```text
5A WatchRule / WatchEvaluation / WatchAlert foundation   IN PROGRESS
5B Deterministic rule evaluator                         IN PROGRESS
5C Natural-language watch creation                      NOT STARTED
5D Durable/retryable evaluation worker                  NOT STARTED
5E Alert lifecycle + deduplication                      NOT STARTED
5F Watch UI + final Phase 5 audit                       NOT STARTED
```

## Phase 5A — Watch foundation

Introduce durable, account-scoped records for:

- WatchRule
- WatchEvaluation
- WatchAlert

Initial WatchRule lifecycle:

- ACTIVE
- PAUSED
- INVALID
- ARCHIVED

Initial alert lifecycle:

- OPEN
- ACKNOWLEDGED
- SNOOZED
- RESOLVED

Every WatchRule must preserve:

- structured condition
- target/source scope
- enabled/lifecycle status
- evaluation trigger/cadence metadata
- current condition state
- last evaluation time
- last trigger time
- rule version
- creator/origin
- created/updated timestamps

Every evaluation must preserve:

- rule version evaluated
- deterministic result
- measured value(s)
- exact evidence/provenance
- evaluation time
- error state where applicable

Every alert must preserve:

- watch rule
- alert episode identity
- evidence that triggered it
- first/last triggered times
- occurrence count
- acknowledgement/resolution/snooze state

## Phase 5B — First deterministic evaluator

Initial supported condition families should be narrow and reliable:

1. **ENTITY_NUMERIC_THRESHOLD**
   - e.g. CURRENT_STOCK <= 5
   - e.g. BALANCE_DUE > 50000

2. **DATASET_AGGREGATE_THRESHOLD**
   - e.g. SUM(balance_due) > 500000
   - evaluated from the current effective dataset view so USER_CONFIRMED overlays are respected

3. Later in Phase 5:
   - DEADLINE_WINDOW
   - STATE_CHANGE
   - INSIGHT_MATCH

Recurring evaluation must not require an LLM for these simple conditions.

## Alert episode rule

Do not emit a new alert on every evaluation while a condition remains true.

```text
FALSE
  ↓
TRUE
  ↓
create OPEN alert episode
  ↓
TRUE again
  ↓
update same alert / occurrence count
  ↓
FALSE
  ↓
resolve condition episode
  ↓
TRUE later
  ↓
new alert episode
```

## Current exact next work

1. define WatchRule / WatchEvaluation / WatchAlert contracts
2. add account-scoped persistence
3. implement ENTITY_NUMERIC_THRESHOLD
4. implement DATASET_AGGREGATE_THRESHOLD using effective current company state
5. add alert episode deduplication
6. add executable Phase 5A/5B CI proof
7. then move to natural-language watch creation
