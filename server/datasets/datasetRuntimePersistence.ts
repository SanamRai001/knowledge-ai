import crypto from 'crypto';
import type {
  Dataset,
  DatasetImportRun,
  DatasetSource,
  DatasetTable,
  DatasetVersion,
} from './types.js';
import { datasetStore } from './datasetStore.js';
import {
  DatasetRuntimePayloadStore,
  datasetRuntimePayloadStore,
} from './datasetRuntimePayloadStore.js';
import {
  durableDatasetPayloadStore,
} from './durableDatasetPayloadStore.js';
import {
  LegacyDatasetPayloadRepository,
} from '../persistence/legacyMetadata.js';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import {
  postgresAccountRepository,
  postgresDatasetMetadataRepository,
} from '../persistence/postgresRepositories.js';
import type {
  DatasetImportRunMetadata,
  DatasetMetadata,
  DatasetPayloadLocator,
  DatasetVersionMetadata,
} from '../persistence/types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function datasetId(): string {
  return 'ds_' + crypto.randomBytes(8).toString('hex');
}

function versionId(): string {
  return 'dsv_' + crypto.randomBytes(8).toString('hex');
}

function importRunMetadata(
  run: DatasetImportRun
): DatasetImportRunMetadata {
  return {
    id: run.id,
    accountId: run.accountId,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    filename: run.filename,
    format: run.format,
    warnings: [...run.warnings],
    error: run.error,
  };
}

function importRunFromMetadata(
  run: DatasetImportRunMetadata
): DatasetImportRun {
  return {
    id: run.id,
    accountId: run.accountId,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    filename: run.filename,
    format: run.format,
    warnings: [...run.warnings],
    error: run.error,
  };
}

export class DatasetRuntimePersistence {
  private readonly legacyPayload =
    new LegacyDatasetPayloadRepository();

  constructor(
    private readonly runtimePayload: DatasetRuntimePayloadStore =
      datasetRuntimePayloadStore
  ) {}

  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  private async loadPayload(params: {
    accountId: string;
    version: DatasetVersionMetadata;
  }): Promise<DatasetVersion> {
    const { accountId, version } = params;
    const locator = version.payload;

    if (
      locator.backend ===
      'durable-dataset-payload'
    ) {
      const tables =
        await durableDatasetPayloadStore.get({
          accountId,
          datasetId: version.datasetId,
          versionId: version.id,
          locator,
        });

      return {
        id: version.id,
        datasetId: version.datasetId,
        versionNumber:
          version.versionNumber,
        createdAt: version.createdAt,
        source: clone(version.source),
        sourceVersionId:
          version.sourceVersionId,
        tables,
        importRunId:
          version.importRunId,
      };
    }

    if (
      locator.backend ===
      'local-dataset-payload'
    ) {
      return this.runtimePayload.get(
        locator
      );
    }
    if (
      locator.backend ===
      'legacy-dataset-json'
    ) {
      return this.legacyPayload.get(
        locator
      );
    }
    throw new Error(
      'Unsupported Dataset payload backend: ' +
        locator.backend
    );
  }

  private async deletePayload(
    locator: DatasetPayloadLocator
  ): Promise<void> {
    if (
      locator.backend ===
      'durable-dataset-payload'
    ) {
      await durableDatasetPayloadStore.delete(
        locator
      );
      return;
    }
    await this.runtimePayload.delete(
      locator
    );
  }

  /**
   * Rebuilds the synchronous analytical cache from PostgreSQL metadata plus
   * the explicit payload backend before the HTTP server accepts traffic.
   */
  public async bootstrap(): Promise<void> {
    if (!this.usesPostgres()) return;

    const datasets: Dataset[] = [];
    const versions: DatasetVersion[] = [];
    const importRuns: DatasetImportRun[] = [];

    const accounts = await postgresAccountRepository.listAll();

    for (const account of accounts) {
      const owned =
        await postgresDatasetMetadataRepository.list(
          account.id
        );

      for (const metadata of owned) {
        const versionMetadata =
          await postgresDatasetMetadataRepository.listVersions(
            account.id,
            metadata.id
          );

        const loadedVersions: DatasetVersion[] = [];
        for (const version of versionMetadata) {
          const payload = await this.loadPayload({
            accountId: account.id,
            version,
          });
          if (
            payload.id !== version.id ||
            payload.datasetId !== metadata.id
          ) {
            throw new Error(
              'Dataset payload identity mismatch for ' +
                version.id
            );
          }

          const materialized: DatasetVersion = {
            ...clone(payload),
            id: version.id,
            datasetId: version.datasetId,
            versionNumber: version.versionNumber,
            createdAt: version.createdAt,
            source: clone(version.source),
            sourceVersionId:
              version.sourceVersionId,
            importRunId:
              version.importRunId,
          };
          loadedVersions.push(materialized);
          versions.push(materialized);
        }

        const currentVersionId =
          metadata.currentVersionId ||
          loadedVersions.at(-1)?.id;
        if (!currentVersionId) {
          throw new Error(
            'Dataset ' +
              metadata.id +
              ' has no current version metadata.'
          );
        }

        datasets.push({
          id: metadata.id,
          accountId: metadata.accountId,
          name: metadata.name,
          description: metadata.description,
          currentVersionId,
          versionIds: loadedVersions.map(
            (version) => version.id
          ),
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
        });
      }

      const runs =
        await postgresDatasetMetadataRepository.listImportRuns(
          account.id,
          5000
        );
      importRuns.push(...runs.map(importRunFromMetadata));
    }

    datasetStore.replaceRuntimeState({
      datasets,
      versions,
      importRuns,
    });
  }

