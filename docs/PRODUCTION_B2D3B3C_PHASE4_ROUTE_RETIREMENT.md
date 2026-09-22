# Production B2D3B3C — Legacy Phase 4 Route Retirement

Status: IMPLEMENTED — awaiting integrated Quality Gate validation.

## Scope

This slice is limited to the legacy Web UI convenience family:

- `/api/phase4/*`

It does not remove:

- governed memory retrieval from the Specialized AI answer path
- experience recording
- sandbox/learning internal services
- authenticated `/api/v1/ai/:ai_id/*` compatibility APIs
- modern `/api/kb/:id/ai` workspace configuration
- modern `/api/query/ask`
- retired experimental frontend tabs/components
- Track C object storage
- workers/queues

## Route inventory

Eighteen legacy convenience routes were registered directly in `server.ts`:

1. `GET /api/phase4/dashboard`
2. `GET /api/phase4/memories`
3. `POST /api/phase4/memories`
4. `PATCH /api/phase4/memories/:id/status`
5. `GET /api/phase4/experiences`
6. `POST /api/phase4/feedback`
7. `GET /api/phase4/sandbox/scenarios`
8. `POST /api/phase4/sandbox/scenarios`
9. `POST /api/phase4/sandbox/runs`
10. `POST /api/phase4/sandbox/batch`
11. `GET /api/phase4/sandbox/runs`
12. `GET /api/phase4/learning/candidates`
13. `POST /api/phase4/learning/generate`
14. `GET /api/phase4/improvements`
15. `POST /api/phase4/improvements/propose`
16. `POST /api/phase4/improvements/:id/approve`
17. `POST /api/phase4/improvements/:id/reject`
18. `PATCH /api/phase4/ai-config`

These routes selected the globally active legacy `kbStore` workspace and commonly fell back to `acc_default`. They predate HUMAN_SESSION request identity and modern account/workspace scoping.

## Retirement vs migration decision

### Memory, experiences, sandbox, learning, improvements, dashboard, audit

The supported API-key compatibility family already exposes authenticated equivalents under:

`/api/v1/ai/:ai_id/*`

That family uses `authenticateApiRequest` and scopes operations with the API key's account ID.

The Phase 4 active-KB convenience wrappers therefore do not need a one-for-one migration.

### Assistant configuration

The normal browser UI already saves Specialized AI configuration through:

`PUT /api/kb/:id/ai`

The workspace router uses `applicationIdentityMiddleware`, so the legacy `PATCH /api/phase4/ai-config` route is redundant.

### Ask and feedback

The current primary Ask UI is `UnifiedAskView`, using:

`POST /api/query/ask`

It does not depend on `/api/phase4/*`.

An older `ChatArea` component still contains a `/api/phase4/feedback` call, but `App.tsx` no longer mounts that component as the product Ask experience. If product feedback is reintroduced, it should use a new human-session identity-aware API rather than reopening the Phase 4 family.

## Legacy frontend finding

The old `Phase4LearningSandbox` / “Learning Lab” remains in experimental navigation, but its client contract has already drifted from the backend. Examples include frontend calls for memory verify/reject/archive and learning proposal URLs that do not match the legacy server registrations.

This confirms the surface is experimental/dead UI debt, not a supported production contract.

Frontend cleanup is deliberately deferred to a separate small slice.

## What changed

### server.ts

Removed all 18 `/api/phase4/*` HTTP registrations.

No Phase 4 supporting import was removed because:

- `memoryStore` remains used by authenticated `/api/v1/ai/:ai_id/*`
- `sandboxService` remains used by authenticated sandbox compatibility APIs
- `learningService` remains used by authenticated learning/improvement compatibility APIs

The internal Specialized AI answer path continues to use:

- `memoryRetrievalService.retrieveRelevantMemories`
- `memoryStore.recordExperience`

### Route quarantine

Changed:

- `/api/phase4` → `RETIRED`

The non-production compatibility flag can no longer reopen the family.

After this slice there are no remaining `DEVELOPMENT_ONLY` legacy route families in the quarantine inventory.

## Regression coverage

Added:

`scripts/check-production-b2d3b3c-phase4-route-retirement.ts`

The proof checks that:

- no `/api/phase4/*` registration remains
- Phase 4 is classified `RETIRED`
- compatibility mode cannot reopen representative Phase 4 paths
- authenticated `/api/v1/ai/:ai_id/*` memory/experience/sandbox/learning/improvement/dashboard/audit routes remain registered
- API-key authentication remains on the supported compatibility family
- modern HUMAN_SESSION workspace AI configuration remains identity-aware
- current product Ask remains on `/api/query/ask`
- governed memory retrieval and experience recording remain in the internal answer path
- memory, sandbox, learning, and retrieval services remain directly importable

Historical B2D3 proofs were advanced to accept the later Phase 4 retirement.

The focused proof is registered in `package.json` and GitHub Actions Quality Gate.

## Exit criteria

B2D3B3C is complete only when:

- TypeScript passes
- production build passes
- focused B2D3B3C proof passes
- previous production-hardening proofs remain green
- PostgreSQL production suite remains green
- Phase 0–8 regression gates remain green
- integrated Quality Gate is green

## Follow-up discovered

After backend legacy-route retirement closes, the production UI should remove or intentionally migrate the retired experimental surfaces:

- Learning Lab / `Phase4LearningSandbox`
- Advanced Orchestration / mediator UI
- Answer Diagnostics / Cognitive Studio
- stale acceptance-test actions that call retired test endpoints

Keep that frontend cleanup separate from B2D3B3C.
