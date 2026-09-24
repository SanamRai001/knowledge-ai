import crypto from 'crypto';
import {
  discoveryRuntimeService,
} from '../discovery/discoveryRuntimeService.js';
import {
  linkExecutionDiscoveryJobWithClient,
  postgresActionRepository,
} from '../persistence/a3PostgresRepositories.js';
import {
  withTransaction,
} from '../persistence/postgres.js';
import {
  enqueueWorkerJobWithClient,
} from '../worker/postgresWorkerJobRepository.js';
import {
  workerJobHandlerRegistry,
  type WorkerJobHandlerRegistry,
} from '../worker/workerJobHandlerRegistry.js';
import {
  WorkerJobHandlerError,
  type WorkerJob,
} from '../worker/workerJobTypes.js';

export const ACTION_DISCOVERY_REFRESH_JOB_TYPE =
  'ACTION_DISCOVERY_REFRESH_V1';

export interface ActionDiscoveryRefreshJobPayload {
  schemaVersion: 1;
  executionId: string;
  proposalId: string;
  datasetId: string;
  referenceTime: number;
  analysisRunId: string;
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

export function buildActionDiscoveryRefreshJob(input: {
  accountId: string;
  executionId: string;
  proposalId: string;
  datasetId: string;
  referenceTime: number;
}): {
  payload: ActionDiscoveryRefreshJobPayload;
  idempotencyKey: string;
  concurrencyKey: string;
} {
  const datasetId =
    input.datasetId.trim();
  if (!datasetId) {
    throw new Error(
      'Action Discovery Dataset ID is required.'
    );
  }

  const analysisRunId =
    'anr_action_' +
    stableHash([
      input.accountId,
      input.executionId,
      datasetId,
    ]);

  return {
    payload: {
      schemaVersion: 1,
      executionId:
        input.executionId,
      proposalId:
        input.proposalId,
      datasetId,
      referenceTime:
        input.referenceTime,
      analysisRunId,
    },
    idempotencyKey:
      'action-discovery:' +
      input.executionId +
      ':' +
      datasetId,
    concurrencyKey:
      'dataset:' + datasetId,
  };
}

function parsePayload(
  job: WorkerJob
): ActionDiscoveryRefreshJobPayload {
  const payload =
    job.payload as Partial<ActionDiscoveryRefreshJobPayload>;

  if (
    payload.schemaVersion !== 1 ||
    typeof payload.executionId !==
      'string' ||
    !payload.executionId.trim() ||
    typeof payload.proposalId !==
      'string' ||
    !payload.proposalId.trim() ||
    typeof payload.datasetId !==
      'string' ||
    !payload.datasetId.trim() ||
    typeof payload.referenceTime !==
      'number' ||
    !Number.isFinite(
      payload.referenceTime
    ) ||
    typeof payload.analysisRunId !==
      'string' ||
    !payload.analysisRunId.trim()
  ) {
    throw new WorkerJobHandlerError(
      'Action Discovery worker payload is invalid.',
      false
    );
  }

  return {
    schemaVersion: 1,
    executionId:
      payload.executionId,
    proposalId:
      payload.proposalId,
    datasetId:
      payload.datasetId,
    referenceTime:
      payload.referenceTime,
    analysisRunId:
      payload.analysisRunId,
  };
}

export async function enqueueActionDiscoveryRefresh(input: {
  accountId: string;
  executionId: string;
  proposalId: string;
  datasetId: string;
  referenceTime: number;
}) {
  const spec =
    buildActionDiscoveryRefreshJob(
      input
    );

  return withTransaction(
    async (client) => {
      const job =
        await enqueueWorkerJobWithClient(
          client,
          {
            accountId:
              input.accountId,
            jobType:
              ACTION_DISCOVERY_REFRESH_JOB_TYPE,
            payload:
              spec.payload as unknown as Record<
                string,
                unknown
              >,
            idempotencyKey:
              spec.idempotencyKey,
            concurrencyKey:
              spec.concurrencyKey,
            maxAttempts: 4,
          }
        );

      const execution =
        await linkExecutionDiscoveryJobWithClient(
          client,
          {
            accountId:
              input.accountId,
            executionId:
              input.executionId,
            workerJobId:
              job.id,
            datasetId:
              input.datasetId,
          }
        );

      return {
        job,
        execution,
      };
    }
  );
}

export async function handleActionDiscoveryRefreshJob(
  job: WorkerJob
): Promise<void> {
  const payload = parsePayload(job);

  const execution =
    await postgresActionRepository
      .getExecution(
        job.accountId,
        payload.executionId
      );

  if (
    !execution ||
    execution.proposalId !==
      payload.proposalId ||
    !execution.downstreamDiscoveryJobIds?.includes(
      job.id
    )
  ) {
    throw new WorkerJobHandlerError(
      'Action Discovery worker job is not linked to the expected Action execution.',
      false
    );
  }

  try {
    const result =
      await discoveryRuntimeService
        .analyzeDataset({
          accountId:
            job.accountId,
          datasetId:
            payload.datasetId,
          referenceTime:
            payload.referenceTime,
          analysisRunId:
            payload.analysisRunId,
          startedAt:
            payload.referenceTime,
        });

    await postgresActionRepository
      .appendExecutionAnalysisRun({
        accountId:
          job.accountId,
        executionId:
          payload.executionId,
        analysisRunId:
          result.run.id,
      });
  } catch (error: any) {
    const message =
      'Discovery refresh failed for dataset ' +
      payload.datasetId +
      ': ' +
      (error?.message ||
        'unknown error');

    const terminalAttempt =
      job.attemptCount >=
      job.maxAttempts;

    const retryable =
      error instanceof
        WorkerJobHandlerError
        ? error.retryable
        : true;

    if (
      !retryable ||
      terminalAttempt
    ) {
      await postgresActionRepository
        .appendExecutionWarning({
          accountId:
            job.accountId,
          executionId:
            payload.executionId,
          warning: message,
        })
        .catch(() => undefined);
    }

    if (
      error instanceof
      WorkerJobHandlerError
    ) {
      throw error;
    }

    throw new WorkerJobHandlerError(
      message,
      true
    );
  }
}

export function registerActionDiscoveryWorkerHandler(
  registry:
    WorkerJobHandlerRegistry =
      workerJobHandlerRegistry
): void {
  if (
    registry.has(
      ACTION_DISCOVERY_REFRESH_JOB_TYPE
    )
  ) {
    return;
  }

  registry.register(
    ACTION_DISCOVERY_REFRESH_JOB_TYPE,
    async ({ job }) => {
      await handleActionDiscoveryRefreshJob(
        job
      );
    }
  );
}
