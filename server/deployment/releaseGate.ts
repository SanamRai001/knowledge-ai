import crypto from 'crypto';
import {
  expectedPostgresMigrations,
  type ExpectedPostgresMigration,
} from '../persistence/migrationRunner.js';

const SHA256 =
  /^sha256:[0-9a-f]{64}$/;
const HEX64 =
  /^[0-9a-f]{64}$/;
const COMMIT =
  /^[0-9a-f]{40}$/;

export interface ReleaseManifest {
  schemaVersion: 1;
  sourceCommit: string;
  buildId: string;
  createdAt: string;
  nodeVersion: string;
  npmVersion: string;
  image: {
    reference: string;
    digest: string;
  };
  migrations: ExpectedPostgresMigration[];
  sbom: {
    format: 'cyclonedx-json';
    sha256: string;
  };
  supplyChain: {
    dependencyAuditPassed: boolean;
    containerScanPassed: boolean;
    actionPinsVerified: boolean;
  };
}

export interface ReleaseEnvironmentIdentity {
  database: string;
  objectBucket: string;
  secretBoundary: string;
  publicOrigin: string;
}

export interface StagingReleaseEvidence {
  schemaVersion: 1;
  environment: 'staging';
  sourceCommit: string;
  buildId: string;
  imageDigest: string;
  checkedAt: string;
  identity: ReleaseEnvironmentIdentity;
  migrations: {
    verified: boolean;
    inventory: ExpectedPostgresMigration[];
  };
  webReadiness: {
    ready: boolean;
    checkedAt: string;
  };
  workerReadiness: {
    ready: boolean;
    checkedAt: string;
  };
  recovery: {
    valid: boolean;
    checkedAt: string;
    recoveryPointAt: string;
    buildId: string;
  };
}

export interface ProductionReleaseTarget {
  schemaVersion: 1;
  environment: 'production';
  imageDigest: string;
  identity: ReleaseEnvironmentIdentity;
}

export type RollbackDecision =
  | {
      mode: 'FORWARD_FIX';
    }
  | {
      mode: 'APP_ROLLBACK';
      targetImageDigest: string;
      schemaCompatibilityVerified: boolean;
      compatibleMigrationInventory:
        ExpectedPostgresMigration[];
    }
  | {
      mode: 'RESTORE';
      isolatedRecoveryValidation: {
        valid: boolean;
        targetEnvironment:
          | 'recovery'
          | 'staging'
          | 'test';
        checkedAt: string;
      };
    };

export interface PromotionGateResult {
  promotable: true;
  sourceCommit: string;
  buildId: string;
  imageDigest: string;
  migrationCount: number;
}

export class ReleaseGateError
  extends Error
{
  readonly code:
    string;

  constructor(
    code: string,
    message: string
  ) {
    super(message);
    this.name =
      'ReleaseGateError';
    this.code = code;
  }
}

function requireString(
  value: unknown,
  label: string
): string {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    throw new ReleaseGateError(
      'RELEASE_FIELD_MISSING',
      label + ' is required.'
    );
  }
  return value.trim();
}

function requireTimestamp(
  value: string,
  label: string
): number {
  const parsed =
    Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ReleaseGateError(
      'RELEASE_TIMESTAMP_INVALID',
      label +
        ' must be an ISO timestamp.'
    );
  }
  return parsed;
}

function normalizeDigest(
  value: string,
  label: string
): string {
  const digest =
    requireString(value, label)
      .toLowerCase();
  if (!SHA256.test(digest)) {
    throw new ReleaseGateError(
      'RELEASE_DIGEST_INVALID',
      label +
        ' must be sha256:<64 lowercase hex>.'
    );
  }
  return digest;
}

function assertMigrationInventory(
  actual: ExpectedPostgresMigration[],
  expected: ExpectedPostgresMigration[],
  label: string
): void {
  if (
    actual.length !==
    expected.length
  ) {
    throw new ReleaseGateError(
      'RELEASE_MIGRATION_MISMATCH',
      label +
        ' migration count differs from the release artifact.'
    );
  }

  for (
    let index = 0;
    index < expected.length;
    index += 1
  ) {
    const a = actual[index];
    const e = expected[index];
    if (
      a?.version !== e.version ||
      a?.filename !== e.filename ||
      a?.checksum !== e.checksum
    ) {
      throw new ReleaseGateError(
        'RELEASE_MIGRATION_MISMATCH',
        label +
          ' migration inventory/checksum differs at index ' +
          index +
          '.'
      );
    }
  }
}

function assertFresh(
  timestamp: string,
  now: number,
  maxAgeMs: number,
  label: string
): void {
  const checkedAt =
    requireTimestamp(
      timestamp,
      label
    );
  const age =
    now - checkedAt;
  if (
    age < -5 * 60_000 ||
    age > maxAgeMs
  ) {
    throw new ReleaseGateError(
      'RELEASE_EVIDENCE_STALE',
      label +
        ' is stale or from the future.'
    );
  }
}

