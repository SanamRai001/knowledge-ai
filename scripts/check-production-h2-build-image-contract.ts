import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const workflow = read('.github/workflows/quality.yml');
  const vite = read('vite.config.ts');
  const server = read('server.ts');
  const dockerfile = read('Dockerfile');
  const dockerignore = read('.dockerignore');

  assert(
    pkg.packageManager === 'npm@10.9.2' &&
      pkg.engines?.node === '22.14.x' &&
      pkg.engines?.npm === '10.9.x',
    'H2 must pin the release Node/npm contract.'
  );

  assert(
    fs.existsSync('package-lock.json') &&
      !fs.existsSync('bun.lock') &&
      lock.lockfileVersion === 3 &&
      lock.packages?.['']?.engines?.node === '22.14.x',
    'H2 must use one canonical npm lockfile and remove Bun lockfile authority.'
  );

  assert(
    workflow.includes('node-version: 22.14.0') &&
      workflow.includes('run: npm ci') &&
      !workflow.includes('run: npm install'),
    'Quality Gate must use exact Node plus frozen npm ci installation.'
  );

  assert(
    pkg.scripts.build.includes('clean:dist') &&
      pkg.scripts.build.includes('build:client') &&
      pkg.scripts.build.includes('build:web') &&
      pkg.scripts.build.includes('build:worker') &&
      pkg.scripts.build.includes('build:ops') &&
      pkg.scripts['build:web'].includes('dist/private/server.cjs') &&
      pkg.scripts['build:worker'].includes('dist/private/worker.cjs') &&
      !pkg.scripts['build:web'].includes('--sourcemap') &&
      !pkg.scripts['build:worker'].includes('--sourcemap') &&
      !pkg.scripts['build:ops'].includes('--sourcemap'),
    'H2 build must split private bundles and omit private production source maps.'
  );

  assert(
    pkg.scripts.start === 'node dist/private/server.cjs' &&
      pkg.scripts['start:worker'] === 'node dist/private/worker.cjs' &&
      pkg.scripts['db:migrate'] === 'node dist/private/db-migrate.cjs' &&
      pkg.scripts['db:import-legacy'] === 'node dist/private/db-import-legacy.cjs' &&
      pkg.scripts['recovery:validate'] === 'node dist/private/recovery-validate.cjs',
    'H2 production entrypoints must execute compiled immutable artifacts.'
  );

  assert(
    vite.includes("outDir: 'dist/public'") &&
      vite.includes('sourcemap: false') &&
      server.includes("await import('vite')") &&
      !server.includes("from 'vite'") &&
      server.includes("'dist',\n      'public'") &&
      server.includes('app.use(express.static(distPath))'),
    'H2 client output must be public-only and Vite must stay out of production runtime imports.'
  );

  assert(
    fs.existsSync('scripts/clean-dist.mjs') &&
      !fs.existsSync('.github/workflows/h2-lockfile-refresh.yml'),
    'H2 must retain deterministic dist cleanup without a branch-only lock refresh workflow.'
  );

  assert(
    dockerfile.includes('ARG NODE_VERSION=22.14.0') &&
      dockerfile.includes('AS build') &&
      dockerfile.includes('AS runtime') &&
      dockerfile.includes('npm ci') &&
      dockerfile.includes('npm prune --omit=dev') &&
      dockerfile.includes('COPY --from=build --chown=node:node /app/dist ./dist') &&
      dockerfile.includes('/app/server/persistence/migrations ./server/persistence/migrations') &&
      dockerfile.includes('USER node') &&
      dockerfile.includes('CMD ["node", "dist/private/server.cjs"]'),
    'H2 Dockerfile must be multi-stage, frozen-install, minimal, non-root, and web-default.'
  );

  const runtimeStage =
    dockerfile.slice(dockerfile.indexOf('AS runtime'));
  for (const forbidden of [
    'COPY server.ts',
    'COPY worker.ts',
    'COPY src ',
    'COPY scripts ',
    'COPY assets ',
  ]) {
    assert(
      !runtimeStage.includes(forbidden),
      'H2 runtime image must not copy mutable source tree: ' + forbidden
    );
  }

  for (const required of [
    'node_modules',
    'dist',
    'data',
    '.env',
    'coverage',
  ]) {
    assert(
      dockerignore.includes(required),
      'H2 Docker context ignore is missing: ' + required
    );
  }

  console.log(
    'PRODUCTION_H2_BUILD_IMAGE_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Canonical npm lock, exact runtime versions, frozen CI installs, public/private artifact separation, compiled ops entrypoints, and non-root multi-stage image contract are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_H2_BUILD_IMAGE_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
