# Knowledge AI — Phase 8 Progress

Last updated: **2026-09-19**

## Status

# 🚧 PHASE 8 IN PROGRESS

Phase 8 turns the mature product into an extensible platform without allowing extensions to bypass the trust, provenance, authorization, audit, Watch, Integration, or Controlled Automation boundaries built in Phases 0–7.

## Goal

> Let developers and domain extensions add value through stable governed contracts instead of reaching directly into internal stores and experimental modules.

## Execution slices

```text
8A Stable developer API + permission manifest           COMPLETE
8B Plugin/tool registration + execution contract        IN PROGRESS
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


## Phase 8A audit findings

The pre-existing developer API is retained as a legacy compatibility surface, not promoted to the new stable platform contract.

Findings:

- `ApiKey` already stores scopes and API keys are SHA-256 hashed at rest.
- legacy starter keys default to `chat:read`, `ai:read`, and `knowledge:read`.
- the older inline `/api/v1` authentication helper validates Bearer keys and applies a flat 100 requests/minute rate limit.
- the legacy helper does not make per-operation scopes authoritative.
- the existing DeveloperPlatform UI is specialized-AI-centric and still describes the older Phase 3 API.
- authoritative product capabilities now live behind account-scoped Phase 0–7 service/router boundaries.

### Stable namespace decision

Phase 8 uses a separate stable namespace:

`/api/platform/v1`

This avoids silently changing the meaning of existing `/api/v1` clients.

New stable scopes use a separate `platform:*` namespace. Legacy scopes do not grant stable platform access automatically.

### Initial stable manifest

The first stable contract contains:

- Sources metadata
- Knowledge summary/entities
- Ask
- Insights read
- Actions read
- Actions **proposal creation only**
- Watch rules/alerts read
- Audit/activity read

Action confirmation and Phase 7 automation execution are intentionally absent.

### Stable authorization boundary

Every protected platform operation is declared in one machine-readable permission manifest with:

- operation ID
- API version
- HTTP method/path
- capability family
- required scopes
- mutation flag
- risk classification
- audit behavior
- rate-limit class
- stability state

The manifest drives scoped authorization and rate limiting.

## Current verification target

Quality Gate must prove:

- unique operation IDs and method/path pairs
- all stable mutations require explicit proposal/write scopes
- legacy scopes receive 403
- correct platform scopes succeed
- API-key account identity overrides caller-supplied account/query/header values
- foreign raw resource IDs remain inaccessible
- stable action proposal creation does not write company state
- no stable confirm/execute route exists
- authorized platform requests are included in API usage audit
- experimental/admin/automation/internal routes remain absent from the stable manifest


## Phase 8A verification

Quality Gate `35429943049` passed the stable developer API foundation.

Verified:

- dedicated stable namespace: `/api/platform/v1`
- machine-readable stable API manifest
- unique operation IDs
- unique method/path pairs
- every stable operation declares family, scopes, mutation flag, risk, audit behavior, rate-limit class, and stability
- new `platform:*` scopes are independent from legacy Phase 3 API scopes
- legacy `chat:read` / `ai:read` / `knowledge:read` keys receive 403 on the new stable API
- correct platform scopes succeed
- API-key account identity is authoritative
- caller-supplied account headers/query values do not change tenant scope
- foreign raw resource IDs remain inaccessible
- stable Sources / Knowledge / Ask / Insights / Actions / Watch / Audit wrappers delegate existing Phase 0–7 services/stores
- stable action mutation is limited to proposal creation
- no stable action-confirm or automation-execute operation exists
- action proposal creation does not mutate effective company state
- authorized stable requests are captured in API usage audit
- experimental/admin routes are absent from the stable manifest
- TypeScript, production build, all Phase 0–7 gates, unseen benchmark, and live Gemini benchmark remain green

### Legacy API decision

The pre-existing `/api/v1` API remains a compatibility surface.

It is not the authoritative Phase 8 platform contract and is not silently granted new capabilities.

## Current exact next work

**Phase 8B — registered tool framework**

1. define a stable registered-tool descriptor and bounded input schema
2. define tool risk, scopes, rate class, audit behavior, and execution mode
3. implement a server-side tool registry with unique ID/version enforcement
4. allow only trusted built-in handlers in the first slice
5. validate tool input before handler execution
6. require both generic tool-invoke scope and tool-specific capability scopes
7. route handlers through existing Phase 0–7 authoritative services
8. expose tool inventory + invoke through the stable platform API
9. add executable tests proving no arbitrary-code / direct-write bypass
10. only then proceed to custom detector registration
