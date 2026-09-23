import type {
  ApiKey,
  ApiUsage,
  ApiUsageStats,
} from '../../src/types.js';

export interface AccountRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMetadata {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  processingStatus: 'empty' | 'processing' | 'ready' | 'error';
  currentVersionTag: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkspaceMetadata {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  processingStatus: WorkspaceMetadata['processingStatus'];
  currentVersionTag: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMetadataPatch {
  name?: string;
  description?: string;
  processingStatus?: WorkspaceMetadata['processingStatus'];
  currentVersionTag?: string;
  updatedAt?: number;
}

export interface DatasetMetadata {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  currentVersionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DatasetVersionMetadata {
  id: string;
  datasetId: string;
  versionNumber: number;
  createdAt: number;
  source: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    format: 'CSV' | 'XLSX';
  };
  sourceVersionId?: string;
  importRunId: string;
  payload: DatasetPayloadLocator;
}

export interface DatasetImportRunMetadata {
  id: string;
  accountId: string;
  status: 'PREVIEWED' | 'IMPORTED' | 'FAILED';
  createdAt: number;
  completedAt?: number;
  filename: string;
  format: 'CSV' | 'XLSX';
  warnings: string[];
  error?: string;
}

export interface DatasetPayloadLocator {
  backend: string;
  ref: string;
  storageBackend?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface AccountRepository {
  ensureAccount(accountId: string): Promise<AccountRecord>;
  getAccount(accountId: string): Promise<AccountRecord | null>;
}

export interface WorkspaceMetadataRepository {
  list(accountId: string): Promise<WorkspaceMetadata[]>;
  get(
    accountId: string,
    workspaceId: string
  ): Promise<WorkspaceMetadata | null>;
  create(
    input: CreateWorkspaceMetadata
  ): Promise<WorkspaceMetadata>;
  update(
    accountId: string,
    workspaceId: string,
    patch: WorkspaceMetadataPatch
  ): Promise<WorkspaceMetadata>;
  delete(accountId: string, workspaceId: string): Promise<void>;
  getActive(accountId: string): Promise<string | null>;
  setActive(
    accountId: string,
    workspaceId: string
  ): Promise<void>;
}

export interface ApiKeyRepository {
  create(record: ApiKey): Promise<void>;
  findByHash(keyHash: string): Promise<ApiKey | null>;
  get(
    accountId: string,
    keyId: string
  ): Promise<ApiKey | null>;
  list(accountId: string): Promise<ApiKey[]>;
  revoke(
    accountId: string,
    keyId: string
  ): Promise<boolean>;
  touchLastUsed(keyId: string, at: number): Promise<void>;
}

export interface ApiUsageRepository {
  record(entry: ApiUsage): Promise<void>;
  stats(
    accountId: string,
    limit?: number
  ): Promise<ApiUsageStats>;
}

export interface DatasetMetadataRepository {
  list(accountId: string): Promise<DatasetMetadata[]>;
  get(
    accountId: string,
    datasetId: string
  ): Promise<DatasetMetadata | null>;
  create(dataset: DatasetMetadata): Promise<void>;
  updateCurrentVersion(
    accountId: string,
    datasetId: string,
    versionId: string
  ): Promise<void>;
  appendVersionMetadata(
    accountId: string,
    version: DatasetVersionMetadata
  ): Promise<void>;
  getVersionMetadata(
    accountId: string,
    datasetId: string,
    versionId: string
  ): Promise<DatasetVersionMetadata | null>;
  findVersionBySourceVersion(
    accountId: string,
    sourceVersionId: string
  ): Promise<DatasetVersionMetadata | null>;
  listVersions(
    accountId: string,
    datasetId: string
  ): Promise<DatasetVersionMetadata[]>;
  recordImportRun(
    run: DatasetImportRunMetadata
  ): Promise<void>;
}

export interface DatasetPayloadRepository<TVersion> {
  put(version: TVersion): Promise<DatasetPayloadLocator>;
  get(locator: DatasetPayloadLocator): Promise<TVersion>;
  delete?(locator: DatasetPayloadLocator): Promise<void>;
}
