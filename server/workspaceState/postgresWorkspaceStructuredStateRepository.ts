import type { PoolClient } from 'pg';
import type {
  ChatMessage,
  EvaluationRun,
  EvaluationTestCase,
  KnowledgeVersion,
  SpecializedAI,
} from '../../src/types.js';
import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import type {
  WorkspaceStructuredState,
  WorkspaceStructuredStateRepository,
} from './workspaceStructuredStateTypes.js';

function epoch(
  value: Date | string | number
): number {
  if (typeof value === 'number') {
    return value;
  }
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(
      'PostgreSQL returned an invalid workspace structured-state timestamp.'
    );
  }
  return parsed;
}

function aiFromRow(
  row: any
): SpecializedAI {
  return {
    id: row.id,
    kbId: row.workspace_id,
    name: row.name,
    description: row.description,
    roleDefinition:
      row.role_definition,
    systemPromptModifier:
      row.system_prompt_modifier ??
      undefined,
    responseStyle:
      row.response_style,
    citationMode:
      row.citation_mode,
    strictRefusal:
      Boolean(row.strict_refusal),
    confidenceThreshold:
      row.confidence_threshold ??
      undefined,
    memoryEnabled:
      row.memory_enabled ??
      undefined,
    memoryRetrievalEnabled:
      row.memory_retrieval_enabled ??
      undefined,
    allowedMemoryTypes:
      Array.isArray(
        row.allowed_memory_types
      )
        ? row.allowed_memory_types
        : [],
    maxRetrievedMemories:
      row.max_retrieved_memories ??
      undefined,
    memoryConfidenceThreshold:
      row.memory_confidence_threshold ??
      undefined,
    allowCandidateGeneration:
      row.allow_candidate_generation ??
      undefined,
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
  };
}

function versionFromRow(
  row: any
): KnowledgeVersion {
  return {
    id: row.id,
    versionNumber:
      Number(row.version_number),
    versionTag: row.version_tag,
    label: row.label,
    timestamp: epoch(row.occurred_at),
    documentCount:
      Number(row.document_count),
    totalPages:
      Number(row.total_pages),
    documents:
      Array.isArray(
        row.legacy_documents
      )
        ? row.legacy_documents
        : [],
    documentRefs:
      Array.isArray(
        row.document_refs
      )
        ? row.document_refs
        : [],
    isCurrent:
      Boolean(row.is_current),
  };
}

function chatFromRow(
  row: any
): ChatMessage {
  const metadata =
    row.metadata &&
    typeof row.metadata === 'object'
      ? row.metadata
      : {};

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: epoch(row.occurred_at),
    citations:
      Array.isArray(row.citations) &&
      row.citations.length > 0
        ? row.citations
        : undefined,
    isFoundInDocuments:
      metadata.isFoundInDocuments,
    memoryUsed:
      metadata.memoryUsed,
    memoryCount:
      metadata.memoryCount,
    usedMemories:
      metadata.usedMemories,
    experienceRecorded:
      metadata.experienceRecorded,
    userFeedback:
      metadata.userFeedback,
    experienceId:
      metadata.experienceId,
  };
}

function testCaseFromRow(
  row: any
): EvaluationTestCase {
  return {
    id: row.id,
    kbId: row.workspace_id,
    category: row.category,
    question: row.question,
    expectedBehavior:
      row.expected_behavior,
    expectedKeywords:
      Array.isArray(
        row.expected_keywords
      ) &&
      row.expected_keywords.length > 0
        ? row.expected_keywords
        : undefined,
    mustRefuse:
      row.must_refuse ??
      undefined,
  };
}

function runFromRow(
  row: any
): EvaluationRun {
  return {
    id: row.id,
    kbId: row.workspace_id,
    versionTag: row.version_tag,
    timestamp: epoch(row.occurred_at),
    totalTests:
      Number(row.total_tests),
    passedCount:
      Number(row.passed_count),
    failedCount:
      Number(row.failed_count),
    accuracyScore:
      Number(row.accuracy_score),
    groundedScore:
      Number(row.grounded_score),
    crossDocScore:
      Number(row.cross_doc_score),
    refusalScore:
      Number(row.refusal_score),
    results:
      Array.isArray(row.results)
        ? row.results
        : [],
  };
}

function chatMetadata(
  message: ChatMessage
) {
  return {
    isFoundInDocuments:
      message.isFoundInDocuments,
    memoryUsed:
      message.memoryUsed,
    memoryCount:
      message.memoryCount,
    usedMemories:
      message.usedMemories,
    experienceRecorded:
      message.experienceRecorded,
    userFeedback:
      message.userFeedback,
    experienceId:
      message.experienceId,
  };
}

