import crypto from 'crypto';
import {
  actionPersistence,
} from '../actions/actionPersistence.js';
import {
  ActionExecutionError,
} from '../actions/actionExecutionService.js';
import {
  automationExecutionRuntimeService,
} from './automationExecutionRuntimeService.js';
import {
  AutomationExecutionError,
} from './automationExecutionService.js';
import {
  automationPersistence,
} from './automationPersistence.js';
import {
  revalidateAutomationWorkerPrincipal,
  snapshotAutomationWorkerPrincipal,
  AutomationWorkerIdentityError,
} from './automationWorkerIdentity.js';
import type {
  AutomationActorRole,
  AutomationRun,
} from './types.js';
import type {
  RequestIdentity,
  RequestIdentitySource,
} from '../requestIdentity.js';
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
  type WorkerJobStatus,
} from '../worker/workerJobTypes.js';

export const AUTOMATION_EXECUTION_JOB_TYPE =
  'AUTOMATION_EXECUTION_V1';

export interface AutomationExecutionJobPayload {
  schemaVersion: 1;
  proposalId: string;
  requestedAt: number;
  identitySource:
    RequestIdentitySource;
  principalId?: string;
  requestedRole:
    AutomationActorRole;
  authorizationRevisionAt?: number;
}

export interface AutomationExecutionJobView {
  id: string;
  proposalId: string;
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
  requestedBy: string;
  identitySource:
    RequestIdentitySource;
  requestedRole:
    AutomationActorRole;
  automationRunId?: string;
  automationRunStatus?:
    AutomationRun['status'];
  actionExecutionId?: string;
  outcomeCode?: string;
  outcomeMessage?: string;
}

type Heartbeat = (
  leaseMs?: number
) => Promise<WorkerJob>;

interface AutomationExecutionJobLink {
  proposalId: string;
  requestedAt: number;
  requestedBy: string;
  identitySource:
    RequestIdentitySource;
  principalId?: string;
  requestedRole:
    AutomationActorRole;
  authorizationRevisionAt?: number;
  automationRunId?: string;
  automationRunStatus?:
    AutomationRun['status'];
  actionExecutionId?: string;
  outcomeCode?: string;
  outcomeMessage?: string;
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
      'Automation worker received an invalid timestamp.'
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
): AutomationExecutionJobPayload {
  const payload =
    job.payload as Partial<AutomationExecutionJobPayload>;

  const validSource =
    payload.identitySource ===
      'HUMAN_SESSION' ||
    payload.identitySource ===
      'API_KEY' ||
    payload.identitySource ===
      'DEFAULT_WEB';

  const validRole =
    typeof payload.requestedRole ===
      'string' &&
    [
      'OWNER',
      'ADMIN',
      'APPROVER',
      'OPERATOR',
      'SERVICE',
      'MEMBER',
    ].includes(
      payload.requestedRole
    );

  if (
    payload.schemaVersion !== 1 ||
    typeof payload.proposalId !==
      'string' ||
    !payload.proposalId.trim() ||
    typeof payload.requestedAt !==
      'number' ||
    !Number.isFinite(
      payload.requestedAt
    ) ||
    !validSource ||
    !validRole ||
    (
      payload.principalId !==
        undefined &&
      typeof payload.principalId !==
        'string'
    ) ||
    (
      payload.authorizationRevisionAt !==
        undefined &&
      (
        typeof payload.authorizationRevisionAt !==
          'number' ||
        !Number.isFinite(
          payload.authorizationRevisionAt
        )
      )
    )
  ) {
    throw new WorkerJobHandlerError(
      'Automation execution worker payload is invalid.',
      false
    );
  }

  return {
    schemaVersion: 1,
    proposalId:
      payload.proposalId.trim(),
    requestedAt:
      payload.requestedAt,
    identitySource:
      payload.identitySource!,
    principalId:
      payload.principalId?.trim() ||
      undefined,
    requestedRole:
      payload.requestedRole as
        AutomationActorRole,
    authorizationRevisionAt:
      payload.authorizationRevisionAt,
  };
}

