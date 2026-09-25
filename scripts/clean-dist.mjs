import fs from 'fs';
import path from 'path';

const dist = path.join(process.cwd(), 'dist');

fs.rmSync(dist, {
  recursive: true,
  force: true,
});

fs.mkdirSync(
  path.join(dist, 'public'),
  { recursive: true }
);
fs.mkdirSync(
  path.join(dist, 'private'),
  { recursive: true }
);

console.log('H2_DIST_CLEAN');
