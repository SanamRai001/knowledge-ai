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
    const sourceObjectId =
      id('srcobj_');
    const sourceVersionId =
      id('srcver_');
    const sizeBytes =
      input.bytes.byteLength;
    const sha256 =
      sha256Bytes(input.bytes);
    const storageKey =
      buildSourceStorageKey({
        accountId: input.accountId,
        sourceObjectId,
        sourceVersionId,
      });
    const storage =
      this.storageProvider();

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

    let sourceObject:
      | SourceObject
      | null = null;

    try {
      const now = Date.now();
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

      const sourceVersion =
        await this.repository.createVersion({
          id: sourceVersionId,
          accountId: input.accountId,
          sourceObjectId,
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
      };
    } catch (error) {
      await storage
        .delete(storageKey)
        .catch(() => undefined);

      if (sourceObject) {
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
      await this.repository
        .tombstoneObject(
          input.accountId,
          input.sourceObjectId
        )
        .catch(() => undefined);
    }
  }
}

export const datasetSourceStorageService =
  new DatasetSourceStorageService();
