import crypto from 'crypto';
import {
  buildSourceStorageKey,
  sha256Bytes,
  verifySourceIntegrity,
  type SourceByteStorage,
} from './sourceByteStorage.js';
import {
  sourceByteStorageRuntime,
} from './sourceByteStorageRuntime.js';
import {
  postgresSourceObjectRepository,
} from './postgresSourceObjectRepository.js';
import type {
  SourceObject,
  SourceObjectRepository,
  SourceVersion,
} from './sourceObjectTypes.js';

export interface StoredDocumentSource {
  sourceObject: SourceObject;
  sourceVersion: SourceVersion;
}

function id(prefix: string): string {
  return (
    prefix +
    crypto.randomBytes(12).toString('hex')
  );
}

export class DocumentSourceStorageService {
  constructor(
    private readonly repository:
      SourceObjectRepository =
        postgresSourceObjectRepository,
    private readonly storageProvider: () =>
      SourceByteStorage =
        sourceByteStorageRuntime
  ) {}

  async persistUploadedPdf(input: {
    accountId: string;
    workspaceId: string;
    filename: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<StoredDocumentSource> {
    const sourceObjectId =
      id('srcobj_');
    const sourceVersionId =
      id('srcver_');
    const sha256 = sha256Bytes(input.bytes);
    const sizeBytes =
      input.bytes.byteLength;
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
      contentType:
        input.contentType ||
        'application/pdf',
      expectedSizeBytes: sizeBytes,
      expectedSha256: sha256,
    });

    verifySourceIntegrity({
      bytes: input.bytes,
      expectedSizeBytes:
        stored.sizeBytes,
      expectedSha256: stored.sha256,
    });

    if (
      stored.backend !== storage.backend ||
      stored.key !== storageKey
    ) {
      await storage
        .delete(storageKey)
        .catch(() => undefined);
      throw new Error(
        'Source storage adapter returned an unexpected physical locator.'
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
          workspaceId:
            input.workspaceId,
          kind: 'DOCUMENT',
          origin: 'UPLOAD',
          createdAt: now,
          updatedAt: now,
        });

      const sourceVersion =
        await this.repository.createVersion({
          id: sourceVersionId,
          accountId: input.accountId,
          sourceObjectId,
          originalFilename:
            input.filename,
          contentType:
            input.contentType ||
            'application/pdf',
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

  async loadPdfBytes(input: {
    accountId: string;
    workspaceId: string;
    sourceVersionId: string;
  }): Promise<{
    sourceVersion: SourceVersion;
    bytes: Buffer;
  }> {
    const sourceVersion =
      await this.repository
        .getVersionForWorkspace(
          input.accountId,
          input.workspaceId,
          input.sourceVersionId
        );

    if (!sourceVersion) {
      throw new Error(
        'Durable document source version was not found in the current account/workspace scope.'
      );
    }

    const storage =
      this.storageProvider();

    if (
      storage.backend !==
      sourceVersion.storageBackend
    ) {
      throw new Error(
        'Configured source storage backend does not match the document source version.'
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

  async retireDocumentSource(input: {
    accountId: string;
    workspaceId: string;
    sourceVersionId: string;
  }): Promise<{
    found: boolean;
    purged: boolean;
  }> {
    const sourceVersion =
      await this.repository
        .getVersionForWorkspace(
          input.accountId,
          input.workspaceId,
          input.sourceVersionId
        );

    if (!sourceVersion) {
      return {
        found: false,
        purged: false,
      };
    }

    await this.repository
      .setVersionRetentionState(
        input.accountId,
        sourceVersion.sourceObjectId,
        sourceVersion.id,
        'PURGE_PENDING'
      );

    await this.repository
      .tombstoneObject(
        input.accountId,
        sourceVersion.sourceObjectId
      );

    try {
      await this.storageProvider().delete(
        sourceVersion.storageKey
      );
      await this.repository
        .setVersionRetentionState(
          input.accountId,
          sourceVersion.sourceObjectId,
          sourceVersion.id,
          'TOMBSTONED'
        );
      return {
        found: true,
        purged: true,
      };
    } catch {
      return {
        found: true,
        purged: false,
      };
    }
  }

  async compensateUnlinkedSource(input: {
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

export const documentSourceStorageService =
  new DocumentSourceStorageService();
