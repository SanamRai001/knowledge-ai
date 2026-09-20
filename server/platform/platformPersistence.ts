import crypto from 'crypto';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import { postgresAccountRepository } from '../persistence/postgresRepositories.js';
import { postgresPlatformStateRepository } from '../persistence/a5PostgresRepositories.js';
import {
  DomainPackAccessError,
  domainPackInstallationStore,
} from './domainPacks/domainPackInstallationStore.js';
import type {
  DomainPackInstallation,
  DomainPackInstallationStatus,
} from './domainPacks/types.js';
import { toolInvocationAuditStore } from './tools/toolInvocationAuditStore.js';
import type {
  ToolInvocationAudit,
  ToolInvocationStatus,
} from './tools/types.js';

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class PlatformPersistence {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  public async installDomainPack(params: {
    accountId: string;
    packId: string;
    packVersion: string;
  }): Promise<DomainPackInstallation> {
    if (!this.usesPostgres()) {
      return domainPackInstallationStore.install(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);

    const existing = (
      await postgresPlatformStateRepository.listDomainPackInstallations(
        params.accountId
      )
    )
      .filter(
        (item) =>
          item.packId === params.packId &&
          item.status === 'ACTIVE'
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    if (existing?.packVersion === params.packVersion) {
      return existing;
    }

    if (existing) {
      await postgresPlatformStateRepository.saveDomainPackInstallation({
        ...existing,
        status: 'REMOVED',
        updatedAt: Date.now(),
      });
    }

    const now = Date.now();
    const installation: DomainPackInstallation = {
      id: id('dpack'),
      accountId: params.accountId,
      packId: params.packId,
      packVersion: params.packVersion,
      status: 'ACTIVE',
      installedAt: now,
      updatedAt: now,
    };

    await postgresPlatformStateRepository.saveDomainPackInstallation(
      installation
    );
    return installation;
  }

  public async listDomainPackInstallations(
    accountId: string
  ): Promise<DomainPackInstallation[]> {
    if (!this.usesPostgres()) {
      return domainPackInstallationStore.list(accountId);
    }
    return postgresPlatformStateRepository.listDomainPackInstallations(
      accountId
    );
  }

  public async getActiveDomainPack(params: {
    accountId: string;
    packId: string;
  }): Promise<DomainPackInstallation | null> {
    if (!this.usesPostgres()) {
      return domainPackInstallationStore.getActive(params);
    }

    const installations =
      await postgresPlatformStateRepository.listDomainPackInstallations(
        params.accountId
      );
    return (
      installations
        .filter(
          (item) =>
            item.packId === params.packId &&
            item.status === 'ACTIVE'
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null
    );
  }

  public async requireActiveDomainPack(params: {
    accountId: string;
    packId: string;
  }): Promise<DomainPackInstallation> {
    const installation = await this.getActiveDomainPack(params);
    if (!installation) {
      throw new DomainPackAccessError(
        'Domain pack is not installed in the current account.'
      );
    }
    return installation;
  }

  public async setDomainPackStatus(params: {
    accountId: string;
    installationId: string;
    status: DomainPackInstallationStatus;
  }): Promise<DomainPackInstallation> {
    if (!this.usesPostgres()) {
      return domainPackInstallationStore.setStatus(params);
    }

    const current =
      await postgresPlatformStateRepository.getDomainPackInstallation(
        params.accountId,
        params.installationId
      );
    if (!current) {
      throw new DomainPackAccessError(
        'Domain pack installation not found in the current account.'
      );
    }

    const updated: DomainPackInstallation = {
      ...current,
      status: params.status,
      updatedAt: Date.now(),
    };

    await postgresPlatformStateRepository.saveDomainPackInstallation(
      updated
    );
    return updated;
  }

  public async startToolInvocation(params: {
    accountId: string;
    toolId: string;
    toolVersion: string;
    requestId: string;
    apiKeyId: string;
    inputHash: string;
  }): Promise<ToolInvocationAudit> {
    if (!this.usesPostgres()) {
      return toolInvocationAuditStore.start(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);

    const record: ToolInvocationAudit = {
      id: id('tinv'),
      accountId: params.accountId,
      toolId: params.toolId,
      toolVersion: params.toolVersion,
      requestId: params.requestId,
      apiKeyId: params.apiKeyId,
      status: 'STARTED',
      inputHash: params.inputHash,
      startedAt: Date.now(),
    };

    await postgresPlatformStateRepository.saveToolInvocation(record);
    return record;
  }

  public async finishToolInvocation(params: {
    accountId: string;
    invocationId: string;
    status: Exclude<ToolInvocationStatus, 'STARTED'>;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<ToolInvocationAudit> {
    if (!this.usesPostgres()) {
      return toolInvocationAuditStore.finish(params);
    }

    const current =
      await postgresPlatformStateRepository.getToolInvocation(
        params.accountId,
        params.invocationId
      );
    if (!current) {
      throw new Error(
        'Tool invocation audit record not found.'
      );
    }

    const updated: ToolInvocationAudit = {
      ...clone(current),
      status: params.status,
      completedAt: Date.now(),
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    };

    await postgresPlatformStateRepository.saveToolInvocation(updated);
    return updated;
  }

  public async listToolInvocations(params: {
    accountId: string;
    toolId?: string;
    limit?: number;
  }): Promise<ToolInvocationAudit[]> {
    if (!this.usesPostgres()) {
      return toolInvocationAuditStore.list(params);
    }
    return postgresPlatformStateRepository.listToolInvocations(params);
  }
}

export const platformPersistence = new PlatformPersistence();
