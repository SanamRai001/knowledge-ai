import fs from 'fs';
import path from 'path';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresWorkspaceMetadataRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  setSourceByteStorageForTesting,
} from '../server/storage/sourceByteStorageRuntime.js';
import {
  kbStore,
} from '../server/kbStore.js';
import {
  WorkspaceRuntimeService,
  workspaceRuntimeService,
} from '../server/workspaceRuntimeService.js';
import {
  workspaceStructuredStateService,
} from '../server/workspaceState/workspaceStructuredStateService.js';
import {
  MemorySourceByteStorage,
} from './support/memorySourceByteStorage.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function snapshot(
  file: string
): string | null {
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : null;
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'C7 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for C7 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes('013') ||
      migrations.alreadyApplied.includes(
        '013'
      ),
    'C7 requires migration 013.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  setSourceByteStorageForTesting(
    new MemorySourceByteStorage()
  );

  const legacyFile = path.join(
    process.cwd(),
    'data',
    'knowledge_bases.json'
  );
  const legacyBefore =
    snapshot(legacyFile);

  const accountA = 'acc_c7_a';
  const accountB = 'acc_c7_b';

  try {
    const workspaceA =
      await workspaceRuntimeService
        .createKB(
          accountA,
          'C7 Workspace A',
          'PostgreSQL structured state proof'
        );
    const workspaceB =
      await workspaceRuntimeService
        .createKB(
          accountB,
          'C7 Workspace B',
          'Isolation proof'
        );

    assert(
      workspaceA.accountId ===
        accountA &&
        workspaceB.accountId ===
          accountB,
      'C7 workspaces must be created in their owning account scope.'
    );

    const ai =
      await workspaceRuntimeService
        .updateSpecializedAI(
          accountA,
          workspaceA.id,
          {
            name:
              'C7 Durable Specialist',
            responseStyle:
              'executive-summary',
            strictRefusal: true,
          }
        );

    const userMessage = {
      id: 'msg_c7_user',
      role: 'user' as const,
      content:
        'Persist this conversation.',
      timestamp: Date.now(),
    };
    const assistantMessage = {
      id: 'msg_c7_assistant',
      role: 'assistant' as const,
      content:
        'This conversation is durable.',
      timestamp: Date.now() + 1,
      isFoundInDocuments: true,
      memoryUsed: false,
      memoryCount: 0,
      experienceRecorded: false,
    };

    await workspaceRuntimeService
      .addChatMessage(
        accountA,
        workspaceA.id,
        userMessage
      );
    await workspaceRuntimeService
      .addChatMessage(
        accountA,
        workspaceA.id,
        assistantMessage
      );

    const testCase =
      await workspaceRuntimeService
        .addTestCase(
          accountA,
          workspaceA.id,
          {
            category: 'custom',
            question:
              'What is durable?',
            expectedBehavior:
              'Use workspace knowledge.',
            expectedKeywords: [
              'durable',
            ],
            mustRefuse: false,
          }
        );

    const evaluationRun = {
      id: 'eval_c7_1',
      kbId: workspaceA.id,
      versionTag:
        workspaceA.currentVersion,
      timestamp: Date.now() + 2,
      totalTests: 1,
      passedCount: 1,
      failedCount: 0,
      accuracyScore: 100,
      groundedScore: 100,
      crossDocScore: 100,
      refusalScore: 100,
      results: [],
    };

    await workspaceRuntimeService
      .recordEvaluationRun(
        accountA,
        workspaceA.id,
        evaluationRun
      );

    const version =
      await workspaceRuntimeService
        .createVersionSnapshot(
          accountA,
          workspaceA.id,
          'C7 durable snapshot'
        );

    assert(
      version.isCurrent &&
        version.versionNumber >= 2,
      'C7 version creation must persist a new current relational KnowledgeVersion.'
    );

    const stateBeforeRestart =
      await workspaceStructuredStateService
        .load(
          accountA,
          workspaceA.id
        );

    assert(
      stateBeforeRestart
        ?.specializedAi.name ===
        'C7 Durable Specialist' &&
        stateBeforeRestart
          .chatHistory.length === 2 &&
        stateBeforeRestart
          .testCases.some(
            (item) =>
              item.id === testCase.id
          ) &&
        stateBeforeRestart
          .evaluationRuns.some(
            (item) =>
              item.id ===
              evaluationRun.id
          ) &&
        stateBeforeRestart
          .versions.some(
            (item) =>
              item.id ===
                version.id &&
              item.isCurrent
          ),
      'C7 structured workspace state must be durable before restart reconstruction.'
    );

    const aiLookup =
      await workspaceRuntimeService
        .getSpecializedAIById(
          accountA,
          ai.id
        );
    assert(
      aiLookup?.kb.id ===
        workspaceA.id &&
        aiLookup.ai.name ===
          'C7 Durable Specialist',
      'C7 Specialized AI lookup must resolve through account-scoped relational state.'
    );

    const foreignAiLookup =
      await workspaceRuntimeService
        .getSpecializedAIById(
          accountB,
          ai.id
        );
    assert(
      foreignAiLookup === null,
      'Foreign account must not resolve another account Specialized AI by raw ID.'
    );

    let foreignWorkspaceBlocked = false;
    try {
      await workspaceRuntimeService
        .requireKB(
          accountB,
          workspaceA.id
        );
    } catch {
      foreignWorkspaceBlocked = true;
    }
    assert(
      foreignWorkspaceBlocked,
      'Foreign account must not materialize another account workspace by raw ID.'
    );

    // Simulate loss of all local/in-process compatibility payload for A.
    kbStore.forgetKnowledgeBase(
      workspaceA.id,
      accountA
    );

    const reconstructedService =
      new WorkspaceRuntimeService();
    const reconstructed =
      await reconstructedService
        .requireKB(
          accountA,
          workspaceA.id
        );

    assert(
      reconstructed.name ===
        'C7 Workspace A' &&
        reconstructed.specializedAi
          .name ===
          'C7 Durable Specialist' &&
        reconstructed.chatHistory
          .map((item) => item.id)
          .join(',') ===
          'msg_c7_user,msg_c7_assistant' &&
        reconstructed.testCases.some(
          (item) =>
            item.id === testCase.id
        ) &&
        reconstructed.evaluationRuns
          .some(
            (item) =>
              item.id ===
                evaluationRun.id
          ) &&
        reconstructed.versions
          .some(
            (item) =>
              item.id ===
                version.id &&
              item.isCurrent
          ),
      'C7 workspace shell must reconstruct from PostgreSQL structured state without local kbStore payload.'
    );

    // Active workspace selection must remain PostgreSQL-authoritative.
    const secondA =
      await workspaceRuntimeService
        .createKB(
          accountA,
          'C7 Workspace A2'
        );
    await workspaceRuntimeService
      .setActiveKB(
        accountA,
        workspaceA.id
      );
    kbStore.forgetKnowledgeBase(
      workspaceA.id,
      accountA
    );
    kbStore.forgetKnowledgeBase(
      secondA.id,
      accountA
    );

    const activeAfterMirrorLoss =
      await reconstructedService
        .getActiveKB(accountA);
    assert(
      activeAfterMirrorLoss.id ===
        workspaceA.id,
      'C7 production active workspace selection must come from PostgreSQL, not global kbStore active state.'
    );

    // Clear-chat must also be relational.
    await reconstructedService
      .clearChat(
        accountA,
        workspaceA.id
      );
    kbStore.forgetKnowledgeBase(
      workspaceA.id,
      accountA
    );
    const afterClear =
      await reconstructedService
        .requireKB(
          accountA,
          workspaceA.id
        );
    assert(
      afterClear.chatHistory.length ===
        0,
      'C7 clear-chat must survive compatibility mirror loss.'
    );

    // One-time migration from a legacy compatibility payload.
    const legacyWorkspaceId =
      'kb_c7_legacy';
    await postgresAccountRepository
      .ensureAccount(accountA);
    await postgresWorkspaceMetadataRepository
      .create({
        id: legacyWorkspaceId,
        accountId: accountA,
        name: 'C7 Legacy Migration',
        description:
          'One-time structured-state migration proof',
        processingStatus: 'empty',
        currentVersionTag: 'v1.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

    const legacyKb =
      kbStore.createKBWithId(
        legacyWorkspaceId,
        'C7 Legacy Migration',
        'One-time structured-state migration proof',
        accountA,
        false
      );
    legacyKb.specializedAi.name =
      'Migrated C7 Specialist';
    legacyKb.chatHistory.push({
      id: 'msg_c7_legacy',
      role: 'user',
      content:
        'Migrate me once.',
      timestamp: Date.now(),
    });
    kbStore.hydrateKnowledgeBase(
      legacyKb,
      false
    );

    const migrated =
      await reconstructedService
        .requireKB(
          accountA,
          legacyWorkspaceId
        );
    assert(
      migrated.specializedAi.name ===
        'Migrated C7 Specialist' &&
        migrated.chatHistory.some(
          (item) =>
            item.id ===
              'msg_c7_legacy'
        ),
      'C7 must perform one-time structured-state migration from an available legacy payload.'
    );

    kbStore.forgetKnowledgeBase(
      legacyWorkspaceId,
      accountA
    );

    const migratedAgain =
      await reconstructedService
        .requireKB(
          accountA,
          legacyWorkspaceId
        );
    assert(
      migratedAgain.specializedAi
        .name ===
        'Migrated C7 Specialist' &&
        migratedAgain.chatHistory
          .some(
            (item) =>
              item.id ===
                'msg_c7_legacy'
          ),
      'After one-time migration, C7 must reconstruct without the legacy compatibility payload.'
    );

    const relationalCounts =
      await postgresPool().query(
        `SELECT
           (SELECT count(*) FROM workspace_specialized_ai WHERE account_id = $1) AS ai_count,
           (SELECT count(*) FROM workspace_knowledge_versions WHERE account_id = $1) AS version_count,
           (SELECT count(*) FROM workspace_evaluation_test_cases WHERE account_id = $1) AS test_count,
           (SELECT count(*) FROM workspace_evaluation_runs WHERE account_id = $1) AS run_count`,
        [accountA]
      );

    assert(
      Number(
        relationalCounts.rows[0]
          ?.ai_count
      ) >= 3 &&
        Number(
          relationalCounts.rows[0]
            ?.version_count
        ) >= 3 &&
        Number(
          relationalCounts.rows[0]
            ?.test_count
        ) >= 1 &&
        Number(
          relationalCounts.rows[0]
            ?.run_count
        ) >= 1,
      'C7 relational tables must hold the migrated workspace structured-state families.'
    );

    assert(
      snapshot(legacyFile) ===
        legacyBefore,
      'PostgreSQL C7 runtime must not mutate data/knowledge_bases.json.'
    );

    console.log(
      'PRODUCTION_C7_WORKSPACE_STRUCTURED_STATE_POSTGRES_CHECK_PASSED'
    );
    console.log(
      'AI config, versions, chat, evaluation state, active workspace selection, one-time legacy migration, restart reconstruction, cross-account isolation, and no-JSON-write production behavior are verified.'
    );
  } finally {
    setSourceByteStorageForTesting(
      null
    );
  }
}

main()
  .catch((error) => {
    setSourceByteStorageForTesting(
      null
    );
    console.error(
      'PRODUCTION_C7_WORKSPACE_STRUCTURED_STATE_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
