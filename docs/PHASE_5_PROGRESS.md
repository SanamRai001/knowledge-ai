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
5D Durable/retryable evaluation worker                  COMPLETE
5E Alert lifecycle + deduplication                      COMPLETE
5F Watch UI + smart reminders + final Phase 5 audit     IN PROGRESS
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


## Phase 5D verification

Quality Gate `35374127375` passed the durable scheduler slice.

Verified:

- persisted WatchJob queue
- idempotent schedule-slot fingerprinting
- due interval rules enqueue deterministic jobs
- successful jobs link to WatchEvaluation IDs
- RUNNING jobs survive persistence/reload
- lease-expired RUNNING jobs are requeued after simulated restart
- prior attempt count is preserved
- unexpected worker failures retry with persisted next-attempt time/error metadata
- max-attempt exhaustion becomes an observable FAILED job
- a later fresh interval slot remains possible after permanent job failure
- repeated scheduler cycles do not rerun a completed schedule slot
- account-scoped job history

## Phase 5E verification

Quality Gate `35374232503` passed the alert lifecycle slice.

Verified:

- snooze persists while its window is active
- a still-true condition reopens the same alert episode after snooze expiry
- repeated triggers do not create duplicate alerts
- manual resolution is recorded as USER_RESOLVED
- manually resolved alerts remain quiet while the condition continuously stays true
- condition FALSE resets the watch state
- a later FALSE → TRUE transition creates a new alert episode
- TRUE → FALSE automatically resolves with CONDITION_CLEARED
- lifecycle history distinguishes manual vs condition-cleared resolution

## Current exact next work

**Phase 5F — Watch UI + smart reminders/date watches + final gate**

1. add a first-class Watch workspace
2. add natural-language Watch draft preview / candidate selection / explicit Save
3. show active rules, current state, last/next evaluation, alerts, evidence, and job/evaluation history
4. expose pause/resume/evaluate-now and alert acknowledge/resolve/snooze
5. add a bounded date/time reminder condition so Phase 5 covers source-relative/time-based monitoring as well as numeric conditions
6. add natural-language parsing for the bounded reminder form
7. add UI and reminder CI proofs
8. run the full integrated gate
9. create `docs/PHASE_5_FINAL_AUDIT.md`
10. advance the master handoff to Phase 6 only after all gates are green
