import crypto from 'crypto';
import {
  integrationRuntimeService,
} from './integrationRuntimeService.js';
import {
  integrationPersistence,
} from './integrationPersistence.js';
import {
  withTransaction,
} from '../persistence/postgres.js';
import {
  enqueueWorkerJobWithClient,
  postgresWorkerJobRepository,
} from '../worker/postgresWorkerJobRepository.js';
import {
  workerJobHandlerRegistry,
  type WorkerJobHandlerRegistry,
} from '../worker/workerJobHandlerRegistry.js';
import {
  WorkerJobHandlerError,
  type WorkerJob,
} from '../worker/workerJobTypes.js';

export const INTEGRATION_SYNC_JOB_TYPE =
  'INTEGRATION_SYNC_V1';

export interface IntegrationSyncJobPayload {
  schemaVersion: 1;
  connectionId: string;
  requestedAt: number;
  requestedBy?: string;
}

export interface IntegrationSyncJobView {
  job: WorkerJob;
  connectionId: string;
  requestedAt: number;
  requestedBy?: string;
  syncRunId?: string;
}

function clean(value: string | undefined):
  string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function randomRequestId(): string {
  return crypto
    .randomBytes(16)
    .toString('hex');
}

function parsePayload(
  job: WorkerJob
): IntegrationSyncJobPayload {
  const payload =
    job.payload as Partial<IntegrationSyncJobPayload>;

  if (
    payload.schemaVersion !== 1 ||
    typeof payload.connectionId !==
      'string' ||
    !payload.connectionId.trim() ||
    typeof payload.requestedAt !==
      'number' ||
    !Number.isFinite(
      payload.requestedAt
    ) ||
    (
      payload.requestedBy !==
        undefined &&
      typeof payload.requestedBy !==
        'string'
    )
  ) {
    throw new WorkerJobHandlerError(
      'Integration sync worker payload is invalid.',
      false
    );
  }

  return {
    schemaVersion: 1,
    connectionId:
      payload.connectionId,
    requestedAt:
      payload.requestedAt,
    requestedBy:
      clean(payload.requestedBy),
  };
}

async function linkForJob(input: {
  accountId: string;
  jobId: string;
}): Promise<{
  connectionId: string;
  requestedAt: number;
  requestedBy?: string;
  syncRunId?: string;
} | null> {
  const { postgresPool } =
    await import(
      '../persistence/postgres.js'
    );
  const result =
    await postgresPool().query(
      `SELECT
         connection_id,
         requested_at,
         requested_by,
         sync_run_id
       FROM integration_sync_worker_jobs
       WHERE account_id = $1
         AND worker_job_id = $2`,
      [
        input.accountId,
        input.jobId,
      ]
    );

  if (!result.rowCount) {
    return null;
  }

  const row = result.rows[0];
  return {
    connectionId:
      row.connection_id,
    requestedAt:
      new Date(
        row.requested_at
      ).getTime(),
    requestedBy:
      row.requested_by ??
      undefined,
    syncRunId:
      row.sync_run_id ??
      undefined,
  };
}

export async function enqueueIntegrationSyncJob(
  input: {
    accountId: string;
    connectionId: string;
    requestId?: string;
    requestedBy?: string;
    requestedAt?: number;
  }
): Promise<IntegrationSyncJobView> {
  const requestId =
    clean(input.requestId) ||
    randomRequestId();
  const requestedAt =
    input.requestedAt ??
    Date.now();

  const result =
    await withTransaction(
      async (client) => {
        const connection =
          await client.query(
            `SELECT status
             FROM integration_connections
             WHERE account_id = $1
               AND id = $2
             FOR UPDATE`,
            [
              input.accountId,
              input.connectionId,
            ]
          );

        if (!connection.rowCount) {
          const error: any =
            new Error(
              'Integration connection not found in the current account scope.'
            );
          error.statusCode = 404;
          error.code =
            'INTEGRATION_CONNECTION_NOT_FOUND';
          throw error;
        }

        if (
          connection.rows[0]
            .status !== 'ACTIVE'
        ) {
          const error: any =
            new Error(
              'Only ACTIVE integration connections can queue synchronization.'
            );
          error.statusCode = 409;
          error.code =
            'CONNECTION_NOT_ACTIVE';
          throw error;
        }

        const active =
          await client.query(
            `SELECT
               l.worker_job_id
             FROM integration_sync_worker_jobs l
             JOIN worker_jobs j
               ON j.account_id =
                    l.account_id
              AND j.id =
                    l.worker_job_id
             WHERE l.account_id = $1
               AND l.connection_id = $2
               AND j.status IN (
                 'PENDING',
                 'RUNNING'
               )
             ORDER BY
               j.created_at ASC,
               j.id ASC
             LIMIT 1`,
            [
              input.accountId,
              input.connectionId,
            ]
          );

        if (active.rowCount) {
          return {
            jobId:
              active.rows[0]
                .worker_job_id,
            coalesced: true,
          };
        }

        const job =
          await enqueueWorkerJobWithClient(
            client,
            {
              accountId:
                input.accountId,
              jobType:
                INTEGRATION_SYNC_JOB_TYPE,
              payload: {
                schemaVersion: 1,
                connectionId:
                  input.connectionId,
                requestedAt,
                requestedBy:
                  clean(
                    input.requestedBy
                  ),
              },
              idempotencyKey:
                'integration-sync:' +
                input.connectionId +
                ':' +
                requestId,
              concurrencyKey:
                'integration:' +
                input.connectionId,
              maxAttempts: 3,
            }
          );

        await client.query(
          `INSERT INTO
             integration_sync_worker_jobs
             (
               account_id,
               connection_id,
               worker_job_id,
               requested_at,
               requested_by,
               created_at,
               updated_at
             )
           VALUES (
             $1,$2,$3,$4,$5,$4,$4
           )
           ON CONFLICT (
             account_id,
             worker_job_id
           )
           DO NOTHING`,
          [
            input.accountId,
            input.connectionId,
            job.id,
            new Date(requestedAt),
            clean(
              input.requestedBy
            ) ?? null,
          ]
        );

        return {
          jobId: job.id,
          coalesced: false,
        };
      }
    );

  const job =
    await postgresWorkerJobRepository
      .get(
        input.accountId,
        result.jobId
      );
  const link =
    await linkForJob({
      accountId:
        input.accountId,
      jobId: result.jobId,
    });

  if (!job || !link) {
    throw new Error(
      'Queued Integration sync job could not be reloaded.'
    );
  }

  return {
    job,
    ...link,
  };
}

