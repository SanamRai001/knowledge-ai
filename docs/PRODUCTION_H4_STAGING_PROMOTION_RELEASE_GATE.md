# Production H4 — Staging Promotion + Rollback Release Gate

Status: **COMPLETE** — authoritative implementation Quality Gate `36175108771`.

## Goal

H4 turns the H1/H2/H3 deployment contracts and G2/G3 readiness/recovery contracts into an executable, provider-neutral release gate.

H4 does not choose a hosting vendor and does not perform an actual production rollout. It defines and proves the release contract that a real staging/production platform must satisfy.

## Immutable release manifest

Added:

`server/deployment/releaseGate.ts`

`scripts/release-manifest.ts`

A release manifest carries:

- source Git commit
- build ID
- release timestamp
- exact Node/npm toolchain
- immutable image reference
- immutable `sha256:<digest>`
- exact migration inventory and checksums
- CycloneDX SBOM SHA-256
- dependency-audit result
- container-scan result
- immutable GitHub Action pin verification

Invalid or incomplete manifests fail closed.

## Build-once promotion

Production promotion is valid only when:

- the staging image digest equals the release manifest image digest
- the production target image digest equals the same manifest digest
- staging source commit equals the release source commit
- staging build ID equals the release build ID

A rebuild between staging validation and production promotion is rejected with:

`RELEASE_ARTIFACT_REBUILD_FORBIDDEN`

The production candidate is therefore the exact artifact tested in staging.

## Staging / production separation

The release gate requires distinct staging and production identities for:

- PostgreSQL database
- object-storage bucket
- SecretStore/KMS boundary
- public/browser origin
- web runtime
- worker runtime
- migration runtime

Public origins must use HTTPS.

This complements the H2/H3 role contract: web, worker, and migration execution remain separate deployment responsibilities.

## Single-writer migration gate

The migration runner now uses one PostgreSQL advisory deployment lock.

If another migration writer already owns the lock, migration fails closed with:

`MIGRATION_LOCK_HELD`

The compiled release migration gate:

`node dist/private/release-migration-gate.cjs`

then verifies that the live `schema_migrations` inventory exactly matches the release artifact by:

- version
- filename
- SHA-256 checksum

No automatic down-migration path was added.

## Readiness gate

Added:

`node dist/private/release-readiness-smoke.cjs`

The staging release smoke requires:

- web readiness HTTP 200 + `ready: true`
- worker readiness HTTP 200 + `ready: true`
- HTTPS by default
- bounded request timeout

This consumes the real G2 web readiness and H3 worker readiness contracts.

## Recovery gate

Promotion requires valid G3 recovery evidence that:

- is current within the configured evidence age
- is marked valid
- carries a valid recovery point timestamp
- is compatible with the exact release build ID

H4 does not substitute a deployment smoke test for recovery evidence.

## Rollback policy

H4 encodes three explicit operator decisions.

### Forward fix

`FORWARD_FIX`

Always remains available as the normal forward-only schema strategy.

### Application rollback

`APP_ROLLBACK`

Requires:

- immutable target image digest
- explicit old-build/new-schema compatibility evidence
- compatible migration inventory

A blind application rollback against a changed schema is rejected.

### Restore

`RESTORE`

Requires valid isolated G3 recovery validation.

H4 never authorizes an automatic production down migration.

## Supply-chain release gate

GitHub Actions are pinned to immutable 40-character commit SHAs.

The workflow declares explicit token permissions.

The H4 supply-chain job verifies:

1. frozen `npm ci`
2. `npm audit --omit=dev --audit-level=high`
3. CycloneDX production-dependency SBOM generation
4. SBOM format/hash verification
5. exact production image build
6. Trivy production-image scan
7. failure on HIGH or CRITICAL fixed vulnerabilities

## Runtime-image vulnerability hardening

The first real H4 Trivy run correctly failed.

The vulnerable surface was primarily the pinned Node runtime image itself:

- outdated Debian Bookworm packages
- npm's globally bundled dependency tree under `/usr/local/lib/node_modules/npm`

Knowledge AI's own production dependency audit was already green.

The gate was **not weakened**.

Instead the runtime image was hardened:

- current Debian Bookworm security updates are applied during the runtime image build
- apt metadata is removed
- global npm/npx are removed from the steady-state runtime because production commands execute compiled Node artifacts and never require npm
- the non-root `node` runtime remains intact

After hardening, the same HIGH/CRITICAL Trivy policy passes.

The build stage still uses the exact H2 Node/npm release toolchain.

## Compiled release entrypoints

Production image operations now include:

- `node dist/private/release-manifest.cjs`
- `node dist/private/release-gate.cjs`
- `node dist/private/release-migration-gate.cjs`
- `node dist/private/release-readiness-smoke.cjs`

The release process does not depend on mutable TypeScript source or `tsx`.

## Executable proofs

### Release promotion contract

`scripts/check-production-h4-release-promotion-contract.ts`

Verifies:

- valid promotion
- build-once digest identity
- source/build identity
- DB/object/KMS/origin separation
- web/worker/migration runtime separation
- readiness failure/staleness
- migration mismatch
- recovery build mismatch
- supply-chain failure
- application rollback compatibility
- isolated restore requirement

### Migration single-writer PostgreSQL proof

`scripts/check-production-h4-migration-gate-postgres.ts`

Verifies:

- another migration writer blocks execution
- lock release restores normal operation
- migration execution remains idempotent
- live schema inventory/checksums match the artifact exactly

### Immutable Action pin proof

`scripts/check-production-h4-action-pins.ts`

Verifies every third-party `uses:` reference is pinned to a 40-character commit SHA and workflows declare explicit permissions.

### SBOM proof

`scripts/check-production-h4-sbom.mjs`

Verifies the generated SBOM is CycloneDX JSON and emits its SHA-256 identity.

## Validation

Authoritative implementation Quality Gate:

`36175108771`

Verified green:

- exact Node/npm + frozen install
- TypeScript
- production build
- complete Phase 0–8 regressions
- production-hardening guards through H4
- H4 release promotion contract
- H4 immutable Action pin proof
- H4 PostgreSQL single-writer migration gate
- H2 real production-image smoke
- production dependency audit
- CycloneDX SBOM generation/verification
- hardened production-image Trivy HIGH/CRITICAL scan
- full PostgreSQL production suite through G3/H4
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Scope intentionally not completed

H4 does not claim:

- vendor-specific deployment automation
- broad concurrency/load capacity
- abuse/rate-limit resilience under measured attack traffic
- malformed file fuzzing
- OAuth/SSRF adversarial test coverage
- sustained worker-load thresholds
- Track J product/admin cleanup

## Next phase

**I1 — Load, Abuse, and Security Test Foundation**

I1 should inventory exposed production attack/load surfaces, define measurable thresholds and fixtures, and add the first repeatable adversarial/concurrency harness without making unsupported scale claims.
