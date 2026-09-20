import type {
  ApiKey,
  ApiUsage,
  ApiUsageStats,
} from '../src/types.js';
import { apiKeyStore } from './apiKeyStore.js';
import { postgresPersistenceEnabled } from './persistence/postgres.js';
import {
  postgresAccountRepository,
  postgresApiKeyRepository,
  postgresApiUsageRepository,
} from './persistence/postgresRepositories.js';

export class ApiKeyRuntimeService {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  /**
   * Production auth stays synchronous during requests by hydrating the
   * validation cache before the HTTP server starts accepting traffic.
   */
  public async bootstrap(): Promise<void> {
    if (!this.usesPostgres()) return;
    const keys = await postgresApiKeyRepository.listAll();
    apiKeyStore.replaceValidationCache(keys);
  }

  public async createApiKey(params: {
    name: string;
    accountId?: string;
    environment?: 'live' | 'test';
    scopes?: string[];
  }): Promise<{ apiKey: ApiKey; secret: string }> {
    if (!this.usesPostgres()) {
      return apiKeyStore.createApiKey(params);
    }

    const accountId = params.accountId || 'acc_default';
    await postgresAccountRepository.ensureAccount(accountId);

    const created = apiKeyStore.createApiKey({
      ...params,
      accountId,
    });

    try {
      await postgresApiKeyRepository.create(created.apiKey);
      apiKeyStore.cacheApiKey(created.apiKey);
      return created;
    } catch (error) {
      apiKeyStore.removeCachedApiKey(created.apiKey.id);
      throw error;
    }
  }

  public async listApiKeyMetadata(
    accountId = 'acc_default'
  ): Promise<Array<Omit<ApiKey, 'keyHash'>>> {
    const keys = this.usesPostgres()
      ? await postgresApiKeyRepository.list(accountId)
      : apiKeyStore.listApiKeys(accountId);

    return keys.map((key) => apiKeyStore.publicApiKey(key));
  }

  public async revokeApiKey(
    id: string,
    accountId = 'acc_default'
  ): Promise<boolean> {
    if (!this.usesPostgres()) {
      return apiKeyStore.revokeApiKey(id, accountId);
    }

    const revoked = await postgresApiKeyRepository.revoke(
      accountId,
      id
    );
    if (revoked) {
      apiKeyStore.markCachedApiKeyRevoked(id, accountId);
    }
    return revoked;
  }

  /**
   * Authentication already succeeded against the PostgreSQL-hydrated cache.
   * last_used_at is observability metadata, so persisting it asynchronously
   * avoids making every request-identity middleware asynchronous.
   */
  public noteValidatedKey(key: ApiKey): void {
    if (!this.usesPostgres()) return;

    const at = key.lastUsedAt || Date.now();
    apiKeyStore.touchCachedApiKey(key.id, at);
    void postgresApiKeyRepository
      .touchLastUsed(key.id, at)
      .catch((error) => {
        console.warn(
          'Could not persist API-key last-used timestamp:',
          error
        );
      });
  }

  public async recordUsage(
    usage: Omit<ApiUsage, 'id'>
  ): Promise<ApiUsage> {
    const record = apiKeyStore.recordUsage(usage);
    if (this.usesPostgres()) {
      await postgresApiUsageRepository.record(record);
    }
    return record;
  }

  public async getUsageStats(
    accountId = 'acc_default'
  ): Promise<ApiUsageStats> {
    if (this.usesPostgres()) {
      return postgresApiUsageRepository.stats(accountId, 50);
    }
    return apiKeyStore.getUsageStats(accountId);
  }
}

export const apiKeyRuntimeService =
  new ApiKeyRuntimeService();
