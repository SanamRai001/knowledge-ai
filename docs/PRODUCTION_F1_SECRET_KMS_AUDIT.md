# Production F1 — Secret/KMS Forensic Audit + Managed-Secret Boundary Plan

Status: **IMPLEMENTED — awaiting integrated Quality Gate validation.**

## Scope

F1 is audit-only.

No production credential is migrated in this phase.
No AWS/GCP/Azure secret-manager SDK is added.
No OAuth, API-key, session, storage, database, or LLM behavior is changed.

## Verdict

The current secret model has two distinct classes and they should not be merged.

### A. Deployment/runtime secrets

These belong in deployment-managed environment/identity injection, not in account-scoped SecretStore records:

- `DATABASE_URL`
- `GEMINI_API_KEY`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `MICROSOFT_ONEDRIVE_CLIENT_SECRET`
- `SOURCE_STORAGE_ACCESS_KEY_ID`
- `SOURCE_STORAGE_SECRET_ACCESS_KEY`
- `INTEGRATION_CREDENTIAL_KEY` (legacy encryption key; should disappear after F2 migration)
- `KNOWLEDGE_AI_BOOTSTRAP_TOKEN`

Related non-secret deployment configuration includes:

- `KNOWLEDGE_AI_PUBLIC_ORIGIN`
- OAuth client IDs
- OAuth redirect URIs
- Microsoft tenant ID
- S3 bucket/region/endpoint
- Gemini model ID
- process-role/persistence flags

### B. Account/provider credentials

The production managed-secret candidate is:

- Google Drive access token
- Google Drive refresh token
- Microsoft OneDrive access token
- Microsoft OneDrive refresh token

These are account-scoped, provider-scoped, mutable, revocable, and required by background workers across process restarts/replicas.

They must move behind the provider-neutral `SecretStore` contract in F2.

## Existing credential families

### Human passwords

Storage:
- PostgreSQL `user_password_credentials`

Protection:
- scrypt-v1
- per-user random salt
- N=32768, r=8, p=1
- 64-byte derived key

Plaintext password is never persisted.

Verdict:
**KEEP AS HASHED CREDENTIAL.**
Do not move passwords into SecretStore.

### Browser sessions

Raw token:
- `kaisess_<random 32-byte base64url>`
- HttpOnly cookie
- Secure in production
- SameSite=Lax

Storage:
- only SHA-256 token hash in PostgreSQL `browser_sessions`

CSRF:
- separate random double-submit token
- browser-readable cookie by design

Verdict:
**KEEP HASHED.**
Session secrets must never enter managed reversible secret storage.

### Platform/API keys

Raw API key:
- generated randomly
- returned once on creation

Storage:
- SHA-256 hash
- masked representation
- metadata/scopes/status in PostgreSQL

Production validation cache:
- contains hash metadata, not raw key

Verdict:
**KEEP HASHED.**
Do not move API-key raw secrets into SecretStore.

### Initial owner bootstrap token

Source:
- `KNOWLEDGE_AI_BOOTSTRAP_TOKEN`

Properties:
- deployment secret
- compared using timing-safe digests
- one-time bootstrap state is stored relationally

Verdict:
**DEPLOYMENT SECRET.**
Inject through deployment secret facilities and remove/rotate after bootstrap.

### Gemini provider key

Source:
- `GEMINI_API_KEY`

Usage:
- server-only Google GenAI client construction
- provider health reports configured/not-configured only

Verdict:
**DEPLOYMENT SECRET.**
Do not store per account unless a future product explicitly supports user-supplied model credentials.

### PostgreSQL connection credential

Source:
- `DATABASE_URL`

Usage:
- PostgreSQL connection pool only

Verdict:
**DEPLOYMENT SECRET.**
Prefer platform secret injection / workload identity where supported.

### S3-compatible object credentials

Sources:
- `SOURCE_STORAGE_ACCESS_KEY_ID`
- `SOURCE_STORAGE_SECRET_ACCESS_KEY`

The implementation already prefers deployment/IAM credentials when explicit keys are absent.

Verdict:
**DEPLOYMENT SECRET.**
Prefer workload/instance identity; static credentials are compatibility fallback.

### OAuth application client secrets

Sources:
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `MICROSOFT_ONEDRIVE_CLIENT_SECRET`

These identify the Knowledge AI OAuth application, not a customer account.

Verdict:
**DEPLOYMENT SECRET.**

### OAuth state / PKCE

