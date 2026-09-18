# Knowledge AI — Phase 0 Progress

Last updated: **2026-09-18**

This is the short, living progress tracker for the Phase 0 work defined in `PHASE_0_AUDIT.md` and `IMPLEMENTATION_ROADMAP.md`.

## Current status

```text
0A Honest live-provider evaluation   COMPLETE
0B Provider abstraction              COMPLETE
0C Workspace isolation               COMPLETE
0D Persistence/security hygiene      COMPLETE
0E Telemetry/evaluation hardening    COMPLETE
0F Final exit-gate audit             COMPLETE

PHASE 0                              COMPLETE
PHASE 1 Structured business data     NEXT
```

## Phase 0A — COMPLETE

Primary commit: `ea8602494d74edf5e951a10a046813cc6045ce77`

The live-provider benchmark now separates:

- overall pipeline metrics
- live-provider-only metrics
- fallback-only metrics
- live-provider coverage
- benchmark validity (`FULL_LIVE`, `PARTIAL_LIVE`, `NO_LIVE`)

Fallback resilience can no longer be presented as measured Gemini quality.

## Phase 0B — COMPLETE

Provider-specific SDK ownership is isolated under `server/providers/`.

Production generation now follows:

```text
Knowledge AI reasoning / grounded RAG
              ↓
       ProviderRouter
              ↓
        LLMProvider
              ↓
       GeminiProvider
```

The provider contract exposes structured failures, capabilities, health, measured/unavailable token usage, and provider latency.

CI permanently enforces the boundary with `check:provider-boundary`.

## Phase 0C — COMPLETE

Key commits include:

- `e6cb3551807dfa29680101d3c4a99439e26b42d4` — authoritative request account resolution
- `b09aae6cd298f08cb711b39fe0f1cc6a88279b0b` — ownership enforcement service
- `373bbe7afe0592dfe4717a9ba271383313008973` — strict Specialized AI ownership
- `50ae7f83349a0f193350e6045e5bdd3bff212322` — account-scoped KB store
- `01828927f14e7e80a7547ed4df8d8f68282324d1` — account scope through workspace access
- `8282505cdefbb0d1bbf44ffaacfb5d267e00ce95` / `a36f229b92fd57d342943642537af42c996fba1f` — executable isolation proof
- `b998021ad230512fb2313517c8e5d676e554d8db` — CI enforcement

CI now proves that a caller cannot use a foreign KB/workspace identifier to:

- read another account's KB
- mutate or delete another account's KB
- switch the active KB across accounts
- query another account's Specialized AI
- leak evidence through retrieval indexes
- spoof account identity through an untrusted header

The isolation rule is enforced at backend service/store boundaries rather than only in UI routing.

## Phase 0D — COMPLETE

Key commits include:

- `ab67281e2e9e30dd2620cb13e0eef01389b65901` — ignore runtime state
- `5295eca2019367f9548d093549b12881c1f1ca2e` — remove tracked API-key metadata
- `8f28c90c31405274d0effb9b4fc7cdf2f19d962f` — remove tracked usage logs
- `0489fa01eb6cc188117772f285ae76a7a12b8ee0` — remove tracked KB runtime state
- `6b67918af3db0cc8918d885b250057d8662d93b5` — remove tracked memory/learning state
- `3a2096a4b6c3e5643e07f52aba9b0b036d756578` through `9299fcc64997c7459d19daa06ce711d961b4bc3c` — secret/runtime-state hygiene guard and fixture cleanup

Mutable local runtime state is no longer source-controlled application data.

`check:secret-hygiene` scans tracked files for known raw credential patterns and fails if forbidden runtime JSON becomes tracked again. The final Phase 0D Quality Gate run `35253388596` passed.

File-backed storage remains an explicitly documented prototype persistence mechanism; relational migration is intentionally incremental rather than a Phase 0 rewrite.

## Phase 0E — COMPLETE

Current implementation:

- removed fake `1 query = 1 measured token` accounting
- records token usage only when the provider exposes measured usage metadata
- records actual provider-call usage separately from token usage
- exposes provider failure category/retryability in the cognitive trace
- exposes measured provider generation latency
- represents unavailable fusion/reranking/reasoning timings as `null` instead of fake zeros or duplicated timings
- adds a measured synthesis-stage duration
- live Gemini benchmark now reports measured token coverage/totals when available
- deterministic unseen benchmark now gates answer accuracy, retrieval, citation precision, refusal accuracy, false-refusal rate, and grounding independently
- live-provider benchmark applies provider-only quality thresholds after minimum live coverage is met
- `check:telemetry-integrity` prevents the old misleading metric patterns from returning

Primary Phase 0E commits:

- `4500979bd6b2e3811bea67a5f339abd70e2f00ef`
- `8d78951602f21b5338ad2f30930722476bbf4de0`
- `f8a76ccf504fee7f4c04a626ab0df1d72fd16eb6`
- `c0d55958684d06039de2873dad95c4e5aacf7e38`
- `5a810c6d60b5420b1cd52f7aaed4808431f9b682`
- `ecdc55655a016a477b80ac207bd7ab60149023b4`

Verification:

- Quality Gate run `35355434759` passed the integrated Phase 0E code, including the stricter unseen benchmark and live-provider benchmark step.
- The telemetry integrity guard has also passed in CI.

## Phase 0F — COMPLETE

The final scorecard is documented in `PHASE_0_FINAL_AUDIT.md`.

Result: **7 / 7 Phase 0 exit-gate requirements pass.**

## Next

Begin **Phase 1 — First-Class Structured Business Data**.

The first slice is CSV/XLSX ingestion → schema detection → preview/mapping → validated structured storage → deterministic analysis → evidence-backed AI explanation.
