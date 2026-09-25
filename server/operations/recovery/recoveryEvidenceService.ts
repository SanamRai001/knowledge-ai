import {
  operationalTelemetry,
} from '../operationalTelemetry.js';
import {
  RECOVERY_REQUIREMENTS,
  RecoveryValidationError,
  type ExternalRestoreEvidence,
  type ObjectStorageProtectionEvidence,
  type RecoveryValidationCheck,
  type RelationalBackupEvidence,
} from './recoveryContracts.js';

function ageMs(
  now: number,
  timestamp: number
): number {
  return Math.max(
    0,
    now - timestamp
  );
}

function check(
  id: string,
  condition: boolean,
  passDetail: string,
  failDetail: string
): RecoveryValidationCheck {
  return {
    id,
    status: condition
      ? 'PASS'
      : 'FAIL',
    detail: condition
      ? passDetail
      : failDetail,
  };
}

export interface RecoveryEvidenceValidation {
  valid: boolean;
  checks: RecoveryValidationCheck[];
}

export function validateRecoveryEvidence(
  input: {
    relational:
      RelationalBackupEvidence;
    objectStorage:
      ObjectStorageProtectionEvidence;
    restore:
      ExternalRestoreEvidence;
    buildId: string;
    now?: number;
  }
): RecoveryEvidenceValidation {
  const now =
    input.now ?? Date.now();
  const relationalAgeMinutes =
    ageMs(
      now,
      input.relational
        .latestRecoveryPointAt
    ) / 60_000;
  const restoreAgeSeconds =
    ageMs(
      now,
      input.restore.restoredAt
    ) / 1000;

  const checks:
    RecoveryValidationCheck[] = [
      check(
        'RELATIONAL_CONTINUOUS_BACKUP',
        input.relational
          .continuousBackupEnabled,
        'CONTINUOUS_BACKUP_ENABLED',
        'CONTINUOUS_BACKUP_REQUIRED'
      ),
      check(
        'RELATIONAL_PITR',
        input.relational
          .pitrEnabled,
        'PITR_ENABLED',
        'PITR_REQUIRED'
      ),
      check(
        'RELATIONAL_RPO',
        relationalAgeMinutes <=
          RECOVERY_REQUIREMENTS
            .relationalRpoMinutes,
        'RECOVERY_POINT_WITHIN_' +
          RECOVERY_REQUIREMENTS
            .relationalRpoMinutes +
          '_MINUTES',
        'RECOVERY_POINT_TOO_OLD'
      ),
      check(
        'RELATIONAL_RTO',
        input.relational
          .estimatedRestoreMinutes <=
          RECOVERY_REQUIREMENTS
            .relationalRtoMinutes,
        'RESTORE_ESTIMATE_WITHIN_' +
          RECOVERY_REQUIREMENTS
            .relationalRtoMinutes +
          '_MINUTES',
        'RESTORE_ESTIMATE_EXCEEDS_RTO'
      ),
      check(
        'BACKUP_BUILD_ID',
        Boolean(
          input.relational
            .backupBuildId
        ) &&
          input.relational
            .backupBuildId ===
            input.buildId,
        'BACKUP_BUILD_MATCHES_RUNNING_BUILD',
        'BACKUP_BUILD_MISMATCH'
      ),
      check(
        'RESTORE_BUILD_ID',
        Boolean(
          input.restore.backupBuildId
        ) &&
          input.restore
            .backupBuildId ===
            input.buildId,
        'RESTORE_BUILD_MATCHES_RUNNING_BUILD',
        'RESTORE_BUILD_MISMATCH'
      ),
      check(
        'RESTORE_RECOVERY_POINT',
        input.restore
          .recoveryPointAt ===
          input.relational
            .latestRecoveryPointAt,
        'RESTORE_USED_DECLARED_RECOVERY_POINT',
        'RESTORE_RECOVERY_POINT_MISMATCH'
      ),
      check(
        'OBJECT_VERSIONING',
        input.objectStorage
          .versioningEnabled,
        'OBJECT_VERSIONING_ENABLED',
        'OBJECT_VERSIONING_REQUIRED'
      ),
      check(
        'OBJECT_RECOVERABLE_DELETE_WINDOW',
        input.objectStorage
          .versioningEnabled &&
          (
            input.objectStorage
              .recoverableDeleteWindowDays ===
              null ||
            (
              typeof input.objectStorage
                .recoverableDeleteWindowDays ===
                'number' &&
              input.objectStorage
                .recoverableDeleteWindowDays >=
                RECOVERY_REQUIREMENTS
                  .minimumRecoverableDeleteWindowDays
            )
          ),
        input.objectStorage
          .recoverableDeleteWindowDays ===
          null
          ? 'RECOVERABLE_DELETE_WINDOW_UNBOUNDED'
          : 'RECOVERABLE_DELETE_WINDOW_' +
              String(
                input.objectStorage
                  .recoverableDeleteWindowDays
              ) +
              '_DAYS',
        'RECOVERABLE_DELETE_WINDOW_TOO_SHORT'
      ),
    ];

  operationalTelemetry.recordMetric({
    name:
      'backup_recovery_point_age_seconds',
    kind: 'GAUGE',
    value:
      relationalAgeMinutes * 60,
    labels: {
      component: 'postgres',
      evidence_source:
        input.relational
          .evidenceSource,
    },
  });

  operationalTelemetry.recordMetric({
    name:
      'recovery_validation_age_seconds',
    kind: 'GAUGE',
    value: restoreAgeSeconds,
    labels: {
      validation:
        'external_restore',
    },
  });

  for (const item of checks) {
    operationalTelemetry.recordMetric({
      name:
        'recovery_validation_total',
      kind: 'COUNTER',
      value: 1,
      labels: {
        check: item.id,
        outcome:
          item.status === 'PASS'
            ? 'success'
            : 'failure',
      },
    });
  }

  const valid = checks.every(
    (item) =>
      item.status === 'PASS'
  );

  operationalTelemetry.emitEvent({
    level: valid
      ? 'info'
      : 'error',
    eventName:
      'recovery.evidence.validated',
    component: 'recovery',
    outcome: valid
      ? 'success'
      : 'failure',
    metadata: {
      checkCount:
        checks.length,
      failedCheckCount:
        checks.filter(
          (item) =>
            item.status === 'FAIL'
        ).length,
      objectBackend:
        input.objectStorage.backend,
    },
  });

  return {
    valid,
    checks,
  };
}

export function assertRecoveryEvidence(
  validation:
    RecoveryEvidenceValidation
): void {
  if (validation.valid) {
    return;
  }

  const failed =
    validation.checks
      .filter(
        (item) =>
          item.status === 'FAIL'
      )
      .map((item) => item.id)
      .join(',');

  throw new RecoveryValidationError(
    'RECOVERY_EVIDENCE_FAILED',
    'Recovery evidence failed required checks: ' +
      failed
  );
}