function assertEnvironmentIdentity(
  identity: ReleaseEnvironmentIdentity,
  label: string
): void {
  requireString(
    identity.database,
    label + '.database'
  );
  requireString(
    identity.objectBucket,
    label + '.objectBucket'
  );
  requireString(
    identity.secretBoundary,
    label + '.secretBoundary'
  );
  const origin =
    requireString(
      identity.publicOrigin,
      label + '.publicOrigin'
    );

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ReleaseGateError(
      'RELEASE_ORIGIN_INVALID',
      label +
        '.publicOrigin must be a URL.'
    );
  }

  if (
    url.protocol !== 'https:'
  ) {
    throw new ReleaseGateError(
      'RELEASE_ORIGIN_INVALID',
      label +
        '.publicOrigin must use HTTPS.'
    );
  }
}

export function validateReleaseManifest(
  manifest: ReleaseManifest
): ReleaseManifest {
  if (
    manifest.schemaVersion !== 1
  ) {
    throw new ReleaseGateError(
      'RELEASE_SCHEMA_UNSUPPORTED',
      'Release manifest schemaVersion must be 1.'
    );
  }

  if (
    !COMMIT.test(
      manifest.sourceCommit
    )
  ) {
    throw new ReleaseGateError(
      'RELEASE_SOURCE_COMMIT_INVALID',
      'sourceCommit must be a 40-character lowercase Git SHA.'
    );
  }

  requireString(
    manifest.buildId,
    'buildId'
  );
  requireTimestamp(
    manifest.createdAt,
    'createdAt'
  );

  if (
    manifest.nodeVersion !==
      '22.14.0' ||
    manifest.npmVersion !==
      '10.9.2'
  ) {
    throw new ReleaseGateError(
      'RELEASE_TOOLCHAIN_MISMATCH',
      'Release manifest must use the H2 Node/npm toolchain.'
    );
  }

  requireString(
    manifest.image.reference,
    'image.reference'
  );
  normalizeDigest(
    manifest.image.digest,
    'image.digest'
  );

  if (
    !HEX64.test(
      manifest.sbom.sha256
    ) ||
    manifest.sbom.format !==
      'cyclonedx-json'
  ) {
    throw new ReleaseGateError(
      'RELEASE_SBOM_INVALID',
      'Release manifest must contain a CycloneDX JSON SBOM SHA-256.'
    );
  }

  if (
    !manifest.supplyChain
      .dependencyAuditPassed ||
    !manifest.supplyChain
      .containerScanPassed ||
    !manifest.supplyChain
      .actionPinsVerified
  ) {
    throw new ReleaseGateError(
      'RELEASE_SUPPLY_CHAIN_FAILED',
      'All release supply-chain gates must pass.'
    );
  }

  assertMigrationInventory(
    manifest.migrations,
    expectedPostgresMigrations(),
    'manifest'
  );

  return manifest;
}

function assertSeparated(
  staging:
    ReleaseEnvironmentIdentity,
  production:
    ReleaseEnvironmentIdentity
): void {
  assertEnvironmentIdentity(
    staging,
    'staging.identity'
  );
  assertEnvironmentIdentity(
    production,
    'production.identity'
  );

  for (const key of [
    'database',
    'objectBucket',
    'secretBoundary',
    'publicOrigin',
  ] as const) {
    if (
      staging[key].trim() ===
      production[key].trim()
    ) {
      throw new ReleaseGateError(
        'RELEASE_ENVIRONMENT_NOT_SEPARATED',
        'Staging and production must use different ' +
          key +
          ' identities.'
      );
    }
  }
}

