import { structuredKnowledgeProjectionService } from '../companyKnowledge/structuredKnowledgeProjectionService.js';
import { datasetService } from '../datasets/datasetService.js';
import { connectorRegistry } from './connectorRegistry.js';
import {
  IntegrationAccessError,
  IntegrationStateError,
  integrationStore,
  publicConnection,
} from './integrationStore.js';
import { testIntegrationConnector } from './connectors/testConnector.js';
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

export class IntegrationSyncError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'CONNECTION_NAME_INVALID'
    | 'CONNECTION_VALIDATION_FAILED'
    | 'UNSUPPORTED_EXTERNAL_RESOURCE'
    | 'EXTERNAL_RECORD_INVALID';

  constructor(
    code:
      | 'CONNECTION_NAME_INVALID'
      | 'CONNECTION_VALIDATION_FAILED'
      | 'UNSUPPORTED_EXTERNAL_RESOURCE'
      | 'EXTERNAL_RECORD_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'IntegrationSyncError';
    this.code = code;
    this.statusCode = statusCode;
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
    return publicConnection(
      integrationStore.setConnectionStatus(
        accountId,
        connectionId,
        'ACTIVE'
      )
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
  }): Promise<SyncRun> {
    const connection = integrationStore.requireConnection(
      params.accountId,
      params.connectionId
    );

    if (connection.status === 'REVOKED') {
      throw new IntegrationStateError(
        'CONNECTION_REVOKED',
        409,
        'Revoked integration connections cannot sync.'
      );
    }
    if (connection.status !== 'ACTIVE') {
      throw new IntegrationStateError(
        'CONNECTION_NOT_ACTIVE',
        409,
        'Only ACTIVE integration connections can sync.'
      );
    }

    const connector = connectorRegistry.require(connection.provider);
    const run = integrationStore.createSyncRun({
      accountId: params.accountId,
      connectionId: connection.id,
      provider: connection.provider,
      cursorBefore: connection.cursor,
    });

    const results: SyncRunRecordResult[] = [];
    let processedCount = 0;
    let importedCount = 0;
    let skippedCount = 0;
    let tombstoneCount = 0;
    let failedCount = 0;

    try {
      const validation = await connector.validateConnection({
        connection,
      });
      if ('error' in validation) {
        throw new IntegrationSyncError(
          'CONNECTION_VALIDATION_FAILED',
          422,
          validation.error
        );
      }

      const page = await connector.listChanges(
        { connection },
        { cursor: connection.cursor }
      );

      for (const ref of page.records) {
        processedCount += 1;

        try {
          const result = await this.processChange({
            accountId: params.accountId,
            connection,
            ref,
            connector,
          });
          results.push(result);

          if (result.status === 'IMPORTED') importedCount += 1;
          else if (result.status === 'SKIPPED') skippedCount += 1;
          else if (result.status === 'TOMBSTONED') {
            tombstoneCount += 1;
          }
        } catch (error: any) {
          failedCount += 1;
          results.push({
            externalId: ref.externalId,
            externalVersion: ref.externalVersion,
            name: ref.name,
            status: 'FAILED',
            error: error?.message || 'External record sync failed.',
          });
          throw error;
        }
      }

      const completedAt = Date.now();
      const completed = integrationStore.updateSyncRun(
        params.accountId,
        run.id,
        {
          status: 'COMPLETED',
          cursorAfter: page.nextCursor,
          completedAt,
          processedCount,
          importedCount,
          skippedCount,
          tombstoneCount,
          failedCount,
          recordResults: results,
          error: undefined,
        }
      );

      integrationStore.updateConnection(
        params.accountId,
        connection.id,
        {
          cursor: page.nextCursor,
          lastSyncAt: completedAt,
          lastSuccessfulSyncAt: completedAt,
          lastError: undefined,
        }
      );

      return completed;
    } catch (error: any) {
      const completedAt = Date.now();
      const message =
        error?.message || 'Integration sync failed.';

      integrationStore.updateConnection(
        params.accountId,
        connection.id,
        {
          lastSyncAt: completedAt,
          lastError: message,
        }
      );

      return integrationStore.updateSyncRun(
        params.accountId,
        run.id,
        {
          status: 'FAILED',
          completedAt,
          processedCount,
          importedCount,
          skippedCount,
          tombstoneCount,
          failedCount: Math.max(1, failedCount),
          recordResults: results,
          error: message,
        }
      );
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
        'Phase 6A currently imports external CSV/XLSX records through the shared sync engine. PDF/document dispatch is reserved for the next connector slice.'
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
          error?.message || 'Knowledge projection failed.',
      });
      throw error;
    }
  }
}

export const integrationSyncService =
  new IntegrationSyncService();
