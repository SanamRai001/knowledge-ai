import fs from 'fs';
import {
  execFileSync,
} from 'node:child_process';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function tracked(path: string): boolean {
  try {
    execFileSync(
      'git',
      [
        'ls-files',
        '--error-unmatch',
        path,
      ],
      {
        stdio: 'ignore',
      }
    );
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const pkg = JSON.parse(read('package.json'));
  const workflow = read(
    '.github/workflows/quality.yml'
  );
  const server = read('server.ts');
  const worker = read('worker.ts');
  const processRole = read(
    'server/runtime/processRole.ts'
  );
  const backgroundRuntime = read(
    'server/runtime/backgroundRuntime.ts'
  );
  const workerRuntime = read(
    'server/worker/workerJobRuntime.ts'
  );
  const readiness = read(
    'server/operations/productionReadinessService.ts'
  );
  const authSecurity = read(
    'server/identity/authHttpSecurity.ts'
  );
  const identityMiddleware = read(
    'server/requestIdentityMiddleware.ts'
  );
  const migrationRunner = read(
    'server/persistence/migrationRunner.ts'
  );
  const datasetRouter = read(
    'server/datasets/datasetRouter.ts'
  );
  const csvParser = read(
    'server/datasets/csvParser.ts'
  );
  const xlsxParser = read(
    'server/datasets/xlsxParser.ts'
  );
  const env = read('.env.example');
  const deploymentContract = read(
    'server/deployment/productionDeploymentContract.ts'
  );
  const audit = read(
    'docs/PRODUCTION_H1_DEPLOYMENT_SUPPLY_CHAIN_AUDIT.md'
  );

  for (const scriptName of [
    'build',
    'start',
    'start:worker',
    'db:migrate',
    'recovery:validate',
  ]) {
    assert(
      typeof pkg.scripts?.[scriptName] ===
        'string',
      'H1 entrypoint inventory is missing package script: ' +
        scriptName
    );
  }

  assert(
    pkg.scripts['build:web'].includes(
      'dist/private/server.cjs'
    ) &&
      pkg.scripts['build:worker'].includes(
        'dist/private/worker.cjs'
      ) &&
      server.includes(
        "'dist',\n      'public'"
      ) &&
      server.includes(
        'app.use(express.static(distPath))'
      ) &&
      fs.readFileSync(
        'vite.config.ts',
        'utf8'
      ).includes(
        "outDir: 'dist/public'"
      ),
    'H1 historical guard must recognize H2 public/private artifact separation.'
  );

  assert(
    fs.existsSync('Dockerfile') &&
      fs.readFileSync(
        'Dockerfile',
        'utf8'
      ).includes('USER node') &&
      fs.readFileSync(
        'Dockerfile',
        'utf8'
      ).includes(
        'npm prune --omit=dev'
      ),
    'H1 historical guard must recognize the H2 non-root multi-stage production image.'
  );

  assert(
    !tracked('bun.lock') &&
      tracked(
        'package-lock.json'
      ) &&
      workflow.includes(
        'run: npm ci'
      ) &&
      !workflow.includes(
        'run: npm install'
      ) &&
      pkg.packageManager ===
        'npm@10.9.2' &&
      pkg.engines?.node ===
        '22.14.x',
    'H1 historical guard must recognize the H2 canonical npm lock and frozen install contract.'
  );

  assert(
    workflow.includes(
      'uses: actions/checkout@v4'
    ) &&
      workflow.includes(
        'uses: actions/setup-node@v4'
      ) &&
      !workflow.includes(
        'npm audit'
      ) &&
      !workflow.includes(
        'permissions:'
      ),
    'H1 must keep current release supply-chain gaps explicit until the release-gate slice.'
  );

  assert(
    processRole.includes(
      'KNOWLEDGE_AI_PROCESS_ROLE must be explicitly set'
    ) &&
      processRole.includes(
        "raw !== 'web'"
      ) &&
      processRole.includes(
        "raw !== 'worker'"
      ),
    'Production web/worker role separation must remain explicit.'
  );

  assert(
    server.includes(
      "app.get('/api/health'"
    ) &&
      server.includes(
        "app.get('/api/ready'"
      ) &&
      readiness.includes(
        "'POSTGRES_REACHABLE'"
      ) &&
      readiness.includes(
        "'SCHEMA_CURRENT'"
      ) &&
      readiness.includes(
        "'OBJECT_STORAGE_CONFIGURED'"
      ) &&
      readiness.includes(
        "'SECRET_KMS_CONFIGURED'"
      ),
    'H1 requires the real G2 liveness/readiness boundary to remain available for deployment.'
  );

  assert(
    !server.includes(
      'runPostgresMigrations'
    ) &&
      worker.includes(
        'Migrations remain a deployment responsibility.'
      ) &&
      pkg.scripts['db:migrate'] ===
        'node dist/private/db-migrate.cjs' &&
      pkg.scripts[
        'db:import-legacy'
      ] ===
        'node dist/private/db-import-legacy.cjs' &&
      pkg.scripts[
        'recovery:validate'
      ] ===
        'node dist/private/recovery-validate.cjs',
    'H1 historical guard must recognize H2 compiled deployment-owned migration/recovery entrypoints.'
  );

  assert(
    !server.includes(
      "process.once('SIGTERM'"
    ) &&
      !server.includes(
        '.close(() =>'
      ) &&
      worker.includes(
        "process.once('SIGTERM'"
      ) &&
      worker.includes(
        'backgroundRuntime.stop()'
      ) &&
      worker.includes(
        'await closePostgresPool()'
      ) &&
      workerRuntime.includes(
        'public stop(): void'
      ) &&
      backgroundRuntime.includes(
        'public stop(): void'
      ),
    'H1 must keep web graceful-shutdown absence and worker timer-only stop semantics explicit until H3.'
  );

  assert(
    authSecurity.includes(
      "'SameSite=Lax'"
    ) &&
      authSecurity.includes(
        "parts.push('Secure')"
      ) &&
      authSecurity.includes(
        "parts.push('HttpOnly')"
      ) &&
      identityMiddleware.includes(
        'requireSameOrigin(req)'
      ) &&
      identityMiddleware.includes(
        'requireDoubleSubmitCsrf(req)'
      ),
    'Browser cookie/origin/CSRF security boundary must remain explicit.'
  );

  assert(
    !server.includes(
      "app.set('trust proxy'"
    ) &&
      !server.includes(
        'Content-Security-Policy'
      ) &&
      !server.includes(
        'Strict-Transport-Security'
      ) &&
      !server.includes(
        "from 'helmet'"
      ),
    'H1 must keep current reverse-proxy/security-header ownership gap explicit until H3.'
  );

  assert(
    server.includes(
      "express.json({ limit: '50mb' })"
    ) &&
      server.includes(
        "express.urlencoded({ extended: true, limit: '50mb' })"
      ) &&
      server.includes(
        'fileSize: 25 * 1024 * 1024'
      ) &&
      server.includes(
        'files: 10'
      ) &&
      datasetRouter.includes(
        'files: 1'
      ) &&
      csvParser.includes(
        'maxFileBytes: 10 * 1024 * 1024'
      ) &&
      xlsxParser.includes(
        'maxFileBytes: 15 * 1024 * 1024'
      ),
    'H1 request/upload limit inventory drifted.'
  );

  assert(
    migrationRunner.includes(
      'schema_migrations'
    ) &&
      migrationRunner.includes(
        "createHash('sha256')"
      ) &&
      migrationRunner.includes(
        'was already applied with different content'
      ) &&
      !migrationRunner.includes(
        'downMigration'
      ),
    'H1 forward-only checksum migration contract must remain explicit.'
  );

  for (const name of [
    'NODE_ENV=',
    'KNOWLEDGE_AI_OPERATIONAL_JSON_LOGS=',
    'KNOWLEDGE_AI_READINESS_TIMEOUT_MS=',
    'KNOWLEDGE_AI_DB_SLOW_QUERY_MS=',
    'KNOWLEDGE_AI_WORKER_READINESS_INTERVAL_MS=',
    'KNOWLEDGE_AI_WORKER_READINESS_MAX_STALENESS_MS=',
    'KNOWLEDGE_AI_PROCESS_ROLE=',
    'KNOWLEDGE_AI_PERSISTENCE_MODE=',
    'DATABASE_URL=',
    'KNOWLEDGE_AI_PUBLIC_ORIGIN=',
    'SOURCE_STORAGE_BACKEND=',
    'SOURCE_STORAGE_BUCKET=',
    'SOURCE_STORAGE_REGION=',
    'KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID=',
    'KNOWLEDGE_AI_SECRET_KEYRING_JSON=',
    'KNOWLEDGE_AI_RECOVERY_ALLOW=',
  ]) {
    assert(
      env.includes(name),
      'H1 environment inventory is missing: ' +
        name
    );
  }

  for (const required of [
    'PRODUCTION_NODE_MAJOR = 22',
    'productionEntrypoints',
    'productionImageRequirements',
    'supplyChainReleaseRequirements',
    'runtimeEdgeRequirements',
    'migrationRollbackRequirements',
    'stagingPromotionRequirements',
    'clientStaticRootSeparateFromServerArtifacts: true',
    'oldBuildAgainstNewSchemaRequiresExplicitCompatibilityProof: true',
    'restoreMustUseG3IsolatedValidation: true',
  ]) {
    assert(
      deploymentContract.includes(
        required
      ),
      'H1 deployment target contract is missing: ' +
        required
    );
  }

  for (const blocker of [
    'BLOCKER H1-01',
    'BLOCKER H1-02',
    'BLOCKER H1-03',
    'BLOCKER H1-04',
    'BLOCKER H1-05',
    'BLOCKER H1-06',
    'BLOCKER H1-07',
    'BLOCKER H1-08',
    'H2 — Reproducible Build + Production Image Foundation',
    'H3 — Runtime Edge + Graceful Shutdown Hardening',
    'H4 — Staging Promotion + Rollback Release Gate',
  ]) {
    assert(
      audit.includes(blocker),
      'H1 evidence is missing required deployment finding/next slice: ' +
        blocker
    );
  }

  console.log(
    'PRODUCTION_H1_DEPLOYMENT_SUPPLY_CHAIN_AUDIT_CHECK_PASSED'
  );
  console.log(
    'H1 deployment contracts remain guarded after H2: reproducible packaging/image blockers are closed while security-header, graceful-shutdown, supply-chain scan/pinning, staging, and rollback-promotion gaps remain explicit for H3/H4.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_H1_DEPLOYMENT_SUPPLY_CHAIN_AUDIT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
