import type {
  DetectorConfigPropertySchema,
  DetectorConfigSchema,
} from './types.js';

export class DetectorConfigError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'DETECTOR_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DetectorConfigError';
  }
}

function validateProperty(
  name: string,
  schema: DetectorConfigPropertySchema,
  value: unknown
): string | number | boolean {
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      throw new DetectorConfigError(
        'Detector config "' + name + '" must be a string.'
      );
    }
    const normalized = value.trim();
    if (
      schema.minLength !== undefined &&
      normalized.length < schema.minLength
    ) {
      throw new DetectorConfigError(
        'Detector config "' + name + '" is too short.'
      );
    }
    if (
      schema.maxLength !== undefined &&
      normalized.length > schema.maxLength
    ) {
      throw new DetectorConfigError(
        'Detector config "' + name + '" is too long.'
      );
    }
    if (
      schema.enum &&
      !schema.enum.includes(normalized)
    ) {
      throw new DetectorConfigError(
        'Detector config "' + name + '" has an unsupported value.'
      );
    }
    return normalized;
  }

  if (schema.type === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value)
    ) {
      throw new DetectorConfigError(
        'Detector config "' + name + '" must be a finite number.'
      );
    }
    if (
      schema.minimum !== undefined &&
      value < schema.minimum
    ) {
      throw new DetectorConfigError(
        'Detector config "' + name + '" is below the minimum.'
      );
    }
    if (
      schema.maximum !== undefined &&
      value > schema.maximum
    ) {
      throw new DetectorConfigError(
        'Detector config "' + name + '" exceeds the maximum.'
      );
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw new DetectorConfigError(
        'Detector config "' + name + '" has an unsupported value.'
      );
    }
    return value;
  }

  if (typeof value !== 'boolean') {
    throw new DetectorConfigError(
      'Detector config "' + name + '" must be boolean.'
    );
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new DetectorConfigError(
      'Detector config "' + name + '" has an unsupported value.'
    );
  }
  return value;
}

export function validateDetectorConfig(
  schema: DetectorConfigSchema,
  raw: unknown
): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DetectorConfigError(
      'Detector config must be an object.'
    );
  }

  const input = raw as Record<string, unknown>;
  const allowed = new Set(Object.keys(schema.properties));

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new DetectorConfigError(
        'Unknown detector config field: ' + key
      );
    }
  }

  for (const required of schema.required) {
    if (!(required in input)) {
      throw new DetectorConfigError(
        'Missing required detector config field: ' + required
      );
    }
  }

  const normalized: Record<
    string,
    string | number | boolean
  > = {};
  for (const [key, property] of Object.entries(
    schema.properties
  )) {
    if (!(key in input)) continue;
    normalized[key] = validateProperty(
      key,
      property,
      input[key]
    );
  }

  return normalized;
}
