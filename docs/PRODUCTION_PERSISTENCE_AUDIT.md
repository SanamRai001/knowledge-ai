# Knowledge AI — Production Persistence Forensic Audit

Date: **2026-09-19**

## Verdict

# ✅ A1 COMPLETE — DO NOT MIGRATE THE CURRENT JSON FILES 1:1

Knowledge AI has mature product behavior, but authoritative mutable state is still fragmented across subsystem-specific JSON files plus several in-memory stores.

The first PostgreSQL migration should **not** copy those JSON shapes directly into relational tables.

Two examples make that unsafe:

1. `knowledge_bases.json` combines workspace metadata, active selection, parsed document pages, version snapshots, chat history, AI configuration, evaluation cases, and evaluation runs.
2. `datasets.json` combines Dataset metadata with full DatasetVersion table schemas **and every cell/row** used by deterministic analytics.

The first relational slice should establish **tenant/workspace identity, API credentials, and Dataset metadata/version identity**, while heavy document/table payloads remain behind existing repositories until their storage design is migrated deliberately.

---

# 1. Persistence inventory

| Store | Current persistence | Main records | Account scoped? | Classification |
|---|---|---|---|---|
| `KnowledgeBaseStore` | `data/knowledge_bases.json` | workspaces, documents, KB versions, chat, AI config, eval data | methods are account scoped | **SPLIT: first metadata, payload later** |
| `ApiKeyStore` | `data/api_keys.json`, `data/api_usage.json` | API keys, usage | yes | **A2 relational-first** |
| API rate-limit buckets | memory | request timestamps | key scoped | **ephemeral/distributed later** |
| `DatasetStore` | `data/datasets.json` | Dataset, DatasetVersion, full tables/rows, import runs | yes | **SPLIT: metadata first, payload later** |
| `CompanyKnowledgeStore` | `data/company-knowledge.json` | entities, relationships, claims, events, projection runs | yes | **relational-next / high** |
| `DiscoveryStore` | `data/discovery.json` | AnalysisRuns, Insights | yes | **relational-next** |
| `ActionStore` | `data/company-actions.json` | proposals, executions, audit | yes | **relational-next / transaction-critical** |
| `WatchStore` | `data/watch.json` | drafts, rules, evaluations, alerts, jobs | yes | **relational-next / worker-critical** |
| `IntegrationStore` | `data/integrations.json` | connections, SyncRuns, import mappings | yes | **relational-next / checkpoint-critical** |
| `IntegrationCredentialStore` | `data/integration_credentials.json` encrypted | OAuth credential blobs | yes/provider | **secret/KMS** |
| Google OAuth state | memory | state/expiry/account | yes | **ephemeral/distributed later** |
| Microsoft OAuth state | memory | state/PKCE/expiry | yes | **ephemeral/distributed later** |
| `AutomationPolicyStore` | `data/automation-policies.json` | policy + revisions | yes | **relational-next / high** |
| `AutomationApprovalStore` | `data/automation-approvals.json` | approvals | yes | **relational-next / high** |
| `AutomationRunStore` | `data/automation-runs.json` | runs/recovery | yes | **relational-next / high** |
| `AutomationControlStore` | `data/automation-control.json` | kill switch/control + revisions | yes | **relational-next / very high** |
| `DomainPackInstallationStore` | `data/platform_domain_packs.json` | pack installations | yes | **relational-later** |
| `ToolInvocationAuditStore` | `data/platform_tool_invocations.json` | invocation audit | yes | **relational-later/audit** |
| `MemoryStore` | `data/memory_learning.json` | memory, experiences, sandbox/learning state | yes in APIs | **experimental/legacy later** |
| RAG telemetry | memory | traces | ephemeral | **observability backend later** |
| Cognitive telemetry | memory | traces | ephemeral | **observability backend later** |
| Mediator telemetry | memory | spans/events/alerts | ephemeral | **observability backend later** |

---

# 2. Highest-risk findings

## 2.1 Active workspace selection is global, not truly per account

`KnowledgeBaseStore` persists one `activeKbId` for the whole process/store.

`getActiveKB(accountId)` safely refuses to return another account's workspace and falls back to the first workspace owned by that account, so isolation is preserved. But `setActiveKB()` still changes one global active ID.

That means one account's switch can erase another account's chosen active-workspace preference.

### Relational fix

Persist active selection per account:

```text
account_workspace_state
  account_id PK/FK
  active_workspace_id FK
  updated_at
```

Do not carry the single global `activeKbId` model into PostgreSQL.

## 2.2 KnowledgeBase is an overloaded aggregate

A current `KnowledgeBase` embeds:

- workspace identity/name/description
- complete logical versions
- complete document records and parsed pages
- chat history
- SpecializedAI configuration
- evaluation test cases/runs
- processing state