async function saveAiWith(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  workspaceId: string,
  ai: SpecializedAI
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_specialized_ai
      (account_id, workspace_id, id, name, description,
       role_definition, system_prompt_modifier, response_style,
       citation_mode, strict_refusal, confidence_threshold,
       memory_enabled, memory_retrieval_enabled, allowed_memory_types,
       max_retrieved_memories, memory_confidence_threshold,
       allow_candidate_generation, created_at, updated_at)
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,
       $15,$16,$17,$18,$19
     )
     ON CONFLICT (account_id, workspace_id)
     DO UPDATE SET
       id = EXCLUDED.id,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       role_definition = EXCLUDED.role_definition,
       system_prompt_modifier = EXCLUDED.system_prompt_modifier,
       response_style = EXCLUDED.response_style,
       citation_mode = EXCLUDED.citation_mode,
       strict_refusal = EXCLUDED.strict_refusal,
       confidence_threshold = EXCLUDED.confidence_threshold,
       memory_enabled = EXCLUDED.memory_enabled,
       memory_retrieval_enabled = EXCLUDED.memory_retrieval_enabled,
       allowed_memory_types = EXCLUDED.allowed_memory_types,
       max_retrieved_memories = EXCLUDED.max_retrieved_memories,
       memory_confidence_threshold = EXCLUDED.memory_confidence_threshold,
       allow_candidate_generation = EXCLUDED.allow_candidate_generation,
       updated_at = EXCLUDED.updated_at`,
    [
      accountId,
      workspaceId,
      ai.id,
      ai.name,
      ai.description,
      ai.roleDefinition,
      ai.systemPromptModifier ?? null,
      ai.responseStyle,
      ai.citationMode,
      ai.strictRefusal,
      ai.confidenceThreshold ?? null,
      ai.memoryEnabled ?? null,
      ai.memoryRetrievalEnabled ??
        null,
      JSON.stringify(
        ai.allowedMemoryTypes || []
      ),
      ai.maxRetrievedMemories ??
        null,
      ai.memoryConfidenceThreshold ??
        null,
      ai.allowCandidateGeneration ??
        null,
      new Date(ai.createdAt),
      new Date(ai.updatedAt),
    ]
  );
}

async function saveVersionWith(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  workspaceId: string,
  version: KnowledgeVersion
): Promise<void> {
  if (version.isCurrent) {
    await client.query(
      `UPDATE workspace_knowledge_versions
       SET is_current = false
       WHERE account_id = $1
         AND workspace_id = $2
         AND is_current = true
         AND id <> $3`,
      [
        accountId,
        workspaceId,
        version.id,
      ]
    );
  }

  await client.query(
    `INSERT INTO workspace_knowledge_versions
      (account_id, workspace_id, id, version_number,
       version_tag, label, occurred_at, document_count,
       total_pages, legacy_documents, document_refs, is_current)
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12
     )
     ON CONFLICT (account_id, workspace_id, id)
     DO UPDATE SET
       version_number = EXCLUDED.version_number,
       version_tag = EXCLUDED.version_tag,
       label = EXCLUDED.label,
       occurred_at = EXCLUDED.occurred_at,
       document_count = EXCLUDED.document_count,
       total_pages = EXCLUDED.total_pages,
       legacy_documents = EXCLUDED.legacy_documents,
       document_refs = EXCLUDED.document_refs,
       is_current = EXCLUDED.is_current`,
    [
      accountId,
      workspaceId,
      version.id,
      version.versionNumber,
      version.versionTag,
      version.label,
      new Date(version.timestamp),
      version.documentCount,
      version.totalPages,
      JSON.stringify(
        version.documents || []
      ),
      JSON.stringify(
        version.documentRefs || []
      ),
      version.isCurrent,
    ]
  );
}

async function saveChatWith(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  workspaceId: string,
  message: ChatMessage
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_chat_messages
      (account_id, workspace_id, id, role, content,
       occurred_at, citations, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
     ON CONFLICT (account_id, workspace_id, id)
     DO UPDATE SET
       role = EXCLUDED.role,
       content = EXCLUDED.content,
       occurred_at = EXCLUDED.occurred_at,
       citations = EXCLUDED.citations,
       metadata = EXCLUDED.metadata`,
    [
      accountId,
      workspaceId,
      message.id,
      message.role,
      message.content,
      new Date(message.timestamp),
      JSON.stringify(
        message.citations || []
      ),
      JSON.stringify(
        chatMetadata(message)
      ),
    ]
  );
}

