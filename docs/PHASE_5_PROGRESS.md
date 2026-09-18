# Knowledge AI — Phase 5 Progress

Last updated: **2026-09-18**

## Status

# ✅ PHASE 5 COMPLETE

Phase 5 adds the WATCH capability to Knowledge AI: durable monitoring rules, deterministic recurring evaluation, restart-safe jobs, stateful alert episodes, smart reminders, and a first-class Watch workspace.

## Execution slices

```text
5A WatchRule / WatchEvaluation / WatchAlert foundation   COMPLETE
5B Deterministic rule evaluator                         COMPLETE
5C Natural-language watch creation                      COMPLETE
5D Durable/retryable evaluation worker                  COMPLETE
5E Alert lifecycle + deduplication                      COMPLETE
5F Watch UI + smart reminders + final gate              COMPLETE
```

## Authoritative final gate

- **Quality Gate:** `35376209226`
- **Result:** PASS
- **Date:** 2026-09-18

The integrated run passed all Phase 0–5 regression gates, TypeScript, production build, unseen-corpus effectiveness evaluation, and the live Gemini unseen-corpus benchmark.

## 5A / 5B — persisted Watch foundation

Verified in Quality Gate `35372866426` and the final integrated gate:

- account-scoped `WatchRule`, `WatchEvaluation`, and `WatchAlert`
- ACTIVE / PAUSED / INVALID / ARCHIVED rule lifecycle
- OPEN / ACKNOWLEDGED / SNOOZED / RESOLVED alert lifecycle
- deterministic `ENTITY_NUMERIC_THRESHOLD`
- deterministic `DATASET_AGGREGATE_THRESHOLD`
- effective USER_CONFIRMED company state is honored
- source/version/hash and confirmed-state overlay provenance
- original imported datasets remain immutable
- TRUE conditions create one alert episode rather than alert spam
- TRUE → FALSE resolves the condition episode
- a later FALSE → TRUE creates a new episode
- account isolation over Watch APIs

## 5C — natural-language Watch creation

Verified in Quality Gate `35373492302` and the final gate:

```text
natural language
      ↓
bounded parser
      ↓
source/entity resolution
      ↓
WatchDraft preview
      ↓
ambiguity selection if needed
      ↓
explicit Save
      ↓
ACTIVE WatchRule
```

Key guarantees:

- parsing never directly activates monitoring
- common stock, order-balance, and outstanding-total requests parse deterministically
- unusual supported wording may use the provider only as a bounded JSON parser
- the LLM cannot calculate current values
- the LLM cannot resolve the final entity/source
- the LLM cannot create or execute a rule
- ambiguity produces candidates instead of a guess
- cancelled drafts cannot be saved
- only explicit Save creates an ACTIVE WatchRule

## 5D — durable/retryable evaluation worker

Verified in Quality Gate `35374127375` and the final gate:

- durable persisted `WatchJob`
- idempotent schedule-slot fingerprinting
- due interval rules create one job per rule/version/slot
- successful jobs link to WatchEvaluation IDs
- RUNNING jobs survive persistence/reload
- lease-expired RUNNING jobs recover after simulated restart
- attempt count survives recovery
- unexpected worker failures retry with persisted backoff metadata
- max-attempt failure remains observable
- completed schedule slots do not rerun
- job history is account scoped
- scheduler starts with the application

## 5E — alert lifecycle

Verified in Quality Gate `35374232503` and the final gate:

- acknowledgement
- manual resolution
- condition-cleared resolution
- snooze
- snooze expiry
- occurrence tracking
- same-episode reopening after snooze expiry
- manual resolution suppresses repeat noise while the condition remains continuously TRUE
- real FALSE state resets the condition
- later FALSE → TRUE creates a fresh alert episode

## 5F — smart reminders

Verified in Quality Gate `35375746521` and the final gate.

Supported bounded reminder conditions:

### Source-relative reminder

Example:

> Remind me 3 days before order O-200 is due.

This becomes:

```text
ENTITY_DATE_WINDOW
entity = O-200
predicate = DUE_DATE
daysBefore = 3
```

The recurring evaluator reads the current effective DUE_DATE claim each time.

If a higher-authority confirmed update moves the due date, the reminder follows the new date without rewriting the imported source.

### Explicit-time reminder

Example:

> Remind me at 2099-02-03T10:15:00+05:45.

This becomes a `TIME_REACHED` rule.

Safety behavior:

- only explicit ISO-8601 timestamps with Z or numeric offset are accepted deterministically
- LLM-assisted parsing cannot invent a timestamp not present in the user request
- vague clock language is refused instead of guessed
- the one-shot rule automatically stops scheduling after it triggers once

## 5F — first-class Watch workspace

The app now exposes **Watch** in primary navigation.

The real API-backed workspace supports:

- natural-language watch input
- preview before activation
- candidate/source selection when ambiguous
- explicit Save / Cancel
- active rule list
- current condition state
- last evaluation
- next scheduled check
- last trigger
- rule version
- Evaluate now
- Pause
- Resume
- Archive
- triggered alerts
- alert evidence
- Acknowledge
- Snooze
- Resolve
- evaluation history
- durable worker/job history
- alert episode history

The UI does not implement browser-local scheduling or a hidden direct-trigger path.

## False-alert evaluation

The final Quality Gate includes a labeled Watch quality suite with **8 known cases** across:

- entity thresholds
- dataset aggregate thresholds
- source-relative date windows
- explicit clock reminders

Results:

```text
cases             8
true positive     4
true negative     4
false positive    0
false negative    0
false-alert rate  0
missed-alert rate 0
```

This is a regression corpus for the currently supported deterministic conditions, not a claim that arbitrary future Watch rules have zero real-world false positives.

## Phase 5 exit gate

| Requirement | Result |
|---|---|
| Watch conditions persist | PASS |
| Conditions evaluate reliably over time | PASS |
| Simple recurring rules avoid repeated LLM calls | PASS |
| Alerts link to evidence/state | PASS |
| Duplicate alert episodes are controlled | PASS |
| Acknowledge / resolve / snooze work | PASS |
| Jobs recover from normal restart/retry scenarios | PASS |
| Account isolation has executable coverage | PASS |
| Watch UI is backed by persisted APIs | PASS |
| False-alert behavior has a labeled regression evaluation | PASS |

## Known limitations carried forward

Phase 5 is complete, but the product is not yet production infrastructure.

- Watch state/jobs are still persisted in ignored local JSON files.
- The scheduler is in-process; persisted jobs recover after restart, but this is not yet a distributed queue/worker system.
- Multi-replica locking is not implemented.
- Alerts are in-app only; email/push/Slack delivery belongs to Integrations.
- Source-relative reminder parsing is currently bounded to ORDER/INVOICE `DUE_DATE`.
- Explicit clock reminders require an ISO-8601 timestamp with an explicit timezone offset or Z.
- STATE_CHANGE and INSIGHT_MATCH are not yet general Watch condition types.
- Calendar/email/external source refresh is not yet connected.
- External source revocation and sync cursors belong to Phase 6.

## Next phase

**Phase 6 — Integrations**

Continue from:

`docs/PHASE_6_PROGRESS.md`
