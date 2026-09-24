import crypto from 'crypto';
import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import type {
  ClaimWorkerJobInput,
  EnqueueWorkerJobInput,
  WorkerJob,
  WorkerJobFailureInput,
  WorkerJobHeartbeatInput,
  WorkerJobLeaseMutationInput,
  WorkerJobListInput,
} from './workerJobTypes.js';
import {
  WorkerJobLeaseError,
  workerRetryDelayMs,
} from './workerJobTypes.js';

function epoch(
  value:
    | Date
    | string
    | number
    | null
    | undefined
): number | undefined {
  if (
    value === null ||
    value === undefined
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
      'PostgreSQL returned an invalid worker-job timestamp.'
    );
  }
  return parsed;
}

function rowToJob(row: any): WorkerJob {
  return {
    id: row.id,
    accountId: row.account_id,
    jobType: row.job_type,
    payload: row.payload || {},
    payloadRef:
      row.payload_ref ?? undefined,
    idempotencyKey:
      row.idempotency_key ??
      undefined,
    concurrencyKey:
      row.concurrency_key ??
      undefined,
    priority: Number(row.priority),
    status: row.status,
    attemptCount: Number(
      row.attempt_count
    ),
    maxAttempts: Number(
      row.max_attempts
    ),
    nextAttemptAt:
      epoch(row.next_attempt_at)!,
    leaseOwner:
      row.lease_owner ?? undefined,
    leaseToken:
      row.lease_token ?? undefined,
    leaseExpiresAt:
      epoch(row.lease_expires_at),
    lastHeartbeatAt:
      epoch(row.last_heartbeat_at),
    startedAt:
      epoch(row.started_at),
    completedAt:
      epoch(row.completed_at),
    lastError:
      row.last_error ?? undefined,
    createdAt:
      epoch(row.created_at)!,
    updatedAt:
      epoch(row.updated_at)!,
  };
}

