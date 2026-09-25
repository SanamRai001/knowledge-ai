# Production F2 — Integration OAuth SecretStore Foundation + Migration

Status: **COMPLETE** — authoritative implementation Quality Gate `36147480475`.

## Goal

F2 removes Google Drive and Microsoft OneDrive OAuth credential bundles from the Node-local encrypted file boundary and moves them behind the provider-neutral `SecretStore` / `KmsService` contracts defined in F1.

F2 is intentionally limited to account-scoped Integration OAuth credentials.

It does not migrate deployment secrets or one-way credentials.

## Durable secret schema

Added:

`server/persistence/migrations/019_account_secret_store.sql`

Tables:

- `account_secrets`
- `account_secret_versions`
- `account_secret_audit_events`

### account_secrets

Stores only non-secret metadata:

- opaque secret ID
- account
- purpose
- provider
- lifecycle status
- current secret version
- created/updated/revoked/deleted timestamps

### account_secret_versions

Stores versioned encrypted envelopes:

- account
- secret ID
- version
- KMS key ID
- envelope algorithm
- ciphertext
- version status
- created/retired timestamps

It does **not** expose OAuth token fields as relational columns.

### account_secret_audit_events

Durably records:

- CREATE
- READ
- ROTATE
- REVOKE
- DELETE
- MIGRATE

Audit rows contain metadata/outcomes/error codes only.

They never contain:

- access tokens
- refresh tokens
- OAuth client secrets
- raw encryption keys

## KMS boundary

Added:

`server/security/versionedAesGcmKmsService.ts`

Current provider-neutral implementation:

- AES-256-GCM
- random 12-byte IV
- authenticated encryption
- versioned key IDs
- deployment-injected keyring
- encryption-context binding through GCM AAD

Required runtime configuration:

- `KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID`
- `KNOWLEDGE_AI_SECRET_KEYRING_JSON`

Each keyring value must decode to exactly 32 bytes.

Encryption context binds ciphertext to:

- accountId
- secretId
- purpose
- provider
- secret version

A captured ciphertext cannot be decrypted under another account/provider/version context.

## Key rotation

The envelope stores the key ID used for each secret version.

This allows:

1. deploy a new key alongside old keys
2. switch the active key ID
3. rotate/re-encrypt secrets
4. verify active versions use the new key
5. remove retired key material only after no active secret requires it

OAuth reauthorization is not required merely because the deployment encryption key rotates.

## Shared SecretStore

Added:

`server/security/postgresSecretStore.ts`

Properties:

- account-scoped lookup
- purpose-scoped lookup
- provider-scoped lookup
- versioned rotation
- revoke/delete lifecycle
- durable security audit events
- row locking for rotation/revocation/deletion
- stale unreferenced OAuth-secret reconciliation
- stable opaque secret references
- shared PostgreSQL visibility across web and worker replicas

Cross-account reads return scoped `SECRET_NOT_FOUND`.

Cross-provider reads return `SECRET_SCOPE_MISMATCH`.

## Integration runtime boundary

Added:

`server/integrations/integrationOAuthSecretRuntime.ts`

In file-mode development:

- existing `IntegrationCredentialStore` behavior remains available

In PostgreSQL mode:

- create -> shared SecretStore
- get -> shared SecretStore
- update/token refresh -> SecretStore rotation under the same credentialRef
- delete -> shared SecretStore deletion
- old file credentials -> safe read-through migration

Google Drive / OneDrive OAuth services and connectors no longer depend directly on the file credential store.

## Web + worker shared resolution

The same opaque `credentialRef` can be resolved by independent web and worker runtime instances through PostgreSQL.

This preserves the E4 Integration worker model:

- generic worker payload carries connection/principal IDs
- worker resolves `credentialRef` server-side
- worker decrypts only when provider work needs it
- token refresh rotates the shared secret
- other replicas immediately resolve the new active version

No raw OAuth token enters worker payload metadata.

## Stable-ref token refresh

Provider refresh preserves the same opaque credentialRef.

A token refresh:

1. resolves current secret
2. calls provider token endpoint
3. builds updated token bundle
4. writes a new encrypted secret version
5. retires the previous encrypted version
6. advances current_version atomically

This means ordinary `IntegrationConnection` metadata does not need to change on each access-token refresh.

## Legacy read-through migration

Legacy encrypted file:

`data/integration_credentials.json`

Legacy key:

`INTEGRATION_CREDENTIAL_KEY`

