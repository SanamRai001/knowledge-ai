import fs from 'fs';
import {
  OperatorDiagnosticsService,
} from '../server/operations/operatorDiagnosticsService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const rawSecrets = [
    'postgres://user:super-secret@private-db.internal/prod',
    'MIGRATION_DRIFT_021_private_checksum',
    'company-prod-private-bucket',
    'kms-key-prod-secret-material',
    'future-provider-token=top-secret',
  ];

  const service =
    new OperatorDiagnosticsService({
      async checkWebReadiness() {
        return {
          target: 'WEB',
          ready: false,
          checkedAt:
            1_795_000_000_000,
          processRole:
            'web',
          checks: [
            {
              id:
                'PROCESS_ROLE_VALID',
              status: 'PASS',
              durationMs: 4,
              detail:
                'ROLE_web_ALLOWED',
            },
            {
              id:
                'POSTGRES_REACHABLE',
              status: 'FAIL',
              durationMs: 18,
              detail:
                rawSecrets[0],
            },
            {
              id:
                'SCHEMA_CURRENT',
              status: 'FAIL',
              durationMs: 2,
              detail:
                rawSecrets[1],
            },
            {
              id:
                'OBJECT_STORAGE_CONFIGURED',
              status: 'FAIL',
              durationMs: 1,
              detail:
                rawSecrets[2],
            },
            {
              id:
                'SECRET_KMS_CONFIGURED',
              status: 'FAIL',
              durationMs: 1,
              detail:
                rawSecrets[3],
            },
            {
              id:
                'FUTURE_UNSAFE_CHECK',
              status: 'FAIL',
              durationMs: 1,
              detail:
                rawSecrets[4],
            },
          ],
        };
      },
    });

  const summary =
    await service.summary();
  const serialized =
    JSON.stringify(summary);

  assert(
    summary.status ===
      'DEGRADED' &&
      summary.checks.length === 5,
    'J5 diagnostics must preserve safe known readiness outcomes and drop unknown future checks.'
  );

  for (const secret of rawSecrets) {
    assert(
      !serialized.includes(secret),
      'J5 sanitized diagnostics leaked raw readiness detail: ' +
        secret
    );
  }

  for (const forbidden of [
    'processRole',
    'durationMs',
    'databaseUrl',
    'storageBucket',
    'kmsKey',
    'stack',
  ]) {
    assert(
      !serialized.includes(
        forbidden
      ),
      'J5 browser diagnostics must not expose low-level field ' +
        forbidden
    );
  }

  assert(
    summary.recovery.mode ===
      'DEPLOYMENT_OPERATED' &&
      summary.recovery
        .inAppRestoreAvailable ===
        false &&
      summary.release.mode ===
        'DEPLOYMENT_OPERATED' &&
      summary.release
        .inAppPromotionAvailable ===
        false &&
      summary.release
        .automaticDownMigration ===
        false,
    'J5 must describe recovery/release policy without authorizing browser restore, promotion, rollback, or down-migration.'
  );

  const organizationRouter = read(
    'server/identity/organizationRouter.ts'
  );
  assert(
    organizationRouter.includes(
      "'/diagnostics'"
    ) &&
      organizationRouter.includes(
        'operatorDiagnosticsService'
      ),
    'J5 organization router must expose the sanitized diagnostics service.'
  );

  const routeStart =
    organizationRouter.indexOf(
      "  '/diagnostics'"
    );
  const routeEnd =
    organizationRouter.indexOf(
      "organizationRouter.get(",
      routeStart + 10
    );
  const route =
    organizationRouter.slice(
      routeStart,
      routeEnd > routeStart
        ? routeEnd
        : undefined
    );

  assert(
    route.includes(
      'requireOwnerOrAdmin'
    ) &&
      route.includes(
        '.summary()'
      ) &&
      !route.includes(
        'req.query'
      ) &&
      !route.includes(
        'req.body'
      ),
    'J5 diagnostics route must be OWNER/ADMIN-only, read-only, and not expose raw-detail toggles.'
  );

  const server = read('server.ts');
  assert(
    server.includes(
      "app.use(\n  '/api/organization',\n  organizationRouter"
    ),
    'J5 diagnostics must remain behind the authenticated organization router mount.'
  );

  console.log(
    'PRODUCTION_J5_RECOVERY_DIAGNOSTICS_CHECK_PASSED'
  );
  console.log(
    'Sanitized readiness mapping, privileged read-only routing, secret redaction, and deployment-operated recovery/release policy are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J5_RECOVERY_DIAGNOSTICS_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
