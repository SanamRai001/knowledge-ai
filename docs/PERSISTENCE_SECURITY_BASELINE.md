# Knowledge AI — Persistence & Security Baseline

Status: **Phase 0D baseline**  
Last updated: **2026-09-17**

This document defines what may be committed to the repository, what is runtime state, how credentials are handled, and the persistence direction that later product phases must follow.

---

## 1. Core rule

**Source code, documentation, deterministic fixtures, and benchmark fixtures belong in Git. Mutable customer/application state does not.**

The repository must never be used as a database.

---

## 2. Current Phase 0 persistence reality

Knowledge AI still uses local JSON persistence for several prototype subsystems:

| Runtime file | Current owner | Classification |
| --- | --- | --- |
| `data/knowledge_bases.json` | `kbStore` | mutable workspace/KB/document/chat/evaluation state |
| `data/memory_learning.json` | `memoryStore` | mutable memory, experience, sandbox, learning, audit state |
| `data/api_keys.json` | `apiKeyStore` | mutable hashed/masked API-key metadata |
| `data/api_usage.json` | `apiKeyStore` | mutable API usage telemetry |

These files are **development/runtime persistence only**. They are not authoritative source files and must not be committed.

The stores recreate `data/` and their JSON state when needed, so a clean checkout does not depend on committed runtime state.

---

## 3. Repository boundary

### Allowed in Git

- application source code
- migration code
- schemas and repository interfaces
- documentation
- synthetic benchmark corpora
- deterministic test fixtures that are intentionally static
- sample/demo generation code
- `.env.example` containing variable names and non-secret examples only

### Forbidden in Git

- runtime knowledge bases
- uploaded company/customer documents
- chat history
- runtime memory or learned observations
- audit/event logs containing operational data
- API usage logs
- generated API-key metadata
- raw API/provider keys
- access tokens
- private keys/certificates
- local `.env` files
- database dumps from real environments

`.gitignore` now excludes the entire `data/` directory along with local environment and private-key file formats.

---

## 4. Credential rules

### Provider credentials

Provider credentials such as `GEMINI_API_KEY` must come from:

1. local `.env` during development, or
2. the deployment platform's secret manager/environment configuration.

They must never be persisted in application state, telemetry, memory, prompts, or Git.

### Knowledge AI application API keys

The current API-key subsystem follows the correct basic rule:

- plaintext secret is returned only when the key is created
- persisted key material is a one-way SHA-256 hash plus masked display metadata
- validation hashes the incoming secret and compares hashes

Even hashed/masked API-key metadata remains runtime state and therefore does not belong in Git.

---

## 5. CI enforcement

`scripts/check-secret-hygiene.mjs` operates on **tracked Git files**, not arbitrary local files.

It fails when it finds known raw credential patterns such as:

- Google API keys
- OpenAI/Anthropic-style keys
- GitHub tokens
- AWS access keys
- Slack tokens
- raw Knowledge AI `kn_live_*` / `kn_test_*` secrets
- private-key blocks

It also fails if known mutable runtime files under `data/` become tracked again.

The main Quality Gate runs:

```bash
npm run check:secret-hygiene
```

before TypeScript/build and the executable workspace-isolation proof.

This guard is a defense-in-depth regression check, not a substitute for platform secret scanning or credential rotation.

---

## 6. Git history caveat

Removing runtime files from the current branch prevents future commits from treating them as application source, but it **does not erase previous Git history**.

The previously committed runtime files observed during Phase 0 contained synthetic/test-heavy state and hashed/masked application-key metadata rather than plaintext application keys. Nevertheless:

- real customer/company data must never be placed in those stores in a public development repository
- if real sensitive data or a live raw credential is ever committed, the credential must be rotated immediately
- sensitive Git history must be rewritten using an appropriate repository-history cleanup process when required

Phase 0 does not claim that deleting a file from `main` erases historical commits.

---

## 7. Production persistence target

The current JSON stores are a prototype convenience. They are **not** the intended persistence architecture for the company-intelligence product.

The migration direction is:

```text
Application services
       ↓
Repository / storage boundaries
       ├── PostgreSQL / relational store
       │     accounts
       │     workspaces
       │     users / memberships / permissions
       │     knowledge-base metadata
       │     source/document metadata
       │     datasets and structured business entities
       │     insights / tasks / reminders
       │     versions / provenance
       │     evaluations
       │     audit metadata
       │
       ├── Object storage
       │     original PDFs / DOCX / XLSX / CSV / media
       │
       ├── Search / vector index
       │     chunks / embeddings / retrieval metadata
       │
       └── Analytics engine
             structured calculations / snapshots
```

### Important ownership invariant

Every durable user/business record must have an authoritative account/workspace ownership path. Tenant filtering must happen in repository/service queries, not only in UI state.

---

## 8. Migration order

Do not replace all stores at once.

Recommended order:

1. **Account/workspace + KB metadata**
2. **Source/document metadata**
3. **versions/provenance/evaluations**
4. **API-key metadata and usage/audit events**
5. **memory/experience state**
6. Phase 1 structured datasets/business entities

Original uploaded files should move to object storage rather than database JSON blobs.

Search/vector indexes should always be reconstructable from authoritative source metadata and original content.

---

## 9. Security invariants for future persistence adapters

Any future PostgreSQL/object/vector implementation must preserve these requirements:

- account/workspace ownership is mandatory
- foreign resource IDs return no data
- read and write isolation are both enforced
- retrieval indexes are scoped by tenant + knowledge base
- credentials are never logged or stored in learned memory
- destructive writes are auditable
- important business mutations preserve actor, timestamp, source, and previous/new state
- backups and exports must preserve tenant boundaries
- production secrets come from a secret manager/environment, never source control

---

## 10. Phase 0D exit criteria

Phase 0D is satisfied when:

- mutable `data/*.json` runtime state is no longer tracked
- `.gitignore` prevents it from being re-added accidentally
- local env/private-key files are ignored
- `.env.example` contains no fake/live credential value
- CI scans tracked files for common raw secret formats
- CI fails if known runtime data files become tracked again
- persistence classifications and the production migration target are documented
- the existing trust/security regression suite remains green

A full PostgreSQL migration is intentionally **not** a Phase 0 requirement. It belongs to the implementation work that follows this baseline and should happen incrementally behind service/repository boundaries.
