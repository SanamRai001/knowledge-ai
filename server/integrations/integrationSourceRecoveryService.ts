import {
  postgresDatasetMetadataRepository,
} from '../persistence/postgresRepositories.js';
import {
  postgresSourceObjectRepository,
} from '../storage/postgresSourceObjectRepository.js';

export interface RecoveredExternalDataset {
  sourceVersionId: string;
  datasetId: string;
  datasetVersionId: string;
}

export class IntegrationSourceRecoveryService {
  async findCommittedDataset(params: {
    accountId: string;
    connectionId: string;
    externalId: string;
    externalVersion: string;
  }): Promise<RecoveredExternalDataset | null> {
    const sourceVersions =
      await postgresSourceObjectRepository
        .listExternalVersions({
          accountId: params.accountId,
          externalConnectionId:
            params.connectionId,
          externalId: params.externalId,
          externalVersion:
            params.externalVersion,
        });

    for (const sourceVersion of sourceVersions) {
      const datasetVersion =
        await postgresDatasetMetadataRepository
          .findVersionBySourceVersion(
            params.accountId,
            sourceVersion.id
          );

      if (!datasetVersion) {
        continue;
      }

      const dataset =
        await postgresDatasetMetadataRepository
          .get(
            params.accountId,
            datasetVersion.datasetId
          );

      if (!dataset) {
        continue;
      }

      return {
        sourceVersionId:
          sourceVersion.id,
        datasetId: dataset.id,
        datasetVersionId:
          datasetVersion.id,
      };
    }

    return null;
  }
}

export const integrationSourceRecoveryService =
  new IntegrationSourceRecoveryService();
