import fs from 'fs';
import path from 'path';
import {
  expectedPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  sha256,
  validateReleaseManifest,
  type ReleaseManifest,
} from '../server/deployment/releaseGate.js';

function required(
  name: string
): string {
  const value =
    process.env[name]?.trim();
  if (!value) {
    throw new Error(
      name + ' is required.'
    );
  }
  return value;
}

const sbomPath =
  path.resolve(
    required(
      'KNOWLEDGE_AI_RELEASE_SBOM_PATH'
    )
  );
const sbomBytes =
  fs.readFileSync(sbomPath);

const manifest:
  ReleaseManifest = {
  schemaVersion: 1,
  sourceCommit:
    required(
      'KNOWLEDGE_AI_RELEASE_SOURCE_COMMIT'
    ).toLowerCase(),
  buildId:
    required(
      'KNOWLEDGE_AI_RELEASE_BUILD_ID'
    ),
  createdAt:
    process.env
      .KNOWLEDGE_AI_RELEASE_CREATED_AT
      ?.trim() ||
    new Date().toISOString(),
  nodeVersion: '22.14.0',
  npmVersion: '10.9.2',
  image: {
    reference:
      required(
        'KNOWLEDGE_AI_RELEASE_IMAGE_REF'
      ),
    digest:
      required(
        'KNOWLEDGE_AI_RELEASE_IMAGE_DIGEST'
      ).toLowerCase(),
  },
  migrations:
    expectedPostgresMigrations(),
  sbom: {
    format:
      'cyclonedx-json',
    sha256:
      sha256(sbomBytes),
  },
  supplyChain: {
    dependencyAuditPassed:
      required(
        'KNOWLEDGE_AI_RELEASE_DEPENDENCY_AUDIT'
      ) === 'PASS',
    containerScanPassed:
      required(
        'KNOWLEDGE_AI_RELEASE_CONTAINER_SCAN'
      ) === 'PASS',
    actionPinsVerified:
      required(
        'KNOWLEDGE_AI_RELEASE_ACTION_PINS'
      ) === 'PASS',
  },
};

validateReleaseManifest(
  manifest
);

const serialized =
  JSON.stringify(
    manifest,
    null,
    2
  ) + '\n';

const output =
  process.env
    .KNOWLEDGE_AI_RELEASE_MANIFEST_PATH
    ?.trim();

if (output) {
  fs.mkdirSync(
    path.dirname(
      path.resolve(output)
    ),
    { recursive: true }
  );
  fs.writeFileSync(
    path.resolve(output),
    serialized,
    'utf8'
  );
}

process.stdout.write(
  serialized
);
