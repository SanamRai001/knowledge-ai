import type {
  KnowledgeBase,
  KnowledgeVersion,
  SpecializedAI,
  ChatMessage,
  EvaluationTestCase,
  EvaluationRun,
} from '../../src/types.js';
import {
  postgresWorkspaceStructuredStateRepository,
} from './postgresWorkspaceStructuredStateRepository.js';
import type {
  WorkspaceStructuredState,
  WorkspaceStructuredStateRepository,
} from './workspaceStructuredStateTypes.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class WorkspaceStructuredStateService {
  constructor(
    private readonly repository:
      WorkspaceStructuredStateRepository =
        postgresWorkspaceStructuredStateRepository
  ) {}

  stateFromKnowledgeBase(
    kb: KnowledgeBase
  ): WorkspaceStructuredState {
    return {
      specializedAi:
        clone(kb.specializedAi),
      versions:
        clone(kb.versions || []),
      chatHistory:
        clone(kb.chatHistory || []),
      testCases:
        clone(kb.testCases || []),
      evaluationRuns:
        clone(
          kb.evaluationRuns || []
        ),
    };
  }

  async load(
    accountId: string,
    workspaceId: string
  ): Promise<WorkspaceStructuredState | null> {
    return this.repository.load(
      accountId,
      workspaceId
    );
  }

  async ensureInitialized(input: {
    accountId: string;
    workspaceId: string;
    legacyKnowledgeBase?: KnowledgeBase | null;
  }): Promise<WorkspaceStructuredState | null> {
    const existing =
      await this.repository.load(
        input.accountId,
        input.workspaceId
      );
    if (existing) {
      return existing;
    }

    if (!input.legacyKnowledgeBase) {
      return null;
    }

    await this.repository.initialize(
      input.accountId,
      input.workspaceId,
      this.stateFromKnowledgeBase(
        input.legacyKnowledgeBase
      )
    );

    return this.repository.load(
      input.accountId,
      input.workspaceId
    );
  }

  async initializeFromKnowledgeBase(
    kb: KnowledgeBase
  ): Promise<void> {
    const accountId =
      kb.accountId || 'acc_default';
    await this.repository.initialize(
      accountId,
      kb.id,
      this.stateFromKnowledgeBase(kb)
    );
  }

  async saveSpecializedAI(
    accountId: string,
    workspaceId: string,
    ai: SpecializedAI
  ): Promise<void> {
    await this.repository
      .saveSpecializedAI(
        accountId,
        workspaceId,
        clone(ai)
      );
  }

  async saveVersion(
    accountId: string,
    workspaceId: string,
    version: KnowledgeVersion
  ): Promise<void> {
    await this.repository.saveVersion(
      accountId,
      workspaceId,
      clone(version)
    );
  }

  async setCurrentVersion(
    accountId: string,
    workspaceId: string,
    versionId: string
  ): Promise<void> {
    await this.repository
      .setCurrentVersion(
        accountId,
        workspaceId,
        versionId
      );
  }

  async addChatMessage(
    accountId: string,
    workspaceId: string,
    message: ChatMessage
  ): Promise<void> {
    await this.repository
      .addChatMessage(
        accountId,
        workspaceId,
        clone(message)
      );
  }

  async clearChat(
    accountId: string,
    workspaceId: string
  ): Promise<void> {
    await this.repository.clearChat(
      accountId,
      workspaceId
    );
  }

  async addTestCase(
    accountId: string,
    workspaceId: string,
    testCase: EvaluationTestCase
  ): Promise<void> {
    await this.repository.addTestCase(
      accountId,
      workspaceId,
      clone(testCase)
    );
  }

  async removeTestCase(
    accountId: string,
    workspaceId: string,
    testCaseId: string
  ): Promise<boolean> {
    return this.repository
      .removeTestCase(
        accountId,
        workspaceId,
        testCaseId
      );
  }

  async recordEvaluationRun(
    accountId: string,
    workspaceId: string,
    run: EvaluationRun
  ): Promise<void> {
    await this.repository
      .recordEvaluationRun(
        accountId,
        workspaceId,
        clone(run)
      );
  }

  async findWorkspaceIdByAiId(
    accountId: string,
    aiId: string
  ): Promise<string | null> {
    return this.repository
      .findWorkspaceIdByAiId(
        accountId,
        aiId
      );
  }
}

export const workspaceStructuredStateService =
  new WorkspaceStructuredStateService();
