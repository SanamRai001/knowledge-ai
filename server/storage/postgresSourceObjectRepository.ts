import { postgresPool } from '../persistence/postgres.js';
import type {
  CreateSourceObject,
  CreateSourceVersion,
  SourceObject,
  SourceObjectRepository,
  SourceVersion,
  SourceVersionRetentionState,
} from './sourceObjectTypes.js';

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
      'PostgreSQL returned an invalid source-object timestamp.'
    );
  }
  return parsed;
}

function objectFromRow(row: any): SourceObject {
  return {
    id: row.id,
    accountId: row.account_id,
    workspaceId: row.workspace_id ?? undefined,
    kind: row.kind,
    origin: row.origin,
    externalConnectionId:
      row.external_connection_id ?? undefined,
    externalId: row.external_id ?? undefined,
    status: row.status,
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
  };
}

function versionFromRow(row: any): SourceVersion {
  return {
    id: row.id,
    accountId: row.account_id,
    sourceObjectId: row.source_object_id,
    externalVersion: row.external_version ?? undefined,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storageBackend: row.storage_backend,
    storageKey: row.storage_key,
    storageEtag: row.storage_etag ?? undefined,
    retentionState: row.retention_state,
    createdAt: epoch(row.created_at),
    retentionUpdatedAt: epoch(
      row.retention_updated_at
    ),
  };
}

function requireSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(
      'Source version SHA-256 must be 64 hexadecimal characters.'
    );
  }
  return normalized;
}

function requireByteSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      'Source version byte size must be a non-negative safe integer.'
    );
  }
  return value;
}

export class PostgresSourceObjectRepository
  implements SourceObjectRepository
{
  async createObject(
    input: CreateSourceObject
  ): Promise<SourceObject> {
    const result = await postgresPool().query(
      `INSERT INTO source_objects
        (id, account_id, workspace_id, kind, origin,
         external_connection_id, external_id, status,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9)
       RETURNING *`,
      [
        input.id,
        input.accountId,
        input.workspaceId ?? null,
        input.kind,
        input.origin,
        input.externalConnectionId ?? null,
        input.externalId ?? null,
        new Date(input.createdAt),
        new Date(input.updatedAt),
      ]
    );
    return objectFromRow(result.rows[0]);
  }

  async getObject(
    accountId: string,
    sourceObjectId: string
  ): Promise<SourceObject | null> {
    const result = await postgresPool().query(
      `SELECT *
       FROM source_objects
       WHERE account_id = $1 AND id = $2`,
      [accountId, sourceObjectId]
    );
    return result.rowCount
      ? objectFromRow(result.rows[0])
      : null;
  }

  async listObjects(
    accountId: string
  ): Promise<SourceObject[]> {
    const result = await postgresPool().query(
      `SELECT *
       FROM source_objects
       WHERE account_id = $1
       ORDER BY updated_at DESC, id ASC`,
      [accountId]
    );
    return result.rows.map(objectFromRow);
  }

  async tombstoneObject(
    accountId: string,
    sourceObjectId: string,
    at = Date.now()
  ): Promise<SourceObject> {
    const result = await postgresPool().query(
      `UPDATE source_objects
       SET status = 'TOMBSTONED',
           updated_at = $3
       WHERE account_id = $1 AND id = $2
       RETURNING *`,
      [
        accountId,
        sourceObjectId,
        new Date(at),
      ]
    );

    if (!result.rowCount) {
      throw new Error(
        'Source object not found in the current account scope.'
      );
    }
    return objectFromRow(result.rows[0]);
  }

  async createVersion(
    input: CreateSourceVersion
  ): Promise<SourceVersion> {
    const sha256 = requireSha256(input.sha256);
    const sizeBytes = requireByteSize(
      input.sizeBytes
    );

    const result = await postgresPool().query(
      `INSERT INTO source_versions
        (id, account_id, source_object_id,
         external_version, original_filename,
         content_type, size_bytes, sha256,
         storage_backend, storage_key, storage_etag,
         retention_state, created_at,
         retention_updated_at)
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
         'ACTIVE',$12,$12
       )
       RETURNING *`,
      [
        input.id,
        input.accountId,
        input.sourceObjectId,
        input.externalVersion ?? null,
        input.originalFilename,
        input.contentType,
        sizeBytes,
        sha256,
        input.storageBackend,
        input.storageKey,
        input.storageEtag ?? null,
        new Date(input.createdAt),
      ]
    );

    return versionFromRow(result.rows[0]);
  }

  async getVersion(
    accountId: string,
    sourceObjectId: string,
    sourceVersionId: string
  ): Promise<SourceVersion | null> {
    const result = await postgresPool().query(
      `SELECT *
       FROM source_versions
       WHERE account_id = $1
         AND source_object_id = $2
         AND id = $3`,
      [
        accountId,
        sourceObjectId,
        sourceVersionId,
      ]
    );

    return result.rowCount
      ? versionFromRow(result.rows[0])
      : null;
  }

  async getVersionForWorkspace(
    accountId: string,
    workspaceId: string,
    sourceVersionId: string
  ): Promise<SourceVersion | null> {
    const result = await postgresPool().query(
      `SELECT sv.*
       FROM source_versions sv
       JOIN source_objects so
         ON so.account_id = sv.account_id
        AND so.id = sv.source_object_id
       WHERE sv.account_id = $1
         AND so.workspace_id = $2
         AND sv.id = $3
         AND so.status = 'ACTIVE'
         AND sv.retention_state = 'ACTIVE'`,
      [
        accountId,
        workspaceId,
        sourceVersionId,
      ]
    );

    return result.rowCount
      ? versionFromRow(result.rows[0])
      : null;
  }

  async listVersions(
    accountId: string,
    sourceObjectId: string
  ): Promise<SourceVersion[]> {
    const result = await postgresPool().query(
      `SELECT *
       FROM source_versions
       WHERE account_id = $1
         AND source_object_id = $2
       ORDER BY created_at DESC, id ASC`,
      [accountId, sourceObjectId]
    );
    return result.rows.map(versionFromRow);
  }

  async setVersionRetentionState(
    accountId: string,
    sourceObjectId: string,
    sourceVersionId: string,
    state: SourceVersionRetentionState,
    at = Date.now()
  ): Promise<SourceVersion> {
    const result = await postgresPool().query(
      `UPDATE source_versions
       SET retention_state = $4,
           retention_updated_at = $5
       WHERE account_id = $1
         AND source_object_id = $2
         AND id = $3
       RETURNING *`,
      [
        accountId,
        sourceObjectId,
        sourceVersionId,
        state,
        new Date(at),
      ]
    );

    if (!result.rowCount) {
      throw new Error(
        'Source version not found in the current account scope.'
      );
    }
    return versionFromRow(result.rows[0]);
  }
}

export const postgresSourceObjectRepository =
  new PostgresSourceObjectRepository();
