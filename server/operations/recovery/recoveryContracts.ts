import {
  RECOVERY_OBJECTIVES,
} from '../productionOperationsContract.js';

export type RecoveryTargetEnvironment =
  | 'recovery'
  | 'staging'
  | 'test';

export interface RelationalBackupEvidence {
  evidenceSource: string;
  checkedAt: number;
  latestRecoveryPointAt: number;
  continuousBackupEnabled: boolean;
  pitrEnabled: boolean;
  estimatedRestoreMinutes: number;
  backupBuildId: string;
}

export interface ObjectStorageProtectionEvidence {
  evidenceSource: string;
  checkedAt: number;
  backend: string;
  versioningEnabled: boolean;
  recoverableDeleteWindowDays?:
    | number
    | null;
  detailCode?: string;
}

export interface ExternalRestoreEvidence {
  evidenceSource: string;
  restoredAt: number;
  recoveryPointAt: number;
  backupBuildId: string;
}

export interface RecoveryTarget {
  environment:
    RecoveryTargetEnvironment;
  databaseUrl: string;
  storageBackend: string;
  storageBucket: string;
  buildId: string;
}

export interface RecoveryValidationCheck {
  id: string;
  status:
    | 'PASS'
    | 'FAIL'
    | 'SKIP';
  detail?: string;
  durationMs?: number;
}

export interface RecoverySmokeSummary {
  workspaceId?: string;
  documentCount: number;
  documentPageCount: number;
  datasetId?: string;
  datasetVersionCount: number;
  datasetHistoricalVersionCount: number;
  datasetTableCount: number;
  workerJobCount: number;
  workerJobStatusCounts:
    Record<string, number>;
  secretVersionCount: number;
  kmsKeyIdsValidated: string[];
}

export interface RecoveryValidationReport {
  valid: boolean;
  targetEnvironment:
    RecoveryTargetEnvironment;
  checkedAt: number;
  buildId: string;
  recoveryPointAt: number;
  checks: RecoveryValidationCheck[];
  smoke: RecoverySmokeSummary;
}

export interface RecoveryEvidenceProvider {
  relationalBackup():
    Promise<RelationalBackupEvidence>;
  externalRestore():
    Promise<ExternalRestoreEvidence>;
}

export interface ObjectStorageRecoveryInspector {
  inspect():
    Promise<ObjectStorageProtectionEvidence>;
}

export class RecoveryValidationError
  extends Error
{
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name =
      'RecoveryValidationError';
  }
}

export const RECOVERY_REQUIREMENTS = {
  relationalRpoMinutes:
    RECOVERY_OBJECTIVES
      .relationalState
      .targetRpoMinutes,
  relationalRtoMinutes:
    RECOVERY_OBJECTIVES
      .relationalState
      .targetRtoMinutes,
  objectRpoMinutes:
    RECOVERY_OBJECTIVES
      .objectPayloads
      .targetRpoMinutes,
  objectRtoMinutes:
    RECOVERY_OBJECTIVES
      .objectPayloads
      .targetRtoMinutes,
  minimumRecoverableDeleteWindowDays:
    RECOVERY_OBJECTIVES
      .objectPayloads
      .minimumRecoverableDeleteWindowDays,
  restoreValidationMaxAgeDays:
    RECOVERY_OBJECTIVES
      .restoreValidation
      .automatedRestoreTestAtLeastEveryDays,
} as const;
