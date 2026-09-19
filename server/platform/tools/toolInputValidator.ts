import type {
  ToolInputPropertySchema,
  ToolInputSchema,
} from './types.js';

export class ToolInputValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'TOOL_INPUT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ToolInputValidationError';
  }
}

function validateProperty(
  key: string,
  value: unknown,
  schema: ToolInputPropertySchema
): void {
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      throw new ToolInputValidationError(
        'Tool input "' + key + '" must be a string.'
      );
    }
    if (
      schema.minLength !== undefined &&
      value.length < schema.minLength
    ) {
      throw new ToolInputValidationError(
        'Tool input "' + key + '" is shorter than allowed.'
      );
    }
    if (
      schema.maxLength !== undefined &&
      value.length > schema.maxLength
    ) {
      throw new ToolInputValidationError(
        'Tool input "' + key + '" is longer than allowed.'
      );
    }
  } else if (schema.type === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value)
    ) {
      throw new ToolInputValidationError(
        'Tool input "' + key + '" must be a finite number.'
      );
    }
    if (
      schema.minimum !== undefined &&
      value < schema.minimum
    ) {
      throw new ToolInputValidationError(
        'Tool input "' + key + '" is below the allowed minimum.'
      );
    }
    if (
      schema.maximum !== undefined &&
      value > schema.maximum
    ) {
      throw new ToolInputValidationError(
        'Tool input "' + key + '" is above the allowed maximum.'
      );
    }
  } else if (typeof value !== 'boolean') {
    throw new ToolInputValidationError(
      'Tool input "' + key + '" must be a boolean.'
    );
  }

  if (
    schema.enum &&
    !schema.enum.some(
      (candidate) => candidate === value
    )
  ) {
    throw new ToolInputValidationError(
      'Tool input "' + key + '" is not an allowed value.'
    );
  }
}

export function validateToolInput(
  schema: ToolInputSchema,
  raw: unknown
): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw)
  ) {
    throw new ToolInputValidationError(
      'Tool input must be a JSON object.'
    );
  }

  const input = raw as Record<string, unknown>;
  const allowed = new Set(Object.keys(schema.properties));

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new ToolInputValidationError(
        'Unknown tool input field: ' + key
      );
    }
  }

  for (const key of schema.required) {
    if (
      !(key in input) ||
      input[key] === undefined ||
      input[key] === null
    ) {
      throw new ToolInputValidationError(
        'Required tool input is missing: ' + key
      );
    }
  }

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    validateProperty(key, value, schema.properties[key]);
  }

  return structuredClone(input);
}