`KnowledgeVersion.documents` may duplicate full document records again for snapshots.

### Decision

Do **not** create one PostgreSQL `knowledge_bases jsonb` table and call the migration complete.

A2 should migrate only workspace identity/state needed for tenancy and routing. Document/source/version payload design belongs to object/source hardening later.

## 2.3 Dataset metadata and analytical payload are coupled

`DatasetVersion` contains source metadata plus:

```text
tables[]
  columns[]
  rows[][]
```

The deterministic analytics engine directly calls `datasetStore.getCurrentVersion()` / `getVersion()` and consumes those rows.

That path also feeds overlays, Discovery, Watch, integrations, and Phase 8 detectors.

### Decision

The first PostgreSQL slice should relationalize Dataset identity, DatasetVersion identity/source metadata, current-version pointer, and ImportRun metadata — **not all cells/rows**.

Keep version payload retrieval behind a separate repository compatible with today's `DatasetVersion` shape. A later measured decision can move payloads to PostgreSQL, Parquet/DuckDB/object storage, or another analytical backend.

## 2.4 API keys are a strong first migration target

API keys have a clean relational shape and are immediately production-critical because request identity and stable Platform API auth depend on them.

### Decision

API keys belong in the first relational vertical slice. Raw secrets remain one-time only; only SHA-256 hashes/masked metadata are stored.

---

# 3. Recommended first relational vertical slice

The refined A2 scope is:

```text
accounts
workspaces
account_workspace_state
api_keys
api_usage
datasets
dataset_versions metadata
dataset_import_runs
```

Do **not** migrate yet:

- document page bodies
- KnowledgeVersion document snapshots
- chat history
- DatasetTable rows
- company knowledge
- Actions
- Watch
- integrations
- automation
- integration OAuth secrets

These follow after the repository pattern and transactional backbone are proven.

---

# 4. Initial PostgreSQL schema direction

This is the logical A2 contract; migration SQL is the next task.

## 4.1 accounts

