export type PlatformApiFamily =
  | 'PLATFORM'
  | 'SOURCES'
  | 'KNOWLEDGE'
  | 'ASK'
  | 'INSIGHTS'
  | 'ACTIONS'
  | 'WATCH'
  | 'AUDIT'
  | 'TOOLS';

export type PlatformRiskClass =
  | 'READ_ONLY'
  | 'QUERY'
  | 'PROPOSAL_WRITE';

export type PlatformRateLimitClass =
  | 'PUBLIC'
  | 'READ'
  | 'QUERY'
  | 'WRITE';

export type PlatformStability = 'STABLE';

export interface PlatformApiOperation {
  operationId: string;
  version: 'v1';
  method: 'GET' | 'POST';
  path: string;
  family: PlatformApiFamily;
  requiredScopes: string[];
  mutation: boolean;
  riskClass: PlatformRiskClass;
  auditBehavior: 'REQUEST_USAGE' | 'REQUEST_USAGE_AND_DOMAIN_AUDIT';
  rateLimitClass: PlatformRateLimitClass;
  stability: PlatformStability;
  description: string;
}

export const PLATFORM_API_VERSION = 'v1';
export const PLATFORM_API_BASE_PATH = '/api/platform/v1';

export const PLATFORM_SCOPES = {
  sourcesRead: 'platform:sources:read',
  knowledgeRead: 'platform:knowledge:read',
  askQuery: 'platform:ask:query',
  insightsRead: 'platform:insights:read',
  actionsRead: 'platform:actions:read',
  actionsPropose: 'platform:actions:propose',
  watchRead: 'platform:watch:read',
  auditRead: 'platform:audit:read',
  toolsRead: 'platform:tools:read',
  toolsInvoke: 'platform:tools:invoke',
} as const;

