import {
  postgresDatasetMetadataRepository,
} from '../persistence/postgresRepositories.js';
import {
  postgresSourceObjectRepository,
} from '../storage/postgresSourceObjectRepository.js';

export interface RecoveredIntegrationDatasetImport {
  sourceVersionId: string;
  datasetId: string;
  datasetVersionId: string;
}

export class IntegrationSourceRecoveryService {
  async resolveDatasetSourceVersion(input: {
    accountId: string;
    datasetId: string;
    datasetVersionId: string;
  }): Promise<string | undefined> {
    const version =
      await postgresDatasetMetadataRepository
        .getVersionMetadata(
          input.accountId,
          input.datasetId,
          input.datasetVersionId
        );

    return version?.sourceVersionId;
  }

  async recoverDatasetImport(input: {
    accountId: string;
    connectionId: string;
    externalId: string;
    externalVersion: string;
  }): Promise<RecoveredIntegrationDatasetImport | null> {
    const sourceObject =
      await postgresSourceObjectRepository
        .findExternalObject(
          input.accountId,
          input.connectionId,
          input.externalId
        );

    if (
      !sourceObject ||
      sourceObject.kind !==
        'DATASET_SOURCE'
    ) {
      return null;
    }

    const sourceVersion =
      await postgresSourceObjectRepository
        .findExternalVersion(
          input.accountId,
          sourceObject.id,
          input.externalVersion
        );

    if (!sourceVersion) {
      return null;
    }

    const datasetVersion =
      await postgresDatasetMetadataRepository
        .findVersionBySourceVersionId(
          input.accountId,
          sourceVersion.id
        );

    if (!datasetVersion) {
      return null;
    }

    if (
      datasetVersion.source.sha256 !==
        sourceVersion.sha256 ||
      datasetVersion.source.sizeBytes !==
        sourceVersion.sizeBytes
    ) {
      throw new Error(
        'Recovered integration DatasetVersion does not match its immutable source snapshot.'
      );
    }

    return {
      sourceVersionId:
        sourceVersion.id,
      datasetId:
        datasetVersion.datasetId,
      datasetVersionId:
        datasetVersion.id,
    };
  }
}

export const integrationSourceRecoveryService =
  new IntegrationSourceRecoveryService();
