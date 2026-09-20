import type { PoolClient } from 'pg';
import type {
  ApiKey,
  ApiUsage,
  ApiUsageStats,
} from '../../src/types.js';
import {
  postgresPool,
  withTransaction,
} from './postgres.js';
import type {
  AccountRecord,
  AccountRepository,
  ApiKeyRepository,
  ApiUsageRepository,
  CreateWorkspaceMetadata,
  DatasetImportRunMetadata,
  DatasetMetadata,
  DatasetMetadataRepository,
  DatasetVersionMetadata,
  WorkspaceMetadata,
  WorkspaceMetadataPatch,
  WorkspaceMetadataRepository,
} from './types.js';

function epoch(value: Date | string | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error('PostgreSQL returned an invalid timestamp.');
  }
  return parsed;
}

function date(value: number | null | undefined): Date | null {
  return value === null || value === undefined
    ? null
    : new Date(value);
}

function workspaceFromRow(row: any): WorkspaceMetadata {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    description: row.description ?? undefined,
    processingStatus: row.processing_status,
    currentVersionTag: row.current_version_tag,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function apiKeyFromRow(row: any): ApiKey {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    maskedKey: row.masked_key,
    environment: row.environment,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    status: row.status,
    createdAt: epoch(row.created_at)!,
    lastUsedAt: epoch(row.last_used_at),
    expiresAt: epoch(row.expires_at),
  };
}

function datasetFromRow(row: any): DatasetMetadata {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    description: row.description ?? undefined,
    currentVersionId: row.current_version_id ?? undefined,
    createdAt: epoch(row.created_at)!,
    updatedAt: epoch(row.updated_at)!,
  };
}

function versionFromRow(row: any): DatasetVersionMetadata {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    versionNumber: row.version_number,
    createdAt: epoch(row.created_at)!,
    source: {
      filename: row.source_filename,
      mimeType: row.source_mime_type,
      sizeBytes: Number(row.source_size_bytes),
      sha256: row.source_sha256,
      format: row.source_format,
    },
    importRunId: row.import_run_id,
    payload: {
      backend: row.payload_backend,
      ref: row.payload_ref,
    },
  };
}

async function requireOwnedWorkspace(
  client: PoolClient,
  accountId: string,
  workspaceId: string
): Promise<void> {
  const result = await client.query(
    'SELECT 1 FROM workspaces WHERE account_id = $1 AND id = $2',
    [accountId, workspaceId]
  );
  if (!result.rowCount) {
    throw new Error(
      'Workspace not found in the current account scope.'
    );
  }
}

export class PostgresAccountRepository
  implements AccountRepository
{
  async ensureAccount(accountId: string): Promise<AccountRecord> {
    const now = new Date();
    const result = await postgresPool().query(
      `INSERT INTO accounts (id, created_at, updated_at)
       VALUES ($1, $2, $2)
       ON CONFLICT (id)
       DO UPDATE SET updated_at = accounts.updated_at
       RETURNING id, created_at, updated_at`,
      [accountId, now]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      createdAt: epoch(row.created_at)!,
      updatedAt: epoch(row.updated_at)!,
    };
  }

  async getAccount(
    accountId: string
  ): Promise<AccountRecord | null> {
    const result = await postgresPool().query(
      'SELECT id, created_at, updated_at FROM accounts WHERE id = $1',
      [accountId]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      createdAt: epoch(row.created_at)!,
      updatedAt: epoch(row.updated_at)!,
    };
  }
}

