import fs from 'fs';
import path from 'path';
import type {
  ApiKey,
  ApiUsage,
  KnowledgeBase,
} from '../../src/types.js';
import type {
  Dataset,
  DatasetImportRun,
  DatasetVersion,
} from '../datasets/types.js';
import type {
  AccountRecord,
  DatasetImportRunMetadata,
  DatasetMetadata,
  DatasetPayloadLocator,
  DatasetPayloadRepository,
  DatasetVersionMetadata,
  WorkspaceMetadata,
} from './types.js';

const DEFAULT_ACCOUNT_ID = 'acc_default';

type LegacyKnowledgeState = {
  activeKbId?: string;
  kbs?: KnowledgeBase[];
};

type LegacyDatasetState = {
  datasets?: Dataset[];
  versions?: DatasetVersion[];
  importRuns?: DatasetImportRun[];
};

export interface LegacyMetadataSnapshot {
  dataDir: string;
  accounts: AccountRecord[];
  workspaces: WorkspaceMetadata[];
  activeWorkspaceByAccount: Record<string, string>;
  apiKeys: ApiKey[];
  apiUsage: ApiUsage[];
  datasets: DatasetMetadata[];
  datasetVersions: DatasetVersionMetadata[];
  datasetImportRuns: DatasetImportRunMetadata[];
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function accountOf(kb: KnowledgeBase): string {
  return kb.accountId?.trim() || DEFAULT_ACCOUNT_ID;
}

function payloadLocator(versionId: string): DatasetPayloadLocator {
  return {
    backend: 'legacy-dataset-json',
    ref: versionId,
  };
}

export function readLegacyMetadataSnapshot(
  dataDir = path.join(process.cwd(), 'data')
): LegacyMetadataSnapshot {
  const knowledge = readJson<LegacyKnowledgeState>(
    path.join(dataDir, 'knowledge_bases.json'),
    {}
  );
  const apiKeys = readJson<ApiKey[]>(
    path.join(dataDir, 'api_keys.json'),
    []
  );
  const apiUsage = readJson<ApiUsage[]>(
    path.join(dataDir, 'api_usage.json'),
    []
  );
  const datasetState = readJson<LegacyDatasetState>(
    path.join(dataDir, 'datasets.json'),
    {}
  );

  const workspaces: WorkspaceMetadata[] = (knowledge.kbs || []).map(
    (kb) => ({
      id: kb.id,
      accountId: accountOf(kb),
      name: kb.name,
      description: kb.description,
      processingStatus: kb.processingStatus,
      currentVersionTag: kb.currentVersion,
      createdAt: kb.createdDate,
      updatedAt: kb.updatedAt || kb.createdDate,
    })
  );

  const datasets: DatasetMetadata[] = (
    datasetState.datasets || []
  ).map((dataset) => ({
    id: dataset.id,
    accountId: dataset.accountId,
    name: dataset.name,
    description: dataset.description,
    currentVersionId: dataset.currentVersionId || undefined,
    createdAt: dataset.createdAt,
    updatedAt: dataset.updatedAt,
  }));

  const datasetVersions: DatasetVersionMetadata[] = (
    datasetState.versions || []
  ).map((version) => ({
    id: version.id,
    datasetId: version.datasetId,
    versionNumber: version.versionNumber,
    createdAt: version.createdAt,
    source: structuredClone(version.source),
    importRunId: version.importRunId,
    payload: payloadLocator(version.id),
  }));

  const datasetImportRuns: DatasetImportRunMetadata[] = (
    datasetState.importRuns || []
  ).map((run) => ({
    id: run.id,
    accountId: run.accountId,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    filename: run.filename,
    format: run.format,
    warnings: [...run.warnings],
    error: run.error,
  }));

  const accountTimes = new Map<
    string,
    { min: number; max: number }
  >();

  const observe = (
    accountId: string,
    createdAt: number,
    updatedAt = createdAt
  ) => {
    const current = accountTimes.get(accountId);
    if (!current) {
      accountTimes.set(accountId, {
        min: createdAt,
        max: updatedAt,
      });
      return;
    }
    current.min = Math.min(current.min, createdAt);
    current.max = Math.max(current.max, updatedAt);
  };

  for (const workspace of workspaces) {
    observe(
      workspace.accountId,
      workspace.createdAt,
      workspace.updatedAt
    );
  }
  for (const key of apiKeys) {
    observe(
      key.accountId || DEFAULT_ACCOUNT_ID,
      key.createdAt,
      key.lastUsedAt || key.createdAt
    );
  }
  for (const usage of apiUsage) {
    observe(
      usage.accountId || DEFAULT_ACCOUNT_ID,
      usage.timestamp
    );
  }
  for (const dataset of datasets) {
    observe(
      dataset.accountId,
      dataset.createdAt,
      dataset.updatedAt
    );
  }
  for (const run of datasetImportRuns) {
    observe(
      run.accountId,
      run.createdAt,
      run.completedAt || run.createdAt
    );
  }

  const accounts: AccountRecord[] = Array.from(
    accountTimes.entries()
  )
    .map(([id, times]) => ({
      id,
      createdAt: times.min,
      updatedAt: times.max,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const activeWorkspaceByAccount: Record<string, string> = {};
  const globalActive = workspaces.find(
    (workspace) => workspace.id === knowledge.activeKbId
  );
  if (globalActive) {
    activeWorkspaceByAccount[globalActive.accountId] =
      globalActive.id;
  }

  const grouped = new Map<string, WorkspaceMetadata[]>();
  for (const workspace of workspaces) {
    const list = grouped.get(workspace.accountId) || [];
    list.push(workspace);
    grouped.set(workspace.accountId, list);
  }

  for (const [accountId, owned] of grouped) {
    if (activeWorkspaceByAccount[accountId]) continue;
    const fallback = [...owned].sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        a.id.localeCompare(b.id)
    )[0];
    if (fallback) {
      activeWorkspaceByAccount[accountId] = fallback.id;
    }
  }

  return {
    dataDir,
    accounts,
    workspaces,
    activeWorkspaceByAccount,
    apiKeys: apiKeys.map((item) => structuredClone(item)),
    apiUsage: apiUsage.map((item) => structuredClone(item)),
    datasets,
    datasetVersions,
    datasetImportRuns,
  };
}

export class LegacyDatasetPayloadRepository
  implements DatasetPayloadRepository<DatasetVersion>
{
  constructor(
    private readonly dataDir = path.join(process.cwd(), 'data')
  ) {}

  async put(
    _version: DatasetVersion
  ): Promise<DatasetPayloadLocator> {
    throw new Error(
      'LegacyDatasetPayloadRepository is read-only during A2 migration.'
    );
  }

  async get(
    locator: DatasetPayloadLocator
  ): Promise<DatasetVersion> {
    if (locator.backend !== 'legacy-dataset-json') {
      throw new Error(
        'Unsupported legacy dataset payload backend: ' +
          locator.backend
      );
    }

    const state = readJson<LegacyDatasetState>(
      path.join(this.dataDir, 'datasets.json'),
      {}
    );
    const version = (state.versions || []).find(
      (item) => item.id === locator.ref
    );
    if (!version) {
      throw new Error(
        'Legacy dataset payload not found for version ' +
          locator.ref
      );
    }
    return structuredClone(version);
  }
}