async function saveTestCaseWith(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  workspaceId: string,
  testCase: EvaluationTestCase
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_evaluation_test_cases
      (account_id, workspace_id, id, category, question,
       expected_behavior, expected_keywords, must_refuse)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT (account_id, workspace_id, id)
     DO UPDATE SET
       category = EXCLUDED.category,
       question = EXCLUDED.question,
       expected_behavior = EXCLUDED.expected_behavior,
       expected_keywords = EXCLUDED.expected_keywords,
       must_refuse = EXCLUDED.must_refuse`,
    [
      accountId,
      workspaceId,
      testCase.id,
      testCase.category,
      testCase.question,
      testCase.expectedBehavior,
      JSON.stringify(
        testCase.expectedKeywords || []
      ),
      testCase.mustRefuse ?? null,
    ]
  );
}

async function saveRunWith(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  workspaceId: string,
  run: EvaluationRun
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_evaluation_runs
      (account_id, workspace_id, id, version_tag, occurred_at,
       total_tests, passed_count, failed_count, accuracy_score,
       grounded_score, cross_doc_score, refusal_score, results)
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb
     )
     ON CONFLICT (account_id, workspace_id, id)
     DO UPDATE SET
       version_tag = EXCLUDED.version_tag,
       occurred_at = EXCLUDED.occurred_at,
       total_tests = EXCLUDED.total_tests,
       passed_count = EXCLUDED.passed_count,
       failed_count = EXCLUDED.failed_count,
       accuracy_score = EXCLUDED.accuracy_score,
       grounded_score = EXCLUDED.grounded_score,
       cross_doc_score = EXCLUDED.cross_doc_score,
       refusal_score = EXCLUDED.refusal_score,
       results = EXCLUDED.results`,
    [
      accountId,
      workspaceId,
      run.id,
      run.versionTag,
      new Date(run.timestamp),
      run.totalTests,
      run.passedCount,
      run.failedCount,
      run.accuracyScore,
      run.groundedScore,
      run.crossDocScore,
      run.refusalScore,
      JSON.stringify(run.results),
    ]
  );
}

