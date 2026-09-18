export type IntegrationProvider =
  | 'TEST'
  | 'GOOGLE_DRIVE'
  | 'GOOGLE_SHEETS'
  | 'MICROSOFT_ONEDRIVE'
  | 'MICROSOFT_EXCEL'
  | 'GMAIL'
  | 'OUTLOOK'
  | 'SLACK'
  | 'DATABASE'
  | 'GENERIC_REST';

export type IntegrationConnectionStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'REVOKED'
  | 'ERROR';

export type SyncRunStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

export type ExternalResourceKind =
  | 'FILE'
  | 'SPREADSHEET'
  | 'DOCUMENT'
  | 'MESSAGE'
  | 'RECORD';

export interface IntegrationCapabilities {
  incrementalSync: boolean;
  deletions: boolean;
  supportedMimeTypes: string[];
  supportedResourceKinds: ExternalResourceKind[];
}

export interface IntegrationConnection {
  id: string;
  accountId: string;
  provider: IntegrationProvider;
  displayName: string;
  status: IntegrationConnectionStatus;
  capabilities: IntegrationCapabilities;
  /** Non-secret provider configuration only. */
  settings: Record<string, string | number | boolean>;
  /** Opaque handle into a future credential vault; never an access token. */
  credentialRef?: string;
  cursor?: string;
  lastSyncAt?: number;
  lastSuccessfulSyncAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PublicIntegrationConnection
  extends Omit<IntegrationConnection, 'credentialRef'> {
  hasCredential: boolean;
}

export interface ExternalSourceRef {
  provider: IntegrationProvider;
  connectionId: string;
  externalId: string;
  externalVersion: string;
  resourceKind: ExternalResourceKind;
  name: string;
  mimeType: string;
  modifiedAt?: number;
  deleted?: boolean;
  webUrl?: string;
}

export interface ExternalRecord {
  ref: ExternalSourceRef;
  buffer: Buffer;
}

export interface ExternalChangePage {
  records: ExternalSourceRef[];
  nextCursor?: string;
}

export interface ExternalImportState {
  id: string;
  accountId: string;
  connectionId: string;
  provider: IntegrationProvider;
  externalId: string;
  externalVersion: string;
  externalName: string;
  resourceKind: ExternalResourceKind;
  internalKind: 'DATASET' | 'DOCUMENT' | 'TOMBSTONE';
  internalId?: string;
  internalVersionId?: string;
  importedAt: number;
  provenance: {
    provider: IntegrationProvider;
    connectionId: string;
    externalId: string;
    externalVersion: string;
    name: string;
    mimeType: string;
    modifiedAt?: number;
    webUrl?: string;
  };
}

export interface SyncRunRecordResult {
  externalId: string;
  externalVersion: string;
  name: string;
  status: 'IMPORTED' | 'SKIPPED' | 'TOMBSTONED' | 'FAILED';
  internalKind?: ExternalImportState['internalKind'];
  internalId?: string;
  internalVersionId?: string;
  error?: string;
}

export interface SyncRun {
  id: string;
  accountId: string;
  connectionId: string;
  provider: IntegrationProvider;
  status: SyncRunStatus;
  cursorBefore?: string;
  cursorAfter?: string;
  startedAt: number;
  completedAt?: number;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  tombstoneCount: number;
  failedCount: number;
  recordResults: SyncRunRecordResult[];
  error?: string;
}

export interface IntegrationConnectorContext {
  connection: IntegrationConnection;
}

export interface IntegrationConnector {
  readonly provider: IntegrationProvider;
  capabilities(): IntegrationCapabilities;
  validateConnection(
    context: IntegrationConnectorContext
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  listChanges(
    context: IntegrationConnectorContext,
    params: { cursor?: string }
  ): Promise<ExternalChangePage>;
  fetchRecord(
    context: IntegrationConnectorContext,
    ref: ExternalSourceRef
  ): Promise<ExternalRecord>;
  healthCheck(
    context: IntegrationConnectorContext
  ): Promise<{ ok: boolean; message?: string }>;
}
