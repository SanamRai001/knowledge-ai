import type {
  QueryResult,
  QueryResultRow,
} from 'pg';
import {
  expectedPostgresMigrations,
} from '../../persistence/migrationRunner.js';
import {
  verifySourceIntegrity,
  type SourceByteStorage,
} from '../../storage/sourceByteStorage.js';
import {
  VersionedAesGcmKmsService,
  type AesGcmKeyringConfig,
} from '../../security/versionedAesGcmKmsService.js';
import type {
  RecoverySmokeSummary,
  RecoveryValidationCheck,
} from './recoveryContracts.js';

export interface RecoveryQueryClient {
  query<T extends QueryResultRow = any>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

function pass(
  id: string,
  detail: string
): RecoveryValidationCheck {
  return {
    id,
    status: 'PASS',
    detail,
  };
}

function skip(
  id: string,
  detail: string
): RecoveryValidationCheck {
  return {
    id,
    status: 'SKIP',
    detail,
  };
}

function fail(
  id: string,
  detail: string
): RecoveryValidationCheck {
  return {
    id,
    status: 'FAIL',
    detail,
  };
}

function parseJson(
  bytes: Buffer,
  label: string
): any {
  try {
    return JSON.parse(
      bytes.toString('utf8')
    );
  } catch {
    throw new Error(
      label +
        ' is not valid JSON.'
    );
  }
}

async function verifyStoredBytes(
  storage: SourceByteStorage,
  input: {
    backend: string;
    key: string;
    sizeBytes: number;
    sha256: string;
  }
): Promise<Buffer> {
  if (
    input.backend !==
    storage.backend
  ) {
    throw new Error(
      'Restore object backend does not match relational metadata.'
    );
  }

  const bytes =
    await storage.get(input.key);

  verifySourceIntegrity({
    bytes,
    expectedSizeBytes:
      input.sizeBytes,
    expectedSha256:
      input.sha256,
  });

  return bytes;
}

export interface IsolatedRestoreVerification {
  valid: boolean;
  checks: RecoveryValidationCheck[];
  smoke: RecoverySmokeSummary;
}

export class IsolatedRestoreVerifier {
  constructor(
    private readonly db:
      RecoveryQueryClient,
    private readonly storage:
      SourceByteStorage,
    private readonly keyring:
      AesGcmKeyringConfig
  ) {}

  private async schemaCheck():
    Promise<RecoveryValidationCheck> {
    const expected =
      expectedPostgresMigrations();

    const result =
      await this.db.query<{
        version: string;
        filename: string;
        checksum: string;
      }>(
        `SELECT
           version,
           filename,
           checksum
         FROM schema_migrations
         ORDER BY version`
      );

    const actual =
      new Map(
        result.rows.map(
          (row) => [
            row.version,
            row,
          ]
        )
      );

    for (const migration of expected) {
      const row =
        actual.get(
          migration.version
        );
      if (
        !row ||
        row.filename !==
          migration.filename ||
        row.checksum !==
          migration.checksum
      ) {
        return fail(
          'RESTORE_SCHEMA_COMPATIBLE',
          'SCHEMA_MISMATCH_' +
            migration.version
        );
      }
    }

    return pass(
      'RESTORE_SCHEMA_COMPATIBLE',
      'MIGRATIONS_' +
        String(expected.length)
    );
  }