Google:
- random state
- only SHA-256 state hash stored in process memory
- 10-minute TTL
- one-time consume

Microsoft:
- random state hash in memory
- random PKCE verifier in memory
- 10-minute TTL
- verifier is not returned by the HTTP begin response

Verdict:
**EPHEMERAL SECURITY STATE, NOT LONG-LIVED SECRETSTORE DATA.**

Current limitation:
OAuth authorization attempts are process-local, so a callback landing on another replica or after process restart cannot complete.

That is an operational HA concern, but not the primary F2 credential migration. A later slice may move OAuth attempt state to short-lived shared storage.

## Critical current weakness: IntegrationCredentialStore

Current file:

`data/integration_credentials.json`

Current protection:

- AES-256-GCM
- random 12-byte IV
- authentication tag
- encryption key = SHA-256(`INTEGRATION_CREDENTIAL_KEY`)
- one deployment-wide key
- encrypted records include account + provider metadata

Current secret values include:

- provider access token
- provider refresh token
- expiry
- OAuth scopes/token type

### What is good

- plaintext tokens are not written to the file
- authenticated encryption is used
- account/provider scoping is checked on every read/update/delete
- public connection serialization removes `credentialRef`
- reauthorization creates a replacement secret and deletes the old secret
- token refresh updates the encrypted secret in place
- disconnect deletes local credentials
- provider Authorization headers are built server-side

### Production blockers

1. **Node-local file storage**
   - credentials do not naturally survive container replacement unless the data volume is durable
   - multiple replicas do not share the same credential store safely

2. **One global symmetric key**
   - compromise of `INTEGRATION_CREDENTIAL_KEY` exposes every integration credential file record
   - there is no key version metadata

3. **No rotation protocol**
   - no dual-read / old-key decrypt / new-key re-encrypt path
   - changing `INTEGRATION_CREDENTIAL_KEY` makes existing records undecryptable

4. **No KMS envelope/context binding**
   - ciphertext is not cryptographically bound to account/provider/credential ID through KMS encryption context

5. **Backup coupling**
   - restoring encrypted credential data without the exact environment key makes it unusable
   - backing up the file and key together defeats the intended separation

6. **No centralized audit trail**
   - create/read/rotate/revoke/delete secret operations are not durable security audit events

7. **Worker/replica availability**
   - E4/E5 workers may execute on a different process/replica; credentials must be resolvable from shared managed storage

## OAuth token lifecycle

### Create / authorize

Provider token endpoint returns access + refresh tokens.

Knowledge AI currently:
1. validates account-bound OAuth state
2. validates required scope
3. encrypts token bundle locally
4. receives an opaque credentialRef
5. stores credentialRef on IntegrationConnection
6. returns only PublicIntegrationConnection

The browser never receives refresh/access tokens.

### Refresh

Connector:
1. resolves credentialRef server-side
2. decrypts token bundle
3. refreshes through provider token endpoint
4. replaces access token and rotated refresh token when supplied
5. re-encrypts updated token bundle

### Reauthorization

1. create new encrypted credential
2. update IntegrationConnection credentialRef
3. delete old credential

### Disconnect / revoke

Google:
- attempts provider-side token revoke
- deletes local credential
- marks connection REVOKED

Microsoft:
- deletes local credential
- marks connection REVOKED

F2 must preserve these exact semantics.

## Browser/API exposure

Safe patterns verified:

- Integration `publicConnection()` strips `credentialRef`
- API-key list surfaces masked key metadata, not hashes
- session raw token is only emitted as HttpOnly cookie
- provider health reports only configured/not-configured
- worker payloads carry durable principal/connection IDs rather than raw credentials
- S3 object credentials remain server environment configuration

## Logging/error exposure

No intentional logging of:
- OAuth access tokens
- OAuth refresh tokens
- raw API keys
- session secrets
- password plaintext
- S3 secret access keys
- OAuth client secrets
- Gemini key

Risk to preserve in F2:
provider `error_description` / API error messages can flow into safe application errors. SecretStore/KMS failures must use fixed error codes and must never serialize secret values, ciphertext, KMS contexts containing sensitive values, or provider credentials.

## Hard-coded webhook prototype secret

`server/mediator/webhookService.ts` seeds:

`whsec_alpha_webhook_secret_key_789`

This module belongs to the retired mediator/SaaS prototype surface and is not a supported production credential path.

F1 classifies it as:
**RETIRED PROTOTYPE FIXTURE — REMOVE/REPLACE WHEN THAT INTERNAL prototype is cleaned further; do not migrate it into F2 managed production secret storage.**

