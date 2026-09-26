import fs from 'fs';

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
  const app = read('src/App.tsx');
  const header = read(
    'src/components/Header.tsx'
  );
  const session = read(
    'src/session.ts'
  );
  const boundary = read(
    'src/components/SessionBoundary.tsx'
  );
  const diagnostics = read(
    'src/components/DiagnosticsWorkspace.tsx'
  );

  assert(
    session.includes(
      'canViewOperationalDiagnostics'
    ) &&
      session.includes(
        "code: 'SERVICE_DEGRADED'"
      ) &&
      session.includes(
        'A required service is temporarily unavailable.'
      ),
    'J5 must preserve the J2 degraded state while replacing raw 503 details with safe browser guidance.'
  );

  assert(
    !session.includes(
      "status: 'degraded',\n      code: error.code"
    ) &&
      !session.includes(
        "status: 'degraded',\n      code: error?.code"
      ),
    'J5 degraded browser state must not forward backend infrastructure codes.'
  );

  assert(
    boundary.includes(
      'degraded-dependency-state'
    ) &&
      boundary.includes(
        'Knowledge AI is temporarily unavailable'
      ),
    'J5 must preserve the explicit J2 degraded dependency UI.'
  );

  assert(
    header.includes(
      "'diagnostics'"
    ) &&
      header.includes(
        'canViewOperationalDiagnostics'
      ) &&
      header.includes(
        'id="nav-tab-diagnostics"'
      ),
    'J5 Header must expose Diagnostics only through the privileged membership capability.'
  );

  assert(
    app.includes(
      "'diagnostics'"
    ) &&
      app.includes(
        'canViewOperationalDiagnostics'
      ) &&
      app.includes(
        "currentTab === 'diagnostics'"
      ) &&
      app.includes(
        "? 'playground'"
      ) &&
      app.includes(
        '<DiagnosticsWorkspace'
      ),
    'J5 App must block MEMBER direct-URL diagnostics selection and render the workspace only for privileged roles.'
  );

  assert(
    diagnostics.includes(
      "'/api/organization/diagnostics'"
    ) &&
      diagnostics.includes(
        'diagnostics-refresh'
      ) &&
      diagnostics.includes(
        'diagnostics-read-only-boundary'
      ) &&
      diagnostics.includes(
        'diagnostics-no-restore-action'
      ) &&
      diagnostics.includes(
        'diagnostics-no-promotion-action'
      ),
    'J5 diagnostics UI must consume only the sanitized organization endpoint and communicate its read-only boundary.'
  );

  for (const forbiddenAction of [
    'restore-action-button',
    'promote-action-button',
    'rollback-action-button',
    'migration-action-button',
    'method: \'POST\'',
    'method: \'PATCH\'',
    'method: \'DELETE\'',
  ]) {
    assert(
      !diagnostics.includes(
        forbiddenAction
      ),
      'J5 diagnostics UI must not invent infrastructure mutation control: ' +
        forbiddenAction
    );
  }

  for (const leakedTerm of [
    'DATABASE_URL',
    'SOURCE_STORAGE_BUCKET',
    'SOURCE_STORAGE_SECRET_ACCESS_KEY',
    'KNOWLEDGE_AI_SECRET_KMS',
    'storageBucket',
    'databaseUrl',
    'processRole',
    'MIGRATION_DRIFT_',
  ]) {
    assert(
      !diagnostics.includes(
        leakedTerm
      ),
      'J5 diagnostics UI must not contain low-level infrastructure detail: ' +
        leakedTerm
    );
  }

  assert(
    !fs.existsSync(
      'src/components/Phase7ReadinessView.tsx'
    ) &&
      !fs.existsSync(
        'src/components/Phase8OperationalDashboard.tsx'
      ) &&
      !fs.existsSync(
        'src/components/Phase9SaaSPlatformView.tsx'
      ) &&
      !app.includes(
        'Phase7ReadinessView'
      ) &&
      !app.includes(
        'Phase8OperationalDashboard'
      ) &&
      !app.includes(
        'Phase9SaaSPlatformView'
      ),
    'J5 diagnostics must remain supported and privileged after J6 removes deprecated phase-numbered operator UI.'
  );

  console.log(
    'PRODUCTION_J5_RECOVERY_DIAGNOSTICS_UI_CHECK_PASSED'
  );
  console.log(
    'Privileged navigation, direct-URL gating, sanitized 503 UX, read-only diagnostics, no unsafe recovery controls, and post-J6 legacy operator UI removal are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J5_RECOVERY_DIAGNOSTICS_UI_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