export function validatePromotionGate(input: {
  manifest: ReleaseManifest;
  staging: StagingReleaseEvidence;
  production: ProductionReleaseTarget;
  now?: number;
  maxReadinessAgeMs?: number;
  maxRecoveryEvidenceAgeMs?: number;
}): PromotionGateResult {
  const manifest =
    validateReleaseManifest(
      input.manifest
    );
  const now =
    input.now ?? Date.now();

  if (
    input.staging.schemaVersion !==
      1 ||
    input.staging.environment !==
      'staging'
  ) {
    throw new ReleaseGateError(
      'RELEASE_STAGING_EVIDENCE_INVALID',
      'Staging evidence schema/environment is invalid.'
    );
  }

  if (
    input.production
      .schemaVersion !== 1 ||
    input.production
      .environment !==
      'production'
  ) {
    throw new ReleaseGateError(
      'RELEASE_PRODUCTION_TARGET_INVALID',
      'Production target schema/environment is invalid.'
    );
  }

  const manifestDigest =
    normalizeDigest(
      manifest.image.digest,
      'manifest.image.digest'
    );
  const stagingDigest =
    normalizeDigest(
      input.staging.imageDigest,
      'staging.imageDigest'
    );
  const productionDigest =
    normalizeDigest(
      input.production.imageDigest,
      'production.imageDigest'
    );

  if (
    stagingDigest !==
      manifestDigest ||
    productionDigest !==
      manifestDigest
  ) {
    throw new ReleaseGateError(
      'RELEASE_ARTIFACT_REBUILD_FORBIDDEN',
      'Staging and production must reference the exact release-manifest image digest.'
    );
  }

  if (
    input.staging.sourceCommit !==
      manifest.sourceCommit ||
    input.staging.buildId !==
      manifest.buildId
  ) {
    throw new ReleaseGateError(
      'RELEASE_BUILD_IDENTITY_MISMATCH',
      'Staging evidence does not match release source/build identity.'
    );
  }

  assertFresh(
    input.staging.checkedAt,
    now,
    input.maxReadinessAgeMs ??
      15 * 60_000,
    'staging.checkedAt'
  );

  for (const [label, ready] of [
    [
      'staging.webReadiness',
      input.staging.webReadiness,
    ],
    [
      'staging.workerReadiness',
      input.staging.workerReadiness,
    ],
  ] as const) {
    if (!ready.ready) {
      throw new ReleaseGateError(
        'RELEASE_READINESS_FAILED',
        label +
          ' must be ready.'
      );
    }
    assertFresh(
      ready.checkedAt,
      now,
      input.maxReadinessAgeMs ??
        15 * 60_000,
      label + '.checkedAt'
    );
  }

  if (
    !input.staging.migrations
      .verified
  ) {
    throw new ReleaseGateError(
      'RELEASE_MIGRATION_GATE_FAILED',
      'Staging migrations must be verified before promotion.'
    );
  }

  assertMigrationInventory(
    input.staging.migrations
      .inventory,
    manifest.migrations,
    'staging'
  );

  if (
    !input.staging.recovery.valid
  ) {
    throw new ReleaseGateError(
      'RELEASE_RECOVERY_GATE_FAILED',
      'G3 recovery evidence must be valid before promotion.'
    );
  }

  assertFresh(
    input.staging.recovery
      .checkedAt,
    now,
    input
      .maxRecoveryEvidenceAgeMs ??
      30 * 24 * 60 * 60_000,
    'staging.recovery.checkedAt'
  );
  requireTimestamp(
    input.staging.recovery
      .recoveryPointAt,
    'staging.recovery.recoveryPointAt'
  );

  if (
    input.staging.recovery
      .buildId !==
    manifest.buildId
  ) {
    throw new ReleaseGateError(
      'RELEASE_RECOVERY_BUILD_MISMATCH',
      'Recovery validation must be compatible with the release build.'
    );
  }

  assertSeparated(
    input.staging.identity,
    input.production.identity
  );

  return {
    promotable: true,
    sourceCommit:
      manifest.sourceCommit,
    buildId: manifest.buildId,
    imageDigest:
      manifestDigest,
    migrationCount:
      manifest.migrations.length,
  };
}

export function validateRollbackDecision(input: {
  decision: RollbackDecision;
  currentManifest: ReleaseManifest;
}): void {
  const manifest =
    validateReleaseManifest(
      input.currentManifest
    );

  if (
    input.decision.mode ===
    'FORWARD_FIX'
  ) {
    return;
  }

  if (
    input.decision.mode ===
    'APP_ROLLBACK'
  ) {
    normalizeDigest(
      input.decision
        .targetImageDigest,
      'rollback.targetImageDigest'
    );

    if (
      !input.decision
        .schemaCompatibilityVerified
    ) {
      throw new ReleaseGateError(
        'RELEASE_ROLLBACK_SCHEMA_UNVERIFIED',
        'Application rollback requires explicit old-build/new-schema compatibility evidence.'
      );
    }

    assertMigrationInventory(
      input.decision
        .compatibleMigrationInventory,
      manifest.migrations,
      'rollback'
    );
    return;
  }

  if (
    !input.decision
      .isolatedRecoveryValidation
      .valid
  ) {
    throw new ReleaseGateError(
      'RELEASE_RESTORE_UNVERIFIED',
      'Restore rollback requires valid isolated G3 recovery validation.'
    );
  }

  requireTimestamp(
    input.decision
      .isolatedRecoveryValidation
      .checkedAt,
    'rollback.recovery.checkedAt'
  );
}

export function sha256(
  bytes: Buffer | string
): string {
  return crypto
    .createHash('sha256')
    .update(bytes)
    .digest('hex');
}
