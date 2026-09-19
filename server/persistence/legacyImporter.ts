import {
  postgresAccountRepository,
  postgresApiKeyRepository,
  postgresDatasetMetadataRepository,
  postgresWorkspaceMetadataRepository,
} from './postgresRepositories.js';
import { postgresPool } from './postgres.js';
import {
  LegacyMetadataSnapshot,
  readLegacyMetadataSnapshot,
} from './legacyMetadata.js';
import type {
  DatasetMetadata,
  DatasetVersionMetadata,
  WorkspaceMetadata,
} from './types.js';
import type { ApiKey, ApiUsage } from '../../src/types.js';

export interface LegacyImportConflict {
  kind:
    | 'WORKSPACE'
    | 'API_KEY'
    | 'API_USAGE'
    | 'DATASET'
    | 'DATASET_IMPORT_RUN'
    | 'DATASET_VERSION'
    | 'ACTIVE_WORKSPACE';
  id: string;
  message: string;
}

export interface LegacyImportReport {
  dryRun: boolean;
  sourceDataDir: string;
  counts: {
    accounts: number;
    workspaces: number;
    apiKeys: number;
    apiUsage: number;
    datasets: number;
    datasetImportRuns: number;
    datasetVersions: number;
    activeWorkspaceSelections: number;
  };
  imported: {
    accounts: number;
    workspaces: number;
    apiKeys: number;
    apiUsage: number;
    datasets: number;
    datasetImportRuns: number;
    datasetVersions: number;
    activeWorkspaceSelections: number;
  };
  skippedExisting: number;
  conflicts: LegacyImportConflict[];
}

function sameWorkspace(
  left: WorkspaceMetadata,
  right: WorkspaceMetadata
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.name === right.name &&
    (left.description || '') === (right.description || '') &&
    left.processingStatus === right.processingStatus &&
    left.currentVersionTag === right.currentVersionTag &&
    left.createdAt === right.createdAt
  );
}

function sameApiKey(left: ApiKey, right: ApiKey): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.name === right.name &&
    left.keyPrefix === right.keyPrefix &&
    left.keyHash === right.keyHash &&
    left.maskedKey === right.maskedKey &&
    left.environment === right.environment &&
    left.status === right.status &&
    JSON.stringify(left.scopes) === JSON.stringify(right.scopes) &&
    left.createdAt === right.createdAt
  );
}

function sameDataset(
  left: DatasetMetadata,
  right: DatasetMetadata
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.name === right.name &&
    (left.description || '') === (right.description || '') &&
    left.createdAt === right.createdAt
  );
}

function sameVersion(
  left: DatasetVersionMetadata,
  right: DatasetVersionMetadata
): boolean {
  return (
    left.id === right.id &&
    left.datasetId === right.datasetId &&
    left.versionNumber === right.versionNumber &&
    left.createdAt === right.createdAt &&
    left.source.filename === right.source.filename &&
    left.source.mimeType === right.source.mimeType &&
    left.source.sizeBytes === right.source.sizeBytes &&
    left.source.sha256 === right.source.sha256 &&
    left.source.format === right.source.format &&
    left.importRunId === right.importRunId &&
    left.payload.backend === right.payload.backend &&
    left.payload.ref === right.payload.ref
  );
}

function emptyReport(
  snapshot: LegacyMetadataSnapshot,
  dryRun: boolean
): LegacyImportReport {
  return {
    dryRun,
    sourceDataDir: snapshot.dataDir,
    counts: {
      accounts: snapshot.accounts.length,
      workspaces: snapshot.workspaces.length,
      apiKeys: snapshot.apiKeys.length,
      apiUsage: snapshot.apiUsage.length,
      datasets: snapshot.datasets.length,
      datasetImportRuns: snapshot.datasetImportRuns.length,
      datasetVersions: snapshot.datasetVersions.length,
      activeWorkspaceSelections: Object.keys(
        snapshot.activeWorkspaceByAccount
      ).length,
    },
    imported: {
      accounts: 0,
      workspaces: 0,
      apiKeys: 0,
      apiUsage: 0,
      datasets: 0,
      datasetImportRuns: 0,
      datasetVersions: 0,
      activeWorkspaceSelections: 0,
    },
    skippedExisting: 0,
    conflicts: [],
  };
}