export async function getIntegrationSyncJob(
  input: {
    accountId: string;
    connectionId: string;
    jobId: string;
  }
): Promise<IntegrationSyncJobView | null> {
  const job =
    await postgresWorkerJobRepository
      .get(
        input.accountId,
        input.jobId
      );
  if (!job) return null;

  const link =
    await linkForJob({
      accountId:
        input.accountId,
      jobId:
        input.jobId,
    });

  if (
    !link ||
    link.connectionId !==
      input.connectionId
  ) {
    return null;
  }

  return {
    job,
    ...link,
  };
}

async function attachSyncRun(input: {
  accountId: string;
  jobId: string;
  syncRunId: string;
}): Promise<void> {
  const { postgresPool } =
    await import(
      '../persistence/postgres.js'
    );
  await postgresPool().query(
    `UPDATE integration_sync_worker_jobs
     SET sync_run_id = $3,
         updated_at = $4
     WHERE account_id = $1
       AND worker_job_id = $2`,
    [
      input.accountId,
      input.jobId,
      input.syncRunId,
      new Date(),
    ]
  );
}

export async function handleIntegrationSyncJob(
  job: WorkerJob
): Promise<void> {
  const payload =
    parsePayload(job);

  const link =
    await linkForJob({
      accountId:
        job.accountId,
      jobId: job.id,
    });

  if (
    !link ||
    link.connectionId !==
      payload.connectionId
  ) {
    throw new WorkerJobHandlerError(
      'Integration sync worker job is not linked to the expected connection.',
      false
    );
  }

  let run;
  try {
    run =
      await integrationRuntimeService
        .sync({
          accountId:
            job.accountId,
          connectionId:
            payload.connectionId,
        });
  } catch (error: any) {
    throw new WorkerJobHandlerError(
      'Integration sync execution failed before a terminal SyncRun was returned: ' +
        (
          error?.message ||
          'unknown error'
        ),
      true
    );
  }

  await attachSyncRun({
    accountId:
      job.accountId,
    jobId: job.id,
    syncRunId: run.id,
  });

  if (run.status === 'COMPLETED') {
    return;
  }

  throw new WorkerJobHandlerError(
    run.error ||
      'Integration synchronization failed.',
    false
  );
}

export function registerIntegrationSyncWorkerHandler(
  registry:
    WorkerJobHandlerRegistry =
      workerJobHandlerRegistry
): void {
  if (
    registry.has(
      INTEGRATION_SYNC_JOB_TYPE
    )
  ) {
    return;
  }

  registry.register(
    INTEGRATION_SYNC_JOB_TYPE,
    async ({ job }) => {
      await handleIntegrationSyncJob(
        job
      );
    }
  );
}

export async function integrationSyncJobRun(
  input: {
    accountId: string;
    syncRunId?: string;
  }
) {
  if (!input.syncRunId) {
    return null;
  }
  return integrationPersistence
    .listSyncRuns({
      accountId:
        input.accountId,
      limit: 500,
    })
    .then(
      (runs) =>
        runs.find(
          (run) =>
            run.id ===
            input.syncRunId
        ) || null
    );
}
