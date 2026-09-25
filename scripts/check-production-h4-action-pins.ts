import fs from 'fs';
import path from 'path';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const workflowDir =
  path.join(
    process.cwd(),
    '.github',
    'workflows'
  );

const files =
  fs.readdirSync(workflowDir)
    .filter((name) =>
      name.endsWith('.yml') ||
      name.endsWith('.yaml')
    );

let useCount = 0;

for (const name of files) {
  const source =
    fs.readFileSync(
      path.join(
        workflowDir,
        name
      ),
      'utf8'
    );

  const matches =
    source.matchAll(
      /\buses:\s*([^\s@]+)@([^\s#]+)/g
    );

  for (const match of matches) {
    useCount += 1;
    const action =
      match[1];
    const revision =
      match[2];

    assert(
      /^[0-9a-f]{40}$/.test(
        revision
      ),
      'GitHub Action ' +
        action +
        ' in ' +
        name +
        ' must be pinned to an immutable 40-character commit SHA.'
    );
  }

  assert(
    source.includes(
      'permissions:'
    ),
    name +
      ' must declare explicit GitHub token permissions.'
  );
}

assert(
  useCount > 0,
  'Expected at least one GitHub Action reference.'
);

console.log(
  'PRODUCTION_H4_ACTION_PIN_CHECK_PASSED'
);
