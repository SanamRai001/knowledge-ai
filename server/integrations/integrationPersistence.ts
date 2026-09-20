import crypto from 'crypto';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import {
  postgresIntegrationCheckpointRepository,
  postgresIntegrationRepository,
} from '../persistence/a4PostgresRepositories.js';
import { postgresAccountRepository } from '../persistence/postgresRepositories.js';
import {
  IntegrationStateError,
  integrationStore,
} from './integrationStore.js';
import type {
  ExternalImportState,
  IntegrationCapabilities,
  IntegrationConnection,
  IntegrationConnectionStatus,
  IntegrationProvider,
  SyncRun,
} from './types.js';
import type {
  IntegrationCheckpointCommitInput,
  IntegrationCheckpointCommitResult,
} from '../persistence/a4Types.js';

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class IntegrationPersistence {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  public async createConnection(params: {
    accountId: string;
    provider: IntegrationProvider;
    displayName: string;
    capabilities: IntegrationCapabilities;
    settings?: Record<string, string | number | boolean>;
    credentialRef?: string;
  }): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationStore.createConnection(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);
    const now = Date.now();
    const connection: IntegrationConnection = {
      id: id('int'),
      accountId: params.accountId,
      provider: params.provider,
      displayName: params.displayName.trim(),
      status: 'ACTIVE',
      capabilities: clone(params.capabilities),
      settings: clone(params.settings || {}),
      credentialRef: params.credentialRef,
      createdAt: now,
      updatedAt: now,
    };
    await postgresIntegrationRepository.saveConnection(connection);
    return connection;
  }

  public async getConnection(
    accountId: string,
    connectionId: string
  ): Promise<IntegrationConnection | null> {
    if (this.usesPostgres()) {
      return postgresIntegrationRepository.getConnection(
        accountId,
        connectionId
      );
    }
    return integrationStore.getConnection(accountId, connectionId);
  }

  public async requireConnection(
    accountId: string,
    connectionId: string
  ): Promise<IntegrationConnection> {
    const connection = await this.getConnection(
      accountId,
      connectionId
    );
    if (!connection) {
      const error: any = new Error(
        'Integration connection not found in the current account scope.'
      );
      error.statusCode = 404;
      error.code = 'INTEGRATION_CONNECTION_NOT_FOUND';
      throw error;
    }
    return connection;
  }

  public async listConnections(
    accountId: string
  ): Promise<IntegrationConnection[]> {
    if (this.usesPostgres()) {
      return postgresIntegrationRepository.listConnections(accountId);
    }
    return integrationStore.listConnections(accountId);
  }

  public async updateConnection(
    accountId: string,
    connectionId: string,
    updates: Partial<IntegrationConnection>
  ): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationStore.updateConnection(
        accountId,
        connectionId,
        updates
      );
    }

    const current = await this.requireConnection(
      accountId,
      connectionId
    );
    const updated: IntegrationConnection = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      provider: current.provider,
      capabilities: current.capabilities,
      updatedAt: Date.now(),
    };
    await postgresIntegrationRepository.saveConnection(updated);
    return updated;
  }

  public async setConnectionStatus(
    accountId: string,
    connectionId: string,
    status: IntegrationConnectionStatus
  ): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationStore.setConnectionStatus(
        accountId,
        connectionId,
        status
      );
    }

    const current = await this.requireConnection(
      accountId,
      connectionId
    );
    if (current.status === 'REVOKED') {
      if (status === 'REVOKED') return current;
      throw new IntegrationStateError(
        'CONNECTION_ALREADY_REVOKED',
        409,
        'Revoked integration connections cannot be reactivated.'
      );
    }

    return this.updateConnection(accountId, connectionId, {
      status,
      attentionReason:
        status === 'ACTIVE' ? undefined : current.attentionReason,
      lastFailureCategory:
        status === 'ACTIVE'
          ? undefined
          : current.lastFailureCategory,
      consecutiveFailureCount:
        status === 'ACTIVE' ? 0 : current.consecutiveFailureCount,
      nextRetryAt:
        status === 'ACTIVE' ? undefined : current.nextRetryAt,
      lastError:
        status === 'ACTIVE' ? undefined : current.lastError,
    });
  }

  public async acquireSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
    leaseMs: number;
    now?: number;
  }): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationStore.acquireSyncLease(params);
    }

    const now = params.now ?? Date.now();
    await this.requireConnection(params.accountId, params.connectionId);
    const acquired =
      await postgresIntegrationRepository.tryAcquireSyncLease({
        accountId: params.accountId,
        connectionId: params.connectionId,
        leaseId: params.leaseId,
        leaseExpiresAt:
          now + Math.max(1_000, params.leaseMs),
        now,
      });
    if (!acquired) {
      throw new IntegrationStateError(
        'SYNC_ALREADY_RUNNING',
        409,
        'A sync is already running for this integration connection.'
      );
    }
    return acquired;
  }

  public async releaseSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
  }): Promise<IntegrationConnection> {
    if (!this.usesPostgres()) {
      return integrationStore.releaseSyncLease(params);
    }

    const released =
      await postgresIntegrationRepository.releaseSyncLease({
        accountId: params.accountId,
        connectionId: params.connectionId,
        leaseId: params.leaseId,
        now: Date.now(),
      });
    if (!released) {
      return this.requireConnection(
        params.accountId,
        params.connectionId
      );
    }
    return released;
  }

  public async createSyncRun(params: {
    accountId: string;
    connectionId: string;
    provider: IntegrationProvider;
    cursorBefore?: string;
    maxAttempts?: number;
  }): Promise<SyncRun> {
    if (!this.usesPostgres()) {
      return integrationStore.createSyncRun(params);
    }

    const run: SyncRun = {
      id: id('sync'),
      accountId: params.accountId,
      connectionId: params.connectionId,
      provider: params.provider,
      status: 'RUNNING',
      cursorBefore: params.cursorBefore,
      startedAt: Date.now(),
      attemptCount: 0,
      maxAttempts: Math.max(
        1,
        Math.min(params.maxAttempts || 3, 5)
      ),
      processedCount: 0,
      importedCount: 0,
      skippedCount: 0,
      tombstoneCount: 0,
      failedCount: 0,
      recordResults: [],
    };
    await postgresIntegrationRepository.saveSyncRun(run);
    return run;
  }

  public async updateSyncRun(
    accountId: string,
    runId: string,
    updates: Partial<SyncRun>
  ): Promise<SyncRun> {
    if (!this.usesPostgres()) {
      return integrationStore.updateSyncRun(accountId, runId, updates);
    }

    const current = await this.requireSyncRun(accountId, runId);
    const updated: SyncRun = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      connectionId: current.connectionId,
      provider: current.provider,
    };
    await postgresIntegrationRepository.saveSyncRun(updated);
    return updated;
  }

  public async getSyncRun(
    accountId: string,
    runId: string
  ): Promise<SyncRun | null> {
    if (this.usesPostgres()) {
      return postgresIntegrationRepository.getSyncRun(accountId, runId);
    }
    return integrationStore.getSyncRun(accountId, runId);
  }

  public async requireSyncRun(
    accountId: string,
    runId: string
  ): Promise<SyncRun> {
    const run = await this.getSyncRun(accountId, runId);
    if (!run) {
      const error: any = new Error(
        'Sync run not found in the current account scope.'
      );
      error.statusCode = 404;
      error.code = 'SYNC_RUN_NOT_FOUND';
      throw error;
    }
    return run;
  }

  public async listSyncRuns(params: {
    accountId: string;
    connectionId?: string;
    limit?: number;
  }): Promise<SyncRun[]> {
    if (this.usesPostgres()) {
      return postgresIntegrationRepository.listSyncRuns(params);
    }
    return integrationStore.listSyncRuns(params);
  }

  public async findExactImport(params: {
    accountId: string;
    connectionId: string;
    externalId: string;
    externalVersion: string;
  }): Promise<ExternalImportState | null> {
    if (this.usesPostgres()) {
      return postgresIntegrationRepository.findExactImport(params);
    }
    return integrationStore.findExactImport(
      params.accountId,
      params.connectionId,
      params.externalId,
      params.externalVersion
    );
  }

  public async listImports(params: {
    accountId: string;
    connectionId?: string;
    externalId?: string;
    limit?: number;
  }): Promise<ExternalImportState[]> {
    if (this.usesPostgres()) {
      return postgresIntegrationRepository.listImports(params);
    }
    return integrationStore.listImports(params);
  }

  public async recordImport(
    imported: Omit<ExternalImportState, 'id'>
  ): Promise<ExternalImportState> {
    if (!this.usesPostgres()) {
      return integrationStore.recordImport(imported);
    }

    const existing = await this.findExactImport({
      accountId: imported.accountId,
      connectionId: imported.connectionId,
      externalId: imported.externalId,
      externalVersion: imported.externalVersion,
    });
    if (existing) return existing;

    const state: ExternalImportState = {
      ...clone(imported),
      id: id('extimp'),
    };
    await postgresIntegrationRepository.saveImport(state);
    return state;
  }

  public async updateImport(
    accountId: string,
    importId: string,
    updates: Partial<ExternalImportState>
  ): Promise<ExternalImportState> {
    if (!this.usesPostgres()) {
      return integrationStore.updateImport(
        accountId,
        importId,
        updates
      );
    }

    const current =
      await postgresIntegrationRepository.getImport(
        accountId,
        importId
      );
    if (!current) {
      const error: any = new Error(
        'External import state not found in the current account scope.'
      );
      error.statusCode = 404;
      error.code = 'EXTERNAL_IMPORT_NOT_FOUND';
      throw error;
    }

    const updated: ExternalImportState = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      connectionId: current.connectionId,
      provider: current.provider,
      externalId: current.externalId,
      externalVersion: current.externalVersion,
      updatedAt: updates.updatedAt ?? Date.now(),
    };
    await postgresIntegrationRepository.saveImport(updated);
    return updated;
  }

  public async commitSuccessfulCheckpoint(
    input: IntegrationCheckpointCommitInput
  ): Promise<IntegrationCheckpointCommitResult> {
    if (this.usesPostgres()) {
      return postgresIntegrationCheckpointRepository
        .commitSuccessfulCheckpoint(input);
    }

    for (const imported of input.imports) {
      const existing = integrationStore.findExactImport(
        imported.accountId,
        imported.connectionId,
        imported.externalId,
        imported.externalVersion
      );
      if (!existing) {
        const { id: _id, ...withoutId } = imported;
        integrationStore.recordImport(withoutId);
      } else {
        integrationStore.updateImport(
          imported.accountId,
          existing.id,
          imported
        );
      }
    }

    const run = integrationStore.updateSyncRun(
      input.accountId,
      input.runId,
      {
        ...input.run,
        status: 'COMPLETED',
        cursorBefore: input.expectedCursor,
        cursorAfter: input.nextCursor,
        completedAt: input.completedAt,
        retryable: false,
        failureCategory: undefined,
        nextRetryAt: undefined,
        error: undefined,
      }
    );

    const connection = integrationStore.updateConnection(
      input.accountId,
      input.connectionId,
      {
        cursor: input.nextCursor,
        lastSyncAt: input.completedAt,
        lastSuccessfulSyncAt: input.completedAt,
        lastError: undefined,
        lastFailureCategory: undefined,
        attentionReason: undefined,
        consecutiveFailureCount: 0,
        nextRetryAt: undefined,
      }
    );

    return {
      connection,
      run,
      imports: input.imports.map(clone),
    };
  }
}

export const integrationPersistence =
  new IntegrationPersistence();
