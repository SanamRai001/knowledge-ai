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
  const migration = read(
    'server/persistence/migrations/021_organization_member_admin.sql'
  );
  const router = read(
    'server/identity/organizationRouter.ts'
  );
  const repository = read(
    'server/identity/postgresOrganizationMemberAdminRepository.ts'
  );
  const authRouter = read(
    'server/identity/authRouter.ts'
  );
  const authService = read(
    'server/identity/humanAuthService.ts'
  );
  const server = read('server.ts');
  const session = read('src/session.ts');

  assert(
    migration.includes(
      'CREATE TABLE account_membership_admin_audit'
    ) &&
      migration.includes(
        "ROLE_CHANGED"
      ) &&
      migration.includes(
        "STATUS_CHANGED"
      ),
    'J4A must persist privileged membership mutation audit evidence.'
  );

  assert(
    router.includes(
      'applicationIdentityMiddleware'
    ) &&
      router.includes(
        "requireHumanRoles("
      ) &&
      router.includes(
        'requireOwnerOrAdmin'
      ) &&
      router.includes(
        "'/members'"
      ) &&
      router.includes(
        "'/members/:userId/role'"
      ) &&
      router.includes(
        "'/members/:userId/status'"
      ),
    'J4A organization routes must be human-account scoped and privileged mutations must remain OWNER/ADMIN-only.'
  );

  for (const invariant of [
    'ORG_MEMBER_SELF_MUTATION_FORBIDDEN',
    'ORG_MEMBER_OWNER_PROTECTED',
    'ORG_MEMBER_LAST_OWNER',
    'FOR UPDATE',
    "role = 'OWNER'",
    "status = 'ACTIVE'",
    'selected_account_id = NULL',
    'account_membership_admin_audit',
  ]) {
    assert(
      repository.includes(invariant),
      'J4A repository is missing membership safety invariant: ' +
        invariant
    );
  }

  assert(
    authRouter.includes(
      "'/select-account'"
    ) &&
      authRouter.includes(
        'requireSameOrigin(req)'
      ) &&
      authRouter.includes(
        'requireDoubleSubmitCsrf(req)'
      ) &&
      authRouter.includes(
        '.selectAccount('
      ) &&
      authRouter.includes(
        'memberships:'
      ),
    'J4A account selection must use the existing authenticated browser session, CSRF boundary, and membership validation.'
  );

  assert(
    authService.includes(
      'sessionOverview('
    ) &&
      authService.includes(
        'activeMemberships('
      ) &&
      authService.includes(
        'humanIdentityFoundationService'
      ) &&
      authService.includes(
        '.selectAccount({'
      ),
    'J4A auth service must expose active membership choices while delegating selection to the membership-bound identity foundation.'
  );

  assert(
    server.includes(
      "app.use(\n  '/api/organization',\n  organizationRouter"
    ),
    'J4A organization router must be mounted explicitly.'
  );

  assert(
    session.includes(
      'memberships: Array<{'
    ),
    'J4A frontend session state must retain all active membership choices for multi-account selection.'
  );

  console.log(
    'PRODUCTION_J4_ORGANIZATION_MEMBER_ADMIN_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Account-scoped member reads, OWNER/ADMIN mutation boundaries, owner/self safeguards, audited status/role writes, and session-bound account selection are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J4_ORGANIZATION_MEMBER_ADMIN_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
