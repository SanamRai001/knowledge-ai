import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ExternalImportState,
  IntegrationCapabilities,
  IntegrationConnection,
  IntegrationConnectionStatus,
  IntegrationProvider,
  PublicIntegrationConnection,
  SyncRun,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const INTEGRATION_FILE = path.join(DATA_DIR, 'integrations.json');

type PersistedIntegrationState = {
  connections: IntegrationConnection[];
  syncRuns: SyncRun[];
  imports: ExternalImportState[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

export class IntegrationAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code:
    | 'INTEGRATION_CONNECTION_NOT_FOUND'
    | 'SYNC_RUN_NOT_FOUND';

  constructor(
    code:
      | 'INTEGRATION_CONNECTION_NOT_FOUND'
      | 'SYNC_RUN_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'IntegrationAccessError';
    this.code = code;
  }
}

export class IntegrationStateError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'CONNECTION_REVOKED'
    | 'CONNECTION_NOT_ACTIVE'
    | 'CONNECTION_ALREADY_REVOKED'
    | 'SYNC_ALREADY_RUNNING';

  constructor(
    code:
      | 'CONNECTION_REVOKED'
      | 'CONNECTION_NOT_ACTIVE'
      | 'CONNECTION_ALREADY_REVOKED'
      | 'SYNC_ALREADY_RUNNING',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'IntegrationStateError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function publicConnection(
  connection: IntegrationConnection
): PublicIntegrationConnection {
  const { credentialRef, syncLeaseId, ...safe } = clone(connection);
  return {
    ...safe,
    hasCredential: Boolean(credentialRef),
    syncInProgress: Boolean(
      syncLeaseId &&
        connection.syncLeaseExpiresAt &&
        connection.syncLeaseExpiresAt > Date.now()
    ),
  };
}

export class IntegrationStore {
  private connections = new Map<string, IntegrationConnection>();
  private syncRuns = new Map<string, SyncRun>();
  private imports = new Map<string, ExternalImportState>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(INTEGRATION_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(INTEGRATION_FILE, 'utf8')
      ) as Partial<PersistedIntegrationState>;

      for (const connection of parsed.connections || []) {
        this.connections.set(connection.id, connection);
      }
      for (const run of parsed.syncRuns || []) {
        this.syncRuns.set(run.id, run);
      }
      for (const imported of parsed.imports || []) {
        this.imports.set(imported.id, imported);
      }
    } catch (error) {
      console.warn(
        'Could not load integration runtime state; starting empty:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedIntegrationState = {
      connections: Array.from(this.connections.values()).slice(-5000),
      syncRuns: Array.from(this.syncRuns.values()).slice(-25000),
      imports: Array.from(this.imports.values()).slice(-50000),
    };

    const temporary = INTEGRATION_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, INTEGRATION_FILE);
  }

  public createConnection(params: {
    accountId: string;
    provider: IntegrationProvider;
    displayName: string;
    capabilities: IntegrationCapabilities;
    settings?: Record<string, string | number | boolean>;
    credentialRef?: string;
  }): IntegrationConnection {
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

    this.connections.set(connection.id, connection);
    this.save();
    return clone(connection);
  }

  public getConnection(
    accountId: string,
    connectionId: string
  ): IntegrationConnection | null {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.accountId !== accountId) return null;
    return clone(connection);
  }

  public requireConnection(
    accountId: string,
    connectionId: string
  ): IntegrationConnection {
    const connection = this.getConnection(accountId, connectionId);
    if (!connection) {
      throw new IntegrationAccessError(
        'INTEGRATION_CONNECTION_NOT_FOUND',
        'Integration connection not found in the current account scope.'
      );
    }
    return connection;
  }

  public listConnections(
    accountId: string
  ): IntegrationConnection[] {
    return Array.from(this.connections.values())
      .filter((connection) => connection.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(clone);
  }

  public updateConnection(
    accountId: string,
    connectionId: string,
    updates: Partial<
      Pick<
        IntegrationConnection,
        | 'displayName'
        | 'status'
        | 'settings'
        | 'credentialRef'
        | 'cursor'
        | 'attentionReason'
        | 'lastFailureCategory'
        | 'consecutiveFailureCount'
        | 'nextRetryAt'
        | 'syncLeaseId'
        | 'syncLeaseExpiresAt'
        | 'lastSyncAt'
        | 'lastSuccessfulSyncAt'
        | 'lastError'
      >
    >
  ): IntegrationConnection {
    const current = this.requireConnection(accountId, connectionId);
    const updated: IntegrationConnection = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      provider: current.provider,
      capabilities: current.capabilities,
      updatedAt: Date.now(),
    };
    this.connections.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public setConnectionStatus(
    accountId: string,
    connectionId: string,
    status: IntegrationConnectionStatus
  ): IntegrationConnection {
    const current = this.requireConnection(accountId, connectionId);

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

  public acquireSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
    leaseMs: number;
    now?: number;
  }): IntegrationConnection {
    const now = params.now ?? Date.now();
    const current = this.requireConnection(
      params.accountId,
      params.connectionId
    );

    if (
      current.syncLeaseId &&
      current.syncLeaseExpiresAt &&
      current.syncLeaseExpiresAt > now
    ) {
      throw new IntegrationStateError(
        'SYNC_ALREADY_RUNNING',
        409,
        'A sync is already running for this integration connection.'
      );
    }

    return this.updateConnection(
      params.accountId,
      params.connectionId,
      {
        syncLeaseId: params.leaseId,
        syncLeaseExpiresAt:
          now + Math.max(1_000, params.leaseMs),
      }
    );
  }

  public releaseSyncLease(params: {
    accountId: string;
    connectionId: string;
    leaseId: string;
  }): IntegrationConnection {
    const current = this.requireConnection(
      params.accountId,
      params.connectionId
    );

    if (
      current.syncLeaseId &&
      current.syncLeaseId !== params.leaseId
    ) {
      return current;
    }

    return this.updateConnection(
      params.accountId,
      params.connectionId,
      {
        syncLeaseId: undefined,
        syncLeaseExpiresAt: undefined,
      }
    );
  }

  public createSyncRun(params: {
    accountId: string;
    connectionId: string;
    provider: IntegrationProvider;
    cursorBefore?: string;
    maxAttempts?: number;
  }): SyncRun {
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

    this.syncRuns.set(run.id, run);
    this.save();
    return clone(run);
  }

  public updateSyncRun(
    accountId: string,
    runId: string,
    updates: Partial<SyncRun>
  ): SyncRun {
    const current = this.requireSyncRun(accountId, runId);
    const updated: SyncRun = {
      ...current,
      ...clone(updates),
      id: current.id,
      accountId: current.accountId,
      connectionId: current.connectionId,
      provider: current.provider,
    };
    this.syncRuns.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public getSyncRun(
    accountId: string,
    runId: string
  ): SyncRun | null {
    const run = this.syncRuns.get(runId);
    if (!run || run.accountId !== accountId) return null;
    return clone(run);
  }

  public requireSyncRun(
    accountId: string,
    runId: string
  ): SyncRun {
    const run = this.getSyncRun(accountId, runId);
    if (!run) {
      throw new IntegrationAccessError(
        'SYNC_RUN_NOT_FOUND',
        'Sync run not found in the current account scope.'
      );
    }
    return run;
  }

  public listSyncRuns(params: {
    accountId: string;
    connectionId?: string;
    limit?: number;
  }): SyncRun[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));

    if (params.connectionId) {
      this.requireConnection(params.accountId, params.connectionId);
    }

    return Array.from(this.syncRuns.values())
      .filter(
        (run) =>
          run.accountId === params.accountId &&
          (!params.connectionId ||
            run.connectionId === params.connectionId)
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map(clone);
  }

  public recordImport(
    imported: Omit<ExternalImportState, 'id'>
  ): ExternalImportState {
    const existing = this.findExactImport(
      imported.accountId,
      imported.connectionId,
      imported.externalId,
      imported.externalVersion
    );
    if (existing) return existing;

    const state: ExternalImportState = {
      ...clone(imported),
      id: id('extimp'),
    };
    this.imports.set(state.id, state);
    this.save();
    return clone(state);
  }

  public updateImport(
    accountId: string,
    importId: string,
    updates: Partial<
      Pick<
        ExternalImportState,
        | 'status'
        | 'knowledgeProjectionRunId'
        | 'lastError'
        | 'updatedAt'
      >
    >
  ): ExternalImportState {
    const current = this.imports.get(importId);
    if (!current || current.accountId !== accountId) {
      throw new IntegrationAccessError(
        'SYNC_RUN_NOT_FOUND',
        'External import state not found in the current account scope.'
      );
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
    this.imports.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public findExactImport(
    accountId: string,
    connectionId: string,
    externalId: string,
    externalVersion: string
  ): ExternalImportState | null {
    const imported = Array.from(this.imports.values()).find(
      (item) =>
        item.accountId === accountId &&
        item.connectionId === connectionId &&
        item.externalId === externalId &&
        item.externalVersion === externalVersion
    );
    return imported ? clone(imported) : null;
  }

  public findLatestImport(
    accountId: string,
    connectionId: string,
    externalId: string
  ): ExternalImportState | null {
    const imported = Array.from(this.imports.values())
      .filter(
        (item) =>
          item.accountId === accountId &&
          item.connectionId === connectionId &&
          item.externalId === externalId
      )
      .sort((a, b) => b.importedAt - a.importedAt)[0];

    return imported ? clone(imported) : null;
  }

  public listImports(params: {
    accountId: string;
    connectionId?: string;
    externalId?: string;
    limit?: number;
  }): ExternalImportState[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 1000));
    return Array.from(this.imports.values())
      .filter(
        (item) =>
          item.accountId === params.accountId &&
          (!params.connectionId ||
            item.connectionId === params.connectionId) &&
          (!params.externalId || item.externalId === params.externalId)
      )
      .sort((a, b) => b.importedAt - a.importedAt)
      .slice(0, limit)
      .map(clone);
  }
}

export const integrationStore = new IntegrationStore();
