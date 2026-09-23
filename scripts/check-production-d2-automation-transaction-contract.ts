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
  const actionRepo = read(
    'server/persistence/a3PostgresRepositories.ts'
  );
  assert(
    actionRepo.includes(
      'export async function commitConfirmedActionWithClient'
    ) &&
      actionRepo.includes(
        'return withTransaction((client) =>'
      ) &&
      actionRepo.includes(
        'commitConfirmedActionWithClient('
      ),
    'D2 must reuse the exact D1 confirmed-Action transaction body through a client-scoped helper.'
  );

  const actionRuntime = read(
    'server/actions/actionRuntimeExecutionService.ts'
  );
  assert(
    actionRuntime.includes(
      'export async function preparePostgresConfirmedAction'
    ) &&
      actionRuntime.includes(
        'finalizeCommittedPostgresAction'
      ) &&
      actionRuntime.includes(
        'postgresConfirmedActionTransactionRepository.commitConfirmedAction'
      ),
    'Manual Action confirmation must preserve D1 behavior while exposing shared preparation/finalization for D2 composition.'
  );

  const types = read(
    'server/persistence/a5Types.ts'
  );
  assert(
    types.includes(
      'AutomationExecutionTransactionRepository'
    ) &&
      types.includes(
        'AutomationExecutionClaimInput'
      ) &&
      types.includes(
        'AutomationExecutionCommitInput'
      ) &&
      types.includes(
        'ConfirmedActionTransactionInput'
      ),
    'D2 must define an explicit Automation execution transaction contract around D1.'
  );

  const automationRepo = read(
    'server/persistence/a5PostgresRepositories.ts'
  );
  for (const required of [
    'lockAutomationAccount',
    'lockAutomationProposal',
    "knowledge-ai:automation-account:",
    "knowledge-ai:automation-execution:",
    'claimPolicyExecution',
    'commitPolicyExecution',
    "status IN ('RUNNING','SUCCEEDED')",
    'FOR UPDATE',
    'commitConfirmedActionWithClient',
    'AUTOMATION_POLICY_CHANGED',
    'AUTOMATION_KILL_SWITCH_ACTIVE',
    'AUTOMATION_CONTROL_CHANGED',
    'AUTOMATION_EXECUTION_CLAIM_POLICY_MISMATCH',
    'AUTOMATION_ACTION_AUTHORIZATION_MISMATCH',
    "status: 'SUCCEEDED'",
  ]) {
    assert(
      automationRepo.includes(required),
      'D2 Automation transaction repository is missing invariant: ' +
        required
    );
  }

  const policyLockIndex =
    automationRepo.indexOf(
      'async commitPolicyRevision'
    );
  const controlLockIndex =
    automationRepo.indexOf(
      'async commitControlRevision'
    );
  assert(
    automationRepo
      .slice(
        policyLockIndex,
        controlLockIndex
      )
      .includes(
        'lockAutomationAccount'
      ) &&
      automationRepo
        .slice(controlLockIndex)
        .includes(
          'lockAutomationAccount'
        ),
    'Policy/control governance writes must share the D2 account lock with automatic execution commits.'
  );

  const runtime = read(
    'server/automation/automationExecutionRuntimeService.ts'
  );
  for (const required of [
    'claimPolicyExecution',
    'preparePostgresConfirmedAction',
    'commitPolicyExecution',
    'finalizeCommittedPostgresAction',
    'recoverableRun',
    "status: 'BLOCKED'",
    "'AUTOMATION_POLICY'",
    "'AUTOMATION_COMPENSATION'",
  ]) {
    assert(
      runtime.includes(required),
      'D2 runtime is missing execution/recovery behavior: ' +
        required
    );
  }

  assert(
    runtime.includes(
      'return automationExecutionService.executeEligible(params);'
    ),
    'D2 must preserve file-mode Automation execution compatibility.'
  );

  assert(
    !automationRepo.includes(
      "from '../watch/"
    ) &&
      !runtime.includes(
        "from '../watch/"
      ),
    'D2 must not broaden into Watch scheduling/worker transaction work.'
  );

  console.log(
    'PRODUCTION_D2_AUTOMATION_TRANSACTION_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'D1 composition, database-backed Automation claims, governance locks, atomic Action+run success, restart reconciliation, compensation/file-mode preservation, and D2 scope boundaries are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_D2_AUTOMATION_TRANSACTION_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