```sql
accounts (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

Existing account IDs, including `acc_default`, must be preserved.

## 4.2 workspaces

```sql
workspaces (
  id text primary key,
  account_id text not null references accounts(id),
  name text not null,
  description text,
  processing_status text not null,
  current_version_tag text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (account_id, id)
)
```

This stores workspace metadata only.

## 4.3 account_workspace_state

```sql
account_workspace_state (
  account_id text primary key references accounts(id),
  active_workspace_id text,
  updated_at timestamptz not null
)
```

Use a composite ownership constraint so the active workspace must belong to the same account.

## 4.4 api_keys

```sql
api_keys (
  id text primary key,
  account_id text not null references accounts(id),
  name text not null,
  key_prefix text not null,
  key_hash char(64) not null unique,
  masked_key text not null,
  environment text not null check (environment in ('live','test')),
  scopes text[] not null,
  status text not null check (status in ('active','revoked')),
  created_at timestamptz not null,
  last_used_at timestamptz,
  expires_at timestamptz
)
```

## 4.5 api_usage

```sql
api_usage (
  id text primary key,
  request_id text not null,
  api_key_id text references api_keys(id),
  account_id text not null references accounts(id),
  ai_id text not null,
  endpoint text not null,
  occurred_at timestamptz not null,
  status integer not null,
  latency_ms integer not null,
  refused boolean not null,
  grounded boolean not null,
  error_code text
)
```

## 4.6 datasets

```sql
datasets (
  id text primary key,
  account_id text not null references accounts(id),
  name text not null,
  description text,
  current_version_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (account_id, id)
)
```

## 4.7 dataset_versions

```sql
dataset_versions (
  id text primary key,
  dataset_id text not null references datasets(id),
  version_number integer not null,
  created_at timestamptz not null,
  source_filename text not null,
  source_mime_type text not null,
  source_size_bytes bigint not null,
  source_sha256 char(64) not null,
  source_format text not null check (source_format in ('CSV','XLSX')),
  import_run_id text not null,
  payload_backend text not null,
  payload_ref text not null,
  unique (dataset_id, version_number),
  unique (dataset_id, id)
)
```

For the hybrid first migration, metadata points to a payload repository. Do not embed `rows[][]` in this metadata row.

## 4.8 dataset_import_runs

```sql
dataset_import_runs (
  id text primary key,
  account_id text not null references accounts(id),
  status text not null,
  created_at timestamptz not null,
  completed_at timestamptz,
  filename text not null,
  format text not null,
  warnings jsonb not null default '[]',
  error text
)
```

---

# 5. A2 repository contracts

Business/domain services should not import a PostgreSQL client directly.

## AccountRepository

```ts
interface AccountRepository {
  ensureAccount(accountId: string): Promise<AccountRecord>;
  getAccount(accountId: string): Promise<AccountRecord | null>;
}
```

## WorkspaceMetadataRepository

```ts
interface WorkspaceMetadataRepository {
  list(accountId: string): Promise<WorkspaceMetadata[]>;
  get(accountId: string, workspaceId: string): Promise<WorkspaceMetadata | null>;
  create(input: CreateWorkspaceMetadata): Promise<WorkspaceMetadata>;
  update(accountId: string, workspaceId: string, patch: WorkspaceMetadataPatch): Promise<WorkspaceMetadata>;
  delete(accountId: string, workspaceId: string): Promise<void>;
  getActive(accountId: string): Promise<string | null>;
  setActive(accountId: string, workspaceId: string): Promise<void>;
}
```

This repository deliberately does not own parsed documents, chats, evaluation bodies, or document snapshots.

## ApiKeyRepository

```ts
interface ApiKeyRepository {
  create(record: ApiKey): Promise<void>;
  findByHash(keyHash: string): Promise<ApiKey | null>;
  get(accountId: string, keyId: string): Promise<ApiKey | null>;
  list(accountId: string): Promise<ApiKey[]>;
  revoke(accountId: string, keyId: string): Promise<boolean>;
  touchLastUsed(keyId: string, at: number): Promise<void>;
}
```

`findByHash` cannot require a caller-provided account because the key itself establishes account identity.

## ApiUsageRepository

```ts
interface ApiUsageRepository {
  record(entry: ApiUsage): Promise<void>;
  stats(accountId: string, limit?: number): Promise<ApiUsageStats>;
}
```

## DatasetMetadataRepository

```ts
interface DatasetMetadataRepository {
  list(accountId: string): Promise<Dataset[]>;
  get(accountId: string, datasetId: string): Promise<Dataset | null>;
  create(dataset: Dataset): Promise<void>;
  updateCurrentVersion(accountId: string, datasetId: string, versionId: string): Promise<void>;
  appendVersionMetadata(accountId: string, version: DatasetVersionMetadata): Promise<void>;
  getVersionMetadata(accountId: string, datasetId: string, versionId: string): Promise<DatasetVersionMetadata | null>;
  listVersions(accountId: string, datasetId: string): Promise<DatasetVersionMetadata[]>;
}
```

## DatasetPayloadRepository

```ts
interface DatasetPayloadRepository {
  put(version: DatasetVersion): Promise<DatasetPayloadLocator>;
  get(locator: DatasetPayloadLocator): Promise<DatasetVersion>;
  delete?(locator: DatasetPayloadLocator): Promise<void>;
}
```

A2 may keep the current file-backed payload implementation. Later storage changes should not force analytics/domain logic to change.

---

# 6. Compatibility and migration strategy

Do not big-bang switch.

## Step 1 — repository interfaces

Introduce repository interfaces with existing file stores as adapters. No behavior change.

## Step 2 — PostgreSQL schema + migration runner

Add versioned migrations, validated database config, connection pool, and transaction helper. Normal runtime may still use file adapters when PostgreSQL is not configured during the transition.

## Step 3 — legacy metadata importer

Provide explicit commands such as:

```bash
npm run db:migrate
npm run db:import-legacy -- --dry-run
npm run db:import-legacy
```

Importer requirements:

- idempotent
- dry-run capable
- count reporting
- conflict reporting
- preserve existing IDs
- non-destructive to source JSON

## Step 4 — validation window

Compare relational metadata against file state and fail/report mismatches.

Avoid indefinite dual-write ambiguity.

## Step 5 — bounded cutover order

1. API keys
2. workspace metadata + per-account active selection
3. Dataset metadata/import-run metadata
4. Dataset payload boundary cleanup
5. then Company Knowledge / Actions / Watch

---

# 7. Cross-store dependency risks

## API keys

Consumers include request identity, Platform auth, developer management, legacy API auth, rate limiting, and usage audit.

Current authentication is synchronous. A PostgreSQL repository will likely be asynchronous.

A2 must choose deliberately between:

1. async auth middleware backed directly by PostgreSQL, or
2. a bounded revocation-aware cache backed by PostgreSQL.

Do not load every key into process memory as the new source of truth.

## Workspaces

Workspace metadata and payload are currently one object.

A2 should compose:

```text
WorkspaceMetadataRepository
        +
legacy WorkspacePayloadStore
        ↓
