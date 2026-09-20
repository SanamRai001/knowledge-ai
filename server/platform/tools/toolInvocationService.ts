import crypto from 'crypto';
import { apiKeyStore } from '../../apiKeyStore.js';
import { PLATFORM_SCOPES } from '../platformApiManifest.js';
import './builtInTools.js';
import { validateToolInput } from './toolInputValidator.js';
import { platformPersistence } from '../platformPersistence.js';
import { toolRegistry } from './toolRegistry.js';
import type {
  RegisteredToolContext,
  RegisteredToolDescriptor,
  RegisteredToolRateClass,
} from './types.js';

const TOOL_RATE_LIMITS: Record<
  RegisteredToolRateClass,
  number
> = {
  READ: 100,
  QUERY: 30,
  WRITE: 20,
};

function canonicalInput(
  value: Record<string, unknown>
): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    ordered[key] = value[key];
  }
  return JSON.stringify(ordered);
}

function inputHash(
  value: Record<string, unknown>
): string {
  return crypto
    .createHash('sha256')
    .update(canonicalInput(value), 'utf8')
    .digest('hex');
}

export class ToolInvocationError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'TOOL_INVOKE_FORBIDDEN'
    | 'TOOL_CAPABILITY_FORBIDDEN'
    | 'TOOL_RATE_LIMITED';

  constructor(
    code:
      | 'TOOL_INVOKE_FORBIDDEN'
      | 'TOOL_CAPABILITY_FORBIDDEN'
      | 'TOOL_RATE_LIMITED',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ToolInvocationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ToolInvocationResult {
  tool: RegisteredToolDescriptor;
  invocationId: string;
  result: unknown;
}

export class ToolInvocationService {
  public list(params: {
    scopes: string[];
  }): Array<
    RegisteredToolDescriptor & {
      invokable: boolean;
      missingScopes: string[];
    }
  > {
    const scopes = new Set(params.scopes);
    const genericAllowed = scopes.has(
      PLATFORM_SCOPES.toolsInvoke
    );

    return toolRegistry.list().map((descriptor) => {
      const missingScopes = descriptor.requiredScopes.filter(
        (scope) => !scopes.has(scope)
      );
      return {
        ...descriptor,
        inputSchema: structuredClone(
          descriptor.inputSchema
        ),
        invokable:
          genericAllowed && missingScopes.length === 0,
        missingScopes,
      };
    });
  }

  public async invoke(params: {
    toolId: string;
    rawInput: unknown;
    context: RegisteredToolContext;
  }): Promise<ToolInvocationResult> {
    const tool = toolRegistry.require(params.toolId);
    const scopes = new Set(params.context.scopes);

    if (!scopes.has(PLATFORM_SCOPES.toolsInvoke)) {
      throw new ToolInvocationError(
        'TOOL_INVOKE_FORBIDDEN',
        403,
        'API key is missing required scope: ' +
          PLATFORM_SCOPES.toolsInvoke
      );
    }

    const missing = tool.descriptor.requiredScopes.filter(
      (scope) => !scopes.has(scope)
    );
    if (missing.length > 0) {
      throw new ToolInvocationError(
        'TOOL_CAPABILITY_FORBIDDEN',
        403,
        'API key is missing tool capability scope(s): ' +
          missing.join(', ')
      );
    }

    const input = validateToolInput(
      tool.descriptor.inputSchema,
      params.rawInput
    );

    const rate = apiKeyStore.checkRateLimit(
      params.context.apiKeyId +
        ':tool:' +
        tool.descriptor.id,
      TOOL_RATE_LIMITS[
        tool.descriptor.rateLimitClass
      ]
    );

    if (!rate.allowed) {
      throw new ToolInvocationError(
        'TOOL_RATE_LIMITED',
        429,
        'Registered tool rate limit exceeded. Retry after ' +
          rate.resetSeconds +
          ' seconds.'
      );
    }

    const audit = await platformPersistence.startToolInvocation({
      accountId: params.context.accountId,
      toolId: tool.descriptor.id,
      toolVersion: tool.descriptor.version,
      requestId: params.context.requestId,
      apiKeyId: params.context.apiKeyId,
      inputHash: inputHash(input),
    });

    try {
      const result = await tool.handler(
        input,
        params.context
      );

      await platformPersistence.finishToolInvocation({
        accountId: params.context.accountId,
        invocationId: audit.id,
        status: 'SUCCEEDED',
      });

      return {
        tool: structuredClone(tool.descriptor),
        invocationId: audit.id,
        result,
      };
    } catch (error: any) {
      await platformPersistence.finishToolInvocation({
        accountId: params.context.accountId,
        invocationId: audit.id,
        status: 'FAILED',
        errorCode:
          typeof error?.code === 'string'
            ? error.code
            : 'TOOL_HANDLER_FAILED',
        errorMessage: 'Invocation failed.',
      });
      throw error;
    }
  }
}

export const toolInvocationService =
  new ToolInvocationService();
