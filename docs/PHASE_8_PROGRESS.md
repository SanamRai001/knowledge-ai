# Knowledge AI — Phase 8 Progress

Last updated: **2026-09-19**

## Status

# 🚧 PHASE 8 IN PROGRESS

Phase 8 turns the mature product into an extensible platform without allowing extensions to bypass the trust, provenance, authorization, audit, Watch, Integration, or Controlled Automation boundaries built in Phases 0–7.

## Goal

> Let developers and domain extensions add value through stable governed contracts instead of reaching directly into internal stores and experimental modules.

## Execution slices

```text
8A Stable developer API + permission manifest           IN PROGRESS
8B Plugin/tool registration + execution contract        NOT STARTED
8C Custom detector framework                            NOT STARTED
8D Domain-pack packaging                                NOT STARTED
8E Platform UI/docs + final Phase 8 audit              NOT STARTED
```

## Non-negotiable platform boundary

```text
external developer / extension
        ↓
stable versioned API or registered tool contract
        ↓
explicit scope / permission requirement
        ↓
authoritative Phase 0–7 service boundary
        ↓
provenance + audit + tenant isolation
```

Extensions must not receive a shortcut around:

- request identity
- account isolation
- source provenance
- deterministic analytics
- Phase 4 action validation
- Phase 5 Watch validation
- Phase 6 integration authorization
- Phase 7 automation policy / kill switch

## Phase 8A — stable developer API foundation

### Audit first

Before adding endpoints, inventory:

- existing REST endpoints
- API-key authentication
- API-key scope semantics
- DeveloperPlatform UI
- routes currently intended only for internal/admin/experimental use
- existing rate-limit behavior
- mutation-capable endpoints

### Initial stable capability families

Target external contract:

- Sources / knowledge metadata
- Ask
- Insights
- Actions
- Watch
- Audit/activity

Do not automatically expose every internal router.

### Permission manifest

Every stable operation must declare at least:

- operation ID
- API version
- HTTP method/path
- capability family
- required scopes
- mutation vs read-only
- risk classification
- audit behavior
- rate-limit class
- stability status

### Scope principles

- missing scopes fail closed
- read scopes do not imply write scopes
- action proposal creation is distinct from action confirmation
- automation execution is not exposed merely because Actions are exposed
- integration credentials/tokens are never returned
- admin/experimental cognitive internals remain outside the stable API

### Phase 8A executable proof target

CI must prove:

- manifest contains unique operation IDs and unique method/path pairs
- all stable mutations declare explicit write scopes
- API keys missing required scopes receive 403
- correct scoped API keys succeed
- foreign accounts cannot cross tenant boundaries
- stable API never trusts caller-supplied account IDs
- experimental/admin-only routes are absent from the stable manifest
- manifest/API version is machine readable
- stable wrappers delegate into existing authoritative services rather than duplicating business logic

## Phase 8B — plugin/tool contract

After 8A is green, define registered tools with:

- schema
- permissions
- risk class
- rate limit
- deterministic validation
- audit requirements
- execution boundary

No arbitrary runtime code execution in the first plugin slice.

## Phase 8C — custom detectors

Allow registered deterministic detectors over bounded inputs.

Detector output must preserve:

- source evidence
- severity
- detector/version identity
- reproducibility

## Phase 8D — domain packs

Package:

- schemas
- detectors
- suggested watches
- entity vocabulary
- safe action templates
- UI metadata

without forking the core.

## Phase 8E — platform product surface

Expose:

- stable API reference
- API key/scopes
- registered tools
- detector/domain-pack inventory
- audit/usage state

## Phase 8 exit gate

Phase 8 is complete only when:

- external capabilities are versioned and permissioned
- plugins/tools cannot bypass core safety boundaries
- custom detectors preserve provenance/reproducibility
- domain packs extend behavior without core forks
- developer UI/docs reflect the real authoritative contracts
- cross-account and scope isolation are executable

## Current exact next work

**Phase 8A — audit and stable API manifest**

Audit current API-key/scopes + DeveloperPlatform + public routes. Then introduce the smallest authoritative stable API manifest and one read-only stable endpoint family before exposing mutation capabilities.
