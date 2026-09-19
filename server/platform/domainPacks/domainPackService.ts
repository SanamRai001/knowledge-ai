import './builtInDomainPacks.js';
import { detectorExecutionService } from '../detectors/detectorExecutionService.js';
import { validateDetectorConfig } from '../detectors/detectorConfigValidator.js';
import { detectorRegistry } from '../detectors/detectorRegistry.js';
import { domainPackInstallationStore } from './domainPackInstallationStore.js';
import { domainPackRegistry } from './domainPackRegistry.js';
import type {
  DomainPackDescriptor,
  DomainPackDetectorRunResult,
  DomainPackInstallation,
} from './types.js';

export class DomainPackServiceError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'DOMAIN_PACK_TEMPLATE_NOT_FOUND'
    | 'DOMAIN_PACK_OVERRIDE_INVALID';

  constructor(
    code:
      | 'DOMAIN_PACK_TEMPLATE_NOT_FOUND'
      | 'DOMAIN_PACK_OVERRIDE_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'DomainPackServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class DomainPackService {
  public list(): DomainPackDescriptor[] {
    return domainPackRegistry.list();
  }

  public get(packId: string): DomainPackDescriptor {
    return domainPackRegistry.require(packId);
  }

  public install(params: {
    accountId: string;
    packId: string;
  }): DomainPackInstallation {
    const pack = domainPackRegistry.require(params.packId);
    return domainPackInstallationStore.install({
      accountId: params.accountId,
      packId: pack.id,
      packVersion: pack.version,
    });
  }

  public listInstallations(
    accountId: string
  ): Array<{
    installation: DomainPackInstallation;
    pack: DomainPackDescriptor;
  }> {
    return domainPackInstallationStore
      .list(accountId)
      .map((installation) => ({
        installation,
        pack: domainPackRegistry.require(
          installation.packId
        ),
      }));
  }

  public runDetectorTemplate(params: {
    accountId: string;
    packId: string;
    templateId: string;
    datasetId: string;
    datasetVersionId?: string;
    configOverrides?: unknown;
    referenceTime?: number;
  }): DomainPackDetectorRunResult {
    const installation =
      domainPackInstallationStore.requireActive({
        accountId: params.accountId,
        packId: params.packId,
      });
    const pack = domainPackRegistry.require(params.packId);

    if (installation.packVersion !== pack.version) {
      throw new DomainPackServiceError(
        'DOMAIN_PACK_TEMPLATE_NOT_FOUND',
        409,
        'Installed domain pack version no longer matches the registered pack version.'
      );
    }

    const template = pack.detectorTemplates.find(
      (item) => item.id === params.templateId
    );
    if (!template) {
      throw new DomainPackServiceError(
        'DOMAIN_PACK_TEMPLATE_NOT_FOUND',
        404,
        'Domain pack detector template not found.'
      );
    }

    const overrides =
      params.configOverrides &&
      typeof params.configOverrides === 'object' &&
      !Array.isArray(params.configOverrides)
        ? (params.configOverrides as Record<string, unknown>)
        : {};

    for (const key of Object.keys(overrides)) {
      if (!template.overridableConfigFields.includes(key)) {
        throw new DomainPackServiceError(
          'DOMAIN_PACK_OVERRIDE_INVALID',
          400,
          'Domain pack detector override is not allowed: ' +
            key
        );
      }
    }

    const detector = detectorRegistry.require(
      template.detectorId
    ).descriptor;
    const effectiveConfig = validateDetectorConfig(
      detector.configSchema,
      {
        ...template.defaultConfig,
        ...overrides,
      }
    );

    const detectorRun = detectorExecutionService.run({
      accountId: params.accountId,
      detectorId: template.detectorId,
      datasetId: params.datasetId,
      datasetVersionId: params.datasetVersionId,
      config: effectiveConfig,
      referenceTime: params.referenceTime,
    });

    return {
      installation,
      pack,
      template,
      effectiveConfig,
      detectorRun: {
        runId: detectorRun.runId,
        configHash: detectorRun.configHash,
        datasetId: detectorRun.datasetId,
        datasetVersionId:
          detectorRun.datasetVersionId,
        insights: detectorRun.insights,
      },
    };
  }
}

export const domainPackService =
  new DomainPackService();
