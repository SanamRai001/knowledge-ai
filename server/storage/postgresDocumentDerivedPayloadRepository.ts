import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import type {
  DocumentDerivedPayloadRecord,
  DocumentDerivedPayloadRepository,
  UpsertDocumentDerivedPayload,
} from './documentDerivedPayloadTypes.js';

function epoch(
  value: Date | string | number
): number {
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(
      'PostgreSQL returned an invalid document payload timestamp.'
    );
  }
  return parsed;
}

function rowToRecord(
  row: any
): DocumentDerivedPayloadRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    documentId: row.document_id,
    sourceVersionId: row.source_version_id,
    derivationVersion:
      row.derivation_version,
    filename: row.filename,
    contentType: row.content_type,
    sourceSizeBytes: Number(
      row.source_size_bytes
    ),
    processingStatus:
      row.processing_status,
    errorMessage:
      row.error_message ?? undefined,
    pageCount: Number(row.page_count),
    payloadBackend:
      row.payload_backend,
    payloadKey: row.payload_key,
    payloadSizeBytes: Number(
      row.payload_size_bytes
    ),
    payloadSha256:
      row.payload_sha256,
    isCurrent: Boolean(
      row.is_current
    ),
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
  };
}

function sha(value: string): string {
  const normalized =
    value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(
      'Derived payload SHA-256 must be 64 hexadecimal characters.'
    );
  }
  return normalized;
}

export class PostgresDocumentDerivedPayloadRepository
  implements DocumentDerivedPayloadRepository
{
  async upsert(
    input: UpsertDocumentDerivedPayload
  ): Promise<DocumentDerivedPayloadRecord> {
    const result =
      await postgresPool().query(
        `INSERT INTO document_derived_payloads
          (id, account_id, workspace_id,
           document_id, source_version_id,
           derivation_version, filename,
           content_type, source_size_bytes,
           processing_status, error_message,
           page_count, payload_backend,
           payload_key, payload_size_bytes,
           payload_sha256, is_current,
           created_at, updated_at)
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,
           $10,$11,$12,$13,$14,$15,$16,
           $17,$18,$19
         )
         ON CONFLICT (
           account_id,
           workspace_id,
           document_id,
           source_version_id,
           derivation_version
         )
         DO UPDATE SET
           filename = EXCLUDED.filename,
           content_type = EXCLUDED.content_type,
           source_size_bytes = EXCLUDED.source_size_bytes,
           processing_status = EXCLUDED.processing_status,
           error_message = EXCLUDED.error_message,
           page_count = EXCLUDED.page_count,
           payload_backend = EXCLUDED.payload_backend,
           payload_key = EXCLUDED.payload_key,
           payload_size_bytes = EXCLUDED.payload_size_bytes,
           payload_sha256 = EXCLUDED.payload_sha256,
           is_current = EXCLUDED.is_current,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          input.id,
          input.accountId,
          input.workspaceId,
          input.documentId,
          input.sourceVersionId,
          input.derivationVersion,
          input.filename,
          input.contentType,
          input.sourceSizeBytes,
          input.processingStatus,
          input.errorMessage ?? null,
          input.pageCount,
          input.payloadBackend,
          input.payloadKey,
          input.payloadSizeBytes,
          sha(input.payloadSha256),
          input.isCurrent ?? true,
          new Date(input.createdAt),
          new Date(input.updatedAt),
        ]
      );

    return rowToRecord(
      result.rows[0]
    );
  }

  async getById(
    accountId: string,
    workspaceId: string,
    payloadId: string
  ): Promise<DocumentDerivedPayloadRecord | null> {
    const result =
      await postgresPool().query(
        `SELECT *
         FROM document_derived_payloads
         WHERE account_id = $1
           AND workspace_id = $2
           AND id = $3`,
        [
          accountId,
          workspaceId,
          payloadId,
        ]
      );
    return result.rowCount
      ? rowToRecord(result.rows[0])
      : null;
  }

  async getCurrentForDocument(
    accountId: string,
    workspaceId: string,
    documentId: string
  ): Promise<DocumentDerivedPayloadRecord | null> {
    const result =
      await postgresPool().query(
        `SELECT *
         FROM document_derived_payloads
         WHERE account_id = $1
           AND workspace_id = $2
           AND document_id = $3
           AND is_current = true
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [
          accountId,
          workspaceId,
          documentId,
        ]
      );
    return result.rowCount
      ? rowToRecord(result.rows[0])
      : null;
  }

  async listCurrentForWorkspace(
    accountId: string,
    workspaceId: string
  ): Promise<DocumentDerivedPayloadRecord[]> {
    const result =
      await postgresPool().query(
        `SELECT *
         FROM document_derived_payloads
         WHERE account_id = $1
           AND workspace_id = $2
           AND is_current = true
         ORDER BY created_at ASC, document_id ASC`,
        [accountId, workspaceId]
      );

    return result.rows.map(
      rowToRecord
    );
  }

  async hasAnyForWorkspace(
    accountId: string,
    workspaceId: string
  ): Promise<boolean> {
    const result =
      await postgresPool().query(
        `SELECT 1
         FROM document_derived_payloads
         WHERE account_id = $1
           AND workspace_id = $2
         LIMIT 1`,
        [accountId, workspaceId]
      );
    return Boolean(result.rowCount);
  }

  async countCurrentForWorkspace(
    accountId: string,
    workspaceId: string
  ): Promise<number> {
    const result =
      await postgresPool().query(
        `SELECT count(*)::int AS count
         FROM document_derived_payloads
         WHERE account_id = $1
           AND workspace_id = $2
           AND is_current = true`,
        [accountId, workspaceId]
      );
    return Number(
      result.rows[0]?.count || 0
    );
  }

  async markDocumentInactive(
    accountId: string,
    workspaceId: string,
    documentId: string,
    at = Date.now()
  ): Promise<void> {
    await postgresPool().query(
      `UPDATE document_derived_payloads
       SET is_current = false,
           updated_at = $4
       WHERE account_id = $1
         AND workspace_id = $2
         AND document_id = $3
         AND is_current = true`,
      [
        accountId,
        workspaceId,
        documentId,
        new Date(at),
      ]
    );
  }

  async setCurrentDocumentRefs(
    accountId: string,
    workspaceId: string,
    payloadIds: string[],
    at = Date.now()
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE document_derived_payloads
           SET is_current = false,
               updated_at = $3
           WHERE account_id = $1
             AND workspace_id = $2
             AND is_current = true`,
          [
            accountId,
            workspaceId,
            new Date(at),
          ]
        );

        if (payloadIds.length === 0) {
          return;
        }

        const updated =
          await client.query(
            `UPDATE document_derived_payloads
             SET is_current = true,
                 updated_at = $4
             WHERE account_id = $1
               AND workspace_id = $2
               AND id = ANY($3::text[])`,
            [
              accountId,
              workspaceId,
              payloadIds,
              new Date(at),
            ]
          );

        if (
          updated.rowCount !==
          payloadIds.length
        ) {
          throw new Error(
            'One or more derived document payload references are outside the current account/workspace scope.'
          );
        }
      }
    );
  }
}

export const postgresDocumentDerivedPayloadRepository =
  new PostgresDocumentDerivedPayloadRepository();
