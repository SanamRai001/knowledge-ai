export const PRODUCTION_NODE_MAJOR = 22 as const;

export const productionEntrypoints = {
  web: {
    packageScript: 'start',
    command:
      'node dist/private/server.cjs',
    processRole: 'web',
    livenessPath: '/api/health',
    readinessPath: '/api/ready',
  },
  worker: {
    packageScript: 'start:worker',
    command:
      'node dist/private/worker.cjs',
    processRole: 'worker',
  },
  migration: {
    packageScript: 'db:migrate',
    currentCommand:
      'node dist/private/db-migrate.cjs',
    requiresMigrationSqlDirectory: true,
    currentlyRequiresDevTooling: false,
  },
  recovery: {
    packageScript: 'recovery:validate',
    currentCommand:
      'node dist/private/recovery-validate.cjs',
    currentlyRequiresDevTooling: false,
  },
  releaseManifest: {
    packageScript:
      'release:manifest',
    command:
      'node dist/private/release-manifest.cjs',
  },
  releaseGate: {
    packageScript:
      'release:gate',
    command:
      'node dist/private/release-gate.cjs',
  },
  releaseMigrationGate: {
    packageScript:
      'release:migration-gate',
    command:
      'node dist/private/release-migration-gate.cjs',
  },
  releaseReadinessSmoke: {
    packageScript:
      'release:readiness-smoke',
    command:
      'node dist/private/release-readiness-smoke.cjs',
  },
} as const;

export const productionImageRequirements = {
  immutableBuild: true,
  runAsNonRoot: true,
  separateWebAndWorkerProcesses: true,
  combinedRoleProductionDefault: false,
  clientStaticRootSeparateFromServerArtifacts: true,
  serverSourceMapsPublic: false,
  buildToolsExcludedFromSteadyStateRuntime: true,
  migrationSqlAvailableToMigrationJob: true,
  migrationAndRecoveryCliAvailableWithoutMutableSourceInstall: true,
  readOnlyApplicationFilesystem: true,
} as const;

export const supplyChainReleaseRequirements = {
  onePackageManager: true,
  committedLockfile: true,
  frozenDependencyInstall: true,
  explicitNodeRuntimeVersion: true,
  githubActionsPinnedToImmutableRevisions: true,
  dependencyVulnerabilityGate: true,
  secretHygieneGate: true,
  sbomForReleaseArtifact: true,
  containerImageScan: true,
  immutableArtifactPromotion: true,
} as const;

export const runtimeEdgeRequirements = {
  httpsRequired: true,
  sameOriginBrowserDeployment: true,
  explicitTrustedProxyTopology: true,
  securityHeadersRequired: true,
  cspRequired: true,
  hstsRequiredAtTlsBoundary: true,
  boundedGeneralRequestBody: true,
  routeSpecificUploadLimits: true,
  gracefulWebDrain: true,
  gracefulWorkerDrain: true,
} as const;

export const migrationRollbackRequirements = {
  migrationsAreForwardOnly: true,
  migrationChecksumsImmutable: true,
  migrationJobSingleWriter: true,
  automaticDownMigrationsForbidden: true,
  oldBuildAgainstNewSchemaRequiresExplicitCompatibilityProof: true,
  incompatibleSchemaRollbackRequiresRestore: true,
  restoreMustUseG3IsolatedValidation: true,
} as const;

export const stagingPromotionRequirements = {
  sameArtifactAsProduction: true,
  separateDatabase: true,
  separateObjectBucket: true,
  separateSecretBoundary: true,
  runMigrationJobBeforeTraffic: true,
  webReadinessRequired: true,
  workerReadinessRequired: true,
  productionRecoveryTargetForbidden: true,
} as const;