export const PLATFORM_API_OPERATIONS: PlatformApiOperation[] = [
  {
    operationId: 'platform.manifest.get',
    version: 'v1',
    method: 'GET',
    path: '/manifest',
    family: 'PLATFORM',
    requiredScopes: [],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'PUBLIC',
    stability: 'STABLE',
    description: 'Return the machine-readable stable platform API manifest.',
  },
  {
    operationId: 'sources.list',
    version: 'v1',
    method: 'GET',
    path: '/sources',
    family: 'SOURCES',
    requiredScopes: [PLATFORM_SCOPES.sourcesRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'List account-scoped dataset/document source metadata.',
  },
  {
    operationId: 'knowledge.summary.get',
    version: 'v1',
    method: 'GET',
    path: '/knowledge/summary',
    family: 'KNOWLEDGE',
    requiredScopes: [PLATFORM_SCOPES.knowledgeRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'Return living company knowledge counts.',
  },
  {
    operationId: 'knowledge.entities.list',
    version: 'v1',
    method: 'GET',
    path: '/knowledge/entities',
    family: 'KNOWLEDGE',
    requiredScopes: [PLATFORM_SCOPES.knowledgeRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'List account-scoped company entities.',
  },
  {
    operationId: 'knowledge.entity.get',
    version: 'v1',
    method: 'GET',
    path: '/knowledge/entities/:id',
    family: 'KNOWLEDGE',
    requiredScopes: [PLATFORM_SCOPES.knowledgeRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'Read an entity with claims, relationships, and events.',
  },
  {
    operationId: 'ask.query',
    version: 'v1',
    method: 'POST',
    path: '/ask',
    family: 'ASK',
    requiredScopes: [PLATFORM_SCOPES.askQuery],
    mutation: false,
    riskClass: 'QUERY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'QUERY',
    stability: 'STABLE',
    description: 'Ask a grounded document or structured-data question.',
  },
  {
    operationId: 'insights.list',
    version: 'v1',
    method: 'GET',
    path: '/insights',
    family: 'INSIGHTS',
    requiredScopes: [PLATFORM_SCOPES.insightsRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'List deterministic discovery insights.',
  },
  {
    operationId: 'actions.list',
    version: 'v1',
    method: 'GET',
    path: '/actions',
    family: 'ACTIONS',
    requiredScopes: [PLATFORM_SCOPES.actionsRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'List safe action proposals. Execution is not exposed here.',
  },
  {
    operationId: 'actions.propose',
    version: 'v1',
    method: 'POST',
    path: '/actions/propose',
    family: 'ACTIONS',
    requiredScopes: [PLATFORM_SCOPES.actionsPropose],
    mutation: true,
    riskClass: 'PROPOSAL_WRITE',
    auditBehavior: 'REQUEST_USAGE_AND_DOMAIN_AUDIT',
    rateLimitClass: 'WRITE',
    stability: 'STABLE',
    description: 'Create a validated action proposal without confirming it.',
  },
  {
    operationId: 'watch.rules.list',
    version: 'v1',
    method: 'GET',
    path: '/watch/rules',
    family: 'WATCH',
    requiredScopes: [PLATFORM_SCOPES.watchRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'List persisted Watch rules.',
  },
  {
    operationId: 'watch.alerts.list',
    version: 'v1',
    method: 'GET',
    path: '/watch/alerts',
    family: 'WATCH',
    requiredScopes: [PLATFORM_SCOPES.watchRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'List persisted Watch alert episodes.',
  },
  {
    operationId: 'tools.list',
    version: 'v1',
    method: 'GET',
    path: '/tools',
    family: 'TOOLS',
    requiredScopes: [PLATFORM_SCOPES.toolsRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description:
      'List governed registered tools and their permission/schema metadata.',
  },
  {
    operationId: 'tools.invoke',
    version: 'v1',
    method: 'POST',
    path: '/tools/:id/invoke',
    family: 'TOOLS',
    requiredScopes: [PLATFORM_SCOPES.toolsInvoke],
    mutation: true,
    riskClass: 'PROPOSAL_WRITE',
    auditBehavior: 'REQUEST_USAGE_AND_DOMAIN_AUDIT',
    rateLimitClass: 'WRITE',
    stability: 'STABLE',
    description:
      'Invoke a trusted registered tool. Tool-specific capability scopes are enforced in addition to the generic invoke scope.',
  },
  {
    operationId: 'audit.activity.list',
    version: 'v1',
    method: 'GET',
    path: '/audit/activity',
    family: 'AUDIT',
    requiredScopes: [PLATFORM_SCOPES.auditRead],
    mutation: false,
    riskClass: 'READ_ONLY',
    auditBehavior: 'REQUEST_USAGE',
    rateLimitClass: 'READ',
    stability: 'STABLE',
    description: 'List normalized action-audit and business-event activity.',
  },
];

export function platformOperation(
  operationId: string
): PlatformApiOperation {
  const operation = PLATFORM_API_OPERATIONS.find(
    (item) => item.operationId === operationId
  );
  if (!operation) {
    throw new Error(
      'Unknown stable platform operation: ' + operationId
    );
  }
  return operation;
}

export function publicPlatformManifest() {
  return {
    api: 'Knowledge AI Platform API',
    version: PLATFORM_API_VERSION,
    basePath: PLATFORM_API_BASE_PATH,
    stability: 'STABLE',
    principles: {
      accountIdentity:
        'Derived only from the authenticated API key; caller-supplied account identifiers are ignored.',
      mutations:
        'Mutation scopes are explicit. Action proposal creation does not expose confirmation or automation execution.',
      experimentalInternals:
        'Experimental cognitive, mediator, sandbox, evaluation, and admin internals are not part of this stable contract.',
    },
    scopes: Object.values(PLATFORM_SCOPES),
    operations: PLATFORM_API_OPERATIONS.map((operation) => ({
      ...operation,
      requiredScopes: [...operation.requiredScopes],
    })),
  };
}
