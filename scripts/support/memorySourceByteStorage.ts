import {
  verifySourceIntegrity,
  type SourceBytePutInput,
  type SourceByteStorage,
  type StoredByteObject,
} from '../../server/storage/sourceByteStorage.js';

export class MemorySourceByteStorage
  implements SourceByteStorage
{
  readonly backend =
    'memory-source-object-store';

  readonly objects =
    new Map<string, Buffer>();

  async put(
    input: SourceBytePutInput
  ): Promise<StoredByteObject> {
    const integrity =
      verifySourceIntegrity({
        bytes: input.bytes,
        expectedSizeBytes:
          input.expectedSizeBytes,
        expectedSha256:
          input.expectedSha256,
      });

    this.objects.set(
      input.key,
      Buffer.from(input.bytes)
    );

    return {
      backend: this.backend,
      key: input.key,
      ...integrity,
      etag:
        'mem-' +
        integrity.sha256.slice(0, 16),
    };
  }

  async get(key: string): Promise<Buffer> {
    const bytes =
      this.objects.get(key);
    if (!bytes) {
      throw new Error(
        'Memory object not found: ' +
          key
      );
    }
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
