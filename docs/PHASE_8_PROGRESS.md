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
8B Plugin/tool registration + execution contract        COMPLETE
8C Custom detector framework                            COMPLETE
8D Domain-pack packaging                                COMPLETE
8E Platform UI/docs + final Phase 8 audit              IN PROGRESS
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


## Phase 8B verification

Quality Gate `35432530926` passed the registered-tool framework.

Verified:

- versioned stable registered-tool descriptors
- closed input schemas with `additionalProperties: false`
- trusted built-in execution mode only
- unique dotted tool IDs
- generic `platform:tools:invoke` permission required
- tool-specific capability scopes required in addition to generic invoke
- legacy/read scopes do not imply invocation authority
- tool inventory never exposes handler functions
- registry rejects arbitrary/non-built-in execution modes
- registered handlers delegate existing Phase 0–7 services
- account identity comes from the API key, not caller-supplied fields/headers
- foreign raw resource IDs remain inaccessible
- unknown arbitrary tools fail closed
- the only mutation tool is proposal-only `actions.propose`
- proposal tool cannot confirm, execute, auto-execute, or mutate company state
- input validation rejects caller-supplied `accountId`
- invocation audit persists a SHA-256 input hash rather than raw tool input
- stable tool inventory/invoke/audit routes are declared in the platform manifest
- structural CI guard rejects confirm/execute/automation/shell/eval/arbitrary-code operation IDs/paths/tool IDs without false positives from documentation prose
- TypeScript, production build, all Phase 0–8A gates, unseen benchmark, and live Gemini benchmark remain green

## Current exact next work

**Phase 8C — custom detector framework**

1. define a registered deterministic detector descriptor with detector ID/version, source type, config schema, output/evidence contract, stability, and execution mode
2. keep first-slice handlers trusted built-ins only; no uploaded JavaScript, eval, shell, SQL, arbitrary HTTP, or runtime code
3. validate detector config through a closed schema
4. execute detectors only against account-authorized DatasetVersions
5. reuse the existing effective Dataset overlay before measurement
6. persist results through the existing DiscoveryStore / Insight model
7. preserve dataset/version/source hash, detector ID/version, calculation, rows, severity, and reproducibility config hash
8. expose detector inventory + run through the stable platform API with dedicated scopes
9. add executable tests for deterministic replay, provenance, scope/account isolation, unknown detector denial, and arbitrary-code denial
10. only after that proceed to Phase 8D domain packs


## Phase 8C verification

Quality Gate `35432753760` passed the registered deterministic detector framework.

Verified:

- versioned registered detector descriptors
- trusted built-in detector handlers only
- DATASET-only execution boundary for the first detector slice
- closed detector config schemas
- arbitrary execution modes are rejected
- stable detector inventory + run operations
- dedicated `platform:detectors:read` and `platform:detectors:write` scopes
- detector run is treated as an explicit analysis mutation because it persists Insights
- Dataset/account authorization occurs before execution
- explicit DatasetVersion selection is supported
- effective confirmed-state overlays are applied before measurement
- historical imported DatasetVersions remain immutable
- normal DiscoveryStore / Insight persistence is reused
- detector ID/version, normalized config, SHA-256 config hash, dataset/version/source hash, calculation, severity, row evidence, and overlay provenance are preserved
- equivalent normalized config replays to the same deterministic fingerprint/Insight episode
- changed config produces a different reproducibility hash/fingerprint
- arbitrary/unknown detector IDs fail closed
- caller-supplied account fields/headers cannot cross tenant boundaries
- TypeScript, production build, all Phase 0–8B gates, unseen benchmark, and live Gemini benchmark remain green

## Current exact next work

**Phase 8D — declarative domain packs**

1. define a versioned declarative DomainPack descriptor
2. package registered detector templates, suggested Watch templates, entity vocabulary, safe action proposal templates, and UI metadata
3. keep packs data-only in the first slice: no handlers, JavaScript, shell, SQL, arbitrary HTTP, or runtime code
4. validate every detector reference against the registered detector registry
5. validate every action template as proposal-only and every Watch template as non-activated suggestion
6. add account-scoped pack installation state without forking core schemas/services
7. let a pack run its registered detector templates only through DetectorExecutionService
8. expose pack inventory/installations/template-run through stable scoped platform operations
9. prove pack installation/run is tenant isolated and cannot auto-execute Actions or silently activate Watches
10. then proceed to Phase 8E platform UI/docs + final Phase 8 audit


## Phase 8D verification

Quality Gate `35433062179` passed the declarative domain-pack framework.

Verified:

- versioned declarative DomainPack descriptors
- data-only `executionMode: DECLARATIVE`
- entity vocabulary packaging
- registered detector templates with exact detector/version references
- detector override allowlists validated against registered detector schemas
- suggestion-only Watch templates
- proposal-only Action templates
- account-scoped installation persistence
- idempotent same-account pack installation
- detector templates execute only through DetectorExecutionService
- domain packs contain no executable handlers/functions/runtime code
- structural CI guard rejects executable fields/modes without false positives from normal metadata such as `evaluationMode`
- stable `platform:domain-packs:read` / `platform:domain-packs:write` scopes
- stable inventory/install/template-run API contracts
- foreign raw Dataset IDs remain inaccessible
- caller-supplied account headers do not change tenant identity
- installing/running a pack does not create Action proposals
- installing/running a pack does not silently activate Watch rules
- TypeScript, production build, all Phase 0–8C gates, unseen benchmark, and live Gemini benchmark remain green

### First built-in domain pack

`inventory.operations@1.0.0` packages:

- PRODUCT / SUPPLIER vocabulary
- registered `inventory.fixed-low-stock@1.0.0` detector template
- suggestion-only per-product CURRENT_STOCK Watch template
- proposal-only RECEIVE_INVENTORY action wording template
- inventory UI metadata

## Current exact next work

**Phase 8E — Platform UI/docs + final Phase 8 audit**

1. replace the legacy Specialized-AI developer screen with the real stable Platform API surface
2. expose manifest/scopes and clearly distinguish `/api/platform/v1` from legacy `/api/v1`
3. support explicit scoped API-key creation
4. expose registered tools, detectors, and domain-pack descriptors without handlers
5. provide a bounded read-only API explorer rather than a generic arbitrary mutation client
6. expose existing account API usage/audit
7. add a Phase 8E UI contract proof
8. run the full integrated Quality Gate
9. create `docs/PHASE_8_FINAL_AUDIT.md`
10. mark Phase 8 complete only after the integrated gate is green