export class PostgresWorkspaceMetadataRepository
  implements WorkspaceMetadataRepository
{
  async list(accountId: string): Promise<WorkspaceMetadata[]> {
    const result = await postgresPool().query(
      `SELECT *
       FROM workspaces
       WHERE account_id = $1
       ORDER BY updated_at DESC, id ASC`,
      [accountId]
    );
    return result.rows.map(workspaceFromRow);
  }

  async get(
    accountId: string,
    workspaceId: string
  ): Promise<WorkspaceMetadata | null> {
    const result = await postgresPool().query(
      `SELECT *
       FROM workspaces
       WHERE account_id = $1 AND id = $2`,
      [accountId, workspaceId]
    );
    return result.rowCount
      ? workspaceFromRow(result.rows[0])
      : null;
  }

  async create(
    input: CreateWorkspaceMetadata
  ): Promise<WorkspaceMetadata> {
    const result = await postgresPool().query(
      `INSERT INTO workspaces
        (id, account_id, name, description, processing_status,
         current_version_tag, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.id,
        input.accountId,
        input.name,
        input.description ?? null,
        input.processingStatus,
        input.currentVersionTag,
        new Date(input.createdAt),
        new Date(input.updatedAt),
      ]
    );
    return workspaceFromRow(result.rows[0]);
  }

  async update(
    accountId: string,
    workspaceId: string,
    patch: WorkspaceMetadataPatch
  ): Promise<WorkspaceMetadata> {
    const current = await this.get(accountId, workspaceId);
    if (!current) {
      throw new Error(
        'Workspace not found in the current account scope.'
      );
    }

    const next = {
      name: patch.name ?? current.name,
      description:
        patch.description !== undefined
          ? patch.description
          : current.description,
      processingStatus:
        patch.processingStatus ?? current.processingStatus,
      currentVersionTag:
        patch.currentVersionTag ?? current.currentVersionTag,
      updatedAt: patch.updatedAt ?? Date.now(),
    };

    const result = await postgresPool().query(
      `UPDATE workspaces
       SET name = $3,
           description = $4,
           processing_status = $5,
           current_version_tag = $6,
           updated_at = $7
       WHERE account_id = $1 AND id = $2
       RETURNING *`,
      [
        accountId,
        workspaceId,
        next.name,
        next.description ?? null,
        next.processingStatus,
        next.currentVersionTag,
        new Date(next.updatedAt),
      ]
    );
    return workspaceFromRow(result.rows[0]);
  }

  async delete(
    accountId: string,
    workspaceId: string
  ): Promise<void> {
    await withTransaction(async (client) => {
      await requireOwnedWorkspace(client, accountId, workspaceId);
      const active = await client.query(
        `SELECT active_workspace_id
         FROM account_workspace_state
         WHERE account_id = $1
         FOR UPDATE`,
        [accountId]
      );

      if (
        active.rowCount &&
        active.rows[0].active_workspace_id === workspaceId
      ) {
        const replacement = await client.query(
          `SELECT id FROM workspaces
           WHERE account_id = $1 AND id <> $2
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
          [accountId, workspaceId]
        );
        await client.query(
          `UPDATE account_workspace_state
           SET active_workspace_id = $2, updated_at = now()
           WHERE account_id = $1`,
          [
            accountId,
            replacement.rowCount
              ? replacement.rows[0].id
              : null,
          ]
        );
      }

      await client.query(
        'DELETE FROM workspaces WHERE account_id = $1 AND id = $2',
        [accountId, workspaceId]
      );
    });
  }

  async getActive(accountId: string): Promise<string | null> {
    const result = await postgresPool().query(
      `SELECT active_workspace_id
       FROM account_workspace_state
       WHERE account_id = $1`,
      [accountId]
    );
    return result.rowCount
      ? result.rows[0].active_workspace_id ?? null
      : null;
  }

  async setActive(
    accountId: string,
    workspaceId: string
  ): Promise<void> {
    await withTransaction(async (client) => {
      await requireOwnedWorkspace(client, accountId, workspaceId);
      await client.query(
        `INSERT INTO account_workspace_state
          (account_id, active_workspace_id, updated_at)
         VALUES ($1,$2,now())
         ON CONFLICT (account_id)
         DO UPDATE SET
           active_workspace_id = EXCLUDED.active_workspace_id,
           updated_at = EXCLUDED.updated_at`,
        [accountId, workspaceId]
      );
    });
  }
}

