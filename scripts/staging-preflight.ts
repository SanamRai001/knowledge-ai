import fs from 'fs';
import path from 'path';
import {
  validateStagingPreflight,
} from '../server/deployment/stagingPreflight.js';

const result =
  validateStagingPreflight();

const serialized =
  JSON.stringify(
    result,
    null,
    2
  ) + '\n';

const output =
  process.env
    .KNOWLEDGE_AI_STAGING_PREFLIGHT_PATH
    ?.trim();

if (output) {
  const resolved =
    path.resolve(output);
  fs.mkdirSync(
    path.dirname(resolved),
    { recursive: true }
  );
  fs.writeFileSync(
    resolved,
    serialized,
    'utf8'
  );
}

process.stdout.write(
  serialized
);
