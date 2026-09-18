import {
  ExternalChangePage,
  ExternalRecord,
  ExternalSourceRef,
  IntegrationCapabilities,
  IntegrationConnector,
  IntegrationConnectorContext,
} from '../types.js';

type TestFixture = {
  ref: ExternalSourceRef;
  buffer: Buffer;
  failFetch?: boolean;
};

const PAGE_SIZE = 100;

export class TestIntegrationConnector
  implements IntegrationConnector
{
  public readonly provider = 'TEST' as const;

  private fixtures = new Map<string, TestFixture[]>();
  private invalidConnections = new Set<string>();

  public capabilities(): IntegrationCapabilities {
    return {
      incrementalSync: true,
      deletions: true,
      supportedMimeTypes: [
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/pdf',
      ],
      supportedResourceKinds: [
        'FILE',
        'SPREADSHEET',
        'DOCUMENT',
      ],
    };
  }

  public configureConnection(params: {
    connectionId: string;
    fixtures?: Array<{
      externalId: string;
      externalVersion: string;
      name: string;
      mimeType: string;
      resourceKind?: ExternalSourceRef['resourceKind'];
      content?: string | Buffer;
      modifiedAt?: number;
      deleted?: boolean;
      webUrl?: string;
      failFetch?: boolean;
    }>;
  }): void {
    this.fixtures.set(
      params.connectionId,
      (params.fixtures || []).map((fixture) => ({
        ref: {
          provider: 'TEST',
          connectionId: params.connectionId,
          externalId: fixture.externalId,
          externalVersion: fixture.externalVersion,
          resourceKind: fixture.resourceKind || 'FILE',
          name: fixture.name,
          mimeType: fixture.mimeType,
          modifiedAt: fixture.modifiedAt,
          deleted: fixture.deleted,
          webUrl: fixture.webUrl,
        },
        buffer: Buffer.isBuffer(fixture.content)
          ? Buffer.from(fixture.content)
          : Buffer.from(fixture.content || '', 'utf8'),
        failFetch: fixture.failFetch,
      }))
    );
  }

  public appendFixture(params: {
    connectionId: string;
    externalId: string;
    externalVersion: string;
    name: string;
    mimeType: string;
    resourceKind?: ExternalSourceRef['resourceKind'];
    content?: string | Buffer;
    modifiedAt?: number;
    deleted?: boolean;
    webUrl?: string;
    failFetch?: boolean;
  }): void {
    const existing = this.fixtures.get(params.connectionId) || [];
    existing.push({
      ref: {
        provider: 'TEST',
        connectionId: params.connectionId,
        externalId: params.externalId,
        externalVersion: params.externalVersion,
        resourceKind: params.resourceKind || 'FILE',
        name: params.name,
        mimeType: params.mimeType,
        modifiedAt: params.modifiedAt,
        deleted: params.deleted,
        webUrl: params.webUrl,
      },
      buffer: Buffer.isBuffer(params.content)
        ? Buffer.from(params.content)
        : Buffer.from(params.content || '', 'utf8'),
      failFetch: params.failFetch,
    });
    this.fixtures.set(params.connectionId, existing);
  }

  public setFetchFailure(params: {
    connectionId: string;
    externalId: string;
    externalVersion: string;
    failFetch: boolean;
  }): void {
    const fixture = (this.fixtures.get(params.connectionId) || []).find(
      (item) =>
        item.ref.externalId === params.externalId &&
        item.ref.externalVersion === params.externalVersion
    );
    if (fixture) fixture.failFetch = params.failFetch;
  }

  public setConnectionValid(
    connectionId: string,
    valid: boolean
  ): void {
    if (valid) this.invalidConnections.delete(connectionId);
    else this.invalidConnections.add(connectionId);
  }

  public async validateConnection(
    context: IntegrationConnectorContext
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.invalidConnections.has(context.connection.id)) {
      return {
        ok: false,
        error: 'Test connector marked this connection invalid.',
      };
    }
    return { ok: true };
  }

  public async listChanges(
    context: IntegrationConnectorContext,
    params: { cursor?: string }
  ): Promise<ExternalChangePage> {
    const fixtures = this.fixtures.get(context.connection.id) || [];
    const parsedCursor = Number(params.cursor || '0');
    const start =
      Number.isInteger(parsedCursor) && parsedCursor >= 0
        ? parsedCursor
        : 0;
    const page = fixtures.slice(start, start + PAGE_SIZE);

    return {
      records: page.map((fixture) => structuredClone(fixture.ref)),
      nextCursor: String(start + page.length),
    };
  }

  public async fetchRecord(
    context: IntegrationConnectorContext,
    ref: ExternalSourceRef
  ): Promise<ExternalRecord> {
    const fixture = (this.fixtures.get(context.connection.id) || []).find(
      (item) =>
        item.ref.externalId === ref.externalId &&
        item.ref.externalVersion === ref.externalVersion
    );

    if (!fixture) {
      throw new Error(
        'Test external record was not found: ' +
          ref.externalId +
          '@' +
          ref.externalVersion
      );
    }
    if (fixture.failFetch) {
      throw new Error(
        'Simulated connector fetch failure for ' +
          ref.externalId +
          '@' +
          ref.externalVersion
      );
    }

    return {
      ref: structuredClone(fixture.ref),
      buffer: Buffer.from(fixture.buffer),
    };
  }

  public async healthCheck(
    context: IntegrationConnectorContext
  ): Promise<{ ok: boolean; message?: string }> {
    const validation = await this.validateConnection(context);
    return validation.ok
      ? { ok: true }
      : { ok: false, message: validation.error };
  }
}

export const testIntegrationConnector =
  new TestIntegrationConnector();