Migration behavior:

1. shared SecretStore lookup runs first
2. if missing, legacy record is resolved in the same account/provider scope
3. the existing credentialRef is imported into PostgreSQL unchanged
4. shared SecretStore read is verified
5. only then is the old file record deleted
6. subsequent reads no longer require `INTEGRATION_CREDENTIAL_KEY`

Cross-account or cross-provider misses remain denied and are not converted into broader legacy access.

The legacy key is now migration-only and may be removed after all legacy records are migrated.

## Crash-safety / cleanup

F2 preserves truthful ordering around OAuth connect/reauthorize flows.

A newly created shared secret may exist briefly before connection metadata points to it.

To recover from that crash window, the SecretStore can reconcile old unreferenced Integration OAuth secrets.

Important behavior:

- attached secrets are never swept
- stale unattached OAuth secrets can be deleted
- reauthorization preserves the currently attached secret if replacement cleanup fails
- cleanup failure does not falsely claim credential destruction

## Ordinary Integration metadata remains non-secret

`IntegrationConnection` continues to contain only an opaque `credentialRef`.

Public connection serialization strips that reference and exposes only:

- `hasCredential`
- ordinary non-secret connection metadata
- sync health/status

The F2 PostgreSQL proof verifies token plaintext does not appear in:

- `integration_connections`
- secret audit metadata
- secret metadata columns
- worker payloads
- API/public connection output

Encrypted ciphertext exists only in `account_secret_versions`.

## Worker startup boundary

The dedicated worker now verifies the shared secret schema exists when PostgreSQL runtime is enabled.

This prevents a worker from starting into a deployment where E4 Integration jobs can run but the F2 secret backend is unavailable.

## Deployment-secret boundary remains unchanged

F2 does **not** move these into account SecretStore:

- `DATABASE_URL`
- `GEMINI_API_KEY`
- S3/object-storage credentials
- Google OAuth application client secret
- Microsoft OAuth application client secret
- bootstrap token
- password/session/API-key hashes

Those remain deployment-injected or one-way hashed according to F1.

## Cloud KMS / Secret Manager note

F2 intentionally does not hard-code:

- AWS Secrets Manager/KMS
- Google Secret Manager/KMS
- Azure Key Vault

The production runtime now depends only on the provider-neutral `SecretStore` / `KmsService` boundary.

The current shared backend is PostgreSQL metadata/ciphertext plus a deployment-injected versioned AES-GCM keyring.

A cloud-vendor KMS adapter can replace the KMS implementation later when the deployment target is selected without changing IntegrationConnection or OAuth callers.

## Executable proofs

### Contract proof

`scripts/check-production-f2-integration-oauth-secret-store-contract.ts`

Verifies:

- secret metadata/version/audit schema
- no OAuth plaintext columns
- versioned KMS configuration
- encryption-context use
- SecretStore contract implementation
- stable-ref rotation
- legacy read-through hooks
- Google/OneDrive caller cutover
- public credentialRef redaction
- worker shared-secret schema dependency
- vendor-neutral package boundary

### PostgreSQL proof

`scripts/check-production-f2-integration-oauth-secret-store-postgres.ts`

Verifies:

- shared web/worker replica resolution
- cross-account denial
- cross-provider denial
- ciphertext-only relational storage
- stable-ref token rotation
- secret-version retirement
- deployment key rotation without OAuth reauthorization
- provider connector refresh through shared runtime
- refreshed token visibility across replicas
- one-time legacy file migration preserving credentialRef
- independence from legacy key after migration
- stale orphan reconciliation
- durable audit metadata
- delete/revoke behavior
- encryption-context mismatch rejection
- no token plaintext in ordinary metadata/audit dumps

## Validation

Authoritative implementation Quality Gate:

`36147480475`

Green:

- TypeScript
- production build
- all Phase 0–8 regressions
- all A–F1 production-hardening guards
- F2 SecretStore contract proof
- F2 PostgreSQL shared-secret proof
- PostgreSQL production suite
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Next phase

**G1 — Observability, Backup, and Operational Recovery Forensic Audit**

G1 should inventory current production telemetry/health/logging/queue/provider/database visibility and current PostgreSQL/object-storage backup/recovery capabilities, then define the minimum measurable observability and restore contracts before implementation.

G1 should remain audit/foundation focused:

- no observability vendor lock-in
- no broad dashboard redesign
- no deployment rewrite
- no Track H container/deployment implementation
