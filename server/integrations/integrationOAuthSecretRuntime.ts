import {
  postgresPersistenceEnabled,
} from '../persistence/postgres.js';
import {
  postgresSecretStore,
  type PostgresSecretStore,
  SecretStoreError,
} from '../security/postgresSecretStore.js';
import {
  IntegrationCredentialStore,
  integrationCredentialStore,
} from './integrationCredentialStore.js';
import type {
  IntegrationProvider,
} from './types.js';

export interface IntegrationCredentialAccess {
  create<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    secret: T;
  }): string | Promise<string>;

  get<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
  }): T | Promise<T>;

  update<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
    secret: T;
  }): void | Promise<void>;

  delete(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
  }): boolean | Promise<boolean>;
}

export class IntegrationOAuthSecretRuntime
  implements IntegrationCredentialAccess
{
  constructor(
    private readonly secretStore:
      PostgresSecretStore =
        postgresSecretStore,
    private readonly legacyStore:
      IntegrationCredentialStore =
        integrationCredentialStore
  ) {}

  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  async create<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    secret: T;
  }): Promise<string> {
    if (!this.usesPostgres()) {
      return this.legacyStore.create(
        params
      );
    }

    await this.secretStore
      .cleanupUnreferencedIntegrationOAuthSecrets({
        accountId: params.accountId,
        provider: params.provider,
      })
      .catch(() => undefined);

    const created =
      await this.secretStore.create({
        accountId: params.accountId,
        purpose:
          'INTEGRATION_OAUTH',
        provider: params.provider,
        secret: params.secret,
      });

    return created.id;
  }

  async get<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
  }): Promise<T> {
    if (!this.usesPostgres()) {
      return this.legacyStore.get<T>(
        params
      );
    }

    try {
      return await this.secretStore.get<T>({
        accountId: params.accountId,
        secretId:
          params.credentialRef,
        purpose:
          'INTEGRATION_OAUTH',
        provider: params.provider,
      });
    } catch (error) {
      if (
        !(
          error instanceof
            SecretStoreError
        ) ||
        error.code !==
          'SECRET_NOT_FOUND'
      ) {
        throw error;
      }
    }

    return this.migrateLegacy<T>(
      params
    );
  }

  async update<T>(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
    secret: T;
  }): Promise<void> {
    if (!this.usesPostgres()) {
      this.legacyStore.update(params);
      return;
    }

    let exists =
      await this.secretStore
        .findMetadata(
          params.accountId,
          params.credentialRef
        );

    if (!exists) {
      await this.migrateLegacy<T>(
        params
      );
      exists =
        await this.secretStore
          .findMetadata(
            params.accountId,
            params.credentialRef
          );
    }

    if (!exists) {
      throw new SecretStoreError(
        'SECRET_NOT_FOUND',
        404,
        'Integration OAuth credential was not found.'
      );
    }

    await this.secretStore.rotate({
      accountId: params.accountId,
      secretId:
        params.credentialRef,
      purpose:
        'INTEGRATION_OAUTH',
      provider: params.provider,
      secret: params.secret,
    });
  }

  async delete(params: {
    accountId: string;
    provider: IntegrationProvider;
    credentialRef: string;
  }): Promise<boolean> {
    if (!this.usesPostgres()) {
      return this.legacyStore.delete(
        params
      );
    }

    const metadata =
      await this.secretStore
        .findMetadata(
          params.accountId,
          params.credentialRef
        );

    if (metadata) {
      const deleted =
        await this.secretStore.delete({
          accountId:
            params.accountId,
          secretId:
            params.credentialRef,
          purpose:
            'INTEGRATION_OAUTH',
          provider:
            params.provider,
        });

      if (deleted) {
        this.legacyStore.delete(
          params
        );
      }
      return deleted;
    }

    return this.legacyStore.delete(
      params
    );
  }

  private async migrateLegacy<T>(
    params: {
      accountId: string;
      provider: IntegrationProvider;
      credentialRef: string;
    }
  ): Promise<T> {
    const legacy =
      this.legacyStore.get<T>(
        params
      );

    await this.secretStore
      .importLegacyWithId({
        accountId:
          params.accountId,
        secretId:
          params.credentialRef,
        purpose:
          'INTEGRATION_OAUTH',
        provider:
          params.provider,
        secret: legacy,
      });

    const verified =
      await this.secretStore.get<T>({
        accountId:
          params.accountId,
        secretId:
          params.credentialRef,
        purpose:
          'INTEGRATION_OAUTH',
        provider:
          params.provider,
      });

    this.legacyStore.delete(
      params
    );

    return verified;
  }
}

export const integrationOAuthSecretRuntime =
  new IntegrationOAuthSecretRuntime();
