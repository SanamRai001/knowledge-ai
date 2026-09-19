import { hybridActionInterpreter } from '../../actions/hybridActionInterpreter.js';
import { companyKnowledgeStore } from '../../companyKnowledge/companyKnowledgeStore.js';
import { discoveryRuntimeService } from '../../discovery/discoveryRuntimeService.js';
import type { InsightStatus } from '../../discovery/types.js';
import { unifiedQueryService } from '../../querying/unifiedQueryService.js';
import { watchStore } from '../../watch/watchStore.js';
import type { WatchRuleStatus } from '../../watch/types.js';
import { PLATFORM_SCOPES } from '../platformApiManifest.js';
import { toolRegistry } from './toolRegistry.js';
import type { RegisteredTool } from './types.js';

function optionalString(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function optionalNumber(
  input: Record<string, unknown>,
  key: string
): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalBoolean(
  input: Record<string, unknown>,
  key: string
): boolean | undefined {
  return typeof input[key] === 'boolean'
    ? (input[key] as boolean)
    : undefined;
}

const BUILT_IN_TOOLS: RegisteredTool[] = [
  {
    descriptor: {
      id: 'knowledge.entity.get',
      version: '1.0.0',
      name: 'Get company entity',
      description:
        'Read one account-scoped company entity with its claims, relationships, and events.',
      family: 'KNOWLEDGE',
      requiredScopes: [PLATFORM_SCOPES.knowledgeRead],
      mutation: false,
      riskClass: 'READ_ONLY',
      rateLimitClass: 'READ',
      auditBehavior: 'INVOCATION',
      executionMode: 'TRUSTED_BUILT_IN',
      stability: 'STABLE',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['entityId'],
        properties: {
          entityId: {
            type: 'string',
            description: 'Account-scoped company entity ID.',
            minLength: 1,
            maxLength: 160,
          },
        },
      },
    },
    handler: (input, context) => {
      const entityId = String(input.entityId);
      const entity = companyKnowledgeStore.requireEntity(
        context.accountId,
        entityId
      );
      return {
        entity,
        claims: companyKnowledgeStore.listClaims({
          accountId: context.accountId,
          entityId,
          currentOnly: false,
          limit: 300,
        }),
        relationships:
          companyKnowledgeStore.listRelationships({
            accountId: context.accountId,
            entityId,
            limit: 100,
          }),
        events: companyKnowledgeStore.listEvents({
          accountId: context.accountId,
          entityId,
          limit: 200,
        }),
      };
    },
  },
  {
    descriptor: {
      id: 'ask.query',
      version: '1.0.0',
      name: 'Ask grounded question',
      description:
        'Ask a grounded document or structured-data question through the authoritative query service.',
      family: 'ASK',
      requiredScopes: [PLATFORM_SCOPES.askQuery],
      mutation: false,
      riskClass: 'QUERY',
      rateLimitClass: 'QUERY',
      auditBehavior: 'INVOCATION',
      executionMode: 'TRUSTED_BUILT_IN',
      stability: 'STABLE',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['question'],
        properties: {
          question: {
            type: 'string',
            description: 'Question to answer from authorized company sources.',
            minLength: 1,
            maxLength: 5000,
          },
          datasetId: {
            type: 'string',
            description: 'Optional structured dataset ID.',
            minLength: 1,
            maxLength: 160,
          },
          datasetVersionId: {
            type: 'string',
            description: 'Optional explicit dataset version ID.',
            minLength: 1,
            maxLength: 160,
          },
          knowledgeBaseId: {
            type: 'string',
            description: 'Optional document knowledge-base ID.',
            minLength: 1,
            maxLength: 160,
          },
          allowLlmPlanning: {
            type: 'boolean',
            description: 'Allow bounded provider planning when deterministic planning is insufficient.',
          },
          allowLlmExplanation: {
            type: 'boolean',
            description: 'Allow provider-generated explanation over deterministic results.',
          },
        },
      },
    },
    handler: async (input, context) =>
      unifiedQueryService.answer({
        accountId: context.accountId,
        requestId: context.requestId,
        question: String(input.question),
        datasetId: optionalString(input, 'datasetId'),
        datasetVersionId: optionalString(
          input,
          'datasetVersionId'
        ),
        knowledgeBaseId: optionalString(
          input,
          'knowledgeBaseId'
        ),
        allowLlmPlanning: optionalBoolean(
          input,
          'allowLlmPlanning'
        ),
        allowLlmExplanation: optionalBoolean(
          input,
          'allowLlmExplanation'
        ),
      }),
  },
  {
    descriptor: {
      id: 'insights.list',
      version: '1.0.0',
      name: 'List deterministic insights',
      description:
        'List account-scoped discovery insights produced by deterministic detectors.',
      family: 'INSIGHTS',
      requiredScopes: [PLATFORM_SCOPES.insightsRead],
      mutation: false,
      riskClass: 'READ_ONLY',
      rateLimitClass: 'READ',
      auditBehavior: 'INVOCATION',
      executionMode: 'TRUSTED_BUILT_IN',
      stability: 'STABLE',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {
          datasetId: {
            type: 'string',
            description: 'Optional dataset filter.',
            minLength: 1,
            maxLength: 160,
          },
          knowledgeBaseId: {
            type: 'string',
            description: 'Optional knowledge-base filter.',
            minLength: 1,
            maxLength: 160,
          },
          status: {
            type: 'string',
            description: 'Optional insight lifecycle status.',
            enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
          },
          latestRunOnly: {
            type: 'boolean',
            description: 'Return only the latest analysis run for a selected source.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of insights.',
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    handler: async (input, context) => ({
      insights: await discoveryRuntimeService.listInsights({
        accountId: context.accountId,
        datasetId: optionalString(input, 'datasetId'),
        knowledgeBaseId: optionalString(
          input,
          'knowledgeBaseId'
        ),
        status: optionalString(
          input,
          'status'
        ) as InsightStatus | undefined,
        latestRunOnly:
          optionalBoolean(input, 'latestRunOnly') ?? true,
        limit: optionalNumber(input, 'limit') ?? 20,
      }),
    }),
  },
  {
    descriptor: {
      id: 'watch.rules.list',
      version: '1.0.0',
      name: 'List Watch rules',
      description:
        'List account-scoped persisted Watch rules without modifying monitoring state.',
      family: 'WATCH',
      requiredScopes: [PLATFORM_SCOPES.watchRead],
      mutation: false,
      riskClass: 'READ_ONLY',
      rateLimitClass: 'READ',
      auditBehavior: 'INVOCATION',
      executionMode: 'TRUSTED_BUILT_IN',
      stability: 'STABLE',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {
          status: {
            type: 'string',
            description: 'Optional Watch rule status.',
            enum: ['ACTIVE', 'PAUSED', 'INVALID', 'ARCHIVED'],
          },
          limit: {
            type: 'number',
            description: 'Maximum number of Watch rules.',
            minimum: 1,
            maximum: 500,
          },
        },
      },
    },
    handler: (input, context) => ({
      rules: watchStore.listRules({
        accountId: context.accountId,
        status: optionalString(
          input,
          'status'
        ) as WatchRuleStatus | undefined,
        limit: optionalNumber(input, 'limit') ?? 100,
      }),
    }),
  },
  {
    descriptor: {
      id: 'actions.propose',
      version: '1.0.0',
      name: 'Propose safe business action',
      description:
        'Create a validated Phase 4 action proposal only. This tool cannot confirm, execute, or auto-execute the proposal.',
      family: 'ACTIONS',
      requiredScopes: [PLATFORM_SCOPES.actionsPropose],
      mutation: true,
      riskClass: 'PROPOSAL_WRITE',
      rateLimitClass: 'WRITE',
      auditBehavior: 'INVOCATION_AND_DOMAIN_AUDIT',
      executionMode: 'TRUSTED_BUILT_IN',
      stability: 'STABLE',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['instruction'],
        properties: {
          instruction: {
            type: 'string',
            description:
              'Supported natural-language payment, inventory receipt, or order-status proposal.',
            minLength: 1,
            maxLength: 2000,
          },
          allowLlmParsing: {
            type: 'boolean',
            description:
              'Allow the bounded language parser if deterministic parsing does not match.',
          },
        },
      },
    },
    handler: async (input, context) =>
      hybridActionInterpreter.interpret({
        accountId: context.accountId,
        instruction: String(input.instruction),
        allowLlmParsing:
          optionalBoolean(input, 'allowLlmParsing') ?? true,
      }),
  },
];

export function registerBuiltInTools(): void {
  for (const tool of BUILT_IN_TOOLS) {
    if (!toolRegistry.get(tool.descriptor.id)) {
      toolRegistry.registerBuiltIn(tool);
    }
  }
}

registerBuiltInTools();