export class PostgresApiKeyRepository
  implements ApiKeyRepository
{
  async create(record: ApiKey): Promise<void> {
    await postgresPool().query(
      `INSERT INTO api_keys
        (id, account_id, name, key_prefix, key_hash, masked_key,
         environment, scopes, status, created_at, last_used_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        record.id,
        record.accountId,
        record.name,
        record.keyPrefix,
        record.keyHash,
        record.maskedKey,
        record.environment,
        record.scopes,
        record.status,
        new Date(record.createdAt),
        date(record.lastUsedAt),
        date(record.expiresAt),
      ]
    );
  }

  async findByHash(keyHash: string): Promise<ApiKey | null> {
    const result = await postgresPool().query(
      'SELECT * FROM api_keys WHERE key_hash = $1',
      [keyHash]
    );
    return result.rowCount
      ? apiKeyFromRow(result.rows[0])
      : null;
  }

  async get(
    accountId: string,
    keyId: string
  ): Promise<ApiKey | null> {
    const result = await postgresPool().query(
      `SELECT * FROM api_keys
       WHERE account_id = $1 AND id = $2`,
      [accountId, keyId]
    );
    return result.rowCount
      ? apiKeyFromRow(result.rows[0])
      : null;
  }

  async listAll(): Promise<ApiKey[]> {
    const result = await postgresPool().query(
      `SELECT * FROM api_keys
       ORDER BY created_at DESC, id ASC`
    );
    return result.rows.map(apiKeyFromRow);
  }

  async list(accountId: string): Promise<ApiKey[]> {
    const result = await postgresPool().query(
      `SELECT * FROM api_keys
       WHERE account_id = $1
       ORDER BY created_at DESC, id ASC`,
      [accountId]
    );
    return result.rows.map(apiKeyFromRow);
  }

  async revoke(
    accountId: string,
    keyId: string
  ): Promise<boolean> {
    const result = await postgresPool().query(
      `UPDATE api_keys
       SET status = 'revoked'
       WHERE account_id = $1 AND id = $2 AND status <> 'revoked'`,
      [accountId, keyId]
    );
    return Boolean(result.rowCount);
  }

  async touchLastUsed(keyId: string, at: number): Promise<void> {
    await postgresPool().query(
      'UPDATE api_keys SET last_used_at = $2 WHERE id = $1',
      [keyId, new Date(at)]
    );
  }
}

export class PostgresApiUsageRepository
  implements ApiUsageRepository
{
  async record(entry: ApiUsage): Promise<void> {
    await postgresPool().query(
      `INSERT INTO api_usage
        (id, request_id, api_key_id, account_id, ai_id, endpoint,
         occurred_at, status, latency_ms, refused, grounded, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.id,
        entry.requestId,
        entry.apiKeyId || null,
        entry.accountId,
        entry.aiId,
        entry.endpoint,
        new Date(entry.timestamp),
        entry.status,
        entry.latencyMs,
        entry.refused,
        entry.grounded,
        entry.errorCode ?? null,
      ]
    );
  }

  async stats(
    accountId: string,
    limit = 50
  ): Promise<ApiUsageStats> {
    const [aggregate, recent] = await Promise.all([
      postgresPool().query(
        `SELECT
           count(*)::int AS total_requests,
           count(*) FILTER (WHERE status >= 200 AND status < 300)::int AS successful_requests,
           count(*) FILTER (WHERE refused)::int AS refused_requests,
           count(*) FILTER (WHERE status >= 400)::int AS error_requests,
           COALESCE(round(avg(latency_ms)),0)::int AS average_latency_ms
         FROM api_usage
         WHERE account_id = $1`,
        [accountId]
      ),
      postgresPool().query(
        `SELECT *
         FROM api_usage
         WHERE account_id = $1
         ORDER BY occurred_at DESC, id DESC
         LIMIT $2`,
        [accountId, Math.max(1, Math.min(limit, 500))]
      ),
    ]);

    const summary = aggregate.rows[0];
    const recentLogs: ApiUsage[] = recent.rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      apiKeyId: row.api_key_id || '',
      accountId: row.account_id,
      aiId: row.ai_id,
      endpoint: row.endpoint,
      timestamp: epoch(row.occurred_at)!,
      status: row.status,
      latencyMs: row.latency_ms,
      refused: row.refused,
      grounded: row.grounded,
      errorCode: row.error_code ?? undefined,
    }));

    return {
      totalRequests: summary.total_requests,
      successfulRequests: summary.successful_requests,
      refusedRequests: summary.refused_requests,
      errorRequests: summary.error_requests,
      averageLatencyMs: summary.average_latency_ms,
      recentLogs,
    };
  }
}

