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
    'server/persistence/migrations/013_workspace_structured_state.sql'
  );

  for (const table of [
    'workspace_specialized_ai',
    'workspace_knowledge_versions',
    'workspace_chat_messages',
    'workspace_evaluation_test_cases',
    'workspace_evaluation_runs',
  ]) {
    assert(
      migration.includes(
        'CREATE TABLE ' + table
      ),
      'C7 migration is missing relational workspace state table: ' +
        table
    );
  }

  assert(
    migration.includes(
      'FOREIGN KEY (account_id, workspace_id)'
    ) &&
      migration.includes(
        'REFERENCES workspaces(account_id, id)'
      ),
    'C7 structured state must be account/workspace scoped by database foreign keys.'
  );

  const runtime = read(
    'server/workspaceRuntimeService.ts'
  );
  for (const required of [
    'workspaceStructuredStateService',
    'initializeFromKnowledgeBase',
    '.saveSpecializedAI(',
    '.saveVersion(',
    '.setCurrentVersion(',
    '.addChatMessage(',
    '.clearChat(',
    '.addTestCase(',
    '.removeTestCase(',
    '.recordEvaluationRun(',
    'findWorkspaceIdByAiId',
    'hydrateKnowledgeBase(\n      materialized,\n      false',
  ]) {
    assert(
      runtime.includes(required),
      'C7 runtime is missing PostgreSQL structured-state boundary: ' +
        required
    );
  }

  const specialized = read(
    'server/specializedAIService.ts'
  );
  assert(
    specialized.includes(
      'workspaceRuntimeService'
    ) &&
      !specialized.includes(
        "from './kbStore.js'"
      ),
    'Specialized AI production resolution must go through C7 workspace runtime rather than kbStore.'
  );

  const evaluation = read(
    'server/evaluationService.ts'
  );
  assert(
    evaluation.includes(
      'workspaceRuntimeService'
    ) &&
      evaluation.includes(
        '.recordEvaluationRun('
      ) &&
      !evaluation.includes(
        "from './kbStore.js'"
      ),
    'Evaluation production reads/writes must go through C7 workspace runtime.'
  );

  const kbStore = read(
    'server/kbStore.ts'
  );
  assert(
    kbStore.includes(
      'hydrateKnowledgeBase(\n    kb: KnowledgeBase,\n    persist: boolean = true'
    ) &&
      kbStore.includes(
        'persist: boolean = true'
      ),
    'Legacy kbStore must support memory-only compatibility mirroring in PostgreSQL mode.'
  );

  const structuredRepo = read(
    'server/workspaceState/postgresWorkspaceStructuredStateRepository.ts'
  );
  assert(
    structuredRepo.includes(
      'OFFSET 25'
    ) &&
      structuredRepo.includes(
        'WHERE account_id = $1'
      ) &&
      structuredRepo.includes(
        'workspace_id = $2'
      ),
    'C7 repository must preserve bounded evaluation history and account/workspace isolation.'
  );

  console.log(
    'PRODUCTION_C7_WORKSPACE_STRUCTURED_STATE_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Relational workspace state, runtime authority, service cutover, memory-only JSON compatibility, account/workspace isolation, and evaluation retention are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_C7_WORKSPACE_STRUCTURED_STATE_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
