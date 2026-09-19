import type {
  RegisteredTool,
  RegisteredToolDescriptor,
} from './types.js';

const TOOL_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+$/;

export class ToolRegistryError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'TOOL_DESCRIPTOR_INVALID'
    | 'TOOL_ALREADY_REGISTERED'
    | 'TOOL_NOT_FOUND';

  constructor(
    code:
      | 'TOOL_DESCRIPTOR_INVALID'
      | 'TOOL_ALREADY_REGISTERED'
      | 'TOOL_NOT_FOUND',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ToolRegistryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  public registerBuiltIn(tool: RegisteredTool): void {
    this.validateDescriptor(tool.descriptor);

    if (this.tools.has(tool.descriptor.id)) {
      throw new ToolRegistryError(
        'TOOL_ALREADY_REGISTERED',
        409,
        'Registered tool ID is already in use: ' +
          tool.descriptor.id
      );
    }

    this.tools.set(tool.descriptor.id, tool);
  }

  public get(toolId: string): RegisteredTool | null {
    return this.tools.get(toolId) || null;
  }

  public require(toolId: string): RegisteredTool {
    const tool = this.get(toolId);
    if (!tool) {
      throw new ToolRegistryError(
        'TOOL_NOT_FOUND',
        404,
        'Registered tool not found.'
      );
    }
    return tool;
  }

  public list(): RegisteredToolDescriptor[] {
    return Array.from(this.tools.values())
      .map((tool) => structuredClone(tool.descriptor))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private validateDescriptor(
    descriptor: RegisteredToolDescriptor
  ): void {
    if (!TOOL_ID_PATTERN.test(descriptor.id)) {
      throw new ToolRegistryError(
        'TOOL_DESCRIPTOR_INVALID',
        400,
        'Tool ID must be a dotted lowercase capability name.'
      );
    }
    if (!VERSION_PATTERN.test(descriptor.version)) {
      throw new ToolRegistryError(
        'TOOL_DESCRIPTOR_INVALID',
        400,
        'Tool version must use semantic x.y.z form.'
      );
    }
    if (
      descriptor.executionMode !== 'TRUSTED_BUILT_IN'
    ) {
      throw new ToolRegistryError(
        'TOOL_DESCRIPTOR_INVALID',
        400,
        'Phase 8B accepts trusted built-in tool handlers only.'
      );
    }
    if (
      descriptor.mutation &&
      descriptor.riskClass !== 'PROPOSAL_WRITE'
    ) {
      throw new ToolRegistryError(
        'TOOL_DESCRIPTOR_INVALID',
        400,
        'Mutation tools must declare PROPOSAL_WRITE risk in Phase 8B.'
      );
    }
    if (
      descriptor.mutation &&
      !descriptor.requiredScopes.some(
        (scope) =>
          scope.includes(':propose') ||
          scope.includes(':write')
      )
    ) {
      throw new ToolRegistryError(
        'TOOL_DESCRIPTOR_INVALID',
        400,
        'Mutation tools require an explicit proposal/write capability scope.'
      );
    }
    if (
      descriptor.inputSchema.type !== 'object' ||
      descriptor.inputSchema.additionalProperties !== false
    ) {
      throw new ToolRegistryError(
        'TOOL_DESCRIPTOR_INVALID',
        400,
        'Tool inputs must use a closed object schema.'
      );
    }
  }
}

export const toolRegistry = new ToolRegistry();
