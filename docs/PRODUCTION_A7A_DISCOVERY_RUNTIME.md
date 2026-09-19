# Knowledge AI — Production A7A Discovery Runtime Cutover

Date: **2026-09-19**

## Verdict

# ✅ A7A COMPLETE

Discovery / Insights is the first product domain whose normal production runtime now selects PostgreSQL when:

`KNOWLEDGE_AI_PERSISTENCE_MODE=postgres`

Authoritative workflow:

- **Workflow:** `35460199628`
- **Quality Gate:** PASS
- **PostgreSQL A2→A7A chain:** PASS

## Runtime boundary

The legacy synchronous services remain available for file-mode development and the historical Phase 2/8 regression suite.

Production-facing entry points now use async runtime services:

- `server/discovery/discoveryRuntimeService.ts`
- `server/discovery/discoveryPersistence.ts`
- `server/platform/detectors/detectorExecutionRuntimeService.ts`
- `server/platform/domainPacks/domainPackRuntimeService.ts`

When PostgreSQL mode is disabled, the selected persistence adapter delegates to `discoveryStore`.

When PostgreSQL mode is enabled, it delegates to `postgresDiscoveryRepository`.

## Cut-over entry points

The following normal runtime paths now use the selected persistence backend:

- Discovery POST analyze
- Discovery run listing
- Discovery Insight listing
- Discovery status update
- Discovery Insight detail
- stable Platform Insights listing
- stable registered detector execution
- stable domain-pack detector execution
- registered `insights.list` tool

## Executable proof

`scripts/check-production-a7-discovery-runtime.ts`

The test runs with real PostgreSQL mode and verifies:

1. normal Discovery HTTP analysis writes AnalysisRun/Insight rows to PostgreSQL
2. status mutation persists to PostgreSQL
3. foreign accounts cannot read another account Insight
4. PostgreSQL pool is closed and reconstructed
5. a fresh Discovery runtime service reads the same persisted Insight/status
6. stable Platform Insights reads the same relational state
7. registered detector execution writes its run/Insights to PostgreSQL
8. registered `insights.list` reads the same PostgreSQL state
9. `data/discovery.json` remains byte-for-byte unchanged throughout the production-mode operations
10. the entire legacy Phase 0–8 suite still passes in normal file mode

## Deliberate boundary

Action confirmation still calls the legacy synchronous downstream Discovery refresh.

That path is intentionally deferred to the Action/Living-Knowledge runtime cutover, because making a currently synchronous transaction path fire-and-forget would weaken correctness.

A7A does not claim all domains are cut over.

## Next slice

# A7B — Integrations runtime cutover

Integrations is next because its operational APIs are already asynchronous and A4 already provides relational checkpoint/import repositories and a transactional successful-checkpoint commit.

The target is:

```text
Integration OAuth / connection metadata
            ↓
selected Integration persistence
            ↓
PostgreSQL connection / SyncRun / external imports
            ↓
transactional checkpoint commit
```

while the encrypted credential vault remains separate from relational non-secret metadata.
