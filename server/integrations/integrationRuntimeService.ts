import crypto from 'crypto';
import { structuredKnowledgeProjectionService } from '../companyKnowledge/structuredKnowledgeProjectionService.js';
import { structuredKnowledgeRuntimeProjectionService } from '../companyKnowledge/structuredKnowledgeRuntimeProjectionService.js';
import { datasetService } from '../datasets/datasetService.js';
import { connectorRegistry } from './connectorRegistry.js';
import { classifyIntegrationFailure } from './integrationFailure.js';
import { integrationPersistence } from './integrationPersistence.js';
import { integrationSourceRecoveryService } from './integrationSourceRecoveryService.js';
import {
  IntegrationStateError,
  publicConnection,
} from './integrationStore.js';
import {
  IntegrationSyncError,
  integrationSyncService,
} from './integrationSyncService.js';
import type {
  ExternalImportState,
  ExternalRecord,
  ExternalSourceRef,
  IntegrationConnection,
  IntegrationProvider,
  PublicIntegrationConnection,
  SyncRun,
  SyncRunRecordResult,
} from './types.js';

const SYNC_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;

type AttemptResult = {
  cursorAfter?: string;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  tombstoneCount: number;
  failedCount: number;
  recordResults: SyncRunRecordResult[];
  checkpointImports: ExternalImportState[];
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

export class IntegrationRuntimeService {
  public usesPostgres(): boolean {
    return integrationPersistence.usesPostgres();
  }

  public async createConnection(params: {
    accountId: string;
    provider: IntegrationProvider;
    displayName: string;
    settings?: Record<string, string | number | boolean>;
    credentialRef?: string;
  }): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationSyncService.createConnection(params);
    }

    const displayName = params.displayName.trim();
    if (!displayName || displayName.length > 160) {
      throw new IntegrationSyncError(
        'CONNECTION_NAME_INVALID',
        400,
        'Integration display name must contain 1–160 characters.'
      );
    }

    const connector = connectorRegistry.require(params.provider);
    return integrationPersistence.createConnection({
      accountId: params.accountId,
      provider: params.provider,
      displayName,
      capabilities: connector.capabilities(),
      settings: params.settings,
      credentialRef: params.credentialRef,
    });
  }

  public async listConnections(
    accountId: string
  ): Promise<PublicIntegrationConnection[]> {
    if (!this.usesPostgres()) {
      return integrationSyncService.listConnections(accountId);
    }
    return (await integrationPersistence.listConnections(accountId)).map(
      publicConnection
    );
  }

  public async getConnection(
    accountId: string,
    connectionId: string
  ): Promise<PublicIntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationSyncService.getConnection(
        accountId,
        connectionId
      );
    }
    return publicConnection(
      await integrationPersistence.requireConnection(
        accountId,
        connectionId
      )
    );
  }

  public async getInternalConnection(
    accountId: string,
    connectionId: string
  ): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      const connection = await integrationPersistence.requireConnection(
        accountId,
        connectionId
      );
      return connection;
    }
    return integrationPersistence.requireConnection(
      accountId,
      connectionId
    );
  }

  public async listRuns(params: {
    accountId: string;
    connectionId?: string;
    limit?: number;
  }): Promise<SyncRun[]> {
    if (!this.usesPostgres()) {
      return integrationSyncService.listRuns(params);
    }
    if (params.connectionId) {
      await integrationPersistence.requireConnection(
        params.accountId,
        params.connectionId
      );
    }
    return integrationPersistence.listSyncRuns(params);
  }

  public async listImports(params: {
    accountId: string;
    connectionId?: string;
    externalId?: string;
    limit?: number;
  }): Promise<ExternalImportState[]> {
    if (!this.usesPostgres()) {
      return integrationSyncService.listImports(params);
    }
    if (params.connectionId) {
      await integrationPersistence.requireConnection(
        params.accountId,
        params.connectionId
      );
    }
    return integrationPersistence.listImports(params);
  }

  public async updateConnection(
    accountId: string,
    connectionId: string,
    updates: Partial<IntegrationConnection>
  ): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationPersistence.updateConnection(
        accountId,
        connectionId,
        updates
      );
    }
    return integrationPersistence.updateConnection(
      accountId,
      connectionId,
      updates
    );
  }

  public async pause(
    accountId: string,
    connectionId: string
  ): Promise<PublicIntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationSyncService.pause(accountId, connectionId);
    }
    return publicConnection(
      await integrationPersistence.setConnectionStatus(
        accountId,
        connectionId,
        'PAUSED'
      )
    );
  }

  public async resume(
    accountId: string,
    connectionId: string
  ): Promise<PublicIntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationSyncService.resume(accountId, connectionId);
    }

    const connection =
      await integrationPersistence.requireConnection(
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
      await integrationPersistence.setConnectionStatus(
        accountId,
        connectionId,
        'ACTIVE'
      )
    );
  }

  public async resetCursor(
    accountId: string,
    connectionId: string
  ): Promise<PublicIntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationSyncService.resetCursor(
        accountId,
        connectionId
      );
    }

    const connection =
      await integrationPersistence.requireConnection(
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
      await integrationPersistence.updateConnection(
        accountId,
        connectionId,
        {
          cursor: undefined,
          status: 'ACTIVE',
          attentionReason: undefined,
          lastFailureCategory: undefined,
          consecutiveFailureCount: 0,
          nextRetryAt: undefined,
          lastError: undefined,
        }
      )
    );
  }

  public async revoke(
    accountId: string,
    connectionId: string
  ): Promise<PublicIntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationSyncService.revoke(accountId, connectionId);
    }
    return publicConnection(
      await integrationPersistence.setConnectionStatus(
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
    if (!this.usesPostgres()) {
      return integrationSyncService.sync(params);
    }

    const initial = await integrationPersistence.requireConnection(
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
    await integrationPersistence.acquireSyncLease({
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

    const run = await integrationPersistence.createSyncRun({
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
        const connection =
          await integrationPersistence.requireConnection(
            params.accountId,
            initial.id
          );

        await integrationPersistence.updateSyncRun(
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
          const currentRun =
            await integrationPersistence.requireSyncRun(
              params.accountId,
              run.id
            );

          const committed =
            await integrationPersistence.commitSuccessfulCheckpoint({
              accountId: params.accountId,
              connectionId: connection.id,
              runId: run.id,
              expectedCursor: run.cursorBefore,
              nextCursor: result.cursorAfter,
              completedAt,
              imports: result.checkpointImports,
              run: {
                ...currentRun,
                status: 'COMPLETED',
                cursorAfter: result.cursorAfter,
                completedAt,
                attemptCount,
                retryable: false,
                failureCategory: undefined,
                nextRetryAt: undefined,
                processedCount: result.processedCount,
                importedCount: result.importedCount,
                skippedCount: result.skippedCount,
                tombstoneCount: result.tombstoneCount,
                failedCount: result.failedCount,
                recordResults: result.recordResults,
                error: undefined,
              },
            });

          return committed.run;
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
                  checkpointImports: [],
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

            await integrationPersistence.updateSyncRun(
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

            await integrationPersistence.updateConnection(
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

          await integrationPersistence.updateConnection(
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

          return integrationPersistence.updateSyncRun(
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
      await integrationPersistence.releaseSyncLease({
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
      checkpointImports: [],
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

          const state = await integrationPersistence.findExactImport({
            accountId: params.accountId,
            connectionId: params.connection.id,
            externalId: ref.externalId,
            externalVersion: ref.externalVersion,
          });
          if (!state) {
            throw new Error(
              'INTEGRATION_CHECKPOINT_IMPORT_MISSING: processed provider record has no durable external-import journal row.'
            );
          }

          if (
            !result.checkpointImports.some(
              (item) => item.id === state.id
            )
          ) {
            result.checkpointImports.push(state);
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

    let exact = await integrationPersistence.findExactImport({
      accountId,
      connectionId: connection.id,
      externalId: ref.externalId,
      externalVersion: ref.externalVersion,
    });

    if (
      this.usesPostgres() &&
      exact?.internalKind === 'DATASET' &&
      exact.internalId &&
      exact.internalVersionId &&
      !exact.sourceVersionId
    ) {
      const sourceVersionId =
        await integrationSourceRecoveryService
          .resolveDatasetSourceVersion({
            accountId,
            datasetId:
              exact.internalId,
            datasetVersionId:
              exact.internalVersionId,
          });

      if (sourceVersionId) {
        exact =
          await integrationPersistence.updateImport(
            accountId,
            exact.id,
            {
              sourceVersionId,
            }
          );
      }
    }

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

      const tombstone = await integrationPersistence.recordImport({
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

    if (
      this.usesPostgres() &&
      isStructuredFile(ref)
    ) {
      const recovered =
        await integrationSourceRecoveryService
          .recoverDatasetImport({
            accountId,
            connectionId:
              connection.id,
            externalId:
              ref.externalId,
            externalVersion:
              ref.externalVersion,
          });

      if (recovered) {
        const recoveredImport =
          await integrationPersistence.recordImport({
            status: 'INGESTED',
            accountId,
            connectionId:
              connection.id,
            provider:
              connection.provider,
            externalId:
              ref.externalId,
            externalVersion:
              ref.externalVersion,
            externalName:
              ref.name,
            resourceKind:
              ref.resourceKind,
            internalKind:
              'DATASET',
            internalId:
              recovered.datasetId,
            internalVersionId:
              recovered.datasetVersionId,
            sourceVersionId:
              recovered.sourceVersionId,
            importedAt:
              Date.now(),
            updatedAt:
              Date.now(),
            provenance:
              provenanceFor(ref),
          });

        return this.finishPendingImport(
          accountId,
          recoveredImport
        );
      }
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
    const priorDataset = (
      await integrationPersistence.listImports({
        accountId,
        connectionId: connection.id,
        externalId: record.ref.externalId,
        limit: 100,
      })
    ).find(
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
        : record.ref.name.replace(/.(csv|xlsx)$/i, ''),
      description:
        'Synchronized from ' +
        connection.provider +
        ' external resource ' +
        record.ref.externalId +
        '.',
      existingDatasetId:
        priorDataset?.internalId,
      sourceOrigin:
        connection.provider ===
        'GOOGLE_DRIVE'
          ? 'GOOGLE_DRIVE'
          : connection.provider ===
              'MICROSOFT_ONEDRIVE'
            ? 'MICROSOFT_ONEDRIVE'
            : undefined,
      externalConnectionId:
        connection.id,
      externalId:
        record.ref.externalId,
      externalVersion:
        record.ref.externalVersion,
    });

    if (!imported.version.sourceVersionId) {
      throw new IntegrationSyncError(
        'EXTERNAL_RECORD_INVALID',
        500,
        'Durable integration Dataset import completed without a source snapshot identity.'
      );
    }

    const importState = await integrationPersistence.recordImport({
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
      sourceVersionId:
        imported.version.sourceVersionId,
      importedAt: Date.now(),
      updatedAt: Date.now(),
      provenance: provenanceFor(record.ref),
    });

    return this.finishPendingImport(accountId, importState);
  }

  private async finishPendingImport(
    accountId: string,
    importState: ExternalImportState
  ): Promise<SyncRunRecordResult> {
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
      const projection = this.usesPostgres()
        ? await structuredKnowledgeRuntimeProjectionService.projectDataset({
            accountId,
            datasetId: importState.internalId,
            versionId: importState.internalVersionId,
          })
        : structuredKnowledgeProjectionService.projectDataset({
            accountId,
            datasetId: importState.internalId,
            versionId: importState.internalVersionId,
          });

      const ready = await integrationPersistence.updateImport(
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
      await integrationPersistence.updateImport(
        accountId,
        importState.id,
        {
          status: 'INGESTED',
          lastError:
            error?.message ||
            'Knowledge projection failed.',
        }
      );
      throw error;
    }
  }
}

export const integrationRuntimeService =
  new IntegrationRuntimeService();