The repository secret-hygiene scanner should still be expanded over time to catch generic webhook-secret fixture patterns.

## Source-control/runtime hygiene

Verified:
- `.env*` ignored except `.env.example`
- private-key file extensions ignored
- `data/` ignored
- secret-hygiene CI scans common provider/API/private-key patterns
- mutable core runtime files are rejected if tracked

Gap:
the hygiene scanner does not cover every possible OAuth token, database URL, generic client-secret, or webhook-secret format. F2 should preserve the current guard; a later security-hardening slice can broaden patterns without relying on pattern matching as the primary secret control.

## Provider-neutral boundary

Added audit-only contract:

`server/security/secretStoreContract.ts`

### SecretStore

Responsibilities:
- account + purpose scoped create/get
- rotation
- revocation
- deletion
- opaque metadata/ref only

SecretStore callers must never depend on:
- cloud provider resource ARN/name
- ciphertext representation
- KMS key material
- local file paths

### KmsService

Responsibilities:
- encrypt/decrypt byte payloads
- require encryption context

Required F2 encryption context for integration credentials:

- accountId
- credentialRef/secretId
- purpose = INTEGRATION_OAUTH
- provider

## Metadata vs secret separation

Ordinary PostgreSQL IntegrationConnection metadata may store:

- credentialRef / opaque secret ID
- provider
- connection status
- timestamps
- non-secret OAuth scope/access-model metadata

It must not store:

- access token
- refresh token
- client secret
- KMS ciphertext
- plaintext encryption key

SecretStore metadata may store non-secret operational values such as:
- secret ID
- account
- purpose/provider
- created/updated time
- secret version
- revoked time

## Failure semantics

If SecretStore/KMS is unavailable:

- OAuth connect/reauthorize: fail closed with 503; do not create ACTIVE connection pointing to missing secret
- provider sync/health requiring credential: fail safely and retain connection metadata for retry
- token refresh: do not destroy previous valid secret before replacement is committed
- revoke/delete: mark explicit cleanup/revocation state if remote/local deletion cannot complete; do not claim credential destruction falsely
- worker retries may retry transient SecretStore availability failures, but must not log secret values

## Rotation requirements

F2+ design must support:

1. create new secret version
2. atomically update durable credentialRef/version metadata
3. retain old version until the new one is committed/usable
4. revoke/delete old version
5. durable audit event
6. recovery if crash occurs between metadata update and old-secret cleanup

KMS key rotation must not require reauthorization from every user.

## Multi-replica requirement

A production SecretStore must be shared across web + worker replicas.

The current local file is therefore not an acceptable final production backend even though its cryptography is reasonable for local/dev compatibility.

## Backup/restore requirement

Backups must keep:
- ordinary metadata backups
- managed secret backup/version policy
- KMS/key lifecycle

separate.

A database restore must not accidentally restore plaintext secrets.

## F2 exact implementation slice

**F2 — Integration OAuth SecretStore Foundation + Migration**

Keep F2 limited to Google Drive and Microsoft OneDrive credential bundles.

1. introduce a runtime `SecretStore` abstraction using the F1 contract
2. keep provider implementation swappable; do not leak vendor identifiers into IntegrationConnection
3. add durable secret metadata/audit records where needed, never token plaintext/ciphertext in ordinary Integration metadata
4. migrate `IntegrationCredentialStore` callers to async SecretStore operations
5. preserve account/provider scope on every operation
6. preserve create, refresh/rotate, reauthorize, revoke/disconnect semantics
7. provide a safe one-time migration/read-through path for existing `data/integration_credentials.json` records
8. define crash-safe metadata/secret ordering and cleanup-pending behavior
9. prove web and worker replicas can resolve the same OAuth credential
10. prove no access/refresh token appears in API responses, worker payloads, logs, PostgreSQL Integration metadata, or source-controlled files

F2 should not migrate:
- DB URL
- Gemini key
- S3 credentials
- OAuth application client secrets
- bootstrap token
- password/session/API-key hashes

A managed provider SDK choice can be made in F2 only if the deployment target is known; otherwise implement the provider-neutral boundary plus a production-ready shared backend adapter separately from local compatibility.

## F1 exit criteria

F1 is complete when:
- executable secret-boundary proof is green
- this evidence is integrated into Quality Gate
- roadmap/handoff identify F2 exactly
- no credential runtime behavior changed
