# Production H2 — Reproducible Build + Production Image Foundation

Status: **COMPLETE** — authoritative implementation Quality Gate `36167552759`.

## Goal

H2 closes the packaging/image blockers identified by H1 without starting staging rollout or runtime-edge hardening.

The production release artifact is now reproducible from one canonical dependency graph and one explicit Node/npm contract, with browser assets physically separated from private web/worker/operations artifacts.

## Release toolchain

Canonical release package manager:

- npm `10.9.2`

Runtime/build Node contract:

- Node.js `22.14.x`
- CI/image pin: `22.14.0`
- `.nvmrc`: `22.14.0`

Repository lock authority:

- `package-lock.json` is committed
- lockfile version 3
- legacy `bun.lock` authority is removed

Quality/release installs use:

`npm ci`

rather than mutable dependency resolution.

## Production artifact layout

The production build now starts with deterministic `dist/` cleanup.

Public browser output:

`dist/public/`

Private runtime/operations output:

`dist/private/`

Private bundles:

- `server.cjs`
- `worker.cjs`
- `db-migrate.cjs`
- `db-import-legacy.cjs`
- `recovery-validate.cjs`

Production private bundles do not emit source maps.

The Express production static root is only `dist/public`.

Vite is loaded dynamically only in non-production development, so the production runtime does not require the Vite dev dependency.

## Production commands

Web:

`node dist/private/server.cjs`

Worker:

`node dist/private/worker.cjs`

Migration job:

`node dist/private/db-migrate.cjs`

Legacy metadata import:

`node dist/private/db-import-legacy.cjs`

Recovery validation:

`node dist/private/recovery-validate.cjs`

Production operations therefore no longer depend on mutable TypeScript source plus `tsx`.

Development source commands remain explicitly separate.

## Production image

Added a multi-stage `Dockerfile`.

Build stage:

1. uses exact Node `22.14.0`
2. verifies npm `10.9.2`
3. installs with `npm ci`
4. builds client/web/worker/ops artifacts
5. prunes dev dependencies

Runtime stage contains only:

- package metadata/lockfile
- production `node_modules`
- `dist/`
- PostgreSQL migration SQL

It does not copy the TypeScript source tree into the steady-state runtime image.

The image runs as the built-in non-root `node` user.

Default image command is the web entrypoint. The same immutable image supports the worker and operations commands by overriding the command/process role.

## Docker context

`.dockerignore` excludes:

- repository metadata
- local secrets
- local mutable data
- local node_modules/dist
- coverage/log output
- development documentation/benchmarks not required by runtime

## H2 executable proofs

### Build/image contract

`scripts/check-production-h2-build-image-contract.ts`

Verifies:

- canonical npm lock authority
- exact Node/npm contract
- frozen Quality Gate install
- private/public artifact separation
- compiled production commands
- no private production source maps
- dev-only Vite boundary
- multi-stage/non-root/minimal image contract
- no temporary H2 lock-refresh workflow remains

### Package layout

`scripts/check-production-h2-package-layout.mjs`

Runs after the real production build and verifies:

- public `index.html`
- all private runtime/ops bundles
- no private bundle under the public static root
- no source maps
- no TypeScript source in `dist/`

### Real image smoke

`scripts/check-production-h2-image-smoke.mjs`

Builds the real Docker image and verifies:

- configured non-root user
- nonzero runtime UID
- public/private artifact presence
- migration SQL presence
- no source tree in runtime image
- no Vite/tsx/TypeScript dev dependencies
- no source maps
- web bundle rejects worker-only process role
- worker bundle rejects web-only process role

## Historical proof advancement

H1 now recognizes the H2 fixes:

- public/private `dist` collision closed
- canonical npm lock/frozen install established
- immutable non-root image exists
- migration/import/recovery CLIs are compiled

H1 intentionally continues to guard the remaining later-track gaps:

- web/worker graceful drain
- trusted-proxy/TLS/security-header ownership
- CSP
- staging topology/promotion
- dependency/container scan and SBOM release gates
- immutable GitHub Action SHA pinning
- broad load/abuse testing

E1 was advanced only for the new private worker artifact path/split build shape; worker ownership semantics are unchanged.

## Validation

Authoritative implementation Quality Gate:

`36167552759`

Verified green:

- exact Node/npm checks
- frozen `npm ci`
- TypeScript
- production build
- H2 package-layout proof
- real H2 Docker image smoke
- full Phase 0–8 regression suite
- all production-hardening contract proofs through H2
- full PostgreSQL production suite through G3
- arithmetic grounding
- deterministic synthesis
- unseen-corpus effectiveness benchmark
- live Gemini benchmark

## Scope intentionally not completed

H2 does not claim:

- graceful web/worker drain
- trusted proxy configuration
- TLS/reverse-proxy ownership enforcement
- CSP/security headers
- tightened global request limits
- supervisor-consumable worker readiness endpoint/command
- staging deployment/promotion
- SBOM/vulnerability scan release policy
- immutable GitHub Action SHA pinning
- broad load/abuse/security testing

## Next phase

**H3 — Runtime Edge + Graceful Shutdown Hardening**

H3 should implement the runtime-edge controls left explicit by H1/H2 while preserving the same immutable H2 image/build contract.