  private async secretCheck():
    Promise<{
      check: RecoveryValidationCheck;
      secretVersionCount: number;
      keyIds: string[];
    }> {
    const result =
      await this.db.query<{
        account_id: string;
        secret_id: string;
        purpose: string;
        provider: string | null;
        version: number;
        kms_key_id: string;
        kms_algorithm: string;
        ciphertext: string;
      }>(
        `SELECT
           v.account_id,
           v.secret_id,
           s.purpose,
           s.provider,
           v.version,
           v.kms_key_id,
           v.kms_algorithm,
           v.ciphertext
         FROM account_secret_versions v
         JOIN account_secrets s
           ON s.account_id =
                v.account_id
          AND s.id =
                v.secret_id
         ORDER BY
           v.account_id,
           v.secret_id,
           v.version`
      );

    const keyIds =
      Array.from(
        new Set(
          result.rows.map(
            (row) =>
              row.kms_key_id
          )
        )
      ).sort();

    for (const keyId of keyIds) {
      if (!this.keyring.keys[keyId]) {
        return {
          check: fail(
            'RESTORE_SECRET_KMS_HISTORY',
            'KMS_KEY_MISSING_' +
              keyId
          ),
          secretVersionCount:
            result.rowCount || 0,
          keyIds,
        };
      }
    }

    const kms =
      new VersionedAesGcmKmsService(
        () => this.keyring
      );

    try {
      for (const row of result.rows) {
        const plaintext =
          await kms.decrypt({
            envelope: {
              keyId:
                row.kms_key_id,
              algorithm:
                row.kms_algorithm,
              ciphertext:
                row.ciphertext,
            },
            encryptionContext: {
              accountId:
                row.account_id,
              secretId:
                row.secret_id,
              purpose:
                row.purpose,
              provider:
                row.provider || '',
              version:
                String(row.version),
            },
          });

        plaintext.fill(0);
      }
    } catch {
      return {
        check: fail(
          'RESTORE_SECRET_KMS_HISTORY',
          'RESTORED_SECRET_CIPHERTEXT_NOT_DECRYPTABLE'
        ),
        secretVersionCount:
          result.rowCount || 0,
        keyIds,
      };
    }

    return {
      check: pass(
        'RESTORE_SECRET_KMS_HISTORY',
        'SECRET_VERSIONS_' +
          String(
            result.rowCount || 0
          ) +
          '_KEYS_' +
          String(keyIds.length)
      ),
      secretVersionCount:
        result.rowCount || 0,
      keyIds,
    };
  }

  private async workspaceDocumentSmoke():
    Promise<{
      check: RecoveryValidationCheck;
      workspaceId?: string;
      documentCount: number;
      pageCount: number;
    }> {
    const workspace =
      await this.db.query<{
        account_id: string;
        id: string;
      }>(
        `SELECT
           w.account_id,
           w.id
         FROM workspaces w
         WHERE EXISTS (
           SELECT 1
           FROM document_derived_payloads d
           WHERE
             d.account_id =
               w.account_id
             AND d.workspace_id =
               w.id
             AND d.is_current =
               true
         )
         ORDER BY
           w.updated_at DESC,
           w.id
         LIMIT 1`
      );

    if (!workspace.rowCount) {
      return {
        check: skip(
          'RESTORE_WORKSPACE_DOCUMENT_CORPUS',
          'NO_DURABLE_DOCUMENT_CORPUS_PRESENT'
        ),
        documentCount: 0,
        pageCount: 0,
      };
    }

    const scope =
      workspace.rows[0];
    const docs =
      await this.db.query<{
        document_id: string;
        source_version_id: string;
        derivation_version: string;
        payload_backend: string;
        payload_key: string;
        payload_size_bytes:
          number | string;
        payload_sha256: string;
      }>(
        `SELECT
           document_id,
           source_version_id,
           derivation_version,
           payload_backend,
           payload_key,
           payload_size_bytes,
           payload_sha256
         FROM document_derived_payloads
         WHERE account_id = $1
           AND workspace_id = $2
           AND is_current = true
         ORDER BY document_id`,
        [
          scope.account_id,
          scope.id,
        ]
      );

    let pageCount = 0;

    try {
      for (const row of docs.rows) {
        const bytes =
          await verifyStoredBytes(
            this.storage,
            {
              backend:
                row.payload_backend,
              key: row.payload_key,
              sizeBytes: Number(
                row.payload_size_bytes
              ),
              sha256:
                row.payload_sha256,
            }
          );

        const envelope =
          parseJson(
            bytes,
            'Restored document payload'
          );

        if (
          envelope?.schemaVersion !== 1 ||
          envelope?.document?.id !==
            row.document_id ||
          envelope?.document
            ?.sourceVersionId !==
            row.source_version_id ||
          envelope
            ?.derivationVersion !==
            row.derivation_version
        ) {
          throw new Error(
            'Restored document payload identity mismatch.'
          );
        }

        pageCount += Number(
          envelope.document
            ?.pageCount || 0
        );

        const source =
          await this.db.query<{
            storage_backend: string;
            storage_key: string;
            size_bytes:
              number | string;
            sha256: string;
          }>(
            `SELECT
               storage_backend,
               storage_key,
               size_bytes,
               sha256
             FROM source_versions
             WHERE account_id = $1
               AND id = $2
               AND retention_state =
                 'ACTIVE'`,
            [
              scope.account_id,
              row.source_version_id,
            ]
          );

        if (!source.rowCount) {
          throw new Error(
            'Restored document source version is unavailable.'
          );
        }

        await verifyStoredBytes(
          this.storage,
          {
            backend:
              source.rows[0]
                .storage_backend,
            key:
              source.rows[0]
                .storage_key,
            sizeBytes: Number(
              source.rows[0]
                .size_bytes
            ),
            sha256:
              source.rows[0]
                .sha256,
          }
        );
      }
    } catch (error: any) {
      return {
        check: fail(
          'RESTORE_WORKSPACE_DOCUMENT_CORPUS',
          String(
            error?.message ||
              'DOCUMENT_RESTORE_FAILED'
          ).slice(0, 180)
        ),
        workspaceId: scope.id,
        documentCount:
          docs.rowCount || 0,
        pageCount,
      };
    }

    return {
      check: pass(
        'RESTORE_WORKSPACE_DOCUMENT_CORPUS',
        'DOCUMENTS_' +
          String(
            docs.rowCount || 0
          ) +
          '_PAGES_' +
          String(pageCount)
      ),
      workspaceId: scope.id,
      documentCount:
        docs.rowCount || 0,
      pageCount,
    };
  }

