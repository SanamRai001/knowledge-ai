import crypto from 'crypto';
import {
  buildSourceStorageKey,
  sha256Bytes,
  verifySourceIntegrity,
  type SourceByteStorage,
} from '../storage/sourceByteStorage.js';
import {
  sourceByteStorageRuntime,
} from '../storage/sourceByteStorageRuntime.js';
import {
  postgresSourceObjectRepository,
} from '../storage/postgresSourceObjectRepository.js';
import type {
  SourceObjectRepository,
  SourceObject,
  SourceObjectOrigin,
  SourceVersion,
} from '../storage/sourceObjectTypes.js';

function id(prefix: string): string {
  return (
    prefix +
    crypto.randomBytes(12).toString('hex')
  );
}

export interface StoredDatasetSource {
  sourceObject: SourceObject;
  sourceVersion: SourceVersion;
  createdSourceObject: boolean;
  createdSourceVersion: boolean;
}

export class DatasetSourceStorageService {
  constructor(
    private readonly repository:
      SourceObjectRepository =
        postgresSourceObjectRepository,
    private readonly storageProvider: () =>
      SourceByteStorage =
        sourceByteStorageRuntime
  ) {}

  async persistUploadedSource(input: {
    accountId: string;
    filename: string;
    contentType: string;
    bytes: Buffer;
    origin?: SourceObjectOrigin;
    externalConnectionId?: string;
    externalId?: string;
    externalVersion?: string;
  }): Promise<StoredDatasetSource> {
    const hasConnection =
      Boolean(
        input.externalConnectionId?.trim()
      );
    const hasExternalId =
      Boolean(input.externalId?.trim());

    if (hasConnection !== hasExternalId) {
      throw new Error(
        'External Dataset source identity requires both connection ID and external resource ID.'
      );
    }

    if (
      input.externalVersion &&
      (!hasConnection || !hasExternalId)
    ) {
      throw new Error(
        'External Dataset source version requires connection and external resource identity.'
      );
    }

    const sizeBytes =
      input.bytes.byteLength;
    const sha256 =
      sha256Bytes(input.bytes);
    const storage =
      this.storageProvider();

    let sourceObject:
      | SourceObject
      | null = null;

    if (
      input.externalConnectionId &&
      input.externalId
    ) {
      sourceObject =
        await this.repository
          .findExternalObject(
            input.accountId,
            input.externalConnectionId,
            input.externalId
          );

      if (
        sourceObject &&
        input.externalVersion
      ) {
        const exactVersion =
          await this.repository
            .findExternalVersion(
              input.accountId,
              sourceObject.id,
              input.externalVersion
            );

        if (exactVersion) {
          if (
            exactVersion.sizeBytes !==
              sizeBytes ||
            exactVersion.sha256 !==
              sha256
          ) {
            throw new Error(
              'External source version identity was reused with different bytes.'
            );
          }

          if (
            exactVersion.storageBackend !==
              storage.backend
          ) {
            throw new Error(
              'Configured object storage backend does not match the existing external source snapshot.'
            );
          }

          const existingBytes =
            await storage.get(
              exactVersion.storageKey
            );
          verifySourceIntegrity({
            bytes: existingBytes,
            expectedSizeBytes:
              exactVersion.sizeBytes,
            expectedSha256:
              exactVersion.sha256,
          });

          return {
            sourceObject,
            sourceVersion:
              exactVersion,
            createdSourceObject: false,
            createdSourceVersion: false,
          };
        }
      }
    }

    const sourceObjectId =
      sourceObject?.id ||
      id('srcobj_');
    const sourceVersionId =
      id('srcver_');
    const storageKey =
      buildSourceStorageKey({
        accountId: input.accountId,
        sourceObjectId,
        sourceVersionId,
      });

    const stored = await storage.put({
      key: storageKey,
      bytes: input.bytes,
      contentType: input.contentType,
      expectedSizeBytes: sizeBytes,
      expectedSha256: sha256,
    });

    verifySourceIntegrity({
      bytes: input.bytes,
      expectedSizeBytes:
        stored.sizeBytes,
      expectedSha256:
        stored.sha256,
    });

    if (
      stored.backend !== storage.backend ||
      stored.key !== storageKey
    ) {
      await storage
        .delete(storageKey)
        .catch(() => undefined);
      throw new Error(
        'Dataset source storage adapter returned an unexpected physical locator.'
      );
    }

    let createdSourceObject = false;

    try {
      const now = Date.now();

      if (!sourceObject) {
        sourceObject =
          await this.repository.createObject({
            id: sourceObjectId,
            accountId: input.accountId,
            kind: 'DATASET_SOURCE',
            origin:
              input.origin ||
              'UPLOAD',
            externalConnectionId:
              input.externalConnectionId,
            externalId:
              input.externalId,
            createdAt: now,
            updatedAt: now,
          });
        createdSourceObject = true;
      }

      const sourceVersion =
        await this.repository.createVersion({
          id: sourceVersionId,
          accountId: input.accountId,
          sourceObjectId:
            sourceObject.id,
          externalVersion:
            input.externalVersion,
          originalFilename:
            input.filename,
          contentType:
            input.contentType,
          sizeBytes,
          sha256,
          storageBackend:
            stored.backend,
          storageKey: stored.key,
          storageEtag: stored.etag,
          createdAt: now,
        });

      return {
        sourceObject,
        sourceVersion,
        createdSourceObject,
        createdSourceVersion: true,
      };
    } catch (error) {
      await storage
        .delete(storageKey)
        .catch(() => undefined);

      if (
        createdSourceObject &&
        sourceObject
      ) {
        await this.repository
          .tombstoneObject(
            input.accountId,
            sourceObject.id
          )
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async loadSourceBytes(input: {
    accountId: string;
    sourceVersionId: string;
  }): Promise<{
    sourceVersion: SourceVersion;
    bytes: Buffer;
  }> {
    const sourceVersion =
      await this.repository
        .getVersionById(
          input.accountId,
          input.sourceVersionId
        );

    if (
      !sourceVersion ||
      sourceVersion.retentionState !==
        'ACTIVE'
    ) {
      throw new Error(
        'Dataset source version was not found in the current account scope.'
      );
    }

    const sourceObject =
      await this.repository.getObject(
        input.accountId,
        sourceVersion.sourceObjectId
      );

    if (
      !sourceObject ||
      sourceObject.status !==
        'ACTIVE' ||
      sourceObject.kind !==
        'DATASET_SOURCE'
    ) {
      throw new Error(
        'Dataset source object is unavailable in the current account scope.'
      );
    }

    const storage =
      this.storageProvider();
    if (
      storage.backend !==
      sourceVersion.storageBackend
    ) {
      throw new Error(
        'Configured object storage backend does not match Dataset source metadata.'
      );
    }

    const bytes = await storage.get(
      sourceVersion.storageKey
    );
    verifySourceIntegrity({
      bytes,
      expectedSizeBytes:
        sourceVersion.sizeBytes,
      expectedSha256:
        sourceVersion.sha256,
    });

    return {
      sourceVersion,
      bytes,
    };
  }

  async compensate(input: {
    accountId: string;
    sourceObjectId: string;
    sourceVersionId: string;
    storageKey: string;
    tombstoneSourceObject?: boolean;
  }): Promise<void> {
    const storage =
      this.storageProvider();

    await this.repository
      .setVersionRetentionState(
        input.accountId,
        input.sourceObjectId,
        input.sourceVersionId,
        'PURGE_PENDING'
      )
      .catch(() => undefined);

    try {
      await storage.delete(
        input.storageKey
      );
      await this.repository
        .setVersionRetentionState(
          input.accountId,
          input.sourceObjectId,
          input.sourceVersionId,
          'TOMBSTONED'
        )
        .catch(() => undefined);
    } finally {
      if (input.tombstoneSourceObject) {
        await this.repository
          .tombstoneObject(
            input.accountId,
            input.sourceObjectId
          )
          .catch(() => undefined);
      }
    }
  }
}

export const datasetSourceStorageService =
  new DatasetSourceStorageService();
