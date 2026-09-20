import crypto from 'crypto';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  HumanIdentityFoundationError,
  hashBrowserSessionToken,
  humanIdentityFoundationService,
} from '../server/identity/humanIdentityFoundationService.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectIdentityError(
  work: () => Promise<unknown>,
  code: HumanIdentityFoundationError['code'],
  message: string
): Promise<void> {
  let seen = false;
  try {
    await work();
  } catch (error) {
    seen =
      error instanceof HumanIdentityFoundationError &&
      error.code === code;
  }
  assert(seen, message);
}

async function reset(): Promise<void> {
  await postgresPool().query(`
    TRUNCATE TABLE
      browser_sessions,
      account_memberships,
      users,
      account_workspace_state,
      workspaces,
      accounts
    CASCADE
  `);
}

async function createWorkspace(
  accountId: string,
  id: string,
  name: string
) {
  const now = Date.now();
  return postgresWorkspaceMetadataRepository.create({
    id,
    accountId,
    name,
    processingStatus: 'empty',
    currentVersionTag: 'v1.0',
    createdAt: now,
    updatedAt: now,
  });
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the B2A identity foundation proof.'
  );

  const firstMigration = await runPostgresMigrations();
  assert(
    firstMigration.applied.includes('007') ||
      firstMigration.alreadyApplied.includes('007'),
    'Migration 007 identity foundation must be present.'
  );

  const secondMigration = await runPostgresMigrations();
  assert(
    secondMigration.applied.length === 0 &&
      secondMigration.alreadyApplied.includes('007'),
    'Identity migration must be repeatable without reapplying.'
  );

  await reset();

  const accountA = 'acc_b2a_a';
  const accountB = 'acc_b2a_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);
  await createWorkspace(accountA, 'kb_b2a_a1', 'A One');
  await createWorkspace(accountA, 'kb_b2a_a2', 'A Two');
  await createWorkspace(accountB, 'kb_b2a_b1', 'B One');

  const owner = await humanIdentityFoundationService.createUser({
    email: 'Owner@Example.COM',
    displayName: 'Owner Fixture',
  });
  assert(
    owner.normalizedEmail === 'owner@example.com',
    'Human identity must keep a normalized unique email identity.'
  );

  const sameOwner = await humanIdentityFoundationService.createUser({
    email: ' owner@example.com ',
  });
  assert(
    sameOwner.id === owner.id,
    'Email normalization must prevent duplicate case-variant user identities.'
  );

  const membershipA =
    await humanIdentityFoundationService.upsertMembership({
      accountId: accountA,
      userId: owner.id,
      role: 'OWNER',
    });
  assert(
    membershipA.role === 'OWNER' &&
      membershipA.status === 'ACTIVE',
    'Account membership must persist OWNER/ADMIN/MEMBER role state.'
  );

  const outsider = await humanIdentityFoundationService.createUser({
    email: 'outsider@example.com',
  });
  await expectIdentityError(
    () =>
      humanIdentityFoundationService.createSession({
        userId: outsider.id,
        selectedAccountId: accountB,
      }),
    'IDENTITY_MEMBERSHIP_REQUIRED',
    'A session must not select an account without active membership.'
  );

  const sessionOne =
    await humanIdentityFoundationService.createSession({
      userId: owner.id,
      selectedAccountId: accountA,
      selectedWorkspaceId: 'kb_b2a_a1',
    });
  const sessionTwo =
    await humanIdentityFoundationService.createSession({
      userId: owner.id,
      selectedAccountId: accountA,
      selectedWorkspaceId: 'kb_b2a_a2',
    });

  const storedToken = await postgresPool().query<{
    token_hash: string;
  }>(
    'SELECT token_hash FROM browser_sessions WHERE id = $1',
    [sessionOne.session.id]
  );
  assert(
    storedToken.rows[0].token_hash ===
      hashBrowserSessionToken(sessionOne.secret),
    'Browser session storage must contain the SHA-256 hash of the high-entropy opaque token.'
  );
  assert(
    storedToken.rows[0].token_hash !== sessionOne.secret,
    'Raw browser session token must never be stored in the session table.'
  );

  const rawSecretLeak = await postgresPool().query<{
    count: number;
  }>(
    `SELECT count(*)::int AS count
     FROM browser_sessions
     WHERE token_hash = $1`,
    [sessionOne.secret]
  );
  assert(
    rawSecretLeak.rows[0].count === 0,
    'Raw opaque session token must not be queryable as persisted token material.'
  );

  const resolvedOne =
    await humanIdentityFoundationService.resolveSession(
      sessionOne.secret
    );
  assert(
    resolvedOne.user.id === owner.id &&
      resolvedOne.membership?.role === 'OWNER' &&
      resolvedOne.session.selectedAccountId === accountA &&
      resolvedOne.session.selectedWorkspaceId === 'kb_b2a_a1',
    'Session resolution must recover the human, active membership, selected account, and selected workspace.'
  );

  await expectIdentityError(
    () =>
      humanIdentityFoundationService.selectWorkspace({
        secret: sessionOne.secret,
        workspaceId: 'kb_b2a_b1',
      }),
    'IDENTITY_WORKSPACE_OUT_OF_SCOPE',
    'A selected workspace must belong to the session selected account.'
  );

  await humanIdentityFoundationService.upsertMembership({
    accountId: accountB,
    userId: owner.id,
    role: 'MEMBER',
  });
  const switched =
    await humanIdentityFoundationService.selectAccount({
      secret: sessionOne.secret,
      accountId: accountB,
    });
  assert(
    switched.session.selectedAccountId === accountB &&
      !switched.session.selectedWorkspaceId,
    'Changing selected account must clear the prior workspace selection.'
  );

  const selectedB =
    await humanIdentityFoundationService.selectWorkspace({
      secret: sessionOne.secret,
      workspaceId: 'kb_b2a_b1',
    });
  assert(
    selectedB.session.selectedWorkspaceId === 'kb_b2a_b1',
    'A workspace inside the selected account must be selectable.'
  );

  const stillA =
    await humanIdentityFoundationService.resolveSession(
      sessionTwo.secret
    );
  assert(
    stillA.session.selectedAccountId === accountA &&
      stillA.session.selectedWorkspaceId === 'kb_b2a_a2',
    'Workspace/account selection must be session-scoped rather than account-global.'
  );

  let directForeignSelectionBlocked = false;
  try {
    await postgresPool().query(
      `INSERT INTO browser_sessions
        (id, user_id, token_hash, selected_account_id,
         selected_workspace_id, status, created_at, last_seen_at,
         expires_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',now(),now(),now() + interval '1 hour')`,
      [
        'sess_b2a_invalid',
        outsider.id,
        crypto.createHash('sha256').update('invalid-fixture').digest('hex'),
        accountB,
        'kb_b2a_b1',
      ]
    );
  } catch {
    directForeignSelectionBlocked = true;
  }
  assert(
    directForeignSelectionBlocked,
    'Database constraints must reject a selected account that has no membership row for the session user.'
  );

  await humanIdentityFoundationService.revokeMembership({
    accountId: accountB,
    userId: owner.id,
  });
  await expectIdentityError(
    () =>
      humanIdentityFoundationService.resolveSession(
        sessionOne.secret
      ),
    'IDENTITY_MEMBERSHIP_REVOKED',
    'Revoked account membership must invalidate a session using that selected account.'
  );

  assert(
    await humanIdentityFoundationService.revokeSession(
      sessionTwo.secret
    ),
    'Session revocation must be durable.'
  );
  await expectIdentityError(
    () =>
      humanIdentityFoundationService.resolveSession(
        sessionTwo.secret
      ),
    'IDENTITY_SESSION_REVOKED',
    'Revoked browser sessions must fail closed.'
  );

  const expiring =
    await humanIdentityFoundationService.createSession({
      userId: owner.id,
      selectedAccountId: accountA,
    });
  await postgresPool().query(
    `UPDATE browser_sessions
     SET created_at = now() - interval '2 hours',
         expires_at = now() - interval '1 hour'
     WHERE id = $1`,
    [expiring.session.id]
  );
  await expectIdentityError(
    () =>
      humanIdentityFoundationService.resolveSession(
        expiring.secret
      ),
    'IDENTITY_SESSION_EXPIRED',
    'Expired browser sessions must fail closed.'
  );

  console.log('PRODUCTION_B2A_IDENTITY_FOUNDATION_CHECK_PASSED');
  console.log(
    'Durable users, account memberships, hashed opaque browser sessions, membership-bound account selection, session-scoped workspace selection, database ownership constraints, revocation, and expiry behavior are verified without introducing browser login endpoints or route cutover.'
  );

  await closePostgresPool();
}

main().catch(async (error) => {
  console.error(
    'PRODUCTION_B2A_IDENTITY_FOUNDATION_CHECK_FAILED'
  );
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
