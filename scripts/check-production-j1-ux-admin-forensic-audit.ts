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
  const developer = read(
    'src/components/DeveloperPlatform.tsx'
  );
  const auth = read(
    'server/identity/authRouter.ts'
  );
  const privileged = read(
    'server/identity/privilegedAuthorization.ts'
  );
  const platformManagement = read(
    'server/platform/platformManagementRouter.ts'
  );
  const automation = read(
    'server/automation/automationRouter.ts'
  );
  const integrations = read(
    'server/integrations/integrationRouter.ts'
  );
  const workspace = read(
    'server/workspaceRouter.ts'
  );
  const aiConfig = read(
    'src/components/SpecializedAIConfig.tsx'
  );

  assert(
    auth.includes("authRouter.get('/me'") &&
      auth.includes(
        'role: context.membership.role'
      ),
    'J1 requires /api/auth/me to expose membership role for a future role-aware shell.'
  );

  assert(
    privileged.includes(
      "export const requireOwnerOrAdmin"
    ) &&
      privileged.includes("'OWNER'") &&
      privileged.includes("'ADMIN'"),
    'J1 expects the hardened OWNER/ADMIN privileged boundary to remain explicit.'
  );

  assert(
    header.includes(
      "export type ActiveTab"
    ) &&
      header.includes("'developer'") &&
      header.includes(
        'id="nav-tab-developer"'
      ) &&
      header.includes(
        'membershipRole'
      ) &&
      !header.includes(
        'id="btn-open-test-suite"'
      ),
    'J1 historical finding must advance with J3: Developer docs remain first-class and Trust Checks stay removed.'
  );

  assert(
    app.includes("'developer'") &&
      app.includes(
        '<DeveloperPlatform'
      ) &&
      app.includes(
        "'/api/auth/me'"
      ) &&
      app.includes(
        '<SessionBoundary'
      ) &&
      app.includes(
        'membershipRole={'
      ),
    'J1 historical finding must advance with J3 safe Developer access inside the authenticated shell.'
  );

  assert(
    developer.includes(
      "'/api/platform-management/keys'"
    ) &&
      developer.includes(
        "'/api/platform-management/usage'"
      ) &&
      developer.includes(
        'developer-admin-boundary'
      ) &&
      developer.includes(
        'if (!canManageKeys)'
      ) &&
      platformManagement.includes(
        'platformManagementRouter.use(requireOwnerOrAdmin)'
      ),
    'J1 historical Developer/admin mismatch must be resolved by J3 while server OWNER/ADMIN authorization remains authoritative.'
  );

  assert(
    automation.includes(
      "  '/policy',"
    ) &&
      automation.includes(
        'requireOwnerOrAdmin'
      ) &&
      automation.includes(
        "automationRouter.get('/context'"
      ),
    'J1 expects Automation to expose a server-side capability context plus privileged policy controls.'
  );

  for (const privilegedRoute of [
    "'/google-drive/oauth/start'",
    "'/onedrive/oauth/start'",
    "'/connections/:id/reset-cursor'",
    "'/connections/:id/pause'",
    "'/connections/:id/resume'",
    "'/connections/:id/revoke'",
  ]) {
    assert(
      integrations.includes(
        privilegedRoute
      ),
      'J1 Integration admin inventory is missing route ' +
        privilegedRoute
    );
  }
  assert(
    integrations.includes(
      'requireOwnerOrAdmin'
    ),
    'J1 expects Integration lifecycle administration to retain OWNER/ADMIN enforcement.'
  );

  assert(
    workspace.includes(
      "workspaceRouter.post('/run-tests'"
    ) &&
      !header.includes(
        'Trust Checks'
      ) &&
      !app.includes(
        'TestSuiteModal'
      ),
    'J1 historical finding must advance with J2: server trust tooling may remain, but it is no longer exposed in the normal product shell.'
  );

  assert(
    fs.existsSync(
      'src/components/Phase7ReadinessView.tsx'
    ) &&
      fs.existsSync(
        'src/components/Phase8OperationalDashboard.tsx'
      ) &&
      fs.existsSync(
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
    'J1 expects phase-numbered orphan UI surfaces to remain unmounted pending J6 cleanup.'
  );

  assert(
    aiConfig.includes(
      'Memory Retrieval Governance (Phase 4)'
    ),
    'J1 phase-numbered production-copy drift finding changed before planned cleanup.'
  );

  const componentListing = fs.readdirSync(
    'src/components'
  );
  assert(
    componentListing.includes(
      'OrganizationWorkspace.tsx'
    ) &&
      header.includes(
        'nav-tab-organization'
      ) &&
      header.includes(
        'account-selector-dropdown'
      ) &&
      app.includes(
        'OrganizationWorkspace'
      ) &&
      app.includes(
        "'/api/auth/select-account'"
      ),
    'J1 historical organization/member gap must advance with J4: organization membership and session-bound account switching are now first-class product surfaces.'
  );

  console.log(
    'PRODUCTION_J1_UX_ADMIN_FORENSIC_AUDIT_CHECK_PASSED'
  );
  console.log(
    'J1 audit remains guarded after J4: session-aware shell, Trust Checks cleanup, admin/developer separation, and organization/member administration have advanced; orphan phase UI, stale phase wording, and later recovery/diagnostics UX remain tracked.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J1_UX_ADMIN_FORENSIC_AUDIT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
