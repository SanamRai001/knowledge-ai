import crypto from 'crypto';
import {
  integrationRuntimeService,
} from './integrationRuntimeService.js';
import {
  integrationPersistence,
} from './integrationPersistence.js';
import {
  classifyIntegrationFailure,
} from './integrationFailure.js';
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
  WorkerJobLeaseError,
  type WorkerJob,
  type WorkerJobStatus,
} from '../worker/workerJobTypes.js';
import type {
  SyncRun,
} from './types.js';

export const INTEGRATION_SYNC_JOB_TYPE =
  'INTEGRATION_SYNC_V1';

export interface IntegrationSyncJobPayload {
  schemaVersion: 1;
  connectionId: string;
  requestedAt: number;
  requestedBy?: string;
  cursorBefore?: string;
  lastSuccessfulSyncAtBefore?: number;
  connectionUpdatedAtBefore: number;
}

export interface IntegrationSyncJobView {
  id: string;
  connectionId: string;
  status: WorkerJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  startedAt?: number;
  completedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  requestedAt: number;
  requestedBy?: string;
  syncRunId?: string;
}

type Heartbeat =
  | ((
      leaseMs?: number
    ) => Promise<WorkerJob>)
  | undefined;

function clean(
  value: string | undefined
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function epoch(
  value:
    | Date
    | string
    | number
    | null
    | undefined
): number | undefined {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(
      'Integration sync worker received an invalid timestamp.'
    );
  }
  return parsed;
}

function stableHash(
  parts: unknown[]
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 24);
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
    typeof payload.connectionUpdatedAtBefore !==
      'number' ||
    !Number.isFinite(
      payload.connectionUpdatedAtBefore
    ) ||
    (
      payload.requestedBy !==
        undefined &&
      typeof payload.requestedBy !==
        'string'
    ) ||
    (
      payload.cursorBefore !==
        undefined &&
      typeof payload.cursorBefore !==
        'string'
    ) ||
    (
      payload.lastSuccessfulSyncAtBefore !==
        undefined &&
      (
        typeof payload.lastSuccessfulSyncAtBefore !==
          'number' ||
        !Number.isFinite(
          payload.lastSuccessfulSyncAtBefore
        )
      )
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
      payload.connectionId.trim(),
    requestedAt:
      payload.requestedAt,
    requestedBy:
      clean(payload.requestedBy),
    cursorBefore:
      clean(payload.cursorBefore),
    lastSuccessfulSyncAtBefore:
      payload.lastSuccessfulSyncAtBefore,
    connectionUpdatedAtBefore:
      payload.connectionUpdatedAtBefore,
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
      epoch(row.requested_at)!,
    requestedBy:
      row.requested_by ??
      undefined,
    syncRunId:
      row.sync_run_id ??
      undefined,
  };
}

function jobView(
  job: WorkerJob,
  link: NonNullable<
    Awaited<
      ReturnType<
        typeof linkForJob
      >
    >
  >
): IntegrationSyncJobView {
  return {
    id: job.id,
    connectionId:
      link.connectionId,
    status: job.status,
    attemptCount:
      job.attemptCount,
    maxAttempts:
      job.maxAttempts,
    nextAttemptAt:
      job.nextAttemptAt,
    startedAt:
      job.startedAt,
    completedAt:
      job.completedAt,
    lastError:
      job.lastError,
    createdAt:
      job.createdAt,
    updatedAt:
      job.updatedAt,
    requestedAt:
      link.requestedAt,
    requestedBy:
      link.requestedBy,
    syncRunId:
      link.syncRunId,
  };
}