  private async datasetSmoke():
    Promise<{
      check: RecoveryValidationCheck;
      datasetId?: string;
      versionCount: number;
      historicalCount: number;
      tableCount: number;
    }> {
    const dataset =
      await this.db.query<{
        account_id: string;
        id: string;
        current_version_id: string;
      }>(
        `SELECT
           d.account_id,
           d.id,
           d.current_version_id
         FROM datasets d
         WHERE d.current_version_id
               IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM dataset_versions v
             WHERE
               v.account_id =
                 d.account_id
               AND v.dataset_id =
                 d.id
               AND v.payload_backend =
                 'durable-dataset-payload'
           )
         ORDER BY
           d.updated_at DESC,
           d.id
         LIMIT 1`
      );

    if (!dataset.rowCount) {
      return {
        check: skip(
          'RESTORE_DATASET_ANALYTICAL_STATE',
          'NO_DURABLE_DATASET_PRESENT'
        ),
        versionCount: 0,
        historicalCount: 0,
        tableCount: 0,
      };
    }

    const scope =
      dataset.rows[0];
    const versions =
      await this.db.query<{
        id: string;
        source_version_id:
          string | null;
        payload_backend: string;
        payload_ref: string;
        payload_storage_backend:
          string | null;
        payload_size_bytes:
          number | string | null;
        payload_sha256:
          string | null;
      }>(
        `SELECT
           id,
           source_version_id,
           payload_backend,
           payload_ref,
           payload_storage_backend,
           payload_size_bytes,
           payload_sha256
         FROM dataset_versions
         WHERE account_id = $1
           AND dataset_id = $2
         ORDER BY
           version_number,
           id`,
        [
          scope.account_id,
          scope.id,
        ]
      );

    let tableCount = 0;

    try {
      for (
        const row of versions.rows
      ) {
        if (
          row.payload_backend !==
            'durable-dataset-payload' ||
          !row.payload_storage_backend ||
          row.payload_size_bytes ===
            null ||
          !row.payload_sha256
        ) {
          throw new Error(
            'Restored DatasetVersion is missing durable analytical payload metadata.'
          );
        }

        const bytes =
          await verifyStoredBytes(
            this.storage,
            {
              backend:
                row
                  .payload_storage_backend,
              key:
                row.payload_ref,
              sizeBytes: Number(
                row.payload_size_bytes
              ),
              sha256:
                row.payload_sha256,
            }
          );

        const envelope =
          parseJson(
            bytes,
            'Restored Dataset payload'
          );

        if (
          envelope?.schemaVersion !== 1 ||
          envelope?.datasetId !==
            scope.id ||
          envelope?.versionId !==
            row.id ||
          !Array.isArray(
            envelope?.tables
          )
        ) {
          throw new Error(
            'Restored Dataset payload identity mismatch.'
          );
        }

        tableCount +=
          envelope.tables.length;

        if (row.source_version_id) {
          const source =
            await this.db.query<{
              storage_backend: string;
              storage_key: string;
              size_bytes:
                number | string;
              sha256: string;
            }>(
              `SELECT
                 storage_backend,
                 storage_key,
                 size_bytes,
                 sha256
               FROM source_versions
               WHERE account_id = $1
                 AND id = $2
                 AND retention_state =
                   'ACTIVE'`,
              [
                scope.account_id,
                row.source_version_id,
              ]
            );

          if (!source.rowCount) {
            throw new Error(
              'Restored Dataset source version is unavailable.'
            );
          }

          await verifyStoredBytes(
            this.storage,
            {
              backend:
                source.rows[0]
                  .storage_backend,
              key:
                source.rows[0]
                  .storage_key,
              sizeBytes: Number(
                source.rows[0]
                  .size_bytes
              ),
              sha256:
                source.rows[0]
                  .sha256,
            }
          );
        }
      }

      if (
        !versions.rows.some(
          (row) =>
            row.id ===
            scope.current_version_id
        )
      ) {
        throw new Error(
          'Restored Dataset current version is missing.'
        );
      }
    } catch (error: any) {
      return {
        check: fail(
          'RESTORE_DATASET_ANALYTICAL_STATE',
          String(
            error?.message ||
              'DATASET_RESTORE_FAILED'
          ).slice(0, 180)
        ),
        datasetId: scope.id,
        versionCount:
          versions.rowCount || 0,
        historicalCount:
          Math.max(
            0,
            (versions.rowCount || 0) -
              1
          ),
        tableCount,
      };
    }

    return {
      check: pass(
        'RESTORE_DATASET_ANALYTICAL_STATE',
        'VERSIONS_' +
          String(
            versions.rowCount || 0
          ) +
          '_HISTORICAL_' +
          String(
            Math.max(
              0,
              (versions.rowCount ||
                0) - 1
            )
          )
      ),
      datasetId: scope.id,
      versionCount:
        versions.rowCount || 0,
      historicalCount:
        Math.max(
          0,
          (versions.rowCount || 0) -
            1
        ),
      tableCount,
    };
  }

