import type {
  RegisteredDetector,
  RegisteredDetectorDescriptor,
} from './types.js';

const DETECTOR_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export class DetectorRegistryError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'DETECTOR_DESCRIPTOR_INVALID'
    | 'DETECTOR_ALREADY_REGISTERED'
    | 'DETECTOR_NOT_FOUND';

  constructor(
    code:
      | 'DETECTOR_DESCRIPTOR_INVALID'
      | 'DETECTOR_ALREADY_REGISTERED'
      | 'DETECTOR_NOT_FOUND',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'DetectorRegistryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class DetectorRegistry {
  private detectors = new Map<string, RegisteredDetector>();

  public registerBuiltIn(detector: RegisteredDetector): void {
    this.validateDescriptor(detector.descriptor);
    if (this.detectors.has(detector.descriptor.id)) {
      throw new DetectorRegistryError(
        'DETECTOR_ALREADY_REGISTERED',
        409,
        'Registered detector ID is already in use: ' +
          detector.descriptor.id
      );
    }
    this.detectors.set(detector.descriptor.id, detector);
  }

  public get(id: string): RegisteredDetector | null {
    return this.detectors.get(id) || null;
  }

  public require(id: string): RegisteredDetector {
    const detector = this.get(id);
    if (!detector) {
      throw new DetectorRegistryError(
        'DETECTOR_NOT_FOUND',
        404,
        'Registered detector not found.'
      );
    }
    return detector;
  }

  public list(): RegisteredDetectorDescriptor[] {
    return Array.from(this.detectors.values())
      .map((item) => structuredClone(item.descriptor))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private validateDescriptor(
    descriptor: RegisteredDetectorDescriptor
  ): void {
    if (!DETECTOR_ID_PATTERN.test(descriptor.id)) {
      throw new DetectorRegistryError(
        'DETECTOR_DESCRIPTOR_INVALID',
        400,
        'Detector ID must be a dotted lowercase capability name.'
      );
    }
    if (!VERSION_PATTERN.test(descriptor.version)) {
      throw new DetectorRegistryError(
        'DETECTOR_DESCRIPTOR_INVALID',
        400,
        'Detector version must use semantic x.y.z form.'
      );
    }
    if (descriptor.sourceType !== 'DATASET') {
      throw new DetectorRegistryError(
        'DETECTOR_DESCRIPTOR_INVALID',
        400,
        'Phase 8C supports deterministic DATASET detectors only.'
      );
    }
    if (descriptor.executionMode !== 'TRUSTED_BUILT_IN') {
      throw new DetectorRegistryError(
        'DETECTOR_DESCRIPTOR_INVALID',
        400,
        'Phase 8C accepts trusted built-in detector handlers only.'
      );
    }
    if (
      descriptor.configSchema.type !== 'object' ||
      descriptor.configSchema.additionalProperties !== false
    ) {
      throw new DetectorRegistryError(
        'DETECTOR_DESCRIPTOR_INVALID',
        400,
        'Detector configuration must use a closed object schema.'
      );
    }
    if (
      descriptor.output.kind !== 'INSIGHT' ||
      descriptor.output.evidenceRequired !== true ||
      descriptor.output.severityModel !== 'DETERMINISTIC'
    ) {
      throw new DetectorRegistryError(
        'DETECTOR_DESCRIPTOR_INVALID',
        400,
        'Registered detectors must produce deterministic evidence-backed Insights.'
      );
    }
  }
}

export const detectorRegistry = new DetectorRegistry();
