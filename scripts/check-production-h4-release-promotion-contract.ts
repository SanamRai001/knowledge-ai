import {
  expectedPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  ReleaseGateError,
  validatePromotionGate,
  validateReleaseManifest,
  validateRollbackDecision,
  type ProductionReleaseTarget,
  type ReleaseManifest,
  type StagingReleaseEvidence,
} from '../server/deployment/releaseGate.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectCode(
  code: string,
  work: () => void
) {
  let seen = false;
  try {
    work();
  } catch (error) {
    seen =
      error instanceof
        ReleaseGateError &&
      error.code === code;
  }
  assert(
    seen,
    'Expected release gate error code ' +
      code
  );
}

function manifest():
  ReleaseManifest {
  return {
    schemaVersion: 1,
    sourceCommit:
      'a'.repeat(40),
    buildId: 'build-h4-001',
    createdAt:
      '2026-09-25T12:00:00.000Z',
    nodeVersion: '22.14.0',
    npmVersion: '10.9.2',
    image: {
      reference:
        'registry.example/knowledge-ai',
      digest:
        'sha256:' +
        'b'.repeat(64),
    },
    migrations:
      expectedPostgresMigrations(),
    sbom: {
      format:
        'cyclonedx-json',
      sha256:
        'c'.repeat(64),
    },
    supplyChain: {
      dependencyAuditPassed:
        true,
      containerScanPassed:
        true,
      actionPinsVerified:
        true,
    },
  };
}

function staging(
  release:
    ReleaseManifest
): StagingReleaseEvidence {
  return {
    schemaVersion: 1,
    environment: 'staging',
    sourceCommit:
      release.sourceCommit,
    buildId:
      release.buildId,
    imageDigest:
      release.image.digest,
    checkedAt:
      '2026-09-25T12:05:00.000Z',
    identity: {
      database: 'db-staging',
      objectBucket:
        'bucket-staging',
      secretBoundary:
        'kms-staging',
      publicOrigin:
        'https://staging.example.com',
      webRuntime:
        'staging-web',
      workerRuntime:
        'staging-worker',
      migrationRuntime:
        'staging-migration',
    },
    migrations: {
      verified: true,
      inventory:
        release.migrations,
    },
    webReadiness: {
      ready: true,
      checkedAt:
        '2026-09-25T12:05:00.000Z',
    },
    workerReadiness: {
      ready: true,
      checkedAt:
        '2026-09-25T12:05:00.000Z',
    },
    recovery: {
      valid: true,
      checkedAt:
        '2026-09-25T10:00:00.000Z',
      recoveryPointAt:
        '2026-09-25T09:59:00.000Z',
      buildId:
        release.buildId,
    },
  };
}

function production(
  release:
    ReleaseManifest
): ProductionReleaseTarget {
  return {
    schemaVersion: 1,
    environment:
      'production',
    imageDigest:
      release.image.digest,
    identity: {
      database: 'db-production',
      objectBucket:
        'bucket-production',
      secretBoundary:
        'kms-production',
      publicOrigin:
        'https://app.example.com',
      webRuntime:
        'production-web',
      workerRuntime:
        'production-worker',
      migrationRuntime:
        'production-migration',
    },
  };
}