  private async workerSmoke():
    Promise<{
      check: RecoveryValidationCheck;
      count: number;
      statusCounts:
        Record<string, number>;
    }> {
    const jobs =
      await this.db.query<{
        status: string;
        attempt_count: number;
        max_attempts: number;
        lease_owner: string | null;
        lease_token: string | null;
        lease_expires_at:
          Date | string | null;
        completed_at:
          Date | string | null;
      }>(
        `SELECT
           status,
           attempt_count,
           max_attempts,
           lease_owner,
           lease_token,
           lease_expires_at,
           completed_at
         FROM worker_jobs
         ORDER BY id`
      );

    const statusCounts:
      Record<string, number> = {};

    for (const row of jobs.rows) {
      statusCounts[row.status] =
        (statusCounts[row.status] ||
          0) + 1;

      if (
        row.status === 'RUNNING' &&
        (
          !row.lease_owner ||
          !row.lease_token ||
          !row.lease_expires_at
        )
      ) {
        return {
          check: fail(
            'RESTORE_WORKER_JOB_STATE',
            'RUNNING_JOB_LEASE_STATE_INVALID'
          ),
          count:
            jobs.rowCount || 0,
          statusCounts,
        };
      }

      if (
        row.status === 'PENDING' &&
        Number(
          row.attempt_count
        ) >=
          Number(
            row.max_attempts
          )
      ) {
        return {
          check: fail(
            'RESTORE_WORKER_JOB_STATE',
            'PENDING_JOB_ATTEMPTS_INVALID'
          ),
          count:
            jobs.rowCount || 0,
          statusCounts,
        };
      }
    }

    return {
      check: pass(
        'RESTORE_WORKER_JOB_STATE',
        'JOBS_' +
          String(
            jobs.rowCount || 0
          ) +
          '_INSPECTED_WITHOUT_EXECUTION'
      ),
      count:
        jobs.rowCount || 0,
      statusCounts,
    };
  }

  async verify():
    Promise<IsolatedRestoreVerification> {
    const schema =
      await this.schemaCheck();
    const secret =
      await this.secretCheck();
    const workspace =
      await this.workspaceDocumentSmoke();
    const dataset =
      await this.datasetSmoke();
    const worker =
      await this.workerSmoke();

    const checks = [
      schema,
      secret.check,
      workspace.check,
      dataset.check,
      worker.check,
    ];

    return {
      valid: checks.every(
        (item) =>
          item.status !== 'FAIL'
      ),
      checks,
      smoke: {
        workspaceId:
          workspace.workspaceId,
        documentCount:
          workspace.documentCount,
        documentPageCount:
          workspace.pageCount,
        datasetId:
          dataset.datasetId,
        datasetVersionCount:
          dataset.versionCount,
        datasetHistoricalVersionCount:
          dataset.historicalCount,
        datasetTableCount:
          dataset.tableCount,
        workerJobCount:
          worker.count,
        workerJobStatusCounts:
          worker.statusCounts,
        secretVersionCount:
          secret.secretVersionCount,
        kmsKeyIdsValidated:
          secret.keyIds,
      },
    };
  }
}
