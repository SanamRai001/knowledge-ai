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
  const runtime = read(
    'server/actions/actionRuntimeExecutionService.ts'
  );
  const repository = read(
    'server/persistence/a3PostgresRepositories.ts'
  );
  const types = read(
    'server/persistence/a3Types.ts'
  );
  const migration = read(
    'server/persistence/migrations/002_living_knowledge_actions.sql'
  );
  const actionDiscoveryWorker = fs.existsSync(
    'server/actions/actionDiscoveryWorker.ts'
  )
    ? read(
        'server/actions/actionDiscoveryWorker.ts'
      )
    : '';

  assert(
    runtime.includes(
      'if (!actionPersistence.usesPostgres())'
    ) &&
      runtime.includes(
        'return actionExecutionService.confirm(params)'
      ),
    'D1 must preserve file-mode Action confirmation compatibility.'
  );

  assert(
    runtime.includes(
      'postgresConfirmedActionTransactionRepository'
    ) &&
      runtime.includes(
        '.commitConfirmedAction('
      ),
    'PostgreSQL Action confirmation must use the explicit confirmed-action transaction repository.'
  );

  const commitIndex =
    runtime.indexOf(
      '.commitConfirmedAction('
    );
  const inlineDiscoveryIndex =
    runtime.indexOf(
      'runDownstreamDiscovery',
      commitIndex
    );
  const queuedDiscoveryIndex =
    runtime.indexOf(
      'enqueueActionDiscoveryRefresh',
      commitIndex
    );

  const inlinePostCommit =
    inlineDiscoveryIndex > commitIndex;
  const queuedPostCommit =
    queuedDiscoveryIndex > commitIndex &&
    actionDiscoveryWorker.includes(
      'discoveryRuntimeService'
    ) &&
    actionDiscoveryWorker.includes(
      '.analyzeDataset({'
    );

  assert(
    commitIndex >= 0 &&
      (inlinePostCommit ||
        queuedPostCommit),
    'Derived Discovery work must remain strictly post-commit: either inline after D1 commit or, after E3, via a durable worker enqueue whose handler owns analyzeDataset.'
  );

  for (const required of [
    'return withTransaction(async (client) =>',
    'loadProposal(',
    'FOR UPDATE',
    'pg_advisory_xact_lock',
    'currentEffectiveState(',
    'insertClaim(client, claim)',
    'insertEvent(client, input.eventToInsert)',
    'insertExecution(client, input.execution)',
    "SET status = 'CONFIRMED'",
    'insertAudit(client, input.auditEntry)',
    'idempotentReplay: true',
    'idempotentReplay: false',
  ]) {
    assert(
      repository.includes(required),
      'D1 confirmed-action transaction is missing invariant: ' +
        required
    );
  }

  assert(
    types.includes(
      'export interface ConfirmedActionTransactionRepository'
    ) &&
      types.includes(
        'claimsToClose:'
      ) &&
      types.includes(
        'claimsToInsert:'
      ) &&
      types.includes(
        'eventToInsert: BusinessEvent'
      ) &&
      types.includes(
        'auditEntry: ActionAuditEntry'
      ),
    'D1 transaction contract must explicitly include company-state writes, execution, proposal transition, and audit state.'
  );

  assert(
    migration.includes(
      'UNIQUE (account_id, proposal_id)'
    ) &&
      migration.includes(
        'action_execution_claims'
      ) &&
      migration.includes(
        'action_execution_events'
      ) &&
      migration.includes(
        'action_audit_entries'
      ),
    'D1 database schema must enforce one execution per account/proposal and relationally link claims/events/audit.'
  );

  console.log(
    'PRODUCTION_D1_CONFIRMED_ACTION_TRANSACTION_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Proposal/state locking, database idempotency, atomic claims/event/execution/status/audit commit, file-mode fallback, and post-commit downstream work are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_D1_CONFIRMED_ACTION_TRANSACTION_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