  public async recordImportRun(
    run: DatasetImportRun
  ): Promise<DatasetImportRun> {
    if (!this.usesPostgres()) {
      return datasetStore.recordImportRun(run);
    }

    await postgresAccountRepository.ensureAccount(
      run.accountId
    );
    await postgresDatasetMetadataRepository.recordImportRun(
      importRunMetadata(run)
    );
    datasetStore.cacheImportRun(run);
    return clone(run);
  }

  public async commitImportedDataset(params: {
    accountId: string;
    name: string;
    description?: string;
    source: DatasetSource;
    tables: DatasetTable[];
    importRun: DatasetImportRun;
    existingDatasetId?: string;
    sourceVersionId?: string;
  }): Promise<{
    dataset: Dataset;
    version: DatasetVersion;
    importRun: DatasetImportRun;
  }> {
    if (!this.usesPostgres()) {
      const result = params.existingDatasetId
        ? datasetStore.addVersion({
            accountId: params.accountId,
            datasetId: params.existingDatasetId,
            source: params.source,
            tables: params.tables,
            importRunId: params.importRun.id,
          })
        : datasetStore.createDataset({
            accountId: params.accountId,
            name: params.name,
            description: params.description,
            source: params.source,
            tables: params.tables,
            importRunId: params.importRun.id,
          });

      datasetStore.recordImportRun(params.importRun);
      return {
        ...result,
        importRun: clone(params.importRun),
      };
    }

    await postgresAccountRepository.ensureAccount(
      params.accountId
    );

    const creating = !params.existingDatasetId;
    const id = params.existingDatasetId || datasetId();
    let currentMetadata: DatasetMetadata | null = null;
    let existingVersions: DatasetVersionMetadata[] = [];

    if (!creating) {
      currentMetadata =
        await postgresDatasetMetadataRepository.get(
          params.accountId,
          id
        );
      if (!currentMetadata) {
        throw new Error(
          'Dataset not found in the current account scope.'
        );
      }
      existingVersions =
        await postgresDatasetMetadataRepository.listVersions(
          params.accountId,
          id
        );
    }

    const now = Date.now();
    const nextVersionNumber = creating
      ? 1
      : Math.max(
          0,
          ...existingVersions.map(
            (version) => version.versionNumber
          )
        ) + 1;

    const version: DatasetVersion = {
      id: versionId(),
      datasetId: id,
      versionNumber: nextVersionNumber,
      createdAt: now,
      source: clone(params.source),
      sourceVersionId:
        params.sourceVersionId,
      tables: clone(params.tables),
      importRunId: params.importRun.id,
    };

    const locator =
      params.sourceVersionId
        ? await durableDatasetPayloadStore.put({
            accountId:
              params.accountId,
            version,
          })
        : await this.runtimePayload.put(
            version
          );

    const metadata: DatasetMetadata = creating
      ? {
          id,
          accountId: params.accountId,
          name: params.name.trim() || params.source.filename,
          description:
            params.description?.trim() || undefined,
          currentVersionId: version.id,
          createdAt: now,
          updatedAt: now,
        }
      : {
          ...currentMetadata!,
          currentVersionId: version.id,
          updatedAt: now,
        };

    const versionMetadata: DatasetVersionMetadata = {
      id: version.id,
      datasetId: version.datasetId,
      versionNumber: version.versionNumber,
      createdAt: version.createdAt,
      source: clone(version.source),
      sourceVersionId:
        version.sourceVersionId,
      importRunId:
        version.importRunId,
      payload: locator,
    };

    try {
      await postgresDatasetMetadataRepository.commitImportedVersion(
        {
          accountId: params.accountId,
          dataset: metadata,
          version: versionMetadata,
          importRun: importRunMetadata(params.importRun),
          createDataset: creating,
        }
      );
    } catch (error) {
      await this.deletePayload(
        locator
      ).catch(() => undefined);
      throw error;
    }

    const versionIds = creating
      ? [version.id]
      : [
          ...existingVersions.map(
            (item) => item.id
          ),
          version.id,
        ];

    const dataset: Dataset = {
      id: metadata.id,
      accountId: metadata.accountId,
      name: metadata.name,
      description: metadata.description,
      currentVersionId: version.id,
      versionIds,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };

    datasetStore.cacheDataset(dataset);
    datasetStore.cacheVersion(version);
    datasetStore.cacheImportRun(params.importRun);

    return {
      dataset: clone(dataset),
      version: clone(version),
      importRun: clone(params.importRun),
    };
  }
}

export const datasetRuntimePersistence =
  new DatasetRuntimePersistence();
