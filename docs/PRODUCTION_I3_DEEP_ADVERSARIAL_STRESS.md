# Production I3 — Deep Adversarial, Race/Idempotency & Sustained Worker Stress

Status: **COMPLETE** — authoritative implementation Quality Gate `36228011034`.

## Scope

I3 closes the remaining Track I stress matrix with bounded, measured CI proofs.

It intentionally does **not** claim broad production capacity.

I3 covers:

- adversarial prompt/evidence boundary attacks
- source-authority preservation under hostile content
- cross-tenant retrieval isolation
- high-contention D1 Action confirmation races
- high-contention D2 Automation execution races
- high-contention D3 Watch completion races
- sustained Watch worker pressure
- sustained Integration worker pressure
- sustained Automation worker pressure
- explicit queue/retry/dead-letter/lease-loss thresholds

## I3A — Adversarial evidence boundary

Added:

- `server/security/evidencePromptBoundary.ts`
- `scripts/check-production-i3a-adversarial-evidence.ts`

The evidence boundary treats retrieved document/Dataset content as untrusted data rather than model instructions.

Verified adversarial cases include:

- instruction text embedded inside retrieved document evidence
- role-like metadata and fake `SYSTEM` / `ASSISTANT` directives
- attempts to forge evidence delimiters
- attempts to inject policy-bypass instructions through evidence metadata
- lower-authority/untrusted evidence competing with stronger source-authority evidence
- mixed-source evidence provenance preservation
- direct prompt attempts to bypass evidence-grounding rules
- account isolation when knowledge-base IDs collide across tenants

The proof verifies that hostile evidence cannot silently become instruction authority and that tenant-scoped retrieval remains isolated.

## I3B — Transaction race/idempotency stress

Added:

`scripts/check-production-i3b-transaction-race-stress-postgres.ts`

Measured contention:

- D1 Action confirmation contenders: **16**
- D2 Automation execution contenders: **12**
- D3 Watch completion contenders: **16**
- allowed unexpected errors: **0**

The proof executes the real PostgreSQL transaction boundaries under concurrent callers and verifies exactly-once resulting state.

### D1

High-contention Action confirmation must produce one committed Action execution and one set of confirmed company-state mutations/events.

### D2

Concurrent Automation execution must preserve one authorized automation result and one effective business-state mutation.

### D3

Concurrent Watch completion must produce:

- one completed Watch job
- one evaluation
- one alert occurrence

No duplicate business effect is accepted.

## I3C — Sustained worker pressure

Added:

`scripts/check-production-i3c-sustained-worker-pressure-postgres.ts`

Measured bounded workload:

### Watch

- due Watch jobs: **24**
- concurrent Watch workers: **2**
- maximum jobs per worker cycle: **6**

### Generic worker queue

- Integration jobs: **16**
- Automation jobs: **16**
- concurrent generic workers: **2**
- maximum jobs per worker cycle: **4**

### Allowed outcomes

- unexpected errors: **0**
- retries: **0**
- dead letters: **0**
- lease losses: **0**
- maximum bounded pressure duration: **180,000 ms**

The test deliberately verifies a partially drained intermediate backlog before full completion; it is not merely an empty-queue smoke test.

## Integration correctness under pressure

The Integration worker pressure proof verifies one completed C6 checkpoint per connection:

- cursor reaches the expected value
- sync run completes
- external import is READY
- immutable sourceVersionId exists

This preserves checkpoint/source-snapshot correctness while multiple workers drain the queue.

## Automation correctness under pressure

The Automation pressure proof verifies, for every queued proposal:

- one successful Automation run
- one Action execution
- one current mutation claim
- one business event
- final effective company state reflects the mutation exactly once

The final inventory value is checked directly, not inferred only from job status.

## Watch correctness under pressure

The Watch pressure proof verifies every due rule produces:

- one completed job
- one completed evaluation
- one alert
- the expected post-evaluation rule state

No retry/dead-letter result is accepted in the bounded passing profile.

## Explicit thresholds

Source:

`server/security/i3StressThresholds.ts`

```text
races:
  Action confirmations:      16
  Automation executions:    12
  Watch completions:        16
  unexpected errors:         0

workers:
  Watch jobs:               24
  Integration jobs:         16
  Automation jobs:          16
  Watch workers:             2
  generic workers:           2
  retries:                   0
  dead letters:              0
  lease losses:              0
  unexpected errors:         0
  max duration:        180000 ms
```

These are **bounded CI/staging acceptance thresholds**, not a production throughput benchmark.

## Quality Gate

Authoritative implementation gate:

`36228011034`

Verified green:

- I3A adversarial evidence proof
- I3B PostgreSQL race/idempotency proof
- I3C sustained worker-pressure PostgreSQL proof
- TypeScript
- production build
- full Phase 0–8 regression suite
- prior production hardening proofs
- PostgreSQL runtime proofs
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Production-readiness interpretation

I3 provides strong evidence that the existing transaction, queue, isolation, and evidence-boundary architecture behaves correctly under the bounded adversarial/concurrency profiles above.

It does not establish:

- a maximum requests-per-second figure
- unlimited worker concurrency
- internet-scale capacity
- zero-failure guarantees outside measured thresholds

Those claims require environment-specific staging/production performance characterization.

## Next phase

**J1 — Production UX/Admin Forensic Audit**

Track J should begin with an audit rather than a redesign:

1. inventory normal-user, admin, developer, recovery, and diagnostics surfaces
2. identify navigation duplication and privilege-boundary confusion
3. audit onboarding, empty/error/recovery states
4. audit organization/member and source-authority administration gaps
5. audit provider/deployment diagnostics exposure
6. define the smallest UX/admin slices that improve production operability without changing core product flows
