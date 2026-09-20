# Knowledge AI — Production A7F Platform Runtime

Date: **2026-09-20**

## Status

# ✅ COMPLETE

Authoritative integrated workflow:

`35522567852`

The PostgreSQL production-runtime job passed A2 through A7F.

## Scope

A7F cuts Phase 8 mutable Platform runtime state over to the existing A5 PostgreSQL repository when:

```text
KNOWLEDGE_AI_PERSISTENCE_MODE=postgres
```

File mode remains supported for local development/regression compatibility.

## Verified runtime behavior

### Domain-pack installations

- install is persisted in PostgreSQL
- repeated install of the same active pack/version is idempotent
- removal preserves history
- reinstall after removal creates a fresh installation record
- only one ACTIVE installation exists for the same account/pack/version
- listing is account scoped
- state survives PostgreSQL pool/persistence reconstruction

### Registered-tool invocation audit

- registered tools continue to execute through the stable Platform API
- tool reads use the selected PostgreSQL Living Knowledge runtime
- invocation audit is stored relationally
- API-key ownership is preserved
- input is represented by privacy-safe hash metadata
- invocation history is account scoped
- state survives PostgreSQL pool/persistence reconstruction

### Isolation and legacy behavior

- spoofed account headers do not override authenticated API-key ownership
- foreign accounts cannot read installations or invocation audit
- PostgreSQL mode does not mutate:
  - `data/platform_domain_packs.json`
  - `data/platform_tool_invocations.json`
- complete file-mode Phase 8 behavior remains covered by the ordinary Quality Gate

## Important finding after A7F

A7F completes the higher-level Phase 8 runtime cutover, but **Track A is not yet complete**.

The original A2 relational foundation already contains repositories for:

- accounts
- workspace metadata / per-account active workspace
- API-key metadata + API usage
- Dataset / DatasetVersion metadata

However, several oldest live runtime paths still call their legacy file stores directly:

- `server/kbStore.ts`
- `server/apiKeyStore.ts`
- `server/datasets/datasetStore.ts`

Therefore the next production slice is:

# A7G — Core Metadata Runtime Cutover

A7G must make the A2 PostgreSQL repositories authoritative in production mode while respecting the A1 split between relational metadata and large document/analytical payloads.