export class PostgresDatasetMetadataRepository
  implements DatasetMetadataRepository
{
  async list(accountId: string): Promise<DatasetMetadata[]> {
    const result = await postgresPool().query(
      `SELECT * FROM datasets
       WHERE account_id = $1
       ORDER BY updated_at DESC, id ASC`,
      [accountId]
    );
    return result.rows.map(datasetFromRow);
  }

  async get(
    accountId: string,
    datasetId: string
  ): Promise<DatasetMetadata | null> {
    const result = await postgresPool().query(
      `SELECT * FROM datasets
       WHERE account_id = $1 AND id = $2`,
      [accountId, datasetId]
    );
    return result.rowCount
      ? datasetFromRow(result.rows[0])
      : null;
  }

  async create(dataset: DatasetMetadata): Promise<void> {
    await postgresPool().query(
      `INSERT INTO datasets
        (id, account_id, name, description, current_version_id,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$6)`,
      [
        dataset.id,
        dataset.accountId,
        dataset.name,
        dataset.description ?? null,
        new Date(dataset.createdAt),
        new Date(dataset.updatedAt),
      ]
    );
  }

  async updateCurrentVersion(
    accountId: string,
    datasetId: string,
    versionId: string
  ): Promise<void> {
    const result = await postgresPool().query(
      `UPDATE datasets
       SET current_version_id = $3, updated_at = now()
       WHERE account_id = $1 AND id = $2`,
      [accountId, datasetId, versionId]
    );
    if (!result.rowCount) {
      throw new Error(
        'Dataset not found in the current account scope.'
      );
    }
  }

  async appendVersionMetadata(
    accountId: string,
    version: DatasetVersionMetadata
  ): Promise<void> {
    const dataset = await this.get(accountId, version.datasetId);
    if (!dataset) {
      throw new Error(
        'Dataset not found in the current account scope.'
      );
    }

    await postgresPool().query(
      `INSERT INTO dataset_versions
        (id, account_id, dataset_id, version_number, created_at,
         source_filename, source_mime_type, source_size_bytes,
         source_sha256, source_format, import_run_id,
         payload_backend, payload_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        version.id,
        accountId,
        version.datasetId,
        version.versionNumber,
        new Date(version.createdAt),
        version.source.filename,
        version.source.mimeType,
        version.source.sizeBytes,
        version.source.sha256,
        version.source.format,
        version.importRunId,
        version.payload.backend,
        version.payload.ref,
      ]
    );
  }

  async getVersionMetadata(
    accountId: string,
    datasetId: string,
    versionId: string
  ): Promise<DatasetVersionMetadata | null> {
    const result = await postgresPool().query(
      `SELECT version.*
       FROM dataset_versions version
       JOIN datasets dataset
         ON dataset.account_id = version.account_id
        AND dataset.id = version.dataset_id
       WHERE version.account_id = $1
         AND dataset.id = $2
         AND version.id = $3`,
      [accountId, datasetId, versionId]
    );
    return result.rowCount
      ? versionFromRow(result.rows[0])
      : null;
  }

  async listVersions(
    accountId: string,
    datasetId: string
  ): Promise<DatasetVersionMetadata[]> {
    const result = await postgresPool().query(
      `SELECT version.*
       FROM dataset_versions version
       JOIN datasets dataset
         ON dataset.account_id = version.account_id
        AND dataset.id = version.dataset_id
       WHERE version.account_id = $1
         AND dataset.id = $2
       ORDER BY version.version_number ASC`,
      [accountId, datasetId]
    );
    return result.rows.map(versionFromRow);
  }

  async recordImportRun(
    run: DatasetImportRunMetadata
  ): Promise<void> {
    await postgresPool().query(
      `INSERT INTO dataset_import_runs
        (id, account_id, status, created_at, completed_at,
         filename, format, warnings, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        run.id,
        run.accountId,
        run.status,
        new Date(run.createdAt),
        date(run.completedAt),
        run.filename,
        run.format,
        JSON.stringify(run.warnings),
        run.error ?? null,
      ]
    );
  }
}

export const postgresAccountRepository =
  new PostgresAccountRepository();
export const postgresWorkspaceMetadataRepository =
  new PostgresWorkspaceMetadataRepository();
export const postgresApiKeyRepository =
  new PostgresApiKeyRepository();
export const postgresApiUsageRepository =
  new PostgresApiUsageRepository();
export const postgresDatasetMetadataRepository =
  new PostgresDatasetMetadataRepository();
