import crypto from 'crypto';
import { structuredKnowledgeProjectionService } from '../companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../datasets/datasetService.js';
import { connectorRegistry } from './connectorRegistry.js';
import {
  IntegrationStateError,
  integrationStore,
  publicConnection,
} from './integrationStore.js';
import { classifyIntegrationFailure } from './integrationFailure.js';
import { testIntegrationConnector } from './connectors/testConnector.js';
import { googleDriveConnector } from './connectors/googleDriveConnector.js';
import { microsoftOneDriveConnector } from './connectors/microsoftOneDriveConnector.js';
import {
  ExternalImportState,
  ExternalRecord,
  ExternalSourceRef,
  IntegrationConnection,
  IntegrationProvider,
  PublicIntegrationConnection,
  SyncRun,
  SyncRunRecordResult,
} from './types.js';

if (!connectorRegistry.get('TEST')) {
  connectorRegistry.register(testIntegrationConnector);
}
if (!connectorRegistry.get('GOOGLE_DRIVE')) {
  connectorRegistry.register(googleDriveConnector);
}
if (!connectorRegistry.get('MICROSOFT_ONEDRIVE')) {
  connectorRegistry.register(microsoftOneDriveConnector);
}

const SYNC_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;

export class IntegrationSyncError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'CONNECTION_NAME_INVALID'
    | 'UNSUPPORTED_EXTERNAL_RESOURCE'
    | 'EXTERNAL_RECORD_INVALID'
    | 'CURSOR_RESET_NOT_REQUIRED';

  constructor(
    code:
      | 'CONNECTION_NAME_INVALID'
      | 'UNSUPPORTED_EXTERNAL_RESOURCE'
      | 'EXTERNAL_RECORD_INVALID'
      | 'CURSOR_RESET_NOT_REQUIRED',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'IntegrationSyncError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

type AttemptResult = {
  cursorAfter?: string;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  tombstoneCount: number;
  failedCount: number;
  recordResults: SyncRunRecordResult[];
};

class AttemptFailure extends Error {
  public readonly causeError: any;
  public readonly progress: AttemptResult;

  constructor(error: any, progress: AttemptResult) {
    super(error?.message || 'Integration sync attempt failed.');
    this.name = 'AttemptFailure';
    this.causeError = error;
    this.progress = progress;
  }
}

function provenanceFor(ref: ExternalSourceRef) {
  return {
    provider: ref.provider,
    connectionId: ref.connectionId,
    externalId: ref.externalId,
    externalVersion: ref.externalVersion,
    name: ref.name,
    mimeType: ref.mimeType,
    modifiedAt: ref.modifiedAt,
    webUrl: ref.webUrl,
  };
}

function isStructuredFile(ref: ExternalSourceRef): boolean {
  const lower = ref.name.toLowerCase();
  return lower.endsWith('.csv') || lower.endsWith('.xlsx');
}

function retryBaseMs(): number {
  const configured = Number(
    process.env.INTEGRATION_SYNC_RETRY_BASE_MS || '250'
  );
  return Number.isFinite(configured) && configured >= 0
    ? Math.min(configured, 10_000)
    : 250;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    10_000,
    retryBaseMs() * Math.pow(2, Math.max(0, attemptCount - 1))
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class IntegrationSyncService {
  public createConnection(params: {
    accountId: string;
    provider: IntegrationProvider;
    displayName: string;
    settings?: Record<string, string | number | boolean>;
    credentialRef?: string;
  }): IntegrationConnection {
    const displayName = params.displayName.trim();
    if (!displayName || displayName.length > 160) {
      throw new IntegrationSyncError(
        'CONNECTION_NAME_INVALID',
        400,
        'Integration display name must contain 1–160 characters.'
      );
    }

    const connector = connectorRegistry.require(params.provider);
    return integrationStore.createConnection({
      accountId: params.accountId,
      provider: params.provider,
      displayName,
      capabilities: connector.capabilities(),
      settings: params.settings,
      credentialRef: params.credentialRef,
    });
  }

  public listConnections(
    accountId: string
  ): PublicIntegrationConnection[] {
    return integrationStore
      .listConnections(accountId)
      .map(publicConnection);
  }

  public getConnection(
    accountId: string,
    connectionId: string
  ): PublicIntegrationConnection {
    return publicConnection(
      integrationStore.requireConnection(accountId, connectionId)
    );
  }

  public listRuns(params: {
    accountId: string;
    connectionId?: string;
    limit?: number;
  }): SyncRun[] {
    return integrationStore.listSyncRuns(params);
  }

  public listImports(params: {
    accountId: string;
    connectionId?: string;
    externalId?: string;
    limit?: number;
  }): ExternalImportState[] {
    return integrationStore.listImports(params);
  }

  public pause(
    accountId: string,
    connectionId: string
  ): PublicIntegrationConnection {
    return publicConnection(
      integrationStore.setConnectionStatus(
        accountId,
        connectionId,
        'PAUSED'
      )
    );
  }

  public resume(
    accountId: string,
    connectionId: string
  ): PublicIntegrationConnection {
    const connection = integrationStore.requireConnection(
      accountId,
      connectionId
    );

    if (
      connection.status === 'ERROR' &&
      (connection.attentionReason === 'REAUTHORIZE' ||
        connection.attentionReason === 'PERMISSION_LOST' ||
        connection.attentionReason === 'CURSOR_RESET_REQUIRED')
    ) {
      throw new IntegrationStateError(
        'CONNECTION_NOT_ACTIVE',
        409,
        'This integration requires its explicit recovery action before it can resume.'
      );
    }

    return publicConnection(
      integrationStore.setConnectionStatus(
        accountId,
        connectionId,
        'ACTIVE'
      )
    );
  }

  public resetCursor(
    accountId: string,
    connectionId: string
  ): PublicIntegrationConnection {
    const connection = integrationStore.requireConnection(
      accountId,
      connectionId
    );

    if (connection.attentionReason !== 'CURSOR_RESET_REQUIRED') {
      throw new IntegrationSyncError(
        'CURSOR_RESET_NOT_REQUIRED',
        409,
        'Cursor reset is only allowed when the provider cursor has explicitly failed.'
      );
    }

    return publicConnection(
      integrationStore.updateConnection(accountId, connectionId, {
        cursor: undefined,
        status: 'ACTIVE',
        attentionReason: undefined,
        lastFailureCategory: undefined,
        consecutiveFailureCount: 0,
        nextRetryAt: undefined,
        lastError: undefined,
      })
    );
  }

  public revoke(
    accountId: string,
    connectionId: string
  ): PublicIntegrationConnection {
    return publicConnection(
      integrationStore.setConnectionStatus(
        accountId,
        connectionId,
        'REVOKED'
      )
    );
  }

  public async sync(params: {
    accountId: string;
    connectionId: string;
    maxAttempts?: number;
  }): Promise<SyncRun> {
    const initial = integrationStore.requireConnection(
      params.accountId,
      params.connectionId
    );

    if (initial.status === 'REVOKED') {
      throw new IntegrationStateError(
        'CONNECTION_REVOKED',
        409,
        'Revoked integration connections cannot sync.'
      );
    }
    if (initial.status !== 'ACTIVE') {
      throw new IntegrationStateError(
        'CONNECTION_NOT_ACTIVE',
        409,
        'Only ACTIVE integration connections can sync.'
      );
    }

    const leaseId =
      'synclease_' + crypto.randomBytes(12).toString('hex');
    integrationStore.acquireSyncLease({
      accountId: params.accountId,
      connectionId: initial.id,
      leaseId,
      leaseMs: SYNC_LEASE_MS,
    });

    const maxAttempts = Math.max(
      1,
      Math.min(
        params.maxAttempts || DEFAULT_MAX_ATTEMPTS,
        5
      )
    );

    const run = integrationStore.createSyncRun({
      accountId: params.accountId,
      connectionId: initial.id,
      provider: initial.provider,
      cursorBefore: initial.cursor,
      maxAttempts,
    });

    try {
      for (
        let attemptCount = 1;
        attemptCount <= maxAttempts;
        attemptCount += 1
      ) {
        const connection = integrationStore.requireConnection(
          params.accountId,
          initial.id
        );

        integrationStore.updateSyncRun(
          params.accountId,
          run.id,
          {
            attemptCount,
            nextRetryAt: undefined,
          }
        );

        try {
          const result = await this.executeAttempt({
            accountId: params.accountId,
            connection,
          });
          const completedAt = Date.now();

          const completed = integrationStore.updateSyncRun(
            params.accountId,
            run.id,
            {
              status: 'COMPLETED',
              cursorAfter: result.cursorAfter,
              completedAt,
              attemptCount,
              retryable: undefined,
              failureCategory: undefined,
              nextRetryAt: undefined,
              processedCount: result.processedCount,
              importedCount: result.importedCount,
              skippedCount: result.skippedCount,
              tombstoneCount: result.tombstoneCount,
              failedCount: result.failedCount,
              recordResults: result.recordResults,
              error: undefined,
            }
          );

          integrationStore.updateConnection(
            params.accountId,
            connection.id,
            {
              cursor: result.cursorAfter,
              status: 'ACTIVE',
              attentionReason: undefined,
              lastFailureCategory: undefined,
              consecutiveFailureCount: 0,
              nextRetryAt: undefined,
              lastSyncAt: completedAt,
              lastSuccessfulSyncAt: completedAt,
              lastError: undefined,
            }
          );

          return completed;
        } catch (rawError: any) {
          const attemptFailure =
            rawError instanceof AttemptFailure
              ? rawError
              : new AttemptFailure(rawError, {
                  processedCount: 0,
                  importedCount: 0,
                  skippedCount: 0,
                  tombstoneCount: 0,
                  failedCount: 1,
                  recordResults: [],
                });
          const classification = classifyIntegrationFailure(
            attemptFailure.causeError
          );
          const canRetry =
            classification.retryable &&
            attemptCount < maxAttempts;

          if (canRetry) {
            const delay = retryDelayMs(attemptCount);
            const nextRetryAt = Date.now() + delay;

            integrationStore.updateSyncRun(
              params.accountId,
              run.id,
              {
                status: 'RUNNING',
                attemptCount,
                retryable: true,
                failureCategory: classification.category,
                nextRetryAt,
                processedCount:
                  attemptFailure.progress.processedCount,
                importedCount:
                  attemptFailure.progress.importedCount,
                skippedCount:
                  attemptFailure.progress.skippedCount,
                tombstoneCount:
                  attemptFailure.progress.tombstoneCount,
                failedCount: Math.max(
                  1,
                  attemptFailure.progress.failedCount
                ),
                recordResults:
                  attemptFailure.progress.recordResults,
                error: classification.message,
              }
            );

            integrationStore.updateConnection(
              params.accountId,
              connection.id,
              {
                lastSyncAt: Date.now(),
                lastFailureCategory:
                  classification.category,
                consecutiveFailureCount:
                  (connection.consecutiveFailureCount || 0) + 1,
                nextRetryAt,
                lastError: classification.message,
              }
            );

            await sleep(delay);
            continue;
          }

          const completedAt = Date.now();
          const attentionReason =
            classification.attentionReason ||
            'SYNC_FAILED';

          integrationStore.updateConnection(
            params.accountId,
            connection.id,
            {
              status: 'ERROR',
              attentionReason,
              lastFailureCategory:
                classification.category,
              consecutiveFailureCount:
                (connection.consecutiveFailureCount || 0) + 1,
              nextRetryAt: undefined,
              lastSyncAt: completedAt,
              lastError: classification.message,
            }
          );

          return integrationStore.updateSyncRun(
            params.accountId,
            run.id,
            {
              status: 'FAILED',
              completedAt,
              attemptCount,
              retryable: classification.retryable,
              failureCategory:
                classification.category,
              nextRetryAt: undefined,
              processedCount:
                attemptFailure.progress.processedCount,
              importedCount:
                attemptFailure.progress.importedCount,
              skippedCount:
                attemptFailure.progress.skippedCount,
              tombstoneCount:
                attemptFailure.progress.tombstoneCount,
              failedCount: Math.max(
                1,
                attemptFailure.progress.failedCount
              ),
              recordResults:
                attemptFailure.progress.recordResults,
              error: classification.message,
            }
          );
        }
      }

      throw new Error(
        'Integration sync retry loop exited unexpectedly.'
      );
    } finally {
      integrationStore.releaseSyncLease({
        accountId: params.accountId,
        connectionId: initial.id,
        leaseId,
      });
    }
  }

  private async executeAttempt(params: {
    accountId: string;
    connection: IntegrationConnection;
  }): Promise<AttemptResult> {
    const connector = connectorRegistry.require(
      params.connection.provider
    );
    const result: AttemptResult = {
      processedCount: 0,
      importedCount: 0,
      skippedCount: 0,
      tombstoneCount: 0,
      failedCount: 0,
      recordResults: [],
    };

    try {
      const page = await connector.listChanges(
        { connection: params.connection },
        { cursor: params.connection.cursor }
      );
      result.cursorAfter = page.nextCursor;

      for (const ref of page.records) {
        result.processedCount += 1;

        try {
          const recordResult = await this.processChange({
            accountId: params.accountId,
            connection: params.connection,
            ref,
            connector,
          });
          result.recordResults.push(recordResult);

          if (recordResult.status === 'IMPORTED') {
            result.importedCount += 1;
          } else if (recordResult.status === 'SKIPPED') {
            result.skippedCount += 1;
          } else if (recordResult.status === 'TOMBSTONED') {
            result.tombstoneCount += 1;
          }
        } catch (error: any) {
          result.failedCount += 1;
          result.recordResults.push({
            externalId: ref.externalId,
            externalVersion: ref.externalVersion,
            name: ref.name,
            status: 'FAILED',
            error:
              error?.message ||
              'External record sync failed.',
          });
          throw error;
        }
      }

      return result;
    } catch (error: any) {
      throw new AttemptFailure(error, result);
    }
  }

  private async processChange(params: {
    accountId: string;
    connection: IntegrationConnection;
    ref: ExternalSourceRef;
    connector: ReturnType<typeof connectorRegistry.require>;
  }): Promise<SyncRunRecordResult> {
    const { accountId, connection, ref, connector } = params;

    if (
      ref.connectionId !== connection.id ||
      ref.provider !== connection.provider ||
      !ref.externalId.trim() ||
      !ref.externalVersion.trim()
    ) {
      throw new IntegrationSyncError(
        'EXTERNAL_RECORD_INVALID',
        422,
        'Connector returned an invalid or cross-connection external reference.'
      );
    }

    const exact = integrationStore.findExactImport(
      accountId,
      connection.id,
      ref.externalId,
      ref.externalVersion
    );

    if (ref.deleted) {
      if (exact?.status === 'TOMBSTONE') {
        return {
          externalId: ref.externalId,
          externalVersion: ref.externalVersion,
          name: ref.name,
          status: 'SKIPPED',
          internalKind: exact.internalKind,
          internalId: exact.internalId,
          internalVersionId: exact.internalVersionId,
        };
      }

      const tombstone = integrationStore.recordImport({
        status: 'TOMBSTONE',
        accountId,
        connectionId: connection.id,
        provider: connection.provider,
        externalId: ref.externalId,
        externalVersion: ref.externalVersion,
        externalName: ref.name,
        resourceKind: ref.resourceKind,
        internalKind: 'TOMBSTONE',
        importedAt: Date.now(),
        updatedAt: Date.now(),
        provenance: provenanceFor(ref),
      });

      return {
        externalId: ref.externalId,
        externalVersion: ref.externalVersion,
        name: ref.name,
        status: 'TOMBSTONED',
        internalKind: tombstone.internalKind,
      };
    }

    if (exact?.status === 'READY') {
      return {
        externalId: ref.externalId,
        externalVersion: ref.externalVersion,
        name: ref.name,
        status: 'SKIPPED',
        internalKind: exact.internalKind,
        internalId: exact.internalId,
        internalVersionId: exact.internalVersionId,
      };
    }

    if (exact?.status === 'INGESTED') {
      return this.finishPendingImport(accountId, exact);
    }

    const record = await connector.fetchRecord(
      { connection },
      ref
    );

    if (!isStructuredFile(record.ref)) {
      throw new IntegrationSyncError(
        'UNSUPPORTED_EXTERNAL_RESOURCE',
        415,
        'Structured integration sync currently imports CSV/XLSX records only.'
      );
    }

    return this.importStructuredRecord({
      accountId,
      connection,
      record,
    });
  }

  private async importStructuredRecord(params: {
    accountId: string;
    connection: IntegrationConnection;
    record: ExternalRecord;
  }): Promise<SyncRunRecordResult> {
    const { accountId, connection, record } = params;
    const priorDataset = integrationStore
      .listImports({
        accountId,
        connectionId: connection.id,
        externalId: record.ref.externalId,
        limit: 100,
      })
      .find(
        (item) =>
          item.internalKind === 'DATASET' &&
          Boolean(item.internalId)
      );

    const imported = await datasetService.importFile({
      accountId,
      buffer: record.buffer,
      filename: record.ref.name,
      mimeType: record.ref.mimeType,
      datasetName: priorDataset
        ? undefined
        : record.ref.name.replace(/\.(csv|xlsx)$/i, ''),
      description:
        'Synchronized from ' +
        connection.provider +
        ' external resource ' +
        record.ref.externalId +
        '.',
      existingDatasetId: priorDataset?.internalId,
    });

    const importState = integrationStore.recordImport({
      status: 'INGESTED',
      accountId,
      connectionId: connection.id,
      provider: connection.provider,
      externalId: record.ref.externalId,
      externalVersion: record.ref.externalVersion,
      externalName: record.ref.name,
      resourceKind: record.ref.resourceKind,
      internalKind: 'DATASET',
      internalId: imported.dataset.id,
      internalVersionId: imported.version.id,
      importedAt: Date.now(),
      updatedAt: Date.now(),
      provenance: provenanceFor(record.ref),
    });

    return this.finishPendingImport(accountId, importState);
  }

  private finishPendingImport(
    accountId: string,
    importState: ExternalImportState
  ): SyncRunRecordResult {
    if (
      importState.internalKind !== 'DATASET' ||
      !importState.internalId ||
      !importState.internalVersionId
    ) {
      throw new IntegrationSyncError(
        'EXTERNAL_RECORD_INVALID',
        422,
        'Pending external import is missing its internal dataset/version identity.'
      );
    }

    try {
      const projection =
        structuredKnowledgeProjectionService.projectDataset({
          accountId,
          datasetId: importState.internalId,
          versionId: importState.internalVersionId,
        });

      const ready = integrationStore.updateImport(
        accountId,
        importState.id,
        {
          status: 'READY',
          knowledgeProjectionRunId: projection.id,
          lastError: undefined,
        }
      );

      return {
        externalId: ready.externalId,
        externalVersion: ready.externalVersion,
        name: ready.externalName,
        status: 'IMPORTED',
        internalKind: ready.internalKind,
        internalId: ready.internalId,
        internalVersionId: ready.internalVersionId,
      };
    } catch (error: any) {
      integrationStore.updateImport(accountId, importState.id, {
        status: 'INGESTED',
        lastError:
          error?.message ||
          'Knowledge projection failed.',
      });
      throw error;
    }
  }
}

export const integrationSyncService =
  new IntegrationSyncService();
