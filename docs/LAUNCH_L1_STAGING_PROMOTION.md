# Launch L1 — Real Staging Promotion

Status: **IN PROGRESS**

L1 is the first committed post-hardening launch objective.

The goal is not to add another architecture layer. The goal is to deploy the already-hardened system to a real staging environment using the H4 build-once promotion contract.

## L1 exit gate

L1 is complete only when one exact immutable release candidate is running in real staging with:

- a managed PostgreSQL staging database
- a durable S3-compatible staging object bucket
- a configured SecretStore/KMS boundary
- separate web and worker runtimes
- a separate migration runtime/job
- HTTPS public origin
- migration single-writer verification
- web readiness green
- worker readiness green
- staging recovery evidence compatible with the release build
- no production database, bucket, secret boundary, public origin, web runtime, worker runtime, or migration runtime reused in staging

A green repository CI run by itself does **not** complete L1.

## L1A — Immutable staging release candidate preparation

Repository support added:

- `server/deployment/stagingPreflight.ts`
- `scripts/staging-preflight.ts`
- `scripts/check-launch-l1-staging-preflight.ts`
- `.github/workflows/staging-release-candidate.yml`

### Staging preflight

The preflight fails closed unless:

- `NODE_ENV=production`
- `KNOWLEDGE_AI_PERSISTENCE_MODE=postgres`
- `DATABASE_URL` is a valid non-local PostgreSQL target
- `SOURCE_STORAGE_BACKEND=s3` is explicitly configured
- bucket/region and credential-pair rules pass the existing storage runtime contract
- the existing F2 SecretStore/KMS keyring contract is valid
- `KNOWLEDGE_AI_PUBLIC_ORIGIN` matches the staging identity
- staging object-bucket identity matches the configured bucket
- web / worker / migration runtime identities are distinct
- every staging resource identity differs from its production counterpart

The output is intentionally sanitized. It contains only non-secret staging identities and never emits:

- database URLs or passwords
- object-store secret keys
- KMS key material
- OAuth credentials
- GitHub tokens

### Staging / production identity variables

The GitHub `staging` environment must provide two non-secret JSON variables:

`KNOWLEDGE_AI_STAGING_IDENTITY_JSON`

`KNOWLEDGE_AI_PRODUCTION_IDENTITY_JSON`

Shape:

```json
{
  "database": "managed-postgres-staging",
  "objectBucket": "knowledge-ai-staging",
  "secretBoundary": "staging-kms-boundary",
  "publicOrigin": "https://staging.example.com",
  "webRuntime": "staging-web-service",
  "workerRuntime": "staging-worker-service",
  "migrationRuntime": "staging-migration-job"
}
```

Production uses the same shape with different identities.

These are labels/identities, not credentials.

## GitHub staging environment contract

The manual workflow uses GitHub Environment:

`staging`

Required secrets:

- `DATABASE_URL`
- `KNOWLEDGE_AI_SECRET_KEYRING_JSON`
- `SOURCE_STORAGE_ACCESS_KEY_ID` when the staging object provider requires static credentials
- `SOURCE_STORAGE_SECRET_ACCESS_KEY` when the staging object provider requires static credentials

Required/non-secret variables:

- `DATABASE_SSL`
- `KNOWLEDGE_AI_PUBLIC_ORIGIN`
- `SOURCE_STORAGE_BACKEND`
- `SOURCE_STORAGE_BUCKET`
- `SOURCE_STORAGE_REGION`
- `SOURCE_STORAGE_ENDPOINT` when using a non-AWS S3-compatible endpoint
- `SOURCE_STORAGE_FORCE_PATH_STYLE`
- `KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID`
- `KNOWLEDGE_AI_STAGING_IDENTITY_JSON`
- `KNOWLEDGE_AI_PRODUCTION_IDENTITY_JSON`

Real provider OAuth/LLM credentials are configured only if the staging rehearsal needs those provider paths.

## Immutable release-candidate workflow

Manual workflow:

`.github/workflows/staging-release-candidate.yml`

Input:

- exact 40-character source commit SHA

The workflow then:

1. validates the immutable source SHA
2. checks out that exact commit
3. verifies Node `22.14.0` / npm `10.9.2`
4. installs through frozen `npm ci`
5. runs the production dependency vulnerability gate
6. runs the immutable GitHub Action pin gate
7. runs TypeScript
8. builds the production package
9. runs the real staging configuration preflight
10. generates and verifies the CycloneDX production SBOM
11. builds the exact production Docker image
12. scans it with the existing H4 HIGH/CRITICAL Trivy policy
13. pushes the candidate to GHCR
14. captures the immutable registry `sha256` digest
15. generates the H4 release manifest from the pushed digest
16. uploads the release manifest, preflight result, and SBOM as workflow evidence

The workflow does **not** claim that the image has been deployed.

## Why GHCR

GHCR is used only as the immutable release-candidate registry.

That keeps the release artifact independent of the eventual staging compute provider.

The staging provider must deploy the exact:

`image reference + sha256 digest`

from the release manifest.

No rebuild is permitted between candidate preparation and staging.

## Provider choice

No hosting vendor is committed in repository architecture.

Suitable staging providers can include a platform capable of:

- Docker image deployment by immutable digest
- managed PostgreSQL
- separate web and worker services
- one-off migration jobs
- environment-scoped secrets
- health/readiness probes

Railway and Render are both viable candidates for this deployment shape, but L1 should select a provider only when an actual staging account is connected/configured.

## Remaining L1 work

After L1A is validated and merged:

1. configure a real managed staging provider
2. create a managed staging PostgreSQL database
3. create/configure a durable S3-compatible staging bucket
4. configure the staging SecretStore/KMS keyring
5. create distinct web / worker / migration runtimes
6. run the immutable release-candidate workflow for a chosen `main` SHA
7. deploy the exact GHCR digest to all required staging runtime roles
8. execute the compiled migration gate once
9. verify web and worker readiness
10. run real staging recovery validation
11. capture `StagingReleaseEvidence`
12. run the H4 promotion gate against the release manifest

Only then mark L1 complete and advance to L2.

## Current blocker

The repository-side release contract can be validated without external infrastructure.

Actual L1 completion requires a connected/configured real staging provider. No provider credentials or managed staging resources are currently available to the repository workflow by default.

Do not replace this requirement with localhost PostgreSQL, an ephemeral CI service, or a fake staging label.
