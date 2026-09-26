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
  const session = read('src/session.ts');
  const developer = read(
    'src/components/DeveloperPlatform.tsx'
  );
  const integrations = read(
    'src/components/IntegrationsWorkspace.tsx'
  );
  const integrationRouter = read(
    'server/integrations/integrationRouter.ts'
  );
  const automation = read(
    'src/components/AutomationWorkspace.tsx'
  );
  const automationRouter = read(
    'server/automation/automationRouter.ts'
  );
  const platformManagement = read(
    'server/platform/platformManagementRouter.ts'
  );

  assert(
    header.includes(
      'id="nav-tab-developer"'
    ) &&
      !header.includes(
        'canManageDeveloperPlatform'
      ) &&
      app.includes(
        "effectiveTab === 'developer'"
      ) &&
      app.includes(
        '<DeveloperPlatform'
      ) &&
      app.includes(
        'membershipRole={'
      ),
    'J3 must keep stable Developer documentation reachable inside the authenticated shell instead of hiding the entire workspace from MEMBER users.'
  );

  assert(
    developer.includes(
      'canManageDeveloperPlatform'
    ) &&
      developer.includes(
        'const canManageKeys ='
      ) &&
      developer.includes(
        'developer-admin-boundary'
      ) &&
      developer.includes(
        'if (!canManageKeys)'
      ) &&
      developer.includes(
        "...(canManageKeys"
      ) &&
      developer.includes(
        "tab === 'keys'"
      ) &&
      developer.includes(
        "tab === 'usage'"
      ),
    'J3 Developer workspace must make Platform key/usage administration explicitly OWNER/ADMIN-only.'
  );

  assert(
    developer.includes(
      "'/api/platform/v1/manifest'"
    ) &&
      developer.includes(
        "'/api/platform/v1/tools'"
      ) &&
      developer.includes(
        "'/api/platform/v1/detectors'"
      ) &&
      developer.includes(
        "'/api/platform/v1/domain-packs'"
      ) &&
      developer.includes(
        'Safe read explorer'
      ),
    'J3 must preserve stable Platform documentation, extension inventory, and the bounded read explorer.'
  );

  assert(
    platformManagement.includes(
      'platformManagementRouter.use(requireOwnerOrAdmin)'
    ) &&
      platformManagement.includes(
        "platformManagementRouter.post('/keys'"
      ) &&
      platformManagement.includes(
        "platformManagementRouter.delete('/keys/:id'"
      ),
    'J3 frontend separation must not weaken the server OWNER/ADMIN Platform Management boundary.'
  );

  assert(
    session.includes(
      'canManageIntegrationLifecycle'
    ) &&
      app.includes(
        'canManageIntegrationLifecycle'
      ) &&
      app.includes(
        'canManageLifecycle={'
      ) &&
      integrations.includes(
        'canManageLifecycle: boolean'
      ) &&
      integrations.includes(
        'integration-lifecycle-readonly'
      ) &&
      integrations.includes(
        "action !== 'sync'"
      ),
    'J3 must pass membership capability into Integrations and keep MEMBER status/history/sync separate from lifecycle administration.'
  );

  assert(
    integrations.includes(
      'Sync now'
    ) &&
      integrations.includes(
        'canManageLifecycle &&'
      ) &&
      integrations.includes(
        'integration-reauthorize-button'
      ) &&
      integrations.includes(
        'integration-reset-cursor-button'
      ) &&
      integrations.includes(
        'integration-disconnect-button'
      ),
    'J3 must preserve ordinary Integration sync visibility while gating privileged lifecycle controls.'
  );

  for (const route of [
    "'/google-drive/oauth/start'",
    "'/onedrive/oauth/start'",
    "'/connections/:id/reset-cursor'",
    "'/connections/:id/pause'",
    "'/connections/:id/resume'",
    "'/connections/:id/revoke'",
  ]) {
    const index =
      integrationRouter.indexOf(route);
    assert(
      index >= 0,
      'J3 server Integration contract is missing route ' +
        route
    );
    const nearby =
      integrationRouter.slice(
        index,
        index + 500
      );
    assert(
      nearby.includes(
        'requireOwnerOrAdmin'
      ),
      'J3 privileged Integration route must retain OWNER/ADMIN authorization: ' +
        route
    );
  }

  assert(
    automationRouter.includes(
      'canManagePolicy:'
    ) &&
      automationRouter.includes(
        "role === 'OWNER' || role === 'ADMIN'"
      ) &&
      automation.includes(
        'context?.capabilities.canManagePolicy'
      ) &&
      automation.includes(
        'automation-policy-admin-boundary'
      ) &&
      automation.includes(
        'context?.capabilities.canControlEmergencyStop'
      ) &&
      automation.includes(
        'context?.capabilities.canResolveApprovals'
      ) &&
      automation.includes(
        'context?.capabilities.canCompensate'
      ),
    'J3 Automation workspace must reflect the authenticated backend capability contract for policy and dangerous controls.'
  );

  const policyPut =
    automationRouter.indexOf(
      "automationRouter.put(\n  '/policy',"
    );
  assert(
    policyPut >= 0 &&
      automationRouter
        .slice(
          policyPut,
          policyPut + 300
        )
        .includes(
          'requireOwnerOrAdmin'
        ),
    'J3 must preserve OWNER/ADMIN server authorization for Automation policy writes.'
  );

  assert(
    app.includes(
      "'/api/auth/me'"
    ) &&
      app.includes(
        '<SessionBoundary'
      ) &&
      session.includes(
        'error.status === 401'
      ) &&
      session.includes(
        'error.status === 403'
      ) &&
      session.includes(
        'error.status === 429'
      ) &&
      session.includes(
        'error.status === 503'
      ),
    'J3 must preserve the J2 session-first and explicit failure-state shell.'
  );

  console.log(
    'PRODUCTION_J3_ADMIN_DEVELOPER_SEPARATION_CHECK_PASSED'
  );
  console.log(
    'Member-safe Developer docs, OWNER/ADMIN Platform Management, Integration lifecycle separation, Automation capability-aware controls, and preserved J2 session boundaries are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J3_ADMIN_DEVELOPER_SEPARATION_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
