import fs from 'fs';
import path from 'path';
import type { DatasetVersion } from './types.js';
import type {
  DatasetPayloadLocator,
  DatasetPayloadRepository,
} from '../persistence/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const PAYLOAD_FILE = path.join(
  DATA_DIR,
  'dataset_runtime_payloads.json'
);

type PersistedPayloadState = {
  versions: DatasetVersion[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DatasetRuntimePayloadError extends Error {
  public readonly code:
    | 'PAYLOAD_NOT_FOUND'
    | 'PAYLOAD_BACKEND_INVALID';

  constructor(
    code: 'PAYLOAD_NOT_FOUND' | 'PAYLOAD_BACKEND_INVALID',
    message: string
  ) {
    super(message);
    this.name = 'DatasetRuntimePayloadError';
    this.code = code;
  }
}

/**
 * Temporary production payload backend for structured analytical rows.
 *
 * PostgreSQL owns Dataset/DatasetVersion metadata in A7G. Large table rows
 * stay behind an explicit payload backend until Track C moves them to durable
 * object/analytical storage.
 */
export class DatasetRuntimePayloadStore
  implements DatasetPayloadRepository<DatasetVersion>
{
  private versions = new Map<string, DatasetVersion>();

  constructor(
    private readonly filePath = PAYLOAD_FILE
  ) {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(
        fs.readFileSync(this.filePath, 'utf8')
      ) as Partial<PersistedPayloadState>;

      for (const version of parsed.versions || []) {
        this.versions.set(version.id, clone(version));
      }
    } catch (error) {
      console.warn(
        'Could not load Dataset runtime payloads:',
        error
      );
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const state: PersistedPayloadState = {
      versions: Array.from(this.versions.values()),
    };
    const temporary = this.filePath + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, this.filePath);
  }

  public async put(
    version: DatasetVersion
  ): Promise<DatasetPayloadLocator> {
    this.versions.set(version.id, clone(version));
    this.save();
    return {
      backend: 'local-dataset-payload',
      ref: version.id,
    };
  }

  public async get(
    locator: DatasetPayloadLocator
  ): Promise<DatasetVersion> {
    if (locator.backend !== 'local-dataset-payload') {
      throw new DatasetRuntimePayloadError(
        'PAYLOAD_BACKEND_INVALID',
        'Unsupported Dataset runtime payload backend: ' +
          locator.backend
      );
    }

    const version = this.versions.get(locator.ref);
    if (!version) {
      throw new DatasetRuntimePayloadError(
        'PAYLOAD_NOT_FOUND',
        'Dataset runtime payload not found for version ' +
          locator.ref
      );
    }
    return clone(version);
  }

  public async delete(
    locator: DatasetPayloadLocator
  ): Promise<void> {
    if (locator.backend !== 'local-dataset-payload') {
      return;
    }
    if (this.versions.delete(locator.ref)) {
      this.save();
    }
  }

  public has(versionId: string): boolean {
    return this.versions.has(versionId);
  }
}

export const datasetRuntimePayloadStore =
  new DatasetRuntimePayloadStore();
