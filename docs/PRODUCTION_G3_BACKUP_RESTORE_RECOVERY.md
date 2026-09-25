# Production G3 — Backup/Restore + Recovery Drill Foundation

Date: **2026-09-25**

Status: **COMPLETE** — authoritative implementation Quality Gate `36158941696`.

## Goal

G3 turns the recovery objectives defined in G1 and the real telemetry/readiness foundation from G2 into an executable, provider-neutral recovery validation boundary.

G3 does not choose a managed backup vendor and never performs a destructive production restore.

## Recovery objectives enforced

The existing production objectives remain authoritative:

- PostgreSQL relational RPO: **5 minutes**
- PostgreSQL relational RTO: **60 minutes**
- durable object recoverable-delete window: **minimum 30 days**
- automated restore validation: at least every **30 days**

The recovery evidence contract requires:

- continuous relational backup enabled
- PITR enabled
- latest recovery point within RPO
- estimated restore time within RTO
- backup/restored build identity compatible with the running validator
- S3-compatible object versioning enabled
- noncurrent-version recoverability of at least 30 days, or unbounded retention

## Fail-closed isolated target

`server/operations/recovery/recoveryRuntimeConfig.ts`

Recovery validation requires explicit authorization:

`KNOWLEDGE_AI_RECOVERY_ALLOW=true`

Allowed target environments:

- recovery
- staging
- test

The target is rejected when:

- target environment is production
- recovery DB identity matches the configured production DB even when credentials differ
- recovery object bucket matches the production source bucket
- required target/build configuration is missing

## Provider-neutral relational evidence

`RecoveryEvidenceProvider` separates Knowledge AI from a specific backup control plane.

The default environment adapter consumes sanitized control-plane evidence containing only:

- checked timestamp
- latest recovery point
- continuous backup/PITR state
- estimated restore time
- build ID
- external restore timestamp/recovery point

Database credentials and backup-provider secrets are not part of the evidence contract.

## Real object-storage policy inspection

`S3RecoveryObjectStorageInspector` uses the S3-compatible control-plane API to inspect:

- bucket versioning state
- lifecycle configuration
- noncurrent-version expiration

A disabled/suspended versioning policy fails recovery validation.

If no noncurrent-version expiration exists, the recoverable-delete window is treated as unbounded.

If lifecycle/versioning state cannot be verified, G3 fails closed instead of assuming protection exists.

## Read-only restore verifier

`server/operations/recovery/isolatedRestoreVerifier.ts`

The verifier performs SELECT/object-read/decrypt-only validation.

It does not:

- run migrations
- insert/update/delete restored data
- claim worker jobs
- start worker runtimes
- call Gemini
- call Integration providers
- upload/delete restored objects

### Schema compatibility

Every restored `schema_migrations` entry required by the running build must match:

- migration version
- filename
- checksum

Drift or missing migrations fails the restore.

### SecretStore/KMS recovery

All restored `account_secret_versions` are inspected.

For every version G3:

1. finds the historical `kms_key_id`
2. requires that key ID in the configured keyring
3. decrypts the ciphertext using the original account/secret/purpose/provider/version context
4. immediately zeroes the temporary plaintext buffer

Missing key history or undecryptable ciphertext fails closed.

No plaintext secret is emitted in the report.

### Workspace/document recovery smoke

G3 selects a durable restored workspace corpus and reconstructs each current derived document from object bytes.

It verifies:

- payload SHA-256/size
- document ID
- sourceVersionId
- derivation version
- page count
- corresponding immutable source object bytes

### Dataset recovery smoke

G3 reconstructs every durable version for one restored Dataset and verifies:

- current version exists
- historical versions remain readable
- analytical payload SHA-256/size
- Dataset/version envelope identity
- table payloads
- immutable source-version bytes where present

This proves current and historical analytical state can be reconstructed from restored PostgreSQL + object storage.

### Worker recovery safety

Restored `worker_jobs` are inspected without claiming or executing them.

G3 validates worker-state invariants such as:

- RUNNING jobs retain lease metadata
- PENDING jobs remain below max attempts

The drill therefore proves durable worker state exists without contacting production providers.

## G2 operational evidence

G3 adds vendor-neutral metrics:

- `backup_recovery_point_age_seconds`
- `recovery_validation_total`
- `recovery_validation_age_seconds`

It also emits privacy-safe recovery validation events through the existing G2 operational sink.

No credentials, ciphertext, source content, Dataset rows, or KMS key material are used as metric labels or event payloads.

## Operator workflow

Command:

`npm run recovery:validate`

The command:

1. validates the isolated recovery target
2. reads external relational backup/restore evidence
3. inspects production object versioning/retention
4. opens the isolated restored PostgreSQL target read-only at the application level
5. reads restored object bytes from the separate recovery bucket
6. validates schema/build/KMS/object/document/Dataset/worker recovery
7. emits G2 recovery metrics/events
8. prints a sanitized validation report

The managed backup provider is responsible for creating the isolated restored DB/bucket before this command runs.

## Executable proofs

### Contract/safety proof

`scripts/check-production-g3-recovery-contract.ts`

Verifies:

- G2 recovery metric contract
- S3 version/lifecycle inspection
- read-only verifier source
- no worker/provider execution from the recovery command
- production target refusal
- same DB identity refusal
- same bucket refusal
- 5-minute RPO / 60-minute RTO checks
- build compatibility
- 30-day recoverable-delete check

### PostgreSQL recovery drill proof

`scripts/check-production-g3-recovery-postgres.ts`

Using real PostgreSQL and the deterministic object backend, it proves:

- one durable workspace/document corpus reconstructs
- current + historical Dataset versions reconstruct
- original and derived object integrity is verified
- two SecretStore versions encrypted under two historical KMS keys validate
- removing an old KMS key fails closed
- a tampered restored object fails closed
- a durable worker job remains PENDING/unclaimed before and after the drill

## Validation

Authoritative implementation Quality Gate:

`36158941696`

Verified green:

- TypeScript
- production build
- all Phase 0–8 regression gates
- all B/C/D/E/F/G1/G2 production guards
- G3 recovery contract proof
- G3 PostgreSQL recovery drill proof
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Scope deliberately left for Track H/I

G3 does not implement:

- a managed PostgreSQL backup/PITR vendor
- automatic creation of cloud restore targets
- production Docker images
- staging deployment
- reverse-proxy configuration
- dependency/security scanning policy
- deployment rollback automation
- broad load/abuse testing

## Next phase

**H1 — Deployment & Supply-Chain Forensic Audit**

H1 should inventory the real deployable web/worker/migration boundaries and define the production image, environment, proxy, security-header, shutdown, staging, supply-chain, and rollback contracts before Docker/staging implementation begins.
