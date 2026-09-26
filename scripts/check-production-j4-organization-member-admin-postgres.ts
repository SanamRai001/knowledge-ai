import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  humanIdentityFoundationService,
} from '../server/identity/humanIdentityFoundationService.js';
import {
  organizationMemberAdminService,
} from '../server/identity/organizationMemberAdminService.js';
import {
  OrganizationMemberAdminError,
} from '../server/identity/organizationMemberAdminTypes.js';
import {
  humanAuthService,
} from '../server/identity/humanAuthService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: string
) {
  try {
    await fn();
  } catch (error) {
    assert(
      error instanceof
        OrganizationMemberAdminError &&
        error.code === code,
      'Expected organization error ' +
        code +
        ', received ' +
        String(
          (error as any)?.code ||
            (error as any)?.message ||
            error
        )
    );
    return;
  }
  throw new Error(
    'Expected organization error ' +
      code
  );
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'J4 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for J4 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes('021') ||
      migrations.alreadyApplied.includes(
        '021'
      ),
    'J4 requires migration 021.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const accountA = 'acc_j4_a';
  const accountB = 'acc_j4_b';
  const accountC = 'acc_j4_c';

  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);
  await postgresAccountRepository
    .ensureAccount(accountC);

  const ownerA =
    await humanIdentityFoundationService
      .createUser({
        email:
          'owner-a@example.test',
        displayName: 'Owner A',
      });
  const ownerB =
    await humanIdentityFoundationService
      .createUser({
        email:
          'owner-b@example.test',
        displayName: 'Owner B',
      });
  const admin =
    await humanIdentityFoundationService
      .createUser({
        email:
          'admin@example.test',
        displayName: 'Admin',
      });
  const member =
    await humanIdentityFoundationService
      .createUser({
        email:
          'member@example.test',
        displayName: 'Member',
      });
  const foreign =
    await humanIdentityFoundationService
      .createUser({
        email:
          'foreign@example.test',
        displayName: 'Foreign',
      });
  const multi =
    await humanIdentityFoundationService
      .createUser({
        email:
          'multi@example.test',
        displayName: 'Multi Account',
      });

  for (const [userId, role] of [
    [ownerA.id, 'OWNER'],
    [ownerB.id, 'OWNER'],
    [admin.id, 'ADMIN'],
    [member.id, 'MEMBER'],
    [multi.id, 'MEMBER'],
  ] as const) {
    await humanIdentityFoundationService
      .upsertMembership({
        accountId: accountA,
        userId,
        role,
      });
  }

  await humanIdentityFoundationService
    .upsertMembership({
      accountId: accountB,
      userId: foreign.id,
      role: 'OWNER',
    });
  await humanIdentityFoundationService
    .upsertMembership({
      accountId: accountB,
      userId: multi.id,
      role: 'MEMBER',
    });

  const members =
    await organizationMemberAdminService
      .listMembers(accountA);
  assert(
    members.length === 5 &&
      members.every(
        (item) =>
          item.userId !== foreign.id
      ),
    'J4 member listing must be strictly account scoped.'
  );

  await expectCode(
    () =>
      organizationMemberAdminService
        .changeRole({
          accountId: accountA,
          actorUserId: admin.id,
          targetUserId: ownerA.id,
          nextRole: 'MEMBER',
        }),
    'ORG_MEMBER_OWNER_PROTECTED'
  );

  await expectCode(
    () =>
      organizationMemberAdminService
        .changeRole({
          accountId: accountA,
          actorUserId: ownerA.id,
          targetUserId: ownerA.id,
          nextRole: 'ADMIN',
        }),
    'ORG_MEMBER_SELF_MUTATION_FORBIDDEN'
  );

  const promoted =
    await organizationMemberAdminService
      .changeRole({
        accountId: accountA,
        actorUserId: ownerA.id,
        targetUserId: member.id,
        nextRole: 'ADMIN',
      });
  assert(
    promoted.role === 'ADMIN' &&
      promoted.membershipStatus ===
        'ACTIVE',
    'OWNER must be able to promote another active member.'
  );

  const targetSession =
    await humanIdentityFoundationService
      .createSession({
        userId: member.id,
        selectedAccountId: accountA,
      });

  const revoked =
    await organizationMemberAdminService
      .changeStatus({
        accountId: accountA,
        actorUserId: ownerA.id,
        targetUserId: member.id,
        nextStatus: 'REVOKED',
      });
  assert(
    revoked.membershipStatus ===
      'REVOKED',
    'J4 must persist membership revocation.'
  );

  const sessionAfter =
    await postgresPool().query(
      `SELECT selected_account_id,
              selected_workspace_id,
              status
       FROM browser_sessions
       WHERE id = $1`,
      [targetSession.session.id]
    );
  assert(
    sessionAfter.rows[0]
      ?.selected_account_id === null &&
      sessionAfter.rows[0]
        ?.selected_workspace_id ===
        null &&
      sessionAfter.rows[0]?.status ===
        'ACTIVE',
    'Revoking one account membership must clear that account selection without destroying the user session for other accounts.'
  );

  const restored =
    await organizationMemberAdminService
      .changeStatus({
        accountId: accountA,
        actorUserId: ownerA.id,
        targetUserId: member.id,
        nextStatus: 'ACTIVE',
      });
  assert(
    restored.membershipStatus ===
      'ACTIVE' &&
      restored.role === 'ADMIN',
    'Restoring membership must preserve the audited role.'
  );

  await expectCode(
    () =>
      organizationMemberAdminService
        .changeStatus({
          accountId: accountA,
          actorUserId: admin.id,
          targetUserId: ownerB.id,
          nextStatus: 'REVOKED',
        }),
    'ORG_MEMBER_OWNER_PROTECTED'
  );

  await expectCode(
    () =>
      organizationMemberAdminService
        .changeRole({
          accountId: accountA,
          actorUserId: ownerA.id,
          targetUserId: foreign.id,
          nextRole: 'MEMBER',
        }),
    'ORG_MEMBER_NOT_FOUND'
  );

  const audit =
    await organizationMemberAdminService
      .listAudit(accountA, 20);
  assert(
    audit.length === 3 &&
      audit.some(
        (item) =>
          item.action ===
            'ROLE_CHANGED' &&
          item.targetUserId ===
            member.id
      ) &&
      audit.filter(
        (item) =>
          item.action ===
          'STATUS_CHANGED'
      ).length === 2,
    'J4 must record successful privileged role/status mutations and exclude rejected attempts.'
  );

  const multiSession =
    await humanIdentityFoundationService
      .createSession({
        userId: multi.id,
      });

  const selectedA =
    await humanAuthService
      .selectAccount(
        multiSession.secret,
        accountA
      );
  assert(
    selectedA.context.session
      .selectedAccountId === accountA &&
      selectedA.context.membership
        ?.accountId === accountA &&
      selectedA.memberships.length ===
        2,
    'J4 account selection must use active membership and preserve all active account choices.'
  );

  const selectedB =
    await humanAuthService
      .selectAccount(
        multiSession.secret,
        accountB
      );
  assert(
    selectedB.context.session
      .selectedAccountId === accountB &&
      selectedB.context.membership
        ?.accountId === accountB,
    'J4 session must switch only to another account where the user is an active member.'
  );

  let foreignSelectionBlocked = false;
  try {
    await humanAuthService
      .selectAccount(
        multiSession.secret,
        accountC
      );
  } catch (error: any) {
    foreignSelectionBlocked =
      error?.code ===
      'IDENTITY_MEMBERSHIP_REQUIRED';
  }
  assert(
    foreignSelectionBlocked,
    'J4 must reject arbitrary account selection outside active memberships.'
  );

  console.log(
    'PRODUCTION_J4_ORGANIZATION_MEMBER_ADMIN_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Account-scoped member listing, privileged owner/admin invariants, audited mutations, revocation session clearing, and membership-bound multi-account selection are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_J4_ORGANIZATION_MEMBER_ADMIN_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
