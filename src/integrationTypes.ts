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

export type IntegrationAttentionReason =
  | 'REAUTHORIZE'
  | 'PERMISSION_LOST'
  | 'CURSOR_RESET_REQUIRED'
  | 'SYNC_FAILED';

export type IntegrationFailureCategory =
  | 'AUTHORIZATION'
  | 'PERMISSION'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'CURSOR_INVALID'
  | 'DATA_INVALID'
  | 'UNSUPPORTED'
  | 'CONFLICT'
  | 'UNKNOWN';

export interface PublicIntegrationConnection {
  id: string;
  accountId: string;
  provider: IntegrationProvider;
  displayName: string;
  status: IntegrationConnectionStatus;
  capabilities: {
    incrementalSync: boolean;
    deletions: boolean;
    supportedMimeTypes: string[];
    supportedResourceKinds: string[];
  };
  settings: Record<string, string | number | boolean>;
  cursor?: string;
  attentionReason?: IntegrationAttentionReason;
  lastFailureCategory?: IntegrationFailureCategory;
  consecutiveFailureCount?: number;
  nextRetryAt?: number;
  syncLeaseExpiresAt?: number;
  lastSyncAt?: number;
  lastSuccessfulSyncAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  hasCredential: boolean;
  syncInProgress: boolean;
}

export interface IntegrationSyncRun {
  id: string;
  accountId: string;
  connectionId: string;
  provider: IntegrationProvider;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  cursorBefore?: string;
  cursorAfter?: string;
  startedAt: number;
  completedAt?: number;
  attemptCount: number;
  maxAttempts: number;
  retryable?: boolean;
  failureCategory?: IntegrationFailureCategory;
  nextRetryAt?: number;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  tombstoneCount: number;
  failedCount: number;
  recordResults: Array<{
    externalId: string;
    externalVersion: string;
    name: string;
    status: 'IMPORTED' | 'SKIPPED' | 'TOMBSTONED' | 'FAILED';
    internalKind?: 'DATASET' | 'DOCUMENT' | 'TOMBSTONE';
    internalId?: string;
    internalVersionId?: string;
    error?: string;
  }>;
  error?: string;
}

export interface ExternalImportRecord {
  id: string;
  status: 'INGESTED' | 'READY' | 'TOMBSTONE';
  accountId: string;
  connectionId: string;
  provider: IntegrationProvider;
  externalId: string;
  externalVersion: string;
  externalName: string;
  resourceKind: string;
  internalKind: 'DATASET' | 'DOCUMENT' | 'TOMBSTONE';
  internalId?: string;
  internalVersionId?: string;
  knowledgeProjectionRunId?: string;
  lastError?: string;
  importedAt: number;
  updatedAt: number;
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
