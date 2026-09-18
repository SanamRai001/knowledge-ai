import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  Dataset,
  DatasetImportRun,
  DatasetSource,
  DatasetTable,
  DatasetVersion,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATASET_FILE = path.join(DATA_DIR, 'datasets.json');

type PersistedDatasetState = {
  datasets: Dataset[];
  versions: DatasetVersion[];
  importRuns: DatasetImportRun[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DatasetAccessError extends Error {
  public readonly code: 'DATASET_NOT_FOUND' | 'VERSION_NOT_FOUND';
  public readonly statusCode = 404;

  constructor(
    code: 'DATASET_NOT_FOUND' | 'VERSION_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'DatasetAccessError';
    this.code = code;
  }
}

export class DatasetStore {
  private datasets = new Map<string, Dataset>();
  private versions = new Map<string, DatasetVersion>();
  private importRuns = new Map<string, DatasetImportRun>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(DATASET_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(DATASET_FILE, 'utf8')
      ) as Partial<PersistedDatasetState>;

      for (const dataset of parsed.datasets || []) {
        this.datasets.set(dataset.id, dataset);
      }
      for (const version of parsed.versions || []) {
        this.versions.set(version.id, version);
      }
      for (const run of parsed.importRuns || []) {
        this.importRuns.set(run.id, run);
      }
    } catch (error) {
      console.warn(
        'Could not load dataset runtime state; starting with an empty dataset store:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedDatasetState = {
      datasets: Array.from(this.datasets.values()),
      versions: Array.from(this.versions.values()),
      importRuns: Array.from(this.importRuns.values()).slice(-200),
    };

    const temporary = DATASET_FILE + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporary, DATASET_FILE);
  }

  public listDatasets(accountId: string): Dataset[] {
    return Array.from(this.datasets.values())
      .filter((dataset) => dataset.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(clone);
  }

  public getDataset(accountId: string, datasetId: string): Dataset | null {
    const dataset = this.datasets.get(datasetId);
    if (!dataset || dataset.accountId !== accountId) return null;
    return clone(dataset);
  }

  public requireDataset(accountId: string, datasetId: string): Dataset {
    const dataset = this.getDataset(accountId, datasetId);
    if (!dataset) {
      throw new DatasetAccessError(
        'DATASET_NOT_FOUND',
        'Dataset not found in the current account scope.'
      );
    }
    return dataset;
  }

  public getVersion(
    accountId: string,
    datasetId: string,
    versionId: string
  ): DatasetVersion | null {
    const dataset = this.datasets.get(datasetId);
    if (!dataset || dataset.accountId !== accountId) return null;
    if (!dataset.versionIds.includes(versionId)) return null;

    const version = this.versions.get(versionId);
    return version ? clone(version) : null;
  }

  public getCurrentVersion(
    accountId: string,
    datasetId: string
  ): DatasetVersion {
    const dataset = this.requireDataset(accountId, datasetId);
    const version = this.versions.get(dataset.currentVersionId);
    if (!version) {
      throw new DatasetAccessError(
        'VERSION_NOT_FOUND',
        'Current dataset version could not be found.'
      );
    }
    return clone(version);
  }

  public recordImportRun(run: DatasetImportRun): DatasetImportRun {
    this.importRuns.set(run.id, clone(run));
    this.save();
    return clone(run);
  }

  public getImportRun(
    accountId: string,
    importRunId: string
  ): DatasetImportRun | null {
    const run = this.importRuns.get(importRunId);
    if (!run || run.accountId !== accountId) return null;
    return clone(run);
  }

  public createDataset(params: {
    accountId: string;
    name: string;
    description?: string;
    source: DatasetSource;
    tables: DatasetTable[];
    importRunId: string;
  }): { dataset: Dataset; version: DatasetVersion } {
    const now = Date.now();
    const datasetId = 'ds_' + crypto.randomBytes(8).toString('hex');
    const versionId = 'dsv_' + crypto.randomBytes(8).toString('hex');

    const version: DatasetVersion = {
      id: versionId,
      datasetId,
      versionNumber: 1,
      createdAt: now,
      source: clone(params.source),
      tables: clone(params.tables),
      importRunId: params.importRunId,
    };

    const dataset: Dataset = {
      id: datasetId,
      accountId: params.accountId,
      name: params.name.trim() || params.source.filename,
      description: params.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      currentVersionId: versionId,
      versionIds: [versionId],
    };

    this.versions.set(version.id, version);
    this.datasets.set(dataset.id, dataset);
    this.save();

    return { dataset: clone(dataset), version: clone(version) };
  }

  public addVersion(params: {
    accountId: string;
    datasetId: string;
    source: DatasetSource;
    tables: DatasetTable[];
    importRunId: string;
  }): { dataset: Dataset; version: DatasetVersion } {
    const dataset = this.requireDataset(params.accountId, params.datasetId);
    const currentVersions = dataset.versionIds
      .map((id) => this.versions.get(id))
      .filter((version): version is DatasetVersion => Boolean(version));
    const nextVersionNumber =
      Math.max(0, ...currentVersions.map((version) => version.versionNumber)) +
      1;

    const version: DatasetVersion = {
      id: 'dsv_' + crypto.randomBytes(8).toString('hex'),
      datasetId: dataset.id,
      versionNumber: nextVersionNumber,
      createdAt: Date.now(),
      source: clone(params.source),
      tables: clone(params.tables),
      importRunId: params.importRunId,
    };

    const updatedDataset: Dataset = {
      ...dataset,
      updatedAt: Date.now(),
      currentVersionId: version.id,
      versionIds: [...dataset.versionIds, version.id],
    };

    this.versions.set(version.id, version);
    this.datasets.set(dataset.id, updatedDataset);
    this.save();

    return {
      dataset: clone(updatedDataset),
      version: clone(version),
    };
  }
}

export const datasetStore = new DatasetStore();