function snapshotValidation(
  snapshot: LegacyMetadataSnapshot,
  report: LegacyImportReport
): void {
  const datasets = new Map(
    snapshot.datasets.map((dataset) => [dataset.id, dataset])
  );
  const importRuns = new Map(
    snapshot.datasetImportRuns.map((run) => [run.id, run])
  );

  for (const version of snapshot.datasetVersions) {
    const dataset = datasets.get(version.datasetId);
    if (!dataset) {
      report.conflicts.push({
        kind: 'DATASET_VERSION',
        id: version.id,
        message:
          'Legacy DatasetVersion references missing Dataset ' +
          version.datasetId +
          '.',
      });
      continue;
    }

    const run = importRuns.get(version.importRunId);
    if (!run) {
      report.conflicts.push({
        kind: 'DATASET_VERSION',
        id: version.id,
        message:
          'Legacy DatasetVersion references missing import run ' +
          version.importRunId +
          '.',
      });
      continue;
    }

    if (run.accountId !== dataset.accountId) {
      report.conflicts.push({
        kind: 'DATASET_VERSION',
        id: version.id,
        message:
          'Legacy DatasetVersion links Dataset and import run from different accounts.',
      });
    }
  }

  for (const [accountId, workspaceId] of Object.entries(
    snapshot.activeWorkspaceByAccount
  )) {
    const workspace = snapshot.workspaces.find(
      (item) => item.id === workspaceId
    );
    if (!workspace || workspace.accountId !== accountId) {
      report.conflicts.push({
        kind: 'ACTIVE_WORKSPACE',
        id: accountId,
        message:
          'Legacy active workspace selection does not belong to the account.',
      });
    }
  }
}

async function existingUsage(id: string): Promise<ApiUsage | null> {
  const result = await postgresPool().query(
    'SELECT * FROM api_usage WHERE id = $1',
    [id]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    requestId: row.request_id,
    apiKeyId: row.api_key_id || '',
    accountId: row.account_id,
    aiId: row.ai_id,
    endpoint: row.endpoint,
    timestamp: new Date(row.occurred_at).getTime(),
    status: row.status,
    latencyMs: row.latency_ms,
    refused: row.refused,
    grounded: row.grounded,
    errorCode: row.error_code ?? undefined,
  };
}

function sameUsage(left: ApiUsage, right: ApiUsage): boolean {
  return (
    left.id === right.id &&
    left.requestId === right.requestId &&
    left.apiKeyId === right.apiKeyId &&
    left.accountId === right.accountId &&
    left.aiId === right.aiId &&
    left.endpoint === right.endpoint &&
    left.timestamp === right.timestamp &&
    left.status === right.status &&
    left.latencyMs === right.latencyMs &&
    left.refused === right.refused &&
    left.grounded === right.grounded &&
    (left.errorCode || '') === (right.errorCode || '')
  );
}

