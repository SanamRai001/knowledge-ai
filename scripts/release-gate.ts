import fs from 'fs';
import {
  validatePromotionGate,
  validateRollbackDecision,
  type ProductionReleaseTarget,
  type ReleaseManifest,
  type RollbackDecision,
  type StagingReleaseEvidence,
} from '../server/deployment/releaseGate.js';

function readJson<T>(
  envName: string
): T {
  const file =
    process.env[envName]
      ?.trim();
  if (!file) {
    throw new Error(
      envName + ' is required.'
    );
  }
  return JSON.parse(
    fs.readFileSync(
      file,
      'utf8'
    )
  ) as T;
}

const manifest =
  readJson<ReleaseManifest>(
    'KNOWLEDGE_AI_RELEASE_MANIFEST_FILE'
  );
const staging =
  readJson<StagingReleaseEvidence>(
    'KNOWLEDGE_AI_STAGING_EVIDENCE_FILE'
  );
const production =
  readJson<ProductionReleaseTarget>(
    'KNOWLEDGE_AI_PRODUCTION_TARGET_FILE'
  );

const result =
  validatePromotionGate({
    manifest,
    staging,
    production,
  });

const rollbackFile =
  process.env
    .KNOWLEDGE_AI_ROLLBACK_DECISION_FILE
    ?.trim();

if (rollbackFile) {
  const decision =
    JSON.parse(
      fs.readFileSync(
        rollbackFile,
        'utf8'
      )
    ) as RollbackDecision;
  validateRollbackDecision({
    decision,
    currentManifest:
      manifest,
  });
}

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);
