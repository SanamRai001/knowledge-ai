# Knowledge AI — Phase 0 Audit

Status: **Phase 0 in progress — major Phase 1 work remains blocked**  
Audit date: **2026-09-17**

This document audits the current `main` branch against the Phase 0 exit gate in `IMPLEMENTATION_ROADMAP.md`.

The purpose is to distinguish what is actually complete from what only exists conceptually, and to define the exact order of work before Knowledge AI expands into first-class structured data, discovery, actions, and proactive monitoring.

---

## 1. Executive verdict

Phase 0 is **not complete yet**.

The current repository has a substantially stronger trustworthy-RAG foundation than the earlier audit suggested. Benchmark-specific Aurora answers have been removed from the generic cognitive path, a leakage guard runs in CI, the unseen synthetic corpus benchmark is cleanly separated from the production path, citation/refusal behavior is measured, and the quality workflow currently passes lint/build and the deterministic trust checks.

However, three Phase 0 blockers remain:

1. **The live LLM path is still coupled directly to Gemini instead of using a provider interface/router.**
2. **Core workspace/knowledge-base isolation is not enforced or covered end-to-end on the normal application routes.**
3. **Live-provider telemetry/evaluation is not honest enough yet when provider calls fall back to the deterministic engine.**

There are also important non-blocking Phase 0 cleanup items around file-backed persistence, tracked runtime data, stage timing instrumentation, and the oversized `server.ts` integration surface.

Do not begin major Phase 1 implementation until the three blockers above are resolved and CI remains green.

---

## 2. Phase 0 exit-gate scorecard

| Exit-gate requirement | Status | Evidence / current reality |
| --- | --- | --- |
| Unseen-corpus evaluation runs without corpus-specific production shortcuts | **COMPLETE** | Generic cognitive reasoning no longer contains Aurora-specific answer branches; `check:benchmark-leakage` runs in CI and passes. |
| Citations are measurably tied to supporting evidence | **PROVISIONALLY COMPLETE** | The unseen benchmark measures citation precision and currently reports 1.0 on the synthetic Lattice Harbor set. This is a useful baseline, not proof of broad production quality. |
| Unsupported questions reliably abstain | **PROVISIONALLY COMPLETE** | The current unseen set reports 100% refusal accuracy and 0 false refusals. The set is still small and should grow over time. |
| Normal grounded Q&A uses provider abstraction | **MISSING — BLOCKER** | Both the cognitive path and legacy grounded path instantiate/call `GoogleGenAI` directly. |
| Simulated/fallback metrics cannot be mistaken for live metrics | **PARTIAL — BLOCKER** | The mediator simulation harness is now clearly labeled `SIMULATED`, but the live Gemini benchmark can report full-pipeline accuracy under `mode: live-gemini` even when most cases used deterministic fallback. |
| Core workspace isolation has executable coverage | **MISSING — BLOCKER** | Main `/api/kb*` routes operate on global/default KB state and KB IDs without authoritative account/workspace ownership checks. No Phase 0 CI isolation test currently proves cross-workspace denial. |
| Lint and build pass consistently | **COMPLETE** | Latest Quality Gate run on `main` completed successfully with TypeScript check and production build passing. |

### Overall

**4 of 7 exit-gate items are complete or provisionally satisfied. 3 remain blocking.**

---

## 3. Workstream audit

### 0.1 Benchmark contamination — COMPLETE

The earlier effectiveness audit identified corpus-specific Aurora Robotics answers inside generic production reasoning. The current generic `knowledgeCognitiveEngine.ts` is evidence-driven and no longer contains those answer fixtures.

The repository also has `scripts/check-benchmark-leakage.mjs`, which scans the production cognitive/RAG paths while intentionally excluding benchmark-only directories. CI runs this guard before lint/build.

#### Keep doing

- expand the forbidden-pattern guard when new benchmark corpora are introduced
- keep benchmark fixtures in benchmark/test-only directories
- never optimize production reasoning around expected benchmark strings

---

### 0.2 Clean evaluation — PARTIAL / STRONG FOUNDATION