async function linkForJob(input: {
  accountId: string;
  jobId: string;
}): Promise<AutomationExecutionJobLink | null> {
  const { postgresPool } =
    await import(
      '../persistence/postgres.js'
    );

  const result =
    await postgresPool().query(
      `SELECT
         l.proposal_id,
         l.requested_at,
         l.requested_by,
         l.identity_source,
         l.principal_id,
         l.requested_role,
         l.authorization_revision_at,
         l.automation_run_id,
         r.status AS automation_run_status,
         l.action_execution_id,
         l.outcome_code,
         l.outcome_message
       FROM automation_execution_worker_jobs l
       LEFT JOIN automation_runs r
         ON r.account_id = l.account_id
        AND r.id = l.automation_run_id
       WHERE l.account_id = $1
         AND l.worker_job_id = $2`,
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
    proposalId: row.proposal_id,
    requestedAt:
      epoch(row.requested_at)!,
    requestedBy:
      row.requested_by,
    identitySource:
      row.identity_source,
    principalId:
      row.principal_id ??
      undefined,
    requestedRole:
      row.requested_role,
    authorizationRevisionAt:
      epoch(
        row.authorization_revision_at
      ),
    automationRunId:
      row.automation_run_id ??
      undefined,
    automationRunStatus:
      row.automation_run_status ??
      undefined,
    actionExecutionId:
      row.action_execution_id ??
      undefined,
    outcomeCode:
      row.outcome_code ??
      undefined,
    outcomeMessage:
      row.outcome_message ??
      undefined,
  };
}

function jobView(
  job: WorkerJob,
  link: AutomationExecutionJobLink
): AutomationExecutionJobView {
  return {
    id: job.id,
    proposalId:
      link.proposalId,
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
    identitySource:
      link.identitySource,
    requestedRole:
      link.requestedRole,
    automationRunId:
      link.automationRunId,
    automationRunStatus:
      link.automationRunStatus,
    actionExecutionId:
      link.actionExecutionId,
    outcomeCode:
      link.outcomeCode,
    outcomeMessage:
      link.outcomeMessage,
  };
}

async function updateLink(input: {
  accountId: string;
  jobId: string;
  automationRunId?: string;
  actionExecutionId?: string;
  outcomeCode?: string;
  outcomeMessage?: string;
}): Promise<void> {
  const { postgresPool } =
    await import(
      '../persistence/postgres.js'
    );

  await postgresPool().query(
    `UPDATE automation_execution_worker_jobs
     SET automation_run_id =
           COALESCE($3, automation_run_id),
         action_execution_id =
           COALESCE($4, action_execution_id),
         outcome_code = $5,
         outcome_message = $6,
         updated_at = $7
     WHERE account_id = $1
       AND worker_job_id = $2`,
    [
      input.accountId,
      input.jobId,
      input.automationRunId ??
        null,
      input.actionExecutionId ??
        null,
      input.outcomeCode ?? null,
      input.outcomeMessage ??
        null,
      new Date(),
    ]
  );
}

async function latestRunForProposal(
  accountId: string,
  proposalId: string
): Promise<AutomationRun | null> {
  const runs =
    await automationPersistence.listRuns({
      accountId,
      proposalId,
      limit: 20,
    });

  return runs[0] || null;
}

async function runWithHeartbeat<T>(
  heartbeat: Heartbeat | undefined,
  work: () => Promise<T>
): Promise<T> {
  if (!heartbeat) {
    return work();
  }

  let heartbeatError:
    | unknown
    | undefined;
  let inFlight = false;

  await heartbeat(90_000);

  const timer =
    setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void heartbeat(90_000)
        .catch((error) => {
          heartbeatError = error;
        })
        .finally(() => {
          inFlight = false;
        });
    }, 30_000);
  timer.unref?.();

  try {
    const result = await work();
    if (heartbeatError) {
      throw heartbeatError;
    }
    return result;
  } finally {
    clearInterval(timer);
  }
}

