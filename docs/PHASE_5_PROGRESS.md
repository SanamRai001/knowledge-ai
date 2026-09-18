# Knowledge AI — Phase 5 Progress

Last updated: **2026-09-18**

Phase 5 adds durable WATCH behavior: persisted monitoring rules, deterministic recurring evaluation, stateful alert episodes, and a first-class Watch product surface.

## Goal

> Monitor important company conditions over time and surface an alert when a meaningful condition becomes true without requiring the user to keep asking.

## Execution slices

```text
5A WatchRule / WatchEvaluation / WatchAlert foundation   COMPLETE
5B Deterministic rule evaluator                         COMPLETE
5C Natural-language watch creation                      IN PROGRESS
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

## Current exact next work

**Phase 5C — Natural-language watch creation**

1. introduce a WatchDraft / proposed-rule contract
2. deterministic parser for common watch language
3. bounded LLM parser fallback for unusual wording
4. conservative source/entity resolution
5. preview the structured condition before saving
6. save only after explicit creation/confirmation
7. add Phase 5C CI proof
8. then continue to durable worker scheduling
