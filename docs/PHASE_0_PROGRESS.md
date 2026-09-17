# Knowledge AI — Phase 0 Progress

Last updated: **2026-09-17**

This is the short, living progress tracker for the Phase 0 work defined in `PHASE_0_AUDIT.md` and `IMPLEMENTATION_ROADMAP.md`.

## Current status

```text
0A Honest live-provider evaluation   COMPLETE
0B Provider abstraction              COMPLETE
0C Workspace isolation               NEXT / BLOCKER
0D Persistence/security hygiene      NOT STARTED
0E Telemetry/evaluation hardening    PARTIAL
0F Final exit-gate audit             NOT STARTED
```

## Phase 0A — COMPLETE

Primary commit: `ea8602494d74edf5e951a10a046813cc6045ce77`

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

## Phase 0B — COMPLETE

Key commits:

- `6f5c8b69d79a3bf3a0493540a00866055cecff0c` — provider-neutral contract
- `a1a57e31a59047d35ab05b2210fed08c27d50c49` — Gemini provider adapter
- `5ebbc35de9da2073d1d0a97e25bde404c343869f` — provider router
- `44f4cf90b4a056ffad115d020e9d5e37d885e9d7` — cognitive engine cutover
- `006a7a4d27398c7d423e067f24f5c8540826b71b` — grounded RAG cutover
- `925304b77a92d15d0ccf7a05758b6e64200a500a` — provider-boundary guard
- `9e62bf99bc02c5fb4f9248985db35e5d2f23f76d` — CI enforcement

Implemented architecture:

```text
Knowledge AI reasoning / grounded RAG
              ↓
       ProviderRouter
              ↓
        LLMProvider
              ↓
       GeminiProvider
              ↓
          Gemini SDK
```

The deterministic evidence-only synthesizers remain explicit application fallbacks outside the live-provider abstraction.

### Provider contract

`server/providers/types.ts` now defines:

- `LLMProvider.generate()`
- `LLMProvider.healthCheck()`
- `LLMProvider.capabilities()`
- structured provider failures
- structured measured/unavailable token-usage metadata

Provider failures are classified into categories such as:

- `NOT_CONFIGURED`
- `RATE_LIMITED`
- `TIMEOUT`
- `UNAVAILABLE`
- `AUTHENTICATION`
- `INVALID_REQUEST`
- `PROVIDER_ERROR`

### Boundary enforcement

Gemini SDK ownership now lives under `server/providers/`.

Both production generation paths use `ProviderRouter`:

- `server/cognitiveEngine/knowledgeCognitiveEngine.ts`
- `server/geminiService.ts`

`scripts/check-provider-boundary.mjs` scans production server TypeScript and fails if `@google/genai` or `GoogleGenAI` appears outside `server/providers/`.

The Quality Gate runs this check before TypeScript/build.

### Verification

Quality Gate run `35250380557` on commit `9e62bf99bc02c5fb4f9248985db35e5d2f23f76d` completed successfully.

Passed steps include:

- benchmark leakage guard
- LLM provider boundary guard
- TypeScript check
- production build
- arithmetic grounding proof guard
- deterministic synthesis guard
- unseen-corpus effectiveness benchmark
- live Gemini benchmark step

Phase 0B exit conditions are therefore satisfied.

## Phase 0C — NEXT / BLOCKER

Make workspace/account ownership authoritative across normal application data access and retrieval.

Required invariants:

```text
Account A → its own workspace / KB       ALLOW
Account A → Account B workspace / KB     DENY
Account B → Account A workspace / KB     DENY
```

This must apply to:

- KB reads
- KB updates/deletes
- active-KB switching
- document upload/removal
- specialized-AI configuration
- versions/evaluations
- chat/query generation
- retrieval/index access

Phase 0C is complete only when cross-workspace read, mutation, and retrieval attempts are executable tests in CI and are denied at the service/store boundary rather than merely hidden in the UI.

## Remaining Phase 0 blockers after 0B

1. authoritative workspace/KB isolation with executable cross-workspace tests

Major Phase 1 structured-data work should remain blocked until Phase 0C is resolved.
