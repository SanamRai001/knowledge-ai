# Knowledge AI — Production A7G Core Metadata Runtime

Date: **2026-09-20**

## Status

# ✅ COMPLETE

Authoritative integrated workflow:

`35523721395`

The full Quality Gate passed with the Production A7G PostgreSQL runtime proof.

## Scope

A7G makes the original A2 core metadata repositories authoritative at runtime when:

```text
KNOWLEDGE_AI_PERSISTENCE_MODE=postgres
```

This slice covers:

- API-key metadata
- API usage metadata
- workspace identity/metadata
- per-account active workspace selection
- Dataset metadata
- DatasetVersion metadata
- Dataset import-run metadata

Large document/chat/evaluation payloads and Dataset analytical row payloads remain behind explicit non-relational payload boundaries for Track C.

## Verified behavior

### API keys and usage

- API-key metadata is PostgreSQL-authoritative
- raw API secrets never enter PostgreSQL
- synchronous request authentication still works from a hydrated validation cache
- the validation cache can be reconstructed from PostgreSQL after simulated restart
- API usage statistics are PostgreSQL-authoritative
- revocation updates both PostgreSQL state and the synchronous validation cache
- account isolation is preserved

### Workspace metadata

- workspace metadata is PostgreSQL-authoritative
- per-account active-workspace selection is PostgreSQL-authoritative
- one account's active workspace cannot affect another account
- stale metadata embedded in the legacy payload file cannot override relational metadata
- workspace metadata and active selection survive PostgreSQL runtime reconstruction
- foreign accounts cannot resolve another account's workspace

### Dataset metadata and versions

- Dataset identity/version metadata is PostgreSQL-authoritative
- imports append relational DatasetVersion history
- current-version pointers advance relationally
- analytical payload location is explicit rather than duplicated into metadata rows
- deterministic analytics still work through the selected runtime cache
- the analytical runtime cache reconstructs from PostgreSQL metadata + payload backend after simulated restart
- account isolation survives reconstruction

### Legacy-file boundary

In PostgreSQL mode, A7G verified no mutation of legacy metadata JSON for:

- API-key metadata
- API usage metadata
- Dataset metadata

The remaining local payload stores are intentional temporary boundaries:

- workspace document/chat/evaluation payload
- Dataset analytical row payload

These are not treated as authoritative relational metadata.

## Integrated regression safety

Workflow `35523721395` also passed:

- all Phase 0–8 product regression gates
- TypeScript
- production build
- workspace isolation
- dataset isolation
- integrations
- Watch
- Actions
- Automation
- Platform
- unseen-corpus benchmark
- live Gemini benchmark

## Track A exit review

### Relational backbone verdict

**Core relational runtime cutover: COMPLETE.**

All mutable metadata/state families identified for the relational backbone now have PostgreSQL-backed runtime paths in production mode.

### Remaining durability dependency

Track A does **not** mean every byte of user content is already durable outside the application filesystem.

Two payload classes remain intentionally outside PostgreSQL:

1. workspace document/chat/evaluation payloads
2. Dataset analytical row payloads

Their production durability belongs to:

**Track C — durable files/object storage**

Therefore:

- relational metadata/state cutover is complete
- production-hardening as a whole is not complete
- Track C must remove the remaining container-local payload durability risk

## Next slice

# Production Hardening B1 — Identity and authorization forensic audit

Do not implement a new auth framework blindly.

First inventory:

- every browser-authenticated route
- every route that still permits the legacy `acc_default` fallback
- current session/user concepts
- organization/workspace membership assumptions
- API-key vs human-session boundaries
- privileged admin operations
- integration-management permissions
- automation-policy permissions
- source-authority permissions

The B1 output should define the smallest real identity/membership vertical slice before coding.
