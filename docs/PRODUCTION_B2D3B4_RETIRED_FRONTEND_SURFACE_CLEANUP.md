# Production B2D3B4 — Retired Experimental Frontend Surface Cleanup

Status: IMPLEMENTED — awaiting integrated Quality Gate validation.

## Why this slice exists

B2D3B1 through B2D3B3C retired prototype/internal HTTP families, but the browser shell still exposed several old experimental views that called those retired endpoints.

That created visible dead UI and misleading controls even though the backend retirement work was correct.

B2D3B4 removes only those stale frontend entry points and files. It does not redesign the product or remove reusable backend engines.

## Removed normal-navigation surfaces

The following tabs were removed from `Header`, `ActiveTab`, URL tab resolution, and `App` render branches:

- Learning Lab
- Advanced Orchestration
- Answer Diagnostics

Their corresponding frontend component trees were unreferenced outside those retired views and were deleted:

- `Phase4LearningSandbox.tsx`
- `MediatorOrchestrationView.tsx`
- `AdaptiveEvidenceStudio.tsx`
- `CognitiveStudioView.tsx`
- `KnowledgeGraphExplorer.tsx`
- `ComplexPdfInspector.tsx`

The older unmounted `ChatArea.tsx` was also removed because it still posted feedback to retired `/api/phase4/feedback` and was no longer the product Ask surface.

## Trust Checks repair

Before this slice, the visible Trust Checks modal still offered:

- Phase 4 Suite
- Phase 1 Grounding

and `App.tsx` selected between:

- retired `POST /api/v1/tests/phase4`
- supported `POST /api/kb/run-tests`

The modal now exposes one truthful **Production Trust Suite** and `App.tsx` always calls:

`POST /api/kb/run-tests`

That workspace route remains behind `applicationIdentityMiddleware`.

## Product Ask preserved

The normal Ask experience remains:

`UnifiedAskView`

using:

`POST /api/query/ask`

No retired experimental Ask view was substituted.

## Backend internals preserved

This cleanup does not delete internal/runtime services such as:

- governed memory store and retrieval
- sandbox and controlled-learning services
- mediator orchestration engine
- cognitive engine

Those modules remain available for supported runtime behavior, CI, or future intentionally designed product surfaces.

## Executable proof

Added:

`scripts/check-production-b2d3b4-retired-frontend-surface-cleanup.ts`

The proof verifies:

- retired component files remain absent
- retired tab values and labels do not return to the main shell
- `App` does not import/render retired experimental views
- Trust Checks uses only `/api/kb/run-tests`
- old Phase 4/Phase 1 suite selection is gone
- primary Ask remains `UnifiedAskView` on `/api/query/ask`
- supported Trust Checks route remains behind workspace identity middleware
- no remaining `src/` TypeScript/TSX file calls:
  - `/api/phase4`
  - `/api/v1/mediator`
  - `/api/v1/cognitive`
  - `/api/v1/rag`
  - `/api/v1/tests/phase4`
- representative internal backend engines/services still exist

The proof is registered in `package.json` and the Quality Gate workflow.

## Scope boundary

This phase does not:

- redesign the product navigation
- remove backend mediator/RAG/Cognitive/Phase 4 engines
- start Track C object storage
- introduce workers/queues
- migrate other unrelated dead historical components

## Exit criteria

B2D3B4 is complete only when:

- TypeScript passes
- production build passes
- focused B2D3B4 proof passes
- Phase 0–8 UI/product regression gates remain green
- all production-hardening proofs remain green
- PostgreSQL production suite remains green
- unseen-corpus and live-provider benchmark tail remains green
- integrated Quality Gate is green