export class PostgresWorkspaceStructuredStateRepository
  implements WorkspaceStructuredStateRepository
{
  async isInitialized(
    accountId: string,
    workspaceId: string
  ): Promise<boolean> {
    const result =
      await postgresPool().query(
        `SELECT 1
         FROM workspace_specialized_ai
         WHERE account_id = $1
           AND workspace_id = $2`,
        [accountId, workspaceId]
      );
    return Boolean(result.rowCount);
  }

  async load(
    accountId: string,
    workspaceId: string
  ): Promise<WorkspaceStructuredState | null> {
    const [
      aiResult,
      versionResult,
      chatResult,
      testCaseResult,
      runResult,
    ] = await Promise.all([
      postgresPool().query(
        `SELECT *
         FROM workspace_specialized_ai
         WHERE account_id = $1
           AND workspace_id = $2`,
        [accountId, workspaceId]
      ),
      postgresPool().query(
        `SELECT *
         FROM workspace_knowledge_versions
         WHERE account_id = $1
           AND workspace_id = $2
         ORDER BY version_number DESC, id DESC`,
        [accountId, workspaceId]
      ),
      postgresPool().query(
        `SELECT *
         FROM workspace_chat_messages
         WHERE account_id = $1
           AND workspace_id = $2
         ORDER BY occurred_at ASC, id ASC`,
        [accountId, workspaceId]
      ),
      postgresPool().query(
        `SELECT *
         FROM workspace_evaluation_test_cases
         WHERE account_id = $1
           AND workspace_id = $2
         ORDER BY id ASC`,
        [accountId, workspaceId]
      ),
      postgresPool().query(
        `SELECT *
         FROM workspace_evaluation_runs
         WHERE account_id = $1
           AND workspace_id = $2
         ORDER BY occurred_at DESC, id DESC
         LIMIT 25`,
        [accountId, workspaceId]
      ),
    ]);

    if (!aiResult.rowCount) {
      return null;
    }

    return {
      specializedAi:
        aiFromRow(aiResult.rows[0]),
      versions:
        versionResult.rows.map(
          versionFromRow
        ),
      chatHistory:
        chatResult.rows.map(
          chatFromRow
        ),
      testCases:
        testCaseResult.rows.map(
          testCaseFromRow
        ),
      evaluationRuns:
        runResult.rows.map(
          runFromRow
        ),
    };
  }

  async initialize(
    accountId: string,
    workspaceId: string,
    state: WorkspaceStructuredState
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        const owned =
          await client.query(
            `SELECT 1
             FROM workspaces
             WHERE account_id = $1
               AND id = $2
             FOR UPDATE`,
            [accountId, workspaceId]
          );
        if (!owned.rowCount) {
          throw new Error(
            'Workspace not found in the current account scope.'
          );
        }

        await saveAiWith(
          client,
          accountId,
          workspaceId,
          state.specializedAi
        );

        await client.query(
          `DELETE FROM workspace_knowledge_versions
           WHERE account_id = $1
             AND workspace_id = $2`,
          [accountId, workspaceId]
        );
        for (const version of state.versions) {
          await saveVersionWith(
            client,
            accountId,
            workspaceId,
            version
          );
        }

        await client.query(
          `DELETE FROM workspace_chat_messages
           WHERE account_id = $1
             AND workspace_id = $2`,
          [accountId, workspaceId]
        );
        for (const message of state.chatHistory) {
          await saveChatWith(
            client,
            accountId,
            workspaceId,
            message
          );
        }

        await client.query(
          `DELETE FROM workspace_evaluation_test_cases
           WHERE account_id = $1
             AND workspace_id = $2`,
          [accountId, workspaceId]
        );
        for (const testCase of state.testCases) {
          await saveTestCaseWith(
            client,
            accountId,
            workspaceId,
            testCase
          );
        }

        await client.query(
          `DELETE FROM workspace_evaluation_runs
           WHERE account_id = $1
             AND workspace_id = $2`,
          [accountId, workspaceId]
        );
        for (const run of state.evaluationRuns.slice(0, 25)) {
          await saveRunWith(
            client,
            accountId,
            workspaceId,
            run
          );
        }
      }
    );
  }

  async saveSpecializedAI(
    accountId: string,
    workspaceId: string,
    ai: SpecializedAI
  ): Promise<void> {
    await withTransaction(
      (client) =>
        saveAiWith(
          client,
          accountId,
          workspaceId,
          ai
        )
    );
  }

  async saveVersion(
    accountId: string,
    workspaceId: string,
    version: KnowledgeVersion
  ): Promise<void> {
    await withTransaction(
      (client) =>
        saveVersionWith(
          client,
          accountId,
          workspaceId,
          version
        )
    );
  }

  async setCurrentVersion(
    accountId: string,
    workspaceId: string,
    versionId: string
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE workspace_knowledge_versions
           SET is_current = false
           WHERE account_id = $1
             AND workspace_id = $2
             AND is_current = true`,
          [accountId, workspaceId]
        );

        const result =
          await client.query(
            `UPDATE workspace_knowledge_versions
             SET is_current = true
             WHERE account_id = $1
               AND workspace_id = $2
               AND id = $3`,
            [
              accountId,
              workspaceId,
              versionId,
            ]
          );

        if (!result.rowCount) {
          throw new Error(
            'Knowledge version not found in the current account/workspace scope.'
          );
        }
      }
    );
  }

  async addChatMessage(
    accountId: string,
    workspaceId: string,
    message: ChatMessage
  ): Promise<void> {
    await withTransaction(
      (client) =>
        saveChatWith(
          client,
          accountId,
          workspaceId,
          message
        )
    );
  }

  async clearChat(
    accountId: string,
    workspaceId: string
  ): Promise<void> {
    await postgresPool().query(
      `DELETE FROM workspace_chat_messages
       WHERE account_id = $1
         AND workspace_id = $2`,
      [accountId, workspaceId]
    );
  }

  async addTestCase(
    accountId: string,
    workspaceId: string,
    testCase: EvaluationTestCase
  ): Promise<void> {
    await withTransaction(
      (client) =>
        saveTestCaseWith(
          client,
          accountId,
          workspaceId,
          testCase
        )
    );
  }

  async removeTestCase(
    accountId: string,
    workspaceId: string,
    testCaseId: string
  ): Promise<boolean> {
    const result =
      await postgresPool().query(
        `DELETE FROM workspace_evaluation_test_cases
         WHERE account_id = $1
           AND workspace_id = $2
           AND id = $3`,
        [
          accountId,
          workspaceId,
          testCaseId,
        ]
      );
    return Boolean(result.rowCount);
  }

  async recordEvaluationRun(
    accountId: string,
    workspaceId: string,
    run: EvaluationRun
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await saveRunWith(
          client,
          accountId,
          workspaceId,
          run
        );

        await client.query(
          `DELETE FROM workspace_evaluation_runs
           WHERE account_id = $1
             AND workspace_id = $2
             AND id IN (
               SELECT id
               FROM workspace_evaluation_runs
               WHERE account_id = $1
                 AND workspace_id = $2
               ORDER BY occurred_at DESC, id DESC
               OFFSET 25
             )`,
          [accountId, workspaceId]
        );
      }
    );
  }

  async findWorkspaceIdByAiId(
    accountId: string,
    aiId: string
  ): Promise<string | null> {
    const result =
      await postgresPool().query(
        `SELECT workspace_id
         FROM workspace_specialized_ai
         WHERE account_id = $1
           AND id = $2`,
        [accountId, aiId]
      );

    return result.rowCount
      ? String(
          result.rows[0]
            .workspace_id
        )
      : null;
  }
}

export const postgresWorkspaceStructuredStateRepository =
  new PostgresWorkspaceStructuredStateRepository();
