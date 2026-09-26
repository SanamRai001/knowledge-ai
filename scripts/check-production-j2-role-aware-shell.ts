import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function section(
  source: string,
  start: string,
  end: string
): string {
  const from = source.indexOf(start);
  const to = source.indexOf(
    end,
    from + start.length
  );
  assert(
    from >= 0 && to > from,
    'Could not isolate section: ' +
      start
  );
  return source.slice(from, to);
}

async function main() {
  const app = read('src/App.tsx');
  const header = read(
    'src/components/Header.tsx'
  );
  const session = read('src/session.ts');
  const boundary = read(
    'src/components/SessionBoundary.tsx'
  );
  const auth = read(
    'server/identity/authRouter.ts'
  );
  const developer = read(
    'src/components/DeveloperPlatform.tsx'
  );

  assert(
    auth.includes(
      "authRouter.get('/me'"
    ) &&
      auth.includes(
        'role: context.membership.role'
      ),
    'J2 requires /api/auth/me membership role context.'
  );

  const bootstrap = section(
    app,
    '  const bootstrapShell = useCallback(',
    '  useEffect(() => {'
  );
  assert(
    bootstrap.includes(
      "'/api/auth/me'"
    ) &&
      bootstrap.includes(
        'await fetchActiveKb()'
      ) &&
      bootstrap.indexOf(
        "'/api/auth/me'"
      ) <
        bootstrap.indexOf(
          'await fetchActiveKb()'
        ),
    'J2 must resolve the human session before loading account-scoped product data.'
  );

  assert(
    app.includes(
      "'/api/auth/login'"
    ) &&
      app.includes(
        '<SessionBoundary'
      ) &&
      app.includes(
        "shellState.status !=="
      ),
    'J2 must provide a usable session-required shell and login path.'
  );

  for (const status of [
    "'session-required'",
    "'permission-denied'",
    "'rate-limited'",
    "'degraded'",
  ]) {
    assert(
      session.includes(status),
      'J2 API error boundary is missing shell state ' +
        status
    );
  }
  assert(
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
    'J2 must preserve 401/403/429/503 semantics for shell rendering.'
  );

  for (const stateId of [
    'session-required-state',
    'permission-denied-state',
    'rate-limited-state',
    'degraded-dependency-state',
  ]) {
    assert(
      boundary.includes(stateId),
      'J2 session boundary is missing explicit UI state ' +
        stateId
    );
  }

  assert(
    header.includes(
      'membershipRole: MembershipRole'
    ) &&
      header.includes(
        'id="nav-tab-developer"'
      ),
    'J2 Header must remain membership-role aware after J3 separates safe Developer docs from administration.'
  );

  assert(
    app.includes(
      "effectiveTab === 'developer'"
    ) &&
      app.includes(
        '<DeveloperPlatform'
      ) &&
      app.includes(
        'membershipRole={'
      ) &&
      developer.includes(
        'canManageDeveloperPlatform'
      ) &&
      developer.includes(
        'developer-admin-boundary'
      ),
    'J2 historical Developer gating must advance in J3: safe docs remain reachable while privileged key administration is role-gated inside the workspace.'
  );

  assert(
    !header.includes(
      'Trust Checks'
    ) &&
      !header.includes(
        'btn-open-test-suite'
      ) &&
      !app.includes(
        'TestSuiteModal'
      ) &&
      !app.includes(
        '/api/kb/run-tests'
      ),
    'J2 must remove browser Trust Checks from the normal product shell.'
  );

  assert(
    header.includes(
      'id="nav-tab-automation"'
    ) &&
      header.includes(
        'id="nav-tab-integrations"'
      ) &&
      app.includes(
        '<AutomationWorkspace'
      ) &&
      app.includes(
        '<IntegrationsWorkspace'
      ),
    'J2 must preserve Automation and Integrations as normal product surfaces.'
  );

  assert(
    developer.includes(
      "'/api/platform-management/keys'"
    ) &&
      developer.includes(
        'if (!canManageKeys)'
      ) &&
      developer.includes(
        '...(canManageKeys'
      ),
    'J3 must preserve J2 session safety while preventing MEMBER users from invoking Platform Management calls.'
  );

  console.log(
    'PRODUCTION_J2_ROLE_AWARE_SHELL_CHECK_PASSED'
  );
  console.log(
    'Session-first bootstrap, structured auth/degraded states, J3-safe Developer separation, Trust Checks removal, and preserved core product navigation are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J2_ROLE_AWARE_SHELL_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
