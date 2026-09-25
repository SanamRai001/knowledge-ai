import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, {
    withFileTypes: true,
  })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const publicRoot = path.join(process.cwd(), 'dist', 'public');
const privateRoot = path.join(process.cwd(), 'dist', 'private');

assert(
  fs.existsSync(path.join(publicRoot, 'index.html')),
  'H2 public artifact must contain index.html.'
);

for (const name of [
  'server.cjs',
  'worker.cjs',
  'db-migrate.cjs',
  'db-import-legacy.cjs',
  'recovery-validate.cjs',
]) {
  assert(
    fs.existsSync(path.join(privateRoot, name)),
    'H2 private artifact is missing: ' + name
  );
  assert(
    !fs.existsSync(path.join(publicRoot, name)),
    'Private runtime artifact leaked into public static root: ' + name
  );
}

for (const file of walk(path.join(process.cwd(), 'dist'))) {
  assert(
    !file.endsWith('.map'),
    'H2 production dist must not contain source maps: ' + file
  );
  assert(
    !file.endsWith('.ts') && !file.endsWith('.tsx'),
    'H2 production dist must not contain TypeScript source: ' + file
  );
}

console.log('PRODUCTION_H2_PACKAGE_LAYOUT_CHECK_PASSED');
