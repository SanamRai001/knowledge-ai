# Knowledge AI Platform API v1

Knowledge AI exposes one stable external developer contract at:

```text
/api/platform/v1
```

The older `/api/v1` routes remain a legacy compatibility surface. They are **not** the authoritative Phase 8 platform contract and should not be used to infer new stable capabilities.

## 1. Contract source of truth

The machine-readable manifest is available at:

```http
GET /api/platform/v1/manifest
```

It declares, per operation:

- operation ID
- API version
- method
- path
- capability family
- required scopes
- mutation flag
- risk class
- audit behavior
- rate-limit class
- stability

External clients should treat the manifest as authoritative rather than guessing permissions from route names.

## 2. Authentication

Protected operations use a Knowledge AI API key:

```http
Authorization: Bearer kn_live_...
```

or a test key:

```http
Authorization: Bearer kn_test_...
```

The account/tenant identity comes from the API key.

Caller-supplied account identifiers in headers, query strings, or request bodies do not change the authenticated account boundary.

## 3. Stable scope model

The current stable scopes are derived from the authoritative manifest and include capability-specific permissions such as:

```text
platform:sources:read
platform:knowledge:read
platform:ask:query
platform:insights:read
platform:actions:read
platform:actions:propose
platform:watch:read
platform:audit:read
platform:tools:read
platform:tools:invoke
platform:detectors:read
platform:detectors:write
platform:domain-packs:read
platform:domain-packs:write
```

A legacy scope such as `knowledge:read` does not automatically grant `platform:knowledge:read`.

Stable mutations require explicit write/proposal scopes.

## 4. Creating Platform API keys

The in-product **Developers** workspace uses an account-scoped management control plane:

```text
/api/platform-management
```

The UI:

1. reads allowed scopes from the stable manifest
2. lets the account choose explicit scopes
3. creates a scoped live/test key
4. shows the raw secret once
5. stores only the SHA-256 hash server-side
6. exposes only masked metadata afterward

The management API rejects scope strings that are not declared by the stable Platform manifest.

Normal Platform read keys do not automatically receive key-management authority.

## 5. Stable capability families

### Sources

Read account-scoped document/dataset source metadata.

### Knowledge

Read Living Company Knowledge summaries and entities using existing authoritative company-memory services.

### Ask

Run grounded questions through the same trusted Ask path used by the product.

### Insights

Read deterministic Discovery/Insight results.

### Actions

Stable action support is deliberately limited to:

- reading proposals
- creating a validated proposal

The stable API does **not** expose:

- confirmation
- direct execution
- Phase 7 automatic execution
- policy bypass

A proposal remains subject to the normal action safety/approval boundary.

### Watch

Read persisted Watch rules and alert episodes.

Recurring Watch execution continues to use stored deterministic rules rather than repeated LLM calls.

### Audit

Read normalized account-scoped activity/audit data.

### Tools

Registered tools are versioned, schema-bound, permissioned capabilities.

The first stable framework allows trusted built-in handlers only.

Tool invocation requires:

- `platform:tools:invoke`
- any tool-specific capability scopes

Tool inventory responses never include executable handler functions.

### Detectors

Registered detectors are deterministic, bounded analyses over authorized DatasetVersions.

Detector runs preserve:

- detector ID/version
- normalized config
- config hash
- dataset/version identity
- source hash
- calculation/evidence
- severity
- effective overlay provenance

Uploaded JavaScript, arbitrary SQL, shell execution, and generic HTTP execution are not part of the detector framework.

### Domain packs

Domain packs are declarative packages that can include:

- entity vocabulary
- registered detector templates
- suggestion-only Watch templates
- proposal-only Action templates
- UI metadata

A pack cannot silently activate Watches or auto-execute Actions.

## 6. Read-only API explorer

The in-product Developers workspace includes a bounded explorer.

It intentionally exposes only:

- stable manifest-declared `GET` operations
- parameter-free paths

It is **not** a generic REST client and does not expose arbitrary mutation requests from the browser.

Mutation examples remain documented and must be invoked deliberately by client code with the correct scopes.

## 7. Example: manifest

```bash
curl "https://your-domain.com/api/platform/v1/manifest"
```

## 8. Example: sources

```bash
curl "https://your-domain.com/api/platform/v1/sources" \
  -H "Authorization: Bearer kn_live_your_scoped_key"
```

Required scope:

```text
platform:sources:read
```

## 9. Example: Ask

```bash
curl -X POST "https://your-domain.com/api/platform/v1/ask" \
  -H "Authorization: Bearer kn_live_your_scoped_key" \
  -H "Content-Type: application/json" \
  -d '{"message":"Which customers currently owe the most?"}'
```

Required scope:

```text
platform:ask:query
```

## 10. Example: action proposal

```bash
curl -X POST "https://your-domain.com/api/platform/v1/actions/propose" \
  -H "Authorization: Bearer kn_live_your_scoped_key" \
  -H "Content-Type: application/json" \
  -d '{"instruction":"Suman paid another NPR 10,000 today."}'
```

Required scope:

```text
platform:actions:propose
```

This creates a proposal only. It does not confirm or execute the action.

## 11. Example: registered tools

```bash
curl "https://your-domain.com/api/platform/v1/tools" \
  -H "Authorization: Bearer kn_live_your_scoped_key"
```

Required scope:

```text
platform:tools:read
```

## 12. Example: detectors

```bash
curl "https://your-domain.com/api/platform/v1/detectors" \
  -H "Authorization: Bearer kn_live_your_scoped_key"
```

Required scope:

```text
platform:detectors:read
```

## 13. Example: domain packs

```bash
curl "https://your-domain.com/api/platform/v1/domain-packs" \
  -H "Authorization: Bearer kn_live_your_scoped_key"
```

Required scope:

```text
platform:domain-packs:read
```

## 14. Usage and audit

Authorized Platform API requests are recorded in the existing account-scoped API usage audit.

The Developers workspace exposes:

- request status
- endpoint
- latency
- timestamp
- aggregate request metrics

Registered tool invocation additionally records privacy-safe invocation audit data. Raw tool input is not persisted in that audit; a SHA-256 input hash is used instead.

## 15. Stable API safety boundaries

The stable contract intentionally excludes:

- experimental cognitive-engine internals
- mediator experiments
- sandbox/learning internals
- evaluation administration
- arbitrary shell/code execution
- arbitrary HTTP execution
- action confirmation
- automation execution
- integration OAuth credentials/tokens
- provider secrets
- direct source-authority bypass

These exclusions are part of the API contract, not missing documentation.

## 16. Extension principle

The platform should let developers add domain value without creating a second trust system.

Every extension must continue to respect:

```text
account identity
    ↓
scope / permission
    ↓
schema validation
    ↓
authoritative service boundary
    ↓
provenance / source authority
    ↓
audit
    ↓
existing Action / Watch safety rules
```

If an extension requires bypassing those layers, it does not belong in the stable platform contract.

## 17. Versioning

Current stable version:

```text
v1
```

Stable endpoints live under:

```text
/api/platform/v1
```

Breaking external contract changes should be introduced through an explicit new platform API version rather than silently changing the behavior of v1.