function cleanOptional(
  value: string | undefined
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function validateJobType(
  value: string
): string {
  const normalized =
    value.trim().toUpperCase();
  if (
    !/^[A-Z][A-Z0-9_]{1,63}$/.test(
      normalized
    )
  ) {
    throw new Error(
      'Worker job type must match ^[A-Z][A-Z0-9_]{1,63}$.'
    );
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number.isFinite(value)
    ? Math.trunc(value!)
    : fallback;
  return Math.min(
    max,
    Math.max(min, n)
  );
}

function newId(): string {
  return (
    'wjob_' +
    crypto.randomBytes(12).toString('hex')
  );
}

function newLeaseToken(): string {
  return crypto
    .randomBytes(24)
    .toString('hex');
}

export class PostgresWorkerJobRepository {
  async enqueue(
    input: EnqueueWorkerJobInput
  ): Promise<WorkerJob> {
    const accountId =
      input.accountId.trim();
    if (!accountId) {
      throw new Error(
        'Worker job accountId is required.'
      );
    }

    const jobType =
      validateJobType(input.jobType);
    const idempotencyKey =
      cleanOptional(
        input.idempotencyKey
      );
    const concurrencyKey =
      cleanOptional(
        input.concurrencyKey
      );
    const payloadRef =
      cleanOptional(input.payloadRef);
    const priority =
      boundedInteger(
        input.priority,
        0,
        -1000,
        1000
      );
    const maxAttempts =
      boundedInteger(
        input.maxAttempts,
        3,
        1,
        100
      );
    const now = Date.now();
    const runAt = Math.max(
      0,
      Math.trunc(
        input.runAt ?? now
      )
    );
    const params = [
      newId(),
      accountId,
      jobType,
      JSON.stringify(
        input.payload || {}
      ),
      payloadRef ?? null,
      idempotencyKey ?? null,
      concurrencyKey ?? null,
      priority,
      maxAttempts,
      new Date(runAt),
      new Date(now),
    ];

    const sql = idempotencyKey
      ? `INSERT INTO worker_jobs
          (id, account_id, job_type,
           payload, payload_ref,
           idempotency_key,
           concurrency_key, priority,
           status, attempt_count,
           max_attempts,
           next_attempt_at,
           created_at, updated_at)
         VALUES (
           $1,$2,$3,$4::jsonb,$5,$6,$7,$8,
           'PENDING',0,$9,$10,$11,$11
         )
         ON CONFLICT (
           account_id,
           job_type,
           idempotency_key
         )
         WHERE idempotency_key IS NOT NULL
         DO UPDATE SET
           updated_at =
             worker_jobs.updated_at
         RETURNING *`
      : `INSERT INTO worker_jobs
          (id, account_id, job_type,
           payload, payload_ref,
           idempotency_key,
           concurrency_key, priority,
           status, attempt_count,
           max_attempts,
           next_attempt_at,
           created_at, updated_at)
         VALUES (
           $1,$2,$3,$4::jsonb,$5,$6,$7,$8,
           'PENDING',0,$9,$10,$11,$11
         )
         RETURNING *`;

    const result =
      await postgresPool().query(
        sql,
        params
      );

    return rowToJob(
      result.rows[0]
    );
  }

  async get(
    accountId: string,
    jobId: string
  ): Promise<WorkerJob | null> {
    const result =
      await postgresPool().query(
        `SELECT *
         FROM worker_jobs
         WHERE account_id = $1
           AND id = $2`,
        [accountId, jobId]
      );

    return result.rowCount
      ? rowToJob(result.rows[0])
      : null;
  }

  async list(
    input: WorkerJobListInput
  ): Promise<WorkerJob[]> {
    const values: unknown[] = [
      input.accountId,
    ];
    const clauses = [
      'account_id = $1',
    ];

    if (input.status) {
      values.push(input.status);
      clauses.push(
        'status = $' +
          values.length
      );
    }

    if (input.jobType) {
      values.push(
        validateJobType(
          input.jobType
        )
      );
      clauses.push(
        'job_type = $' +
          values.length
      );
    }

    const limit =
      boundedInteger(
        input.limit,
        100,
        1,
        500
      );
    values.push(limit);

    const result =
      await postgresPool().query(
        `SELECT *
         FROM worker_jobs
         WHERE ${clauses.join(
           ' AND '
         )}
         ORDER BY
           created_at DESC,
           id DESC
         LIMIT $${values.length}`,
        values
      );

    return result.rows.map(
      rowToJob
    );
  }

  async claim(
    input: ClaimWorkerJobInput
  ): Promise<WorkerJob | null> {
    const workerId =
      input.workerId.trim();
    if (!workerId) {
      throw new Error(
        'Worker ID is required to claim jobs.'
      );
    }

    const leaseMs = Math.max(
      5_000,
      Math.trunc(input.leaseMs)
    );
    const now =
      input.now ?? Date.now();
    const leaseToken =
      newLeaseToken();
    const leaseExpiresAt =
      now + leaseMs;
    const jobTypes =
      (input.jobTypes || [])
        .map(validateJobType);

    if (
      input.jobTypes &&
      jobTypes.length === 0
    ) {
      return null;
    }

    const typeClause =
      jobTypes.length > 0
        ? 'AND j.job_type = ANY($5::text[])'
        : '';

    for (
      let attempt = 0;
      attempt < 5;
      attempt += 1
    ) {
      try {
        const result =
          await postgresPool().query(
            `WITH candidate AS (
               SELECT j.id
               FROM worker_jobs j
               WHERE j.status = 'PENDING'
                 AND j.next_attempt_at <= $1
                 AND j.attempt_count < j.max_attempts
                 ${typeClause}
                 AND (
                   j.concurrency_key IS NULL
                   OR NOT EXISTS (
                     SELECT 1
                     FROM worker_jobs running
                     WHERE
                       running.account_id =
                         j.account_id
                       AND running.job_type =
                         j.job_type
                       AND running.concurrency_key =
                         j.concurrency_key
                       AND running.status =
                         'RUNNING'
                   )
                 )
               ORDER BY
                 j.priority DESC,
                 j.next_attempt_at ASC,
                 j.created_at ASC,
                 j.id ASC
               FOR UPDATE SKIP LOCKED
               LIMIT 1
             )
             UPDATE worker_jobs j
             SET
               status = 'RUNNING',
               attempt_count =
                 j.attempt_count + 1,
               lease_owner = $2,
               lease_token = $3,
               lease_expires_at = $4,
               last_heartbeat_at = $1,
               started_at =
                 COALESCE(
                   j.started_at,
                   $1
                 ),
               completed_at = NULL,
               last_error = NULL,
               updated_at = $1
             FROM candidate
             WHERE j.id = candidate.id
             RETURNING j.*`,
            jobTypes.length > 0
              ? [
                  new Date(now),
                  workerId,
                  leaseToken,
                  new Date(
                    leaseExpiresAt
                  ),
                  jobTypes,
                ]
              : [
                  new Date(now),
                  workerId,
                  leaseToken,
                  new Date(
                    leaseExpiresAt
                  ),
                ]
          );

        return result.rowCount
          ? rowToJob(
              result.rows[0]
            )
          : null;
      } catch (error: any) {
        if (
          error?.code === '23505'
        ) {
          continue;
        }
        throw error;
      }
    }

    return null;
  }

  async heartbeat(
    input: WorkerJobHeartbeatInput
  ): Promise<WorkerJob> {
    const now =
      input.now ?? Date.now();
    const leaseMs = Math.max(
      5_000,
      Math.trunc(input.leaseMs)
    );

    const result =
      await postgresPool().query(
        `UPDATE worker_jobs
         SET
           lease_expires_at = $5,
           last_heartbeat_at = $4,
           updated_at = $4
         WHERE account_id = $1
           AND id = $2
           AND status = 'RUNNING'
           AND lease_owner = $3
           AND lease_token = $6
           AND lease_expires_at > $4
         RETURNING *`,
        [
          input.accountId,
          input.jobId,
          input.workerId,
          new Date(now),
          new Date(now + leaseMs),
          input.leaseToken,
        ]
      );

    if (!result.rowCount) {
      throw new WorkerJobLeaseError(
        'Worker job lease is no longer owned by this worker/token.'
      );
    }

    return rowToJob(
      result.rows[0]
    );
  }

  async complete(
    input: WorkerJobLeaseMutationInput
  ): Promise<WorkerJob> {
    const now =
      input.now ?? Date.now();

    const result =
      await postgresPool().query(
        `UPDATE worker_jobs
         SET
           status = 'SUCCEEDED',
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_heartbeat_at = $4,
           completed_at = $4,
           last_error = NULL,
           updated_at = $4
         WHERE account_id = $1
           AND id = $2
           AND status = 'RUNNING'
           AND lease_owner = $3
           AND lease_token = $5
           AND lease_expires_at > $4
         RETURNING *`,
        [
          input.accountId,
          input.jobId,
          input.workerId,
          new Date(now),
          input.leaseToken,
        ]
      );

    if (!result.rowCount) {
      throw new WorkerJobLeaseError(
        'Worker job completion rejected because the lease is no longer valid.'
      );
    }

    return rowToJob(
      result.rows[0]
    );
  }

  async fail(
    input: WorkerJobFailureInput
  ): Promise<WorkerJob> {
    const now =
      input.now ?? Date.now();

    return withTransaction(
      async (client) => {
        const locked =
          await client.query(
            `SELECT *
             FROM worker_jobs
             WHERE account_id = $1
               AND id = $2
             FOR UPDATE`,
            [
              input.accountId,
              input.jobId,
            ]
          );

        if (!locked.rowCount) {
          throw new WorkerJobLeaseError(
            'Worker job no longer exists in this account.'
          );
        }

        const current =
          rowToJob(
            locked.rows[0]
          );

        if (
          current.status !==
            'RUNNING' ||
          current.leaseOwner !==
            input.workerId ||
          current.leaseToken !==
            input.leaseToken ||
          !current.leaseExpiresAt ||
          current.leaseExpiresAt <=
            now
        ) {
          throw new WorkerJobLeaseError(
            'Worker job failure settlement rejected because the lease is no longer valid.'
          );
        }

        const retryable =
          input.retryable &&
          current.attemptCount <
            current.maxAttempts;
        const nextStatus =
          retryable
            ? 'PENDING'
            : input.retryable
              ? 'DEAD_LETTER'
              : 'FAILED';
        const retryAt =
          retryable
            ? Math.max(
                now,
                input.retryAt ??
                  now +
                    workerRetryDelayMs(
                      current.attemptCount
                    )
              )
            : current.nextAttemptAt;

        const result =
          await client.query(
            `UPDATE worker_jobs
             SET
               status = $3,
               next_attempt_at = $4,
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               last_heartbeat_at = $5,
               completed_at = $6,
               last_error = $7,
               updated_at = $5
             WHERE account_id = $1
               AND id = $2
             RETURNING *`,
            [
              input.accountId,
              input.jobId,
              nextStatus,
              new Date(retryAt),
              new Date(now),
              retryable
                ? null
                : new Date(now),
              input.error.slice(
                0,
                4000
              ),
            ]
          );

        return rowToJob(
          result.rows[0]
        );
      }
    );
  }

  async recoverStale(
    input?: {
      now?: number;
      jobTypes?: string[];
    }
  ): Promise<WorkerJob[]> {
    const now =
      input?.now ?? Date.now();
    const jobTypes =
      (input?.jobTypes || [])
        .map(validateJobType);

    if (
      input?.jobTypes &&
      jobTypes.length === 0
    ) {
      return [];
    }

    const typeClause =
      jobTypes.length > 0
        ? 'AND job_type = ANY($2::text[])'
        : '';

    const result =
      await postgresPool().query(
        `UPDATE worker_jobs
         SET
           status = CASE
             WHEN attempt_count >=
               max_attempts
               THEN 'DEAD_LETTER'
             ELSE 'PENDING'
           END,
           next_attempt_at = CASE
             WHEN attempt_count >=
               max_attempts
               THEN next_attempt_at
             ELSE $1
           END,
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           completed_at = CASE
             WHEN attempt_count >=
               max_attempts
               THEN $1
             ELSE NULL
           END,
           last_error =
             'Worker lease expired before completion.',
           updated_at = $1
         WHERE status = 'RUNNING'
           AND lease_expires_at <= $1
           ${typeClause}
         RETURNING *`,
        jobTypes.length > 0
          ? [
              new Date(now),
              jobTypes,
            ]
          : [new Date(now)]
      );

    return result.rows.map(
      rowToJob
    );
  }
}

export const postgresWorkerJobRepository =
  new PostgresWorkerJobRepository();