The repository now has a useful unseen synthetic business corpus (`Lattice Harbor`) covering:

- direct facts
- table calculations
- correction questions
- conversational follow-ups
- unsupported/refusal cases
- adversarial prompt injection
- multilingual questions

The deterministic run currently reports:

- answer accuracy: 1.0
- retrieval hit rate: 1.0
- citation precision: 1.0
- correct refusal rate: 1.0
- false refusal rate: 0
- average grounding score: 1.0

These numbers are valuable as a regression baseline, but they must not be described as general production accuracy. The corpus is small, synthetic, and deterministic.

#### Remaining work

- add stricter CI thresholds for more than retrieval hit rate
- grow the unseen set substantially
- add noisy/messy real-document layouts
- add ambiguous citations and conflicting evidence
- add more multilingual cases
- add workspace-isolation/security evaluation separately

---

### 0.3 Provider architecture — MISSING / BLOCKER

The architecture target is:

```text
LLMProvider
  generate()
  healthCheck()
  capabilities()

ProviderRouter
  primary
  fallback
  optional verifier later
```

Current reality:

- `server/cognitiveEngine/knowledgeCognitiveEngine.ts` directly imports and creates `GoogleGenAI`
- `server/geminiService.ts` directly imports and creates `GoogleGenAI`
- model name and Gemini-specific request shape are embedded in both paths

This means provider failure handling, telemetry, model replacement, and future verification cannot be implemented cleanly without duplicating provider-specific logic.

#### Required Phase 0 implementation

Create a bounded provider module, for example:

```text
server/providers/
  types.ts
  geminiProvider.ts
  providerRouter.ts
```

Then route both normal grounded generation and cognitive generation through it.

A deterministic evidence-only synthesizer remains an application fallback, not a fake external provider.

---

### 0.4 Honest telemetry — PARTIAL / BLOCKER

#### What improved

`server/mediator/realProviderAdapter.ts` now explicitly identifies itself as a **simulation harness**. Its responses and provider-health fixtures are labeled `SIMULATED`, which prevents that subsystem from being presented as live provider evidence.

Cognitive stage timing no longer appears to split one duration into arbitrary percentages.

#### Current problem: live benchmark fallback contamination

The current live Gemini benchmark allows deterministic fallback responses to contribute to the headline `live-gemini` metrics.

A real CI run on 2026-09-17 produced:

```text
Gemini responses: 1
Deterministic fallback responses: 19
Total: 20
```

The provider returned 503/429 errors for many calls, but the script still printed 100% `answerAccuracy` under `mode: live-gemini` because the deterministic fallback answered those cases correctly.

That measures **end-to-end pipeline resilience**, not **Gemini quality**.

These must be reported separately.

#### Immediate fix

The live benchmark must report:

- live-provider coverage
- fallback count
- overall pipeline metrics
- live-provider-only metrics
- benchmark validity (`FULL_LIVE`, `PARTIAL_LIVE`, `NO_LIVE`)

A run with insufficient live-provider coverage must not be described as a valid full live-provider benchmark.

#### Additional telemetry cleanup

- token usage should record real provider token data when available rather than treating one query as one measured token
- generation and reasoning timing should not be duplicate aliases unless explicitly documented
- fusion/reranking should be measured or marked unavailable, not silently represented as meaningful zeros
- provider timeout/rate-limit/error counters should be captured by the provider abstraction

---

### 0.5 Persistence baseline — PARTIAL

The current product still uses file-backed prototype persistence for important state, including knowledge bases, memory/learning data, API key metadata, and usage data.

File-backed persistence is acceptable for some Phase 0 prototype workflows, but the repository currently tracks generated/runtime JSON under `data/` in the public Git repository.

#### Required classification

Before Phase 1, classify state into:

**Keep temporarily file-backed**
- benchmark fixtures
- explicitly static development fixtures

**Move toward durable relational persistence**
- workspaces/knowledge-base metadata
- source/document metadata
- user/account ownership
- permissions
- evaluation history that should survive deployments

