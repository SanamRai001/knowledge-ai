export type RegisteredToolRiskClass =
  | 'READ_ONLY'
  | 'QUERY'
  | 'PROPOSAL_WRITE';

export type RegisteredToolRateClass =
  | 'READ'
  | 'QUERY'
  | 'WRITE';

export type RegisteredToolAuditBehavior =
  | 'INVOCATION'
  | 'INVOCATION_AND_DOMAIN_AUDIT';

export type ToolInputScalarType =
  | 'string'
  | 'number'
  | 'boolean';

export interface ToolInputPropertySchema {
  type: ToolInputScalarType;
  description: string;
  enum?: Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolInputPropertySchema>;
  required: string[];
  additionalProperties: false;
}

export interface RegisteredToolDescriptor {
  id: string;
  version: string;
  name: string;
  description: string;
  family:
    | 'KNOWLEDGE'
    | 'ASK'
    | 'INSIGHTS'
    | 'ACTIONS'
    | 'WATCH';
  requiredScopes: string[];
  mutation: boolean;
  riskClass: RegisteredToolRiskClass;
  rateLimitClass: RegisteredToolRateClass;
  auditBehavior: RegisteredToolAuditBehavior;
  executionMode: 'TRUSTED_BUILT_IN';
  inputSchema: ToolInputSchema;
  stability: 'STABLE';
}

export interface RegisteredToolContext {
  accountId: string;
  requestId: string;
  apiKeyId: string;
  scopes: string[];
}

export type RegisteredToolHandler = (
  input: Record<string, unknown>,
  context: RegisteredToolContext
) => unknown | Promise<unknown>;

export interface RegisteredTool {
  descriptor: RegisteredToolDescriptor;
  handler: RegisteredToolHandler;
}

export type ToolInvocationStatus =
  | 'STARTED'
  | 'SUCCEEDED'
  | 'FAILED';

export interface ToolInvocationAudit {
  id: string;
  accountId: string;
  toolId: string;
  toolVersion: string;
  requestId: string;
  apiKeyId: string;
  status: ToolInvocationStatus;
  inputHash: string;
  startedAt: number;
  completedAt?: number;
  errorCode?: string;
  errorMessage?: string;
}
