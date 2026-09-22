# Production B2D3B3B — RAG + Cognitive Route Retirement

Status: IMPLEMENTED — awaiting integrated Quality Gate validation.

## Scope

This slice is intentionally limited to the legacy prototype HTTP families:

- `/api/v1/rag/*`
- `/api/v1/cognitive/*`

It does not modify:

- `/api/phase4/*` — reserved for B2D3B3C
- Track C object storage
- workers/queues
- modern product query behavior

## Audit result

### RAG HTTP inventory

Five legacy endpoints were registered directly in `server.ts`:

1. `POST /api/v1/rag/benchmark/run`
2. `GET /api/v1/rag/benchmark/status`
3. `POST /api/v1/rag/reproduce-sequence`
4. `GET /api/v1/rag/telemetry`
5. `GET /api/v1/rag/telemetry/stats`

These are benchmark, reproduction, and diagnostic surfaces. They are not a supported product API contract.

### Cognitive HTTP inventory

Eleven legacy endpoints were registered directly in `server.ts`:

1. `POST /api/v1/cognitive/query`
2. `POST /api/v1/cognitive/benchmarks/aurora`
3. `GET /api/v1/cognitive/benchmarks/aurora`
4. `POST /api/v1/cognitive/benchmarks/golden`
5. `GET /api/v1/cognitive/benchmarks/golden`
6. `POST /api/v1/cognitive/benchmarks/multilingual`
7. `GET /api/v1/cognitive/benchmarks/multilingual`
8. `GET /api/v1/cognitive/telemetry`
9. `GET /api/v1/cognitive/graph`
10. `GET /api/v1/cognitive/tables`
11. `GET /api/v1/cognitive/outline`

The query handler used legacy `kbStore` state, caller-supplied tenant/kb identifiers, and an Aurora fallback corpus. The remaining routes expose benchmarks, diagnostic telemetry, experimental GraphRAG, extracted-table inspection, and document-outline inspection.

None of these routes use the modern application identity boundary.

## Retirement vs migration decision

The normal product query contract already exists at:

`POST /api/query/ask`

That router:

- uses `applicationIdentityMiddleware`
- resolves account identity from the authenticated request
- delegates to `unifiedQueryService`
- is mounted before the legacy/prototype quarantine boundary

Therefore no legacy `/api/v1/cognitive/query` HTTP compatibility endpoint is required for production.

The prototype RAG/Cognitive HTTP families are retired rather than migrated one-for-one.

## What changed

### server.ts

Removed all 16 RAG/Cognitive HTTP registrations.

Removed only their HTTP-only imports:

- `runRag50GoldenBenchmark`
- `runEightTurnConversationalSequence`
- `ragTelemetryStore`
- `knowledgeCognitiveEngine`
- `runAurora24Benchmark`
- `runMultilingualBenchmark`
- `runGolden220Benchmark`
- `cognitiveTelemetryStore`
- `knowledgeGraphEngine`
- `hierarchicalIndex`
- `generateFullAuroraRoboticsCorpusPdf`

Shared document parsing/import dependencies remain because supported upload flows still use them.

### Route quarantine

Changed:

- `/api/v1/rag` → `RETIRED`
- `/api/v1/cognitive` → `RETIRED`

The non-production compatibility flag can no longer reopen either family.

`/api/phase4` remains `DEVELOPMENT_ONLY` for B2D3B3C.

## Internals intentionally preserved

The underlying RAG/Cognitive modules remain available for internal quality work, experimentation, or future supported integration:

- RAG benchmark runner
- conversational reproduction runner
- RAG telemetry store
- hybrid RAG index/pipeline
- cognitive engine
- Aurora / multilingual / golden cognitive benchmarks
- cognitive telemetry
- knowledge graph engine
- hierarchical index

The older GraphRAG subsystem remains experimental and is not authoritative company memory.

## Regression coverage

Added:

`scripts/check-production-b2d3b3b-rag-cognitive-route-retirement.ts`

The proof checks that:

- no `/api/v1/rag/*` registration remains
- no `/api/v1/cognitive/*` registration remains
- obsolete route-only imports are absent from `server.ts`
- supported `/api/query/ask` remains mounted and identity-aware
- RAG/Cognitive families are `RETIRED`
- compatibility mode cannot reopen them
- representative RAG/Cognitive internals remain importable and callable
- `/api/phase4/*` compatibility remains untouched

Historical production-hardening proofs were advanced so they no longer expect RAG/Cognitive to remain DEVELOPMENT_ONLY.

The focused proof is registered in `package.json` and the GitHub Actions Quality Gate.

## Frontend follow-up discovered

The legacy `CognitiveStudioView` is still reachable from the old experimental navigation, similar to the already-retired Mediator surface.

This backend slice does not expand into frontend cleanup. After the prototype route-retirement sequence is complete, retired experimental navigation/components should be removed or intentionally migrated so the production UI does not expose dead tooling.

## Exit criteria

B2D3B3B is complete only when:

- TypeScript passes
- production build passes
- focused B2D3B3B proof passes
- previous production-hardening proofs remain green
- PostgreSQL production suite remains green
- integrated Quality Gate is green

## Next phase

After B2D3B3B closes:

**B2D3B3C — Legacy Phase 4 Route Retirement or Migration**

Keep that phase limited to `/api/phase4/*`.