function businessOutcomeCode(
  error:
    | AutomationExecutionError
    | ActionExecutionError
): string {
  return error.code;
}

export async function enqueueAutomationExecutionJob(
  input: {
    accountId: string;
    proposalId: string;
    identity: RequestIdentity;
    requestedAt?: number;
  }
): Promise<AutomationExecutionJobView> {
  const requestedAt =
    input.requestedAt ??
    Date.now();

  if (
    input.identity.accountId !==
      input.accountId
  ) {
    throw new AutomationWorkerIdentityError(
      'Automation worker enqueue identity does not match the requested account.'
    );
  }

  const principal =
    await snapshotAutomationWorkerPrincipal(
      input.identity
    );

  const result =
    await withTransaction(
      async (client) => {
        const proposal =
          await client.query(
            `SELECT
               status,
               updated_at
             FROM action_proposals
             WHERE account_id = $1
               AND id = $2
             FOR UPDATE`,
            [
              input.accountId,
              input.proposalId,
            ]
          );

        if (!proposal.rowCount) {
          const error: any =
            new Error(
              'Action proposal was not found in the current account scope.'
            );
          error.statusCode = 404;
          error.code =
            'ACTION_PROPOSAL_NOT_FOUND';
          throw error;
        }

        const completedExecution =
          await client.query(
            `SELECT l.worker_job_id
             FROM automation_execution_worker_jobs l
             JOIN worker_jobs j
               ON j.account_id =
                    l.account_id
              AND j.id =
                    l.worker_job_id
             WHERE l.account_id = $1
               AND l.proposal_id = $2
               AND l.action_execution_id IS NOT NULL
               AND j.status = 'SUCCEEDED'
             ORDER BY
               j.completed_at DESC,
               j.id DESC
             LIMIT 1`,
            [
              input.accountId,
              input.proposalId,
            ]
          );

        if (completedExecution.rowCount) {
          return {
            jobId:
              completedExecution.rows[0]
                .worker_job_id,
          };
        }

        const active =
          await client.query(
            `SELECT l.worker_job_id
             FROM automation_execution_worker_jobs l
             JOIN worker_jobs j
               ON j.account_id =
                    l.account_id
              AND j.id =
                    l.worker_job_id
             WHERE l.account_id = $1
               AND l.proposal_id = $2
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
              input.proposalId,
            ]
          );

        if (active.rowCount) {
          return {
            jobId:
              active.rows[0]
                .worker_job_id,
          };
        }

        const [policy, control] =
          await Promise.all([
            client.query(
              `SELECT
                 id,
                 version,
                 updated_at
               FROM automation_policies
               WHERE account_id = $1`,
              [input.accountId]
            ),
            client.query(
              `SELECT
                 version,
                 updated_at
               FROM automation_controls
               WHERE account_id = $1`,
              [input.accountId]
            ),
          ]);

        const proposalRow =
          proposal.rows[0];
        const policyRow =
          policy.rows[0] || null;
        const controlRow =
          control.rows[0] || null;

        const baseline =
          stableHash([
            input.accountId,
            input.proposalId,
            proposalRow.status,
            epoch(
              proposalRow.updated_at
            ),
            policyRow?.id ?? null,
            policyRow?.version ?? 0,
            epoch(
              policyRow?.updated_at
            ) ?? 0,
            controlRow?.version ?? 0,
            epoch(
              controlRow?.updated_at
            ) ?? 0,
            principal.source,
            principal.principalId ??
              null,
            principal.requestedRole,
            principal.authorizationRevisionAt ??
              null,
          ]);

        const payload:
          AutomationExecutionJobPayload = {
            schemaVersion: 1,
            proposalId:
              input.proposalId,
            requestedAt,
            identitySource:
              principal.source,
            principalId:
              principal.principalId,
            requestedRole:
              principal.requestedRole,
            authorizationRevisionAt:
              principal.authorizationRevisionAt,
          };

        const job =
          await enqueueWorkerJobWithClient(
            client,
            {
              accountId:
                input.accountId,
              jobType:
                AUTOMATION_EXECUTION_JOB_TYPE,
              payload:
                payload as unknown as Record<
                  string,
                  unknown
                >,
              idempotencyKey:
                'automation-execution:' +
                input.proposalId +
                ':' +
                baseline,
              concurrencyKey:
                'automation-proposal:' +
                input.proposalId,
              maxAttempts: 3,
            }
          );

        await client.query(
          `INSERT INTO
             automation_execution_worker_jobs
             (
               account_id,
               proposal_id,
               worker_job_id,
               requested_at,
               requested_by,
               identity_source,
               principal_id,
               requested_role,
               authorization_revision_at,
               created_at,
               updated_at
             )
           VALUES (
             $1,$2,$3,$4,$5,$6,
             $7,$8,$9,$4,$4
           )
           ON CONFLICT (
             account_id,
             worker_job_id
           )
           DO NOTHING`,
          [
            input.accountId,
            input.proposalId,
            job.id,
            new Date(requestedAt),
            principal.requestedBy,
            principal.source,
            principal.principalId ??
              null,
            principal.requestedRole,
            principal.authorizationRevisionAt ===
              undefined
              ? null
              : new Date(
                  principal.authorizationRevisionAt
                ),
          ]
        );

        return {
          jobId: job.id,
        };
      }
    );

  const [job, link] =
    await Promise.all([
      postgresWorkerJobRepository.get(
        input.accountId,
        result.jobId
      ),
      linkForJob({
        accountId:
          input.accountId,
        jobId: result.jobId,
      }),
    ]);

  if (!job || !link) {
    throw new Error(
      'Queued Automation execution job could not be reloaded.'
    );
  }

  return jobView(job, link);
}

export async function getAutomationExecutionJob(
  input: {
    accountId: string;
    proposalId: string;
    jobId: string;
  }
): Promise<AutomationExecutionJobView | null> {
  const [job, link] =
    await Promise.all([
      postgresWorkerJobRepository.get(
        input.accountId,
        input.jobId
      ),
      linkForJob({
        accountId:
          input.accountId,
        jobId:
          input.jobId,
      }),
    ]);

  if (
    !job ||
    !link ||
    link.proposalId !==
      input.proposalId
  ) {
    return null;
  }

  return jobView(job, link);
}

export async function listAutomationExecutionJobs(
  input: {
    accountId: string;
    proposalId: string;
    limit?: number;
  }
): Promise<AutomationExecutionJobView[]> {
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
       FROM automation_execution_worker_jobs
       WHERE account_id = $1
         AND proposal_id = $2
       ORDER BY
         created_at DESC,
         worker_job_id DESC
       LIMIT $3`,
      [
        input.accountId,
        input.proposalId,
        limit,
      ]
    );

  const views:
    AutomationExecutionJobView[] = [];

  for (const row of links.rows) {
    const view =
      await getAutomationExecutionJob({
        accountId:
          input.accountId,
        proposalId:
          input.proposalId,
        jobId:
          row.worker_job_id,
      });
    if (view) {
      views.push(view);
    }
  }

  return views;
}

async function attachLatestOutcome(
  input: {
    job: WorkerJob;
    proposalId: string;
    outcomeCode: string;
    outcomeMessage?: string;
  }
): Promise<AutomationRun | null> {
  const run =
    await latestRunForProposal(
      input.job.accountId,
      input.proposalId
    );
  const execution =
    run?.executionId
      ? await actionPersistence
          .getExecutionByProposal(
            input.job.accountId,
            input.proposalId
          )
      : null;

  await updateLink({
    accountId:
      input.job.accountId,
    jobId: input.job.id,
    automationRunId:
      run?.id,
    actionExecutionId:
      execution?.id,
    outcomeCode:
      input.outcomeCode,
    outcomeMessage:
      input.outcomeMessage,
  });

  return run;
}

export async function handleAutomationExecutionJob(
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
    link.proposalId !==
      payload.proposalId ||
    link.identitySource !==
      payload.identitySource ||
    link.principalId !==
      payload.principalId
  ) {
    throw new WorkerJobHandlerError(
      'Automation execution worker job is not linked to the expected proposal/principal.',
      false
    );
  }

  if (
    link.automationRunStatus ===
      'SUCCEEDED' &&
    link.actionExecutionId
  ) {
    return;
  }

  let identity: RequestIdentity;
  try {
    identity =
      await revalidateAutomationWorkerPrincipal({
        accountId:
          job.accountId,
        source:
          payload.identitySource,
        principalId:
          payload.principalId,
      });
  } catch (error: any) {
    await updateLink({
      accountId:
        job.accountId,
      jobId: job.id,
      outcomeCode:
        error?.code ||
        'AUTOMATION_WORKER_IDENTITY_INVALID',
      outcomeMessage:
        error?.message ||
        'Queued Automation principal is no longer authorized.',
    });

    throw new WorkerJobHandlerError(
      error?.message ||
        'Queued Automation principal is no longer authorized.',
      false
    );
  }

  try {
    const result =
      await runWithHeartbeat(
        options?.heartbeat,
        () =>
          automationExecutionRuntimeService
            .executeEligible({
              accountId:
                job.accountId,
              proposalId:
                payload.proposalId,
              identity,
            })
      );

    await updateLink({
      accountId:
        job.accountId,
      jobId: job.id,
      automationRunId:
        result.run.id,
      actionExecutionId:
        result.execution.id,
      outcomeCode:
        result.replayed
          ? 'AUTOMATION_REPLAYED'
          : 'AUTOMATION_SUCCEEDED',
      outcomeMessage:
        result.replayed
          ? 'Existing governed Automation execution was replayed safely.'
          : 'Governed Automation execution completed successfully.',
    });
    return;
  } catch (error: any) {
    if (
      error instanceof
        AutomationExecutionError
    ) {
      const run =
        await attachLatestOutcome({
          job,
          proposalId:
            payload.proposalId,
          outcomeCode:
            businessOutcomeCode(
              error
            ),
          outcomeMessage:
            error.message,
        });

      if (
        error.code ===
        'AUTOMATION_TECHNICAL_FAILURE'
      ) {
        throw new WorkerJobHandlerError(
          error.message,
          false
        );
      }

      // Policy denial, unsupported intent,
      // stale authorization and execution-mode
      // conflicts are completed business
      // outcomes, not queue transport failures.
      return;
    }

    if (
      error instanceof
        ActionExecutionError
    ) {
      await attachLatestOutcome({
        job,
        proposalId:
          payload.proposalId,
        outcomeCode:
          businessOutcomeCode(
            error
          ),
        outcomeMessage:
          error.message,
      });

      return;
    }

    await attachLatestOutcome({
      job,
      proposalId:
        payload.proposalId,
      outcomeCode:
        'AUTOMATION_WORKER_TRANSIENT_FAILURE',
      outcomeMessage:
        error?.message ||
        'Automation worker failed unexpectedly.',
    }).catch(() => null);

    throw new WorkerJobHandlerError(
      error?.message ||
        'Automation worker failed unexpectedly.',
      true
    );
  }
}

export function registerAutomationExecutionWorkerHandler(
  registry:
    WorkerJobHandlerRegistry =
      workerJobHandlerRegistry
): void {
  if (
    registry.has(
      AUTOMATION_EXECUTION_JOB_TYPE
    )
  ) {
    return;
  }

  registry.register(
    AUTOMATION_EXECUTION_JOB_TYPE,
    async ({
      job,
      heartbeat,
    }) => {
      await handleAutomationExecutionJob(
        job,
        { heartbeat }
      );
    }
  );
}