async function main() {
  const release =
    manifest();
  const stage =
    staging(release);
  const prod =
    production(release);

  validateReleaseManifest(
    release
  );

  const result =
    validatePromotionGate({
      manifest: release,
      staging: stage,
      production: prod,
      now: Date.parse(
        '2026-09-25T12:10:00.000Z'
      ),
    });

  assert(
    result.promotable &&
      result.imageDigest ===
        release.image.digest &&
      result.migrationCount ===
        release.migrations.length,
    'Valid H4 release must pass promotion gate.'
  );

  expectCode(
    'RELEASE_ARTIFACT_REBUILD_FORBIDDEN',
    () =>
      validatePromotionGate({
        manifest: release,
        staging: stage,
        production: {
          ...prod,
          imageDigest:
            'sha256:' +
            'd'.repeat(64),
        },
        now: Date.parse(
          '2026-09-25T12:10:00.000Z'
        ),
      })
  );

  for (const key of [
    'database',
    'objectBucket',
    'secretBoundary',
    'publicOrigin',
    'webRuntime',
    'workerRuntime',
    'migrationRuntime',
  ] as const) {
    expectCode(
      'RELEASE_ENVIRONMENT_NOT_SEPARATED',
      () =>
        validatePromotionGate({
          manifest: release,
          staging: stage,
          production: {
            ...prod,
            identity: {
              ...prod.identity,
              [key]:
                stage.identity[key],
            },
          },
          now: Date.parse(
            '2026-09-25T12:10:00.000Z'
          ),
        })
    );
  }

  expectCode(
    'RELEASE_READINESS_FAILED',
    () =>
      validatePromotionGate({
        manifest: release,
        staging: {
          ...stage,
          workerReadiness: {
            ...stage.workerReadiness,
            ready: false,
          },
        },
        production: prod,
        now: Date.parse(
          '2026-09-25T12:10:00.000Z'
        ),
      })
  );

  expectCode(
    'RELEASE_EVIDENCE_STALE',
    () =>
      validatePromotionGate({
        manifest: release,
        staging: {
          ...stage,
          webReadiness: {
            ready: true,
            checkedAt:
              '2026-09-25T10:00:00.000Z',
          },
        },
        production: prod,
        now: Date.parse(
          '2026-09-25T12:10:00.000Z'
        ),
      })
  );

  expectCode(
    'RELEASE_RECOVERY_BUILD_MISMATCH',
    () =>
      validatePromotionGate({
        manifest: release,
        staging: {
          ...stage,
          recovery: {
            ...stage.recovery,
            buildId:
              'different-build',
          },
        },
        production: prod,
        now: Date.parse(
          '2026-09-25T12:10:00.000Z'
        ),
      })
  );

  expectCode(
    'RELEASE_MIGRATION_MISMATCH',
    () =>
      validatePromotionGate({
        manifest: release,
        staging: {
          ...stage,
          migrations: {
            verified: true,
            inventory:
              stage.migrations
                .inventory.slice(
                  0,
                  -1
                ),
          },
        },
        production: prod,
        now: Date.parse(
          '2026-09-25T12:10:00.000Z'
        ),
      })
  );

  expectCode(
    'RELEASE_SUPPLY_CHAIN_FAILED',
    () =>
      validateReleaseManifest({
        ...release,
        supplyChain: {
          ...release.supplyChain,
          containerScanPassed:
            false,
        },
      })
  );

  validateRollbackDecision({
    currentManifest: release,
    decision: {
      mode: 'FORWARD_FIX',
    },
  });

  expectCode(
    'RELEASE_ROLLBACK_SCHEMA_UNVERIFIED',
    () =>
      validateRollbackDecision({
        currentManifest:
          release,
        decision: {
          mode:
            'APP_ROLLBACK',
          targetImageDigest:
            'sha256:' +
            'e'.repeat(64),
          schemaCompatibilityVerified:
            false,
          compatibleMigrationInventory:
            release.migrations,
        },
      })
  );

  validateRollbackDecision({
    currentManifest: release,
    decision: {
      mode:
        'APP_ROLLBACK',
      targetImageDigest:
        'sha256:' +
        'e'.repeat(64),
      schemaCompatibilityVerified:
        true,
      compatibleMigrationInventory:
        release.migrations,
    },
  });

  expectCode(
    'RELEASE_RESTORE_UNVERIFIED',
    () =>
      validateRollbackDecision({
        currentManifest:
          release,
        decision: {
          mode: 'RESTORE',
          isolatedRecoveryValidation:
            {
              valid: false,
              targetEnvironment:
                'recovery',
              checkedAt:
                '2026-09-25T12:00:00.000Z',
            },
        },
      })
  );

  validateRollbackDecision({
    currentManifest: release,
    decision: {
      mode: 'RESTORE',
      isolatedRecoveryValidation:
        {
          valid: true,
          targetEnvironment:
            'recovery',
          checkedAt:
            '2026-09-25T12:00:00.000Z',
        },
    },
  });

  console.log(
    'PRODUCTION_H4_RELEASE_PROMOTION_CONTRACT_CHECK_PASSED'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_H4_RELEASE_PROMOTION_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
