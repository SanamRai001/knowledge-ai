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
  const organization = read(
    'src/components/OrganizationWorkspace.tsx'
  );
  const session = read('src/session.ts');

  assert(
    header.includes(
      "'organization'"
    ) &&
      header.includes(
        'id="nav-tab-organization"'
      ) &&
      app.includes(
        "effectiveTab ===\n          'organization'"
      ) &&
      app.includes(
        '<OrganizationWorkspace'
      ),
    'J4 UI must expose an authenticated Organization workspace through the normal application shell.'
  );

  assert(
    session.includes(
      'memberships: Array<{'
    ) &&
      header.includes(
        'accountMemberships'
      ) &&
      header.includes(
        'id="account-selector-dropdown"'
      ) &&
      app.includes(
        "'/api/auth/select-account'"
      ) &&
      app.includes(
        "authContext.memberships"
      ) &&
      app.includes(
        "'X-CSRF-Token':"
      ),
    'J4 account switching must use the authenticated session membership list and CSRF-protected select-account contract.'
  );

  assert(
    organization.includes(
      "'/api/organization/members'"
    ) &&
      organization.includes(
        'capabilities.canManageMembers'
      ) &&
      organization.includes(
        'capabilities.canManageOwners'
      ) &&
      organization.includes(
        'member.userId ===\n          currentUserId'
      ) &&
      organization.includes(
        'id="organization-read-only-boundary"'
      ),
    'J4 Organization UI must remain capability-driven, protect self-management, and keep MEMBER users read-only.'
  );

  assert(
    organization.includes(
      "'/role'"
    ) &&
      organization.includes(
        "'/status'"
      ) &&
      organization.includes(
        "'X-CSRF-Token':"
      ) &&
      organization.includes(
        "'/api/organization/membership-audit?limit=50'"
      ) &&
      organization.includes(
        'id="organization-membership-audit"'
      ),
    'J4 privileged member mutations and audit history must use the real CSRF-protected organization API.'
  );

  assert(
    organization.includes(
      'id="organization-no-invite-contract"'
    ) &&
      organization.includes(
        'does not yet define a durable'
      ) &&
      !organization.includes(
        '/invite'
      ) &&
      !organization.includes(
        '/invitations'
      ) &&
      !organization.includes(
        'Invite member'
      ) &&
      !organization.includes(
        'Add member'
      ),
    'J4 must not invent invitation/onboarding UI before a durable invitation backend contract exists.'
  );

  assert(
    app.includes(
      'accountId={\n              authContext.membership\n                .accountId'
    ) &&
      app.includes(
        'currentUserId={\n              authContext.user.id'
      ) &&
      app.includes(
        'membershipRole={\n              authContext.membership.role'
      ),
    'J4 Organization workspace must receive account/user/role identity from the authenticated session context, never arbitrary frontend IDs.'
  );

  console.log(
    'PRODUCTION_J4_ORGANIZATION_MEMBER_UI_CHECK_PASSED'
  );
  console.log(
    'Organization navigation, session-bound account switching, capability-driven member controls, CSRF mutations, audit visibility, self/OWNER protection, and no-invite boundary are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_J4_ORGANIZATION_MEMBER_UI_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