export async function importLegacyMetadata(params: {
  dataDir?: string;
  dryRun?: boolean;
  snapshot?: LegacyMetadataSnapshot;
} = {}): Promise<LegacyImportReport> {
  const snapshot =
    params.snapshot ||
    readLegacyMetadataSnapshot(params.dataDir);
  const report = emptyReport(snapshot, Boolean(params.dryRun));
  snapshotValidation(snapshot, report);

  if (params.dryRun || report.conflicts.length > 0) {
    return report;
  }

  for (const account of snapshot.accounts) {
    const existing =
      await postgresAccountRepository.getAccount(account.id);
    await postgresAccountRepository.ensureAccount(account.id);
    if (existing) report.skippedExisting += 1;
    else report.imported.accounts += 1;
  }

  for (const workspace of snapshot.workspaces) {
    const existing =
      await postgresWorkspaceMetadataRepository.get(
        workspace.accountId,
        workspace.id
      );
    if (existing) {
      if (!sameWorkspace(existing, workspace)) {
        report.conflicts.push({
          kind: 'WORKSPACE',
          id: workspace.id,
          message:
            'Workspace already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresWorkspaceMetadataRepository.create({
      ...workspace,
    });
    report.imported.workspaces += 1;
  }

  for (const apiKey of snapshot.apiKeys) {
    const existingById =
      await postgresApiKeyRepository.get(
        apiKey.accountId,
        apiKey.id
      );
    const existingByHash =
      await postgresApiKeyRepository.findByHash(apiKey.keyHash);

    if (existingById || existingByHash) {
      const existing = existingById || existingByHash!;
      if (!sameApiKey(existing, apiKey)) {
        report.conflicts.push({
          kind: 'API_KEY',
          id: apiKey.id,
          message:
            'API key ID or hash already exists with different ownership/metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresApiKeyRepository.create(apiKey);
    report.imported.apiKeys += 1;
  }

  for (const usage of snapshot.apiUsage) {
    const existing = await existingUsage(usage.id);
    if (existing) {
      if (!sameUsage(existing, usage)) {
        report.conflicts.push({
          kind: 'API_USAGE',
          id: usage.id,
          message:
            'API usage record already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresPool().query(
      `INSERT INTO api_usage
        (id, request_id, api_key_id, account_id, ai_id, endpoint,
         occurred_at, status, latency_ms, refused, grounded, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        usage.id,
        usage.requestId,
        usage.apiKeyId || null,
        usage.accountId,
        usage.aiId,
        usage.endpoint,
        new Date(usage.timestamp),
        usage.status,
        usage.latencyMs,
        usage.refused,
        usage.grounded,
        usage.errorCode ?? null,
      ]
    );
    report.imported.apiUsage += 1;
  }

  for (const run of snapshot.datasetImportRuns) {
    const existing = await postgresPool().query(
      'SELECT * FROM dataset_import_runs WHERE id = $1',
      [run.id]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      const same =
        row.account_id === run.accountId &&
        row.status === run.status &&
        new Date(row.created_at).getTime() === run.createdAt &&
        row.filename === run.filename &&
        row.format === run.format;
      if (!same) {
        report.conflicts.push({
          kind: 'DATASET_IMPORT_RUN',
          id: run.id,
          message:
            'Dataset import run already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresDatasetMetadataRepository.recordImportRun(run);
    report.imported.datasetImportRuns += 1;
  }

  for (const dataset of snapshot.datasets) {
    const existing =
      await postgresDatasetMetadataRepository.get(
        dataset.accountId,
        dataset.id
      );
    if (existing) {
      if (!sameDataset(existing, dataset)) {
        report.conflicts.push({
          kind: 'DATASET',
          id: dataset.id,
          message:
            'Dataset already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresDatasetMetadataRepository.create(dataset);
    report.imported.datasets += 1;
  }

  const datasetById = new Map(
    snapshot.datasets.map((dataset) => [dataset.id, dataset])
  );

  for (const version of snapshot.datasetVersions) {
    const dataset = datasetById.get(version.datasetId);
    if (!dataset) continue;

    const existing =
      await postgresDatasetMetadataRepository.getVersionMetadata(
        dataset.accountId,
        dataset.id,
        version.id
      );
    if (existing) {
      if (!sameVersion(existing, version)) {
        report.conflicts.push({
          kind: 'DATASET_VERSION',
          id: version.id,
          message:
            'DatasetVersion already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresDatasetMetadataRepository.appendVersionMetadata(
      dataset.accountId,
      version
    );
    report.imported.datasetVersions += 1;
  }

  if (report.conflicts.length > 0) {
    return report;
  }

  for (const dataset of snapshot.datasets) {
    if (!dataset.currentVersionId) continue;
    await postgresDatasetMetadataRepository.updateCurrentVersion(
      dataset.accountId,
      dataset.id,
      dataset.currentVersionId
    );
  }

  for (const [accountId, workspaceId] of Object.entries(
    snapshot.activeWorkspaceByAccount
  )) {
    const existing =
      await postgresWorkspaceMetadataRepository.getActive(
        accountId
      );
    if (existing === workspaceId) {
      report.skippedExisting += 1;
      continue;
    }

    await postgresWorkspaceMetadataRepository.setActive(
      accountId,
      workspaceId
    );
    report.imported.activeWorkspaceSelections += 1;
  }

  return report;
}