export async function enqueueIntegrationSyncJob(
  input: {
    accountId: string;
    connectionId: string;
    requestedBy?: string;
    requestedAt?: number;
  }
): Promise<IntegrationSyncJobView> {
  const requestedAt =
    input.requestedAt ??
    Date.now();

  const result =
    await withTransaction(
      async (client) => {
        const connection =
          await client.query(
            `SELECT
               status,
               cursor,
               last_successful_sync_at,
               updated_at
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

        const row =
          connection.rows[0];

        if (
          row.status !== 'ACTIVE'
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
          };
        }

        const cursorBefore =
          row.cursor ?? undefined;
        const lastSuccessfulSyncAtBefore =
          epoch(
            row.last_successful_sync_at
          );
        const connectionUpdatedAtBefore =
          epoch(
            row.updated_at
          )!;

        const baselineKey =
          stableHash([
            input.accountId,
            input.connectionId,
            cursorBefore ?? null,
            lastSuccessfulSyncAtBefore ??
              null,
            connectionUpdatedAtBefore,
          ]);

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
                cursorBefore,
                lastSuccessfulSyncAtBefore,
                connectionUpdatedAtBefore,
              },
              idempotencyKey:
                'integration-sync:' +
                input.connectionId +
                ':' +
                baselineKey,
              concurrencyKey:
                'integration:' +
                input.connectionId,
              maxAttempts: 5,
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

  return jobView(
    job,
    link
  );
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

  return jobView(
    job,
    link
  );
}

export async function listIntegrationSyncJobs(
  input: {
    accountId: string;
    connectionId: string;
    limit?: number;
  }
): Promise<IntegrationSyncJobView[]> {
  const { postgresPool } =
    await import(
      '../persistence/postgres.js'
    );
  const limit = Math.max(
    1,
    Math.min(
      100,
      Math.trunc(
        input.limit ?? 40
      )
    )
  );
  const links =
    await postgresPool().query(
      `SELECT worker_job_id
       FROM integration_sync_worker_jobs
       WHERE account_id = $1
         AND connection_id = $2
       ORDER BY
         created_at DESC,
         worker_job_id DESC
       LIMIT $3`,
      [
        input.accountId,
        input.connectionId,
        limit,
      ]
    );

  const views:
    IntegrationSyncJobView[] = [];

  for (const row of links.rows) {
    const view =
      await getIntegrationSyncJob({
        accountId:
          input.accountId,
        connectionId:
          input.connectionId,
        jobId:
          row.worker_job_id,
      });
    if (view) {
      views.push(view);
    }
  }

  return views;
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

async function completedRunAfterBaseline(
  input: {
    accountId: string;
    connectionId: string;
    lastSuccessfulSyncAtBefore?: number;
  }
): Promise<SyncRun | null> {
  const connection =
    await integrationPersistence
      .requireConnection(
        input.accountId,
        input.connectionId
      );

  const completedAt =
    connection.lastSuccessfulSyncAt;

  if (
    !completedAt ||
    (
      input.lastSuccessfulSyncAtBefore !==
        undefined &&
      completedAt <=
        input.lastSuccessfulSyncAtBefore
    )
  ) {
    return null;
  }

  const runs =
    await integrationPersistence
      .listSyncRuns({
        accountId:
          input.accountId,
        connectionId:
          input.connectionId,
        limit: 100,
      });

  return (
    runs.find(
      (run) =>
        run.status ===
          'COMPLETED' &&
        run.completedAt ===
          completedAt
    ) || null
  );
}

async function runWithHeartbeat<T>(
  heartbeat: Heartbeat,
  work: () => Promise<T>
): Promise<T> {
  if (!heartbeat) {
    return work();
  }

  let heartbeatError:
    | unknown
    | undefined;
  let heartbeatInFlight =
    false;

  await heartbeat(90_000);

  const timer =
    setInterval(() => {
      if (heartbeatInFlight) {
        return;
      }
      heartbeatInFlight = true;
      void heartbeat(90_000)
        .catch((error) => {
          heartbeatError =
            error;
        })
        .finally(() => {
          heartbeatInFlight =
            false;
        });
    }, 30_000);
  timer.unref?.();

  try {
    const result =
      await work();
    if (heartbeatError) {
      throw heartbeatError;
    }
    return result;
  } finally {
    clearInterval(timer);
  }
}

async function markTerminalWorkerFailure(
  input: {
    accountId: string;
    connectionId: string;
    message: string;
    category:
      ReturnType<
        typeof classifyIntegrationFailure
      >['category'];
  }
): Promise<void> {
  const connection =
    await integrationPersistence
      .requireConnection(
        input.accountId,
        input.connectionId
      )
      .catch(() => null);

  if (
    !connection ||
    connection.status !==
      'ACTIVE'
  ) {
    return;
  }

  await integrationPersistence
    .updateConnection(
      input.accountId,
      input.connectionId,
      {
        attentionReason:
          connection.attentionReason ||
          'SYNC_FAILED',
        lastFailureCategory:
          input.category,
        consecutiveFailureCount:
          (connection.consecutiveFailureCount ||
            0) + 1,
        nextRetryAt: undefined,
        lastError:
          input.message,
        lastSyncAt:
          Date.now(),
      }
    )
    .catch(() => undefined);
}

export async function handleIntegrationSyncJob(
  job: WorkerJob,
  options?: {
    heartbeat?: Heartbeat;
  }
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

  if (link.syncRunId) {
    const linkedRun =
      await integrationPersistence
        .getSyncRun(
          job.accountId,
          link.syncRunId
        );

    if (linkedRun?.status === 'COMPLETED') {
      return;
    }

    if (linkedRun?.status === 'FAILED') {
      throw new WorkerJobHandlerError(
        linkedRun.error ||
          'The linked Integration SyncRun already failed.',
        false
      );
    }

    if (linkedRun?.status === 'RUNNING') {
      const linkedConnection =
        await integrationPersistence
          .requireConnection(
            job.accountId,
            payload.connectionId
          );
      const now = Date.now();

      if (
        linkedConnection.syncLeaseExpiresAt &&
        linkedConnection.syncLeaseExpiresAt >
          now
      ) {
        throw new WorkerJobHandlerError(
          'The linked Integration SyncRun is still owned by an active sync lease.',
          true,
          Math.max(
            5_000,
            linkedConnection.syncLeaseExpiresAt -
              now +
              1_000
          )
        );
      }

      await integrationPersistence
        .updateSyncRun(
          job.accountId,
          linkedRun.id,
          {
            status: 'FAILED',
            completedAt: now,
            retryable: true,
            failureCategory:
              'TRANSIENT',
            nextRetryAt: undefined,
            error:
              'Worker restart recovered an orphaned RUNNING Integration SyncRun after its sync lease expired.',
          }
        );
    }
  }

  const alreadyCompleted =
    await completedRunAfterBaseline({
      accountId:
        job.accountId,
      connectionId:
        payload.connectionId,
      lastSuccessfulSyncAtBefore:
        payload.lastSuccessfulSyncAtBefore,
    });

  if (alreadyCompleted) {
    await attachSyncRun({
      accountId:
        job.accountId,
      jobId:
        job.id,
      syncRunId:
        alreadyCompleted.id,
    });
    return;
  }

  const current =
    await integrationPersistence
      .requireConnection(
        job.accountId,
        payload.connectionId
      );

  if (
    current.cursor !==
      payload.cursorBefore &&
    current.lastSuccessfulSyncAt ===
      payload.lastSuccessfulSyncAtBefore
  ) {
    throw new WorkerJobHandlerError(
      'Queued Integration sync request is stale because the provider checkpoint changed before the worker started.',
      false
    );
  }

  let run: SyncRun;
  try {
    run =
      await runWithHeartbeat(
        options?.heartbeat,
        () =>
          integrationRuntimeService
            .sync({
              accountId:
                job.accountId,
              connectionId:
                payload.connectionId,
            })
      );
  } catch (error: any) {
    if (
      error instanceof
        WorkerJobLeaseError
    ) {
      throw error;
    }

    const classification =
      classifyIntegrationFailure(
        error
      );
    const leaseConflict =
      error?.code ===
        'SYNC_ALREADY_RUNNING';
    const retryable =
      leaseConflict ||
      classification.retryable;
    const terminal =
      !retryable ||
      job.attemptCount >=
        job.maxAttempts;

    if (terminal) {
      await markTerminalWorkerFailure({
        accountId:
          job.accountId,
        connectionId:
          payload.connectionId,
        message:
          error?.message ||
          'Integration sync worker failed.',
        category:
          classification.category,
      });
    }

    let retryDelayMs:
      | number
      | undefined;

    if (leaseConflict) {
      const latest =
        await integrationPersistence
          .requireConnection(
            job.accountId,
            payload.connectionId
          )
          .catch(() => null);
      if (
        latest
          ?.syncLeaseExpiresAt
      ) {
        retryDelayMs =
          Math.max(
            5_000,
            latest
              .syncLeaseExpiresAt -
              Date.now() +
              1_000
          );
      }
    }

    throw new WorkerJobHandlerError(
      'Integration sync worker failed before a terminal SyncRun was returned: ' +
        (
          error?.message ||
          'unknown error'
        ),
      retryable,
      retryDelayMs
    );
  }

  await attachSyncRun({
    accountId:
      job.accountId,
    jobId: job.id,
    syncRunId: run.id,
  });

  if (
    run.status ===
      'COMPLETED'
  ) {
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
    async ({
      job,
      heartbeat,
    }) => {
      await handleIntegrationSyncJob(
        job,
        {
          heartbeat,
        }
      );
    }
  );
}

export async function integrationSyncJobRun(
  input: {
    accountId: string;
    syncRunId?: string;
  }
): Promise<SyncRun | null> {
  if (!input.syncRunId) {
    return null;
  }
  return integrationPersistence
    .getSyncRun(
      input.accountId,
      input.syncRunId
    );
}
