import crypto from 'crypto';
import type {
  DatasetTable,
  DatasetVersion,
} from './types.js';
import type {
  DatasetPayloadLocator,
} from '../persistence/types.js';
import {
  sha256Bytes,
  verifySourceIntegrity,
  type SourceByteStorage,
} from '../storage/sourceByteStorage.js';
import {
  sourceByteStorageRuntime,
} from '../storage/sourceByteStorageRuntime.js';

const SAFE_SEGMENT =
  /^[A-Za-z0-9_-]+$/;

function safe(
  value: string,
  label: string
): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    !SAFE_SEGMENT.test(trimmed)
  ) {
    throw new Error(
      label +
        ' must contain only letters, numbers, underscore, or hyphen.'
    );
  }
  return trimmed;
}

export function buildDatasetPayloadKey(input: {
  accountId: string;
  datasetId: string;
  versionId: string;
  writeId: string;
}): string {
  return (
    'accounts/' +
    safe(input.accountId, 'accountId') +
    '/datasets/' +
    safe(input.datasetId, 'datasetId') +
    '/versions/' +
    safe(input.versionId, 'versionId') +
    '/payload/' +
    safe(input.writeId, 'writeId') +
    '.json'
  );
}

interface DurableDatasetEnvelope {
  schemaVersion: 1;
  datasetId: string;
  versionId: string;
  tables: DatasetTable[];
}

export class DurableDatasetPayloadStore {
  constructor(
    private readonly storageProvider: () =>
      SourceByteStorage =
        sourceByteStorageRuntime
  ) {}

  async put(input: {
    accountId: string;
    version: DatasetVersion;
  }): Promise<DatasetPayloadLocator> {
    const writeId =
      'write_' +
      crypto.randomBytes(12).toString('hex');
    const key =
      buildDatasetPayloadKey({
        accountId: input.accountId,
        datasetId:
          input.version.datasetId,
        versionId:
          input.version.id,
        writeId,
      });

    const envelope:
      DurableDatasetEnvelope = {
        schemaVersion: 1,
        datasetId:
          input.version.datasetId,
        versionId:
          input.version.id,
        tables:
          structuredClone(
            input.version.tables
          ),
      };
    const bytes = Buffer.from(
      JSON.stringify(envelope),
      'utf8'
    );
    const sha256 =
      sha256Bytes(bytes);
    const storage =
      this.storageProvider();

    const stored = await storage.put({
      key,
      bytes,
      contentType:
        'application/json',
      expectedSizeBytes:
        bytes.byteLength,
      expectedSha256: sha256,
    });

    verifySourceIntegrity({
      bytes,
      expectedSizeBytes:
        stored.sizeBytes,
      expectedSha256:
        stored.sha256,
    });

    if (
      stored.backend !== storage.backend ||
      stored.key !== key
    ) {
      await storage
        .delete(key)
        .catch(() => undefined);
      throw new Error(
        'Dataset analytical storage adapter returned an unexpected physical locator.'
      );
    }

    return {
      backend:
        'durable-dataset-payload',
      ref: key,
      storageBackend:
        stored.backend,
      sizeBytes:
        stored.sizeBytes,
      sha256:
        stored.sha256,
    };
  }

  async get(input: {
    accountId: string;
    datasetId: string;
    versionId: string;
    locator: DatasetPayloadLocator;
  }): Promise<DatasetTable[]> {
    if (
      input.locator.backend !==
      'durable-dataset-payload'
    ) {
      throw new Error(
        'Unsupported durable Dataset payload backend: ' +
          input.locator.backend
      );
    }

    const expectedPrefix =
      'accounts/' +
      safe(
        input.accountId,
        'accountId'
      ) +
      '/datasets/' +
      safe(
        input.datasetId,
        'datasetId'
      ) +
      '/versions/' +
      safe(
        input.versionId,
        'versionId'
      ) +
      '/payload/';

    if (
      !input.locator.ref.startsWith(
        expectedPrefix
      )
    ) {
      throw new Error(
        'Dataset payload locator is outside the current account/dataset/version scope.'
      );
    }

    const storage =
      this.storageProvider();
    if (
      input.locator.storageBackend &&
      input.locator.storageBackend !==
        storage.backend
    ) {
      throw new Error(
        'Configured object storage backend does not match Dataset payload metadata.'
      );
    }

    if (
      input.locator.sizeBytes ===
        undefined ||
      !input.locator.sha256
    ) {
      throw new Error(
        'Durable Dataset payload is missing integrity metadata.'
      );
    }

    const bytes = await storage.get(
      input.locator.ref
    );

    verifySourceIntegrity({
      bytes,
      expectedSizeBytes:
        input.locator.sizeBytes,
      expectedSha256:
        input.locator.sha256,
    });

    const parsed = JSON.parse(
      bytes.toString('utf8')
    ) as DurableDatasetEnvelope;

    if (
      parsed.schemaVersion !== 1 ||
      parsed.datasetId !==
        input.datasetId ||
      parsed.versionId !==
        input.versionId ||
      !Array.isArray(parsed.tables)
    ) {
      throw new Error(
        'Durable Dataset payload identity does not match relational metadata.'
      );
    }

    return structuredClone(
      parsed.tables
    );
  }

  async delete(
    locator: DatasetPayloadLocator
  ): Promise<void> {
    if (
      locator.backend !==
      'durable-dataset-payload'
    ) {
      return;
    }
    await this.storageProvider()
      .delete(locator.ref);
  }
}

export const durableDatasetPayloadStore =
  new DurableDatasetPayloadStore();