WorkspaceAccessService / aggregate
```

This permits relational metadata without forcing PDF/chat/evaluation migration in the same commit.

## Datasets

Dataset consumers include analytics, overlays, Discovery, Living Knowledge projection, Watch, integrations, and Phase 8 detectors.

The analytics engine directly imports `datasetStore`, so A2 should introduce a `DatasetVersionResolver`/repository boundary before changing storage.

This is the highest coupling risk in the first slice.

---

# 8. Migration order after A2

## A3 — Living Knowledge + Actions

- CompanyEntity
- CompanyRelationship
- KnowledgeClaim
- BusinessEvent
- KnowledgeProjectionRun
- ActionProposal
- ActionExecution
- ActionAuditEntry

Reason: confirmed company state and Action execution need a real transaction boundary.

## A4 — Watch + Integrations

- WatchDraft
- WatchRule
- WatchEvaluation
- WatchAlert
- WatchJob
- IntegrationConnection metadata
- SyncRun
- ExternalImportState

Reason: job leases, idempotency, and provider checkpoints need atomic DB semantics.

OAuth secret bytes remain outside normal relational tables.

## A5 — Automation + Platform state

- AutomationPolicy + revisions
- AutomationApproval
- AutomationRun
- AutomationControl + revisions
- DomainPackInstallation
- ToolInvocationAudit

The AutomationControl kill switch should be prioritized early inside this group.

---

# 9. Deferred/separate-track state

## Memory/Learning Lab

`memory_learning.json` is a mixed older experimental/learning domain. Keep it out of the first production schema until product ownership is revisited.

## Telemetry

RAG/cognitive/mediator telemetry is ephemeral. Move it toward a production observability backend, not ordinary transactional domain tables.

## OAuth state

Use a distributed TTL/nonce store when multi-replica auth is introduced.

## OAuth credentials

Move encrypted OAuth material to KMS/secret manager. PostgreSQL should hold opaque references/metadata only.

---

# 10. Early relational integrity rules

PostgreSQL should add constraints JSON files cannot enforce:

- API key hash unique globally
- workspace belongs to exactly one account
- active workspace belongs to the same account
- Dataset belongs to exactly one account
- DatasetVersion belongs to one Dataset
- Dataset version number unique per Dataset
- current version belongs to the same Dataset
- later: integration idempotency keys unique
- later: Action/Watch job fingerprints unique

Tenant isolation must still exist in every repository query. Database constraints are defense-in-depth, not authorization replacements.

---

# 11. Timestamp, ID, and numeric policy

## Timestamps

Current domain types use epoch milliseconds. PostgreSQL should store `timestamptz`; adapters can convert epoch-ms ↔ timestamptz initially.

## IDs

Preserve current string IDs during migration. Existing IDs are part of provenance and cross-store references.

## Money/numerics

Do not use floating-point database columns for exact monetary state. Use integer minor units where semantics support it or PostgreSQL `numeric`. Do not blindly convert arbitrary imported analytical decimals to cents.

---

# 12. What not to do

Do not:

- replace every JSON file with one `jsonb` column and call it relational persistence
- move parsed PDFs into ordinary relational rows before object/source design is ready
- normalize every Dataset cell into PostgreSQL just because PostgreSQL is introduced
- make every store async in one giant refactor
- remove file adapters before importer/validation tooling exists
- put OAuth refresh tokens into ordinary application tables
- add Redis/Kafka/queues before measured worker requirements justify them
- silently drop `acc_default` state during later real-auth migration

---

# 13. Exact next milestone

# Production Hardening A2 — PostgreSQL foundation + repository contracts

## A2.1 Infrastructure

Add:

- PostgreSQL driver
- validated `DATABASE_URL` configuration
- database pool module
- transaction helper
- versioned migration runner
- development fallback to legacy adapters during transition

## A2.2 Migration 001

Create:

- `accounts`
- `workspaces`
- `account_workspace_state`
- `api_keys`
- `api_usage`
- `datasets`
- `dataset_versions` metadata
- `dataset_import_runs`

No heavy document/table payload tables in migration 001.

## A2.3 Repository contracts

Implement the interfaces defined above with:

```text
legacy/file adapter
postgres adapter
```

## A2.4 Legacy importer

Import only A2 metadata and preserve IDs.

## A2.5 Executable proof

CI must verify:

1. empty database migrations succeed
2. migration versioning is repeatable
3. legacy fixture metadata imports without changing IDs
4. API key hash/account ownership survives import
5. raw API secrets are absent
6. active workspace selection persists independently per account
7. account A cannot query/update account B workspace/key/dataset metadata
8. Dataset current-version constraints cannot point across datasets
9. compatibility payloads remain readable
10. all Phase 0–8 gates remain green

---

# A1 exit decision

The forensic audit has identified the persistence boundaries and the smallest safe relational vertical slice.

The correct next action is **not** a full-store conversion.

It is:

> Build PostgreSQL migration/repository infrastructure for account/workspace identity, API keys, and Dataset metadata while preserving current document/table payload behavior behind adapters.

# A1 status: ✅ COMPLETE

Next: **Production Hardening A2 — PostgreSQL foundation + repository contracts.**
