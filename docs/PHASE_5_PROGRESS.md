# Knowledge AI — Phase 5 Progress

Last updated: **2026-09-18**

Phase 5 adds durable WATCH behavior: persisted monitoring rules, deterministic recurring evaluation, stateful alert episodes, and a first-class Watch product surface.

## Goal

> Monitor important company conditions over time and surface an alert when a meaningful condition becomes true without requiring the user to keep asking.

## Execution slices

```text
5A WatchRule / WatchEvaluation / WatchAlert foundation   COMPLETE
5B Deterministic rule evaluator                         COMPLETE
5C Natural-language watch creation                      COMPLETE
5D Durable/retryable evaluation worker                  IN PROGRESS
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

## Phase 5A / 5B verification

Quality Gate `35372866426` passed the integrated Watch foundation.

Verified:

- durable account-scoped WatchRule, WatchEvaluation, and WatchAlert records
- ACTIVE / PAUSED / INVALID / ARCHIVED rule lifecycle contract
- OPEN / ACKNOWLEDGED / SNOOZED / RESOLVED alert lifecycle
- deterministic ENTITY_NUMERIC_THRESHOLD evaluation
- deterministic DATASET_AGGREGATE_THRESHOLD evaluation
- effective USER_CONFIRMED company state is honored
- dataset watch evidence preserves source/version/hash provenance
- confirmed-state overlay provenance is preserved
- repeated TRUE evaluations update one alert episode rather than creating duplicates
- acknowledgement and snooze survive repeated triggers
- TRUE → FALSE resolves the active alert episode
- a later FALSE → TRUE transition creates a new alert episode
- pause prevents evaluation; resume advances rule version
- original imported datasets remain immutable
- account isolation is enforced over Watch HTTP APIs
- TypeScript, production build, all Phase 0–4 gates, unseen-corpus benchmark, and live Gemini benchmark remain green

## Phase 5C verification

Quality Gate `35373492302` passed the natural-language Watch creation slice.

Verified:

- natural language creates a persisted draft, not a live rule
- common stock/order-balance/outstanding-total requests parse deterministically
- unsupported wording can fall back only to a bounded JSON LLM parser
- the LLM cannot resolve entities/datasets, calculate current values, save rules, or execute evaluations
- ambiguous entities produce explicit candidates instead of guesses
- multiple eligible datasets produce explicit source candidates
- candidate selection is validated against the offered choices
- cancelled drafts cannot be saved
- unsupported deterministic wording writes nothing
- only explicit Save creates an ACTIVE WatchRule
- saved natural-language rules reuse the deterministic evaluator
- account isolation protects drafts and rule creation
- the full Phase 0–5 regression suite and live Gemini benchmark remained green

## Current exact next work

**Phase 5D — Durable/retryable evaluation worker**

1. define persisted WatchJob records
2. generate idempotent jobs from due interval rules
3. recover stale RUNNING jobs after restart/crash
4. process jobs with bounded retry metadata
5. connect successful jobs to WatchEvaluation IDs
6. make scheduler tick safe to run repeatedly
7. add executable restart/idempotency proof
8. then continue to Phase 5E alert lifecycle completion
