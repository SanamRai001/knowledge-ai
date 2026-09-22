export type SourceObjectKind =
  | 'DOCUMENT'
  | 'DATASET_SOURCE';

export type SourceObjectOrigin =
  | 'UPLOAD'
  | 'GOOGLE_DRIVE'
  | 'MICROSOFT_ONEDRIVE'
  | 'GENERATED';

export type SourceObjectStatus =
  | 'ACTIVE'
  | 'TOMBSTONED';

export type SourceVersionRetentionState =
  | 'ACTIVE'
  | 'TOMBSTONED'
  | 'PURGE_PENDING';

export interface SourceObject {
  id: string;
  accountId: string;
  workspaceId?: string;
  kind: SourceObjectKind;
  origin: SourceObjectOrigin;
  externalConnectionId?: string;
  externalId?: string;
  status: SourceObjectStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSourceObject {
  id: string;
  accountId: string;
  workspaceId?: string;
  kind: SourceObjectKind;
  origin: SourceObjectOrigin;
  externalConnectionId?: string;
  externalId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SourceVersion {
  id: string;
  accountId: string;
  sourceObjectId: string;
  externalVersion?: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storageBackend: string;
  storageKey: string;
  storageEtag?: string;
  retentionState: SourceVersionRetentionState;
  createdAt: number;
  retentionUpdatedAt: number;
}

export interface CreateSourceVersion {
  id: string;
  accountId: string;
  sourceObjectId: string;
  externalVersion?: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storageBackend: string;
  storageKey: string;
  storageEtag?: string;
  createdAt: number;
}

export interface SourceObjectRepository {
  createObject(
    input: CreateSourceObject
  ): Promise<SourceObject>;

  getObject(
    accountId: string,
    sourceObjectId: string
  ): Promise<SourceObject | null>;

  listObjects(
    accountId: string
  ): Promise<SourceObject[]>;

  tombstoneObject(
    accountId: string,
    sourceObjectId: string,
    at?: number
  ): Promise<SourceObject>;

  createVersion(
    input: CreateSourceVersion
  ): Promise<SourceVersion>;

  getVersion(
    accountId: string,
    sourceObjectId: string,
    sourceVersionId: string
  ): Promise<SourceVersion | null>;

  getVersionForWorkspace(
    accountId: string,
    workspaceId: string,
    sourceVersionId: string
  ): Promise<SourceVersion | null>;

  listVersions(
    accountId: string,
    sourceObjectId: string
  ): Promise<SourceVersion[]>;

  setVersionRetentionState(
    accountId: string,
    sourceObjectId: string,
    sourceVersionId: string,
    state: SourceVersionRetentionState,
    at?: number
  ): Promise<SourceVersion>;
}