**Never commit as runtime state**
- generated API-key metadata
- usage logs
- mutable user/workspace content
- runtime memory state

A migration to PostgreSQL does not need to block all Phase 0 work, but source ownership and isolation must have a durable design before Phase 1 expands the data model.

---

### 0.6 Security baseline — MISSING / BLOCKER

There is security-related machinery in mediator/governance modules, prompt-injection refusal logic, upload size/type checks, and hashed application API keys.

However, the normal application routes do not yet demonstrate authoritative workspace isolation.

Examples of the current risk pattern:

```text
GET /api/kb
PATCH /api/kb/:id
DELETE /api/kb/:id
POST /api/kb/switch
GET/PUT /api/kb/:id/ai
version/evaluation routes
```

These routes fetch or mutate KBs by global active state or raw KB ID. `kbStore` has an `accountId` concept, but many read/write methods do not require the caller's account/workspace identity.

Therefore a key Phase 0 invariant is not yet proven:

> A caller from workspace/account A must never read, switch to, update, delete, retrieve from, or generate against workspace/account B.

#### Required Phase 0 work

1. introduce one authoritative request identity/context mechanism for normal application APIs
2. require account/workspace context on KB reads/writes
3. enforce ownership in the store/service boundary, not only in UI routing
4. ensure retrieval indexes are tenant + knowledge-base scoped
5. add executable cross-tenant tests to CI
6. document upload/security limits and prompt-injection boundaries

The exact production authentication product can evolve later; **data isolation cannot wait**.

---

### 0.7 Product surface — MOSTLY COMPLETE FOR PHASE 0

The current direction has already moved normal users away from phase numbers and cognitive/orchestration jargon toward product concepts such as Ask, Documents, Sources, Settings, and Quality.

Do not spend significant Phase 0 time redesigning the entire UI. Larger navigation evolution belongs to later phases.

---

### 0.8 Server modularization — PARTIAL / NON-BLOCKING

`server.ts` remains a very large integration surface, but the repository already contains many bounded services.

Do not perform a giant refactor in Phase 0.

Extract only when it directly supports a blocker, especially:

- `server/providers/` while implementing provider abstraction
- workspace/authorization middleware/service while implementing isolation
- evaluation helpers while strengthening benchmark honesty

---

## 4. Recommended execution order

### Phase 0A — Honest live-provider evaluation

Fix live benchmark reporting so provider fallback cannot inflate provider-specific results.

**Done when:**

- coverage/fallback are explicit
- provider-only metrics are separate from overall pipeline metrics
- insufficient live coverage marks the provider benchmark partial/invalid

### Phase 0B — Provider abstraction

Create `LLMProvider` + Gemini implementation + `ProviderRouter` and migrate both grounded generation paths.

**Done when:**

- `knowledgeCognitiveEngine.ts` no longer imports `GoogleGenAI`
- `geminiService.ts` no longer imports `GoogleGenAI`
- provider failures return structured failure metadata
- deterministic fallback remains explicit

### Phase 0C — Workspace isolation

Make account/workspace ownership authoritative in the normal KB/document/query paths.

**Done when:**

- cross-workspace read is denied
- cross-workspace mutation is denied
- retrieval cannot cross workspace boundaries
- executable isolation tests run in CI

### Phase 0D — Persistence/security hygiene

- stop treating mutable runtime `data/` as source-controlled application state
- document fixture vs runtime storage
- prepare relational persistence boundary
- verify no secrets/raw provider credentials are committed

### Phase 0E — Telemetry + evaluation hardening

- real stage timing where useful
- real provider error classification
- real token usage when exposed
- stronger CI metric thresholds
- broader unseen corpus

### Phase 0F — Final exit-gate audit

Re-run the complete Phase 0 scorecard.

Only when every blocker is green should major Phase 1 structured-data implementation begin.

---

## 5. Current next action

**Start Phase 0A now.**

The first code change should fix `scripts/run-live-gemini-benchmark.ts` so a mixed live/fallback run cannot present deterministic success as live-provider accuracy.
