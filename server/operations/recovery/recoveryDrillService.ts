import {
  operationalTelemetry,
} from '../operationalTelemetry.js';
import {
  assertRecoveryEvidence,
  validateRecoveryEvidence,
} from './recoveryEvidenceService.js';
import type {
  ObjectStorageRecoveryInspector,
  RecoveryEvidenceProvider,
  RecoveryTarget,
  RecoveryValidationReport,
} from './recoveryContracts.js';
import {
  RecoveryValidationError,
} from './recoveryContracts.js';
import type {
  IsolatedRestoreVerifier,
} from './isolatedRestoreVerifier.js';

export class RecoveryDrillService {
  constructor(
    private readonly evidence:
      RecoveryEvidenceProvider,
    private readonly objectInspector:
      ObjectStorageRecoveryInspector,
    private readonly verifier:
      IsolatedRestoreVerifier
  ) {}

  async run(
    target: RecoveryTarget,
    now: number = Date.now()
  ): Promise<RecoveryValidationReport> {
    const [
      relational,
      restore,
      objectStorage,
    ] = await Promise.all([
      this.evidence
        .relationalBackup(),
      this.evidence
        .externalRestore(),
      this.objectInspector.inspect(),
    ]);

    const evidenceValidation =
      validateRecoveryEvidence({
        relational,
        restore,
        objectStorage,
        buildId: target.buildId,
        now,
      });

    assertRecoveryEvidence(
      evidenceValidation
    );

    const restored =
      await this.verifier.verify();

    for (const item of restored.checks) {
      operationalTelemetry.recordMetric({
        name:
          'recovery_validation_total',
        kind: 'COUNTER',
        value: 1,
        labels: {
          check: item.id,
          outcome:
            item.status === 'FAIL'
              ? 'failure'
              : item.status === 'SKIP'
                ? 'skipped'
                : 'success',
        },
      });
    }

    const checks = [
      ...evidenceValidation.checks,
      ...restored.checks,
    ];
    const valid =
      restored.valid &&
      checks.every(
        (item) =>
          item.status !== 'FAIL'
      );

    operationalTelemetry.emitEvent({
      level: valid
        ? 'info'
        : 'error',
      eventName:
        'recovery.restore.validated',
      component: 'recovery',
      outcome: valid
        ? 'success'
        : 'failure',
      metadata: {
        targetEnvironment:
          target.environment,
        checkCount:
          checks.length,
        failedCheckCount:
          checks.filter(
            (item) =>
              item.status === 'FAIL'
          ).length,
        workspaceRecovered:
          Boolean(
            restored.smoke
              .workspaceId
          ),
        datasetRecovered:
          Boolean(
            restored.smoke
              .datasetId
          ),
        workerJobCount:
          restored.smoke
            .workerJobCount,
        secretVersionCount:
          restored.smoke
            .secretVersionCount,
      },
    });

    if (!valid) {
      throw new RecoveryValidationError(
        'RECOVERY_RESTORE_VALIDATION_FAILED',
        'Isolated restore validation failed one or more required checks.'
      );
    }

    return {
      valid,
      targetEnvironment:
        target.environment,
      checkedAt: now,
      buildId:
        target.buildId,
      recoveryPointAt:
        restore.recoveryPointAt,
      checks,
      smoke:
        restored.smoke,
    };
  }
}
