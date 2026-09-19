import '../detectors/builtInDetectors.js';
import { detectorRegistry } from '../detectors/detectorRegistry.js';
import type { DomainPackDescriptor } from './types.js';

const PACK_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const TEMPLATE_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export class DomainPackRegistryError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'DOMAIN_PACK_INVALID'
    | 'DOMAIN_PACK_ALREADY_REGISTERED'
    | 'DOMAIN_PACK_NOT_FOUND';

  constructor(
    code:
      | 'DOMAIN_PACK_INVALID'
      | 'DOMAIN_PACK_ALREADY_REGISTERED'
      | 'DOMAIN_PACK_NOT_FOUND',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'DomainPackRegistryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class DomainPackRegistry {
  private packs = new Map<string, DomainPackDescriptor>();

  public registerBuiltIn(pack: DomainPackDescriptor): void {
    this.validate(pack);
    if (this.packs.has(pack.id)) {
      throw new DomainPackRegistryError(
        'DOMAIN_PACK_ALREADY_REGISTERED',
        409,
        'Domain pack ID is already registered: ' + pack.id
      );
    }
    this.packs.set(pack.id, structuredClone(pack));
  }

  public get(id: string): DomainPackDescriptor | null {
    const pack = this.packs.get(id);
    return pack ? structuredClone(pack) : null;
  }

  public require(id: string): DomainPackDescriptor {
    const pack = this.get(id);
    if (!pack) {
      throw new DomainPackRegistryError(
        'DOMAIN_PACK_NOT_FOUND',
        404,
        'Domain pack not found.'
      );
    }
    return pack;
  }

  public list(): DomainPackDescriptor[] {
    return Array.from(this.packs.values())
      .map((pack) => structuredClone(pack))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private validate(pack: DomainPackDescriptor): void {
    if (!PACK_ID_PATTERN.test(pack.id)) {
      throw new DomainPackRegistryError(
        'DOMAIN_PACK_INVALID',
        400,
        'Domain pack ID must be a dotted lowercase capability name.'
      );
    }
    if (!VERSION_PATTERN.test(pack.version)) {
      throw new DomainPackRegistryError(
        'DOMAIN_PACK_INVALID',
        400,
        'Domain pack version must use semantic x.y.z form.'
      );
    }
    if (pack.executionMode !== 'DECLARATIVE') {
      throw new DomainPackRegistryError(
        'DOMAIN_PACK_INVALID',
        400,
        'Phase 8D domain packs must be declarative data only.'
      );
    }

    const templateIds = [
      ...pack.detectorTemplates.map((item) => item.id),
      ...pack.watchTemplates.map((item) => item.id),
      ...pack.actionTemplates.map((item) => item.id),
    ];
    if (
      new Set(templateIds).size !== templateIds.length ||
      templateIds.some((id) => !TEMPLATE_ID_PATTERN.test(id))
    ) {
      throw new DomainPackRegistryError(
        'DOMAIN_PACK_INVALID',
        400,
        'Domain pack template IDs must be unique bounded identifiers.'
      );
    }

    for (const template of pack.detectorTemplates) {
      const detector = detectorRegistry.require(
        template.detectorId
      ).descriptor;
      if (detector.version !== template.detectorVersion) {
        throw new DomainPackRegistryError(
          'DOMAIN_PACK_INVALID',
          400,
          'Domain pack detector template references a version that is not registered: ' +
            template.detectorId +
            '@' +
            template.detectorVersion
        );
      }
      const schemaFields = new Set(
        Object.keys(detector.configSchema.properties)
      );
      if (
        template.overridableConfigFields.some(
          (field) => !schemaFields.has(field)
        )
      ) {
        throw new DomainPackRegistryError(
          'DOMAIN_PACK_INVALID',
          400,
          'Domain pack detector override field is not declared by the registered detector schema.'
        );
      }
    }

    for (const watch of pack.watchTemplates) {
      if (
        watch.activation !== 'SUGGESTION_ONLY' ||
        !Number.isFinite(watch.defaultThreshold) ||
        !Number.isInteger(watch.intervalMinutes) ||
        watch.intervalMinutes < 1
      ) {
        throw new DomainPackRegistryError(
          'DOMAIN_PACK_INVALID',
          400,
          'Domain pack Watch templates must remain bounded non-activated suggestions.'
        );
      }
    }

    for (const action of pack.actionTemplates) {
      if (
        action.mode !== 'PROPOSAL_ONLY' ||
        !action.instructionTemplate.trim()
      ) {
        throw new DomainPackRegistryError(
          'DOMAIN_PACK_INVALID',
          400,
          'Domain pack Action templates must remain proposal-only text templates.'
        );
      }
    }
  }
}

export const domainPackRegistry = new DomainPackRegistry();
