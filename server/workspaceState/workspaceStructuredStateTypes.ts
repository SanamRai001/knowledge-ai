import type {
  ChatMessage,
  EvaluationRun,
  EvaluationTestCase,
  KnowledgeVersion,
  SpecializedAI,
} from '../../src/types.js';

export interface WorkspaceStructuredState {
  specializedAi: SpecializedAI;
  versions: KnowledgeVersion[];
  chatHistory: ChatMessage[];
  testCases: EvaluationTestCase[];
  evaluationRuns: EvaluationRun[];
}

export interface WorkspaceStructuredStateRepository {
  isInitialized(
    accountId: string,
    workspaceId: string
  ): Promise<boolean>;

  load(
    accountId: string,
    workspaceId: string
  ): Promise<WorkspaceStructuredState | null>;

  initialize(
    accountId: string,
    workspaceId: string,
    state: WorkspaceStructuredState
  ): Promise<void>;

  saveSpecializedAI(
    accountId: string,
    workspaceId: string,
    ai: SpecializedAI
  ): Promise<void>;

  saveVersion(
    accountId: string,
    workspaceId: string,
    version: KnowledgeVersion
  ): Promise<void>;

  setCurrentVersion(
    accountId: string,
    workspaceId: string,
    versionId: string
  ): Promise<void>;

  addChatMessage(
    accountId: string,
    workspaceId: string,
    message: ChatMessage
  ): Promise<void>;

  clearChat(
    accountId: string,
    workspaceId: string
  ): Promise<void>;

  addTestCase(
    accountId: string,
    workspaceId: string,
    testCase: EvaluationTestCase
  ): Promise<void>;

  removeTestCase(
    accountId: string,
    workspaceId: string,
    testCaseId: string
  ): Promise<boolean>;

  recordEvaluationRun(
    accountId: string,
    workspaceId: string,
    run: EvaluationRun
  ): Promise<void>;

  findWorkspaceIdByAiId(
    accountId: string,
    aiId: string
  ): Promise<string | null>;
}
