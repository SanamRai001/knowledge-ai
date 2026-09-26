import {
  productionReadinessService,
  type ProductionReadinessReport,
} from './productionReadinessService.js';
import {
  RECOVERY_REQUIREMENTS,
} from './recovery/recoveryContracts.js';

export type OperatorDiagnosticStatus =
  | 'OPERATIONAL'
  | 'DEGRADED';

export interface SafeOperatorDiagnosticCheck {
  id:
    | 'runtime'
    | 'database'
    | 'schema'
    | 'object-storage'
    | 'secret-protection';
  label: string;
  status: OperatorDiagnosticStatus;
  guidance: string;
}

export interface SafeOperatorDiagnostics {
  status: OperatorDiagnosticStatus;
  checkedAt: number;
  checks: SafeOperatorDiagnosticCheck[];
  recovery: {
    mode: 'DEPLOYMENT_OPERATED';
    inAppRestoreAvailable: false;
    targetRpoMinutes: number;
    targetRtoMinutes: number;
    minimumRecoverableDeleteWindowDays: number;
    validationMaxAgeDays: number;
    guidance: string;
  };
  release: {
    mode: 'DEPLOYMENT_OPERATED';
    inAppPromotionAvailable: false;
    buildOncePromotion: true;
    requiresWebReadiness: true;
    requiresWorkerReadiness: true;
    requiresRecoveryEvidence: true;
    automaticDownMigration: false;
    guidance: string;
  };
}

type ReadinessProvider = {
  checkWebReadiness():
    Promise<ProductionReadinessReport>;
};

type SafeCheckDefinition = {
  id: SafeOperatorDiagnosticCheck['id'];
  label: string;
  passGuidance: string;
  failGuidance: string;
};

const SAFE_CHECKS:
  Readonly<
    Record<
      string,
      SafeCheckDefinition
    >
  > = {
    PROCESS_ROLE_VALID: {
      id: 'runtime',
      label: 'Application runtime',
      passGuidance:
        'The web runtime is available for this role.',
      failGuidance:
        'The application runtime is not ready. Retry shortly or contact the deployment operator.',
    },
    POSTGRES_REACHABLE: {
      id: 'database',
      label: 'Data service',
      passGuidance:
        'The primary data service is reachable.',
      failGuidance:
        'The primary data service is temporarily unavailable.',
    },
    SCHEMA_CURRENT: {
      id: 'schema',
      label: 'Application data compatibility',
      passGuidance:
        'Application data compatibility checks passed.',
      failGuidance:
        'The running application and data schema are not ready together.',
    },
    OBJECT_STORAGE_CONFIGURED: {
      id: 'object-storage',
      label: 'Durable file storage',
      passGuidance:
        'Durable file storage is configured.',
      failGuidance:
        'Durable file storage is not ready.',
    },
    SECRET_KMS_CONFIGURED: {
      id: 'secret-protection',
      label: 'Protected credentials',
      passGuidance:
        'Protected credential storage is configured.',
      failGuidance:
        'Protected credential storage is not ready.',
    },
  };

function safeStatus(
  status: 'PASS' | 'FAIL'
): OperatorDiagnosticStatus {
  return status === 'PASS'
    ? 'OPERATIONAL'
    : 'DEGRADED';
}

export class OperatorDiagnosticsService {
  constructor(
    private readonly readiness:
      ReadinessProvider =
        productionReadinessService
  ) {}

  async summary():
    Promise<SafeOperatorDiagnostics> {
    const report =
      await this.readiness
        .checkWebReadiness();

    const checks =
      report.checks.flatMap(
        (item) => {
          const definition =
            SAFE_CHECKS[item.id];
          if (!definition) {
            return [];
          }

          const status =
            safeStatus(item.status);
          return [
            {
              id: definition.id,
              label:
                definition.label,
              status,
              guidance:
                status ===
                'OPERATIONAL'
                  ? definition
                      .passGuidance
                  : definition
                      .failGuidance,
            } satisfies SafeOperatorDiagnosticCheck,
          ];
        }
      );

    return {
      status: report.ready
        ? 'OPERATIONAL'
        : 'DEGRADED',
      checkedAt:
        report.checkedAt,
      checks,
      recovery: {
        mode:
          'DEPLOYMENT_OPERATED',
        inAppRestoreAvailable:
          false,
        targetRpoMinutes:
          RECOVERY_REQUIREMENTS
            .relationalRpoMinutes,
        targetRtoMinutes:
          RECOVERY_REQUIREMENTS
            .relationalRtoMinutes,
        minimumRecoverableDeleteWindowDays:
          RECOVERY_REQUIREMENTS
            .minimumRecoverableDeleteWindowDays,
        validationMaxAgeDays:
          RECOVERY_REQUIREMENTS
            .restoreValidationMaxAgeDays,
        guidance:
          'Restore validation is performed against an isolated recovery target by the deployment operator. Knowledge AI does not expose a browser restore action.',
      },
      release: {
        mode:
          'DEPLOYMENT_OPERATED',
        inAppPromotionAvailable:
          false,
        buildOncePromotion: true,
        requiresWebReadiness:
          true,
        requiresWorkerReadiness:
          true,
        requiresRecoveryEvidence:
          true,
        automaticDownMigration:
          false,
        guidance:
          'Promotion and rollback decisions are deployment-operated release-gate workflows. Knowledge AI does not expose a browser promote or rollback action.',
      },
    };
  }
}

export const operatorDiagnosticsService =
  new OperatorDiagnosticsService();
