import {
  spawnSync,
} from 'child_process';

const image =
  process.env.H2_IMAGE_TAG ||
  'knowledge-ai:h2-smoke';

function run(args, options = {}) {
  const result = spawnSync(
    'docker',
    args,
    {
      encoding: 'utf8',
      ...options,
    }
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(
      'Docker command failed: docker ' +
        args.join(' ')
    );
  }

  return (
    (result.stdout || '') +
    (result.stderr || '')
  );
}

function expectFailure(
  args,
  expected
) {
  const result = spawnSync(
    'docker',
    args,
    { encoding: 'utf8' }
  );
  const output =
    (result.stdout || '') +
    (result.stderr || '');

  if (result.status === 0) {
    throw new Error(
      'Expected Docker command to fail: docker ' +
        args.join(' ')
    );
  }
  if (!output.includes(expected)) {
    throw new Error(
      'Expected startup failure to contain "' +
        expected +
        '" but received:\n' +
        output
    );
  }
}

try {
  run([
    'build',
    '--tag',
    image,
    '.',
  ], { stdio: 'inherit' });

  const configuredUser = run([
    'image',
    'inspect',
    '--format',
    '{{.Config.User}}',
    image,
  ]).trim();

  if (configuredUser !== 'node') {
    throw new Error(
      'H2 runtime image must configure USER node.'
    );
  }

  run([
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    image,
    '-lc',
    [
      'set -eu',
      'test "$(id -u)" -ne 0',
      'test -f /app/dist/public/index.html',
      'test -f /app/dist/private/server.cjs',
      'test -f /app/dist/private/worker.cjs',
      'test -f /app/dist/private/db-migrate.cjs',
      'test -f /app/dist/private/db-import-legacy.cjs',
      'test -f /app/dist/private/recovery-validate.cjs',
      'test -d /app/server/persistence/migrations',
      'test "$(find /app/server/persistence/migrations -type f -name "*.sql" | wc -l)" -gt 0',
      'test ! -e /app/server.ts',
      'test ! -e /app/worker.ts',
      'test ! -d /app/src',
      'test ! -d /app/scripts',
      'test ! -d /app/node_modules/vite',
      'test ! -d /app/node_modules/tsx',
      'test ! -d /app/node_modules/typescript',
      'test -z "$(find /app/dist/public -type f -name "*.map" -print -quit)"',
      'test -z "$(find /app/dist/private -type f -name "*.map" -print -quit)"',
    ].join('; '),
  ]);

  expectFailure(
    [
      'run',
      '--rm',
      '-e',
      'NODE_ENV=production',
      '-e',
      'KNOWLEDGE_AI_PROCESS_ROLE=worker',
      '--entrypoint',
      'node',
      image,
      'dist/private/server.cjs',
    ],
    'HTTP server entrypoint cannot run'
  );

  expectFailure(
    [
      'run',
      '--rm',
      '-e',
      'NODE_ENV=production',
      '-e',
      'KNOWLEDGE_AI_PROCESS_ROLE=web',
      '--entrypoint',
      'node',
      image,
      'dist/private/worker.cjs',
    ],
    'worker entrypoint cannot run'
  );

  console.log(
    'PRODUCTION_H2_IMAGE_SMOKE_CHECK_PASSED'
  );
} finally {
  spawnSync(
    'docker',
    ['image', 'rm', '-f', image],
    { stdio: 'ignore' }
  );
}
