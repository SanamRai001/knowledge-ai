# Knowledge AI — Phase 0 Progress

Last updated: **2026-09-17**

This is the short, living progress tracker for the Phase 0 work defined in `PHASE_0_AUDIT.md` and `IMPLEMENTATION_ROADMAP.md`.

## Current status

```text
0A Honest live-provider evaluation   COMPLETE
0B Provider abstraction              NEXT
0C Workspace isolation               BLOCKED / NOT STARTED
0D Persistence/security hygiene      NOT STARTED
0E Telemetry/evaluation hardening    PARTIAL
0F Final exit-gate audit             NOT STARTED
```

## Phase 0A — COMPLETE

Commit: `ea8602494d74edf5e951a10a046813cc6045ce77`

`scripts/run-live-gemini-benchmark.ts` now distinguishes:

- overall pipeline metrics
- live-provider-only metrics
- fallback-only metrics
- live-provider response count
- fallback response count
- live-provider coverage
- benchmark validity (`FULL_LIVE`, `PARTIAL_LIVE`, `NO_LIVE`)

It also requires a minimum live-provider coverage (80% by default, configurable through `LIVE_PROVIDER_MIN_COVERAGE`) before the run can be treated as a valid provider-quality benchmark.

### Verification

The first CI run after this change hit Gemini free-tier quota limits.

Observed result:

```text
mode: mixed-live-and-fallback
benchmarkValidity: NO_LIVE
liveProviderResponses: 0
fallbackResponses: 20
liveProviderCoverage: 0
```

The deterministic fallback pipeline still passed all 20 cases, but those results were correctly reported only under `overallPipelineMetrics` / `fallbackOnlyMetrics`.

`liveProviderOnlyMetrics` contained no fabricated accuracy values.

The script then rejected the provider benchmark because live coverage was below the required threshold.

This is the desired behavior: **fallback resilience must never be presented as measured live-model quality.**

The main Quality Gate remains non-blocking for provider quota/rate-limit failures because the live-provider workflow step currently uses `continue-on-error`. The invalidity is still explicit in the benchmark output.

## Phase 0B — NEXT

Implement a stable live LLM provider boundary.

Target:

```text
server/providers/
  types.ts
  geminiProvider.ts
  providerRouter.ts
```

Required behavior:

- `LLMProvider` defines generation, capability/configuration, health/failure metadata
- Gemini-specific SDK usage lives only inside the Gemini provider
- `ProviderRouter` selects the configured primary provider
- provider errors are returned in a structured way (`RATE_LIMITED`, `UNAVAILABLE`, `TIMEOUT`, etc.)
- deterministic evidence-only synthesis remains a clearly separate application fallback

Phase 0B is complete only when:

- `server/cognitiveEngine/knowledgeCognitiveEngine.ts` no longer imports `GoogleGenAI`
- `server/geminiService.ts` no longer imports `GoogleGenAI`
- both use the provider abstraction for live generation
- existing deterministic benchmarks remain green
- lint/build remain green

## Remaining Phase 0 blockers after 0A

1. provider abstraction
2. authoritative workspace/KB isolation with executable cross-workspace tests

Major Phase 1 structured-data work should remain blocked until those are resolved.
