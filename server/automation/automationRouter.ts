import express from 'express';
import {
  RequestIdentity,
  RequestIdentityError,
} from '../requestIdentity.js';
import { applicationIdentityMiddleware } from '../requestIdentityMiddleware.js';
import { requireOwnerOrAdmin } from '../identity/privilegedAuthorization.js';
import { ActionAccessError } from '../actions/actionStore.js';
import { ActionExecutionError } from '../actions/actionExecutionService.js';
import { CompanyKnowledgeAccessError } from '../companyKnowledge/companyKnowledgeStore.js';
import { ActionIntent } from '../actions/types.js';
import {
  AutomationActorRole,
  AutomationApprovalStatus,
  AutomationPolicyMode,
  AutomationRiskClass,
  AutomationRunFeedback,
} from './types.js';
import { automationRuntimeService } from './automationRuntimeService.js';
import { AutomationApprovalError } from './automationApprovalService.js';
import { AutomationExecutionError } from './automationExecutionService.js';
import { AutomationControlError } from './automationControlService.js';
import { AutomationRunAccessError } from './automationRunStore.js';
import { AutomationApprovalAccessError } from './automationApprovalStore.js';
import { AutomationQualityError } from './automationQualityService.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import {
  enqueueAutomationExecutionJob,
  getAutomationExecutionJob,
  listAutomationExecutionJobs,
} from './automationExecutionWorker.js';
import {
  AutomationWorkerIdentityError,
} from './automationWorkerIdentity.js';

export const automationRouter = express.Router();

automationRouter.use(applicationIdentityMiddleware);

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function actorLabel(value: RequestIdentity): string {
  return automationActorLabel(value);
}

function limitFrom(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(parsed, 1000))
    : fallback;
}

const ACTION_INTENTS: ActionIntent[] = [
  'RECORD_PAYMENT',
  'RECEIVE_INVENTORY',
  'UPDATE_STATUS',
  'CREATE_ORDER',
];

const POLICY_MODES: AutomationPolicyMode[] = [
  'SUGGEST_ONLY',
  'REQUIRE_APPROVAL',
  'AUTO_EXECUTE_LOW_RISK',
];

const RISK_CLASSES: AutomationRiskClass[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
];

const IDENTITY_SOURCES: RequestIdentity['source'][] = [
  'API_KEY',
  'HUMAN_SESSION',
  'DEFAULT_WEB',
];

const ACTOR_ROLES: AutomationActorRole[] = [
  'OWNER',
  'ADMIN',
  'APPROVER',
  'OPERATOR',
  'SERVICE',
  'MEMBER',
];

const APPROVAL_STATUSES: AutomationApprovalStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
];

function finiteNonNegative(
  value: unknown,
  name: string
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed =
    typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AutomationPolicyInputError(
      name + ' must be a finite non-negative number.'
    );
  }

  return parsed;
}

function stringArray<T extends string>(params: {
  value: unknown;
  allowed: readonly T[];
  name: string;
}): T[] {
  if (!Array.isArray(params.value)) {
    throw new AutomationPolicyInputError(
      params.name + ' must be an array.'
    );
  }

  const unique: T[] = [];
  for (const item of params.value) {
    if (
      typeof item !== 'string' ||
      !params.allowed.includes(item as T)
    ) {
      throw new AutomationPolicyInputError(
        params.name + ' contains an unsupported value.'
      );
    }
    if (!unique.includes(item as T)) {
      unique.push(item as T);
    }
  }
  return unique;
}

function optionalStringArray<T extends string>(params: {
  value: unknown;
  allowed: readonly T[];
  name: string;
}): T[] | undefined {
  if (params.value === undefined || params.value === null) {
    return undefined;
  }
  return stringArray(params);
}

function optionalFreeStringArray(
  value: unknown,
  name: string
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new AutomationPolicyInputError(name + ' must be an array.');
  }

  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new AutomationPolicyInputError(
        name + ' must contain only strings.'
      );
    }
    const normalized = item.trim();
    if (!normalized || normalized.length > 160) {
      throw new AutomationPolicyInputError(
        name + ' contains an empty or overly long value.'
      );
    }
    if (!output.includes(normalized)) output.push(normalized);
  }
  return output;
}

function approvalStatus(
  value: unknown
): AutomationApprovalStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return APPROVAL_STATUSES.includes(
    normalized as AutomationApprovalStatus
  )
    ? (normalized as AutomationApprovalStatus)
    : undefined;
}

function automationRunStatus(
  value: unknown
):
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'BLOCKED'
  | 'FAILED'
  | 'COMPENSATED'
  | 'RECOVERY_REQUIRED'
  | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed = [
    'RUNNING',
    'SUCCEEDED',
    'BLOCKED',
    'FAILED',
    'COMPENSATED',
    'RECOVERY_REQUIRED',
  ] as const;
  return allowed.includes(normalized as any)
    ? (normalized as (typeof allowed)[number])
    : undefined;
}

export class AutomationPolicyInputError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'AUTOMATION_POLICY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AutomationPolicyInputError';
  }
}

function handleError(
  res: express.Response,
  error: any
): void {
  if (
    error instanceof RequestIdentityError ||
    error instanceof ActionAccessError ||
    error instanceof ActionExecutionError ||
    error instanceof CompanyKnowledgeAccessError ||
    error instanceof AutomationPolicyInputError ||
    error instanceof AutomationApprovalAccessError ||
    error instanceof AutomationApprovalError ||
    error instanceof AutomationExecutionError ||
    error instanceof AutomationControlError ||
    error instanceof AutomationRunAccessError ||
    error instanceof AutomationQualityError ||
    error instanceof AutomationWorkerIdentityError
  ) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  res.status(500).json({
    error: error?.message || 'Automation policy request failed.',
  });
}

automationRouter.get('/context', (_req, res) => {
  try {
    const requestIdentity = identity(res);
    const role = resolveAutomationActorRole(requestIdentity);
    res.json({
      actor: automationActorLabel(requestIdentity),
      role,
      source: requestIdentity.source,
      capabilities: {
        canManagePolicy:
          role === 'OWNER' || role === 'ADMIN',
        canControlEmergencyStop:
          role === 'OWNER' || role === 'ADMIN',
        canResolveApprovals:
          role === 'OWNER' ||
          role === 'ADMIN' ||
          role === 'APPROVER',
        canCompensate:
          role === 'OWNER' ||
          role === 'ADMIN' ||
          role === 'APPROVER',
        canExecuteAutomation:
          role === 'OWNER' ||
          role === 'ADMIN' ||
          role === 'OPERATOR',
        canRecordFeedback: true,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/quality', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      quality: await automationRuntimeService.quality(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/dashboard', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json(await automationRuntimeService.dashboard(accountId));
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/policy', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    const policy = await automationRuntimeService.getPolicy(accountId);

    res.json({
      policy,
      effectiveDefault: policy
        ? null
        : {
            mode: 'SUGGEST_ONLY',
            enabled: false,
            decision: 'DENY',
            reason:
              'No automation policy exists. Automatic execution is disabled by default.',
          },
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.put(
  '/policy',
  requireOwnerOrAdmin,
  async (req, res) => {
  try {
    const requestIdentity = identity(res);
    const mode =
      typeof req.body?.mode === 'string'
        ? req.body.mode.trim().toUpperCase()
        : '';

    if (
      !POLICY_MODES.includes(mode as AutomationPolicyMode)
    ) {
      throw new AutomationPolicyInputError(
        'mode must be SUGGEST_ONLY, REQUIRE_APPROVAL, or AUTO_EXECUTE_LOW_RISK.'
      );
    }

    const risk =
      typeof req.body?.maxRiskClass === 'string'
        ? req.body.maxRiskClass.trim().toUpperCase()
        : '';

    if (!RISK_CLASSES.includes(risk as AutomationRiskClass)) {
      throw new AutomationPolicyInputError(
        'maxRiskClass must be LOW, MEDIUM, or HIGH.'
      );
    }

    if (typeof req.body?.enabled !== 'boolean') {
      throw new AutomationPolicyInputError(
        'enabled must be a boolean.'
      );
    }

    const allowedActionIntents =
      stringArray<ActionIntent>({
        value: req.body?.allowedActionIntents,
        allowed: ACTION_INTENTS,
        name: 'allowedActionIntents',
      });

    const allowedIdentitySources =
      stringArray<RequestIdentity['source']>({
        value: req.body?.allowedIdentitySources,
        allowed: IDENTITY_SOURCES,
        name: 'allowedIdentitySources',
      });

    const policy = await automationRuntimeService.upsertPolicy({
      accountId: requestIdentity.accountId,
      actor: actorLabel(requestIdentity),
      policy: {
        enabled: req.body.enabled,
        mode: mode as AutomationPolicyMode,
        allowedActionIntents,
        maxRiskClass: risk as AutomationRiskClass,
        maxAmount: finiteNonNegative(
          req.body?.maxAmount,
          'maxAmount'
        ),
        maxQuantity: finiteNonNegative(
          req.body?.maxQuantity,
          'maxQuantity'
        ),
        allowedIdentitySources,
        allowedActorRoles:
          optionalStringArray<AutomationActorRole>({
            value: req.body?.allowedActorRoles,
            allowed: ACTOR_ROLES,
            name: 'allowedActorRoles',
          }),
        approvalRoles:
          optionalStringArray<AutomationActorRole>({
            value: req.body?.approvalRoles,
            allowed: ACTOR_ROLES,
            name: 'approvalRoles',
          }),
        allowedTargetEntityTypes: optionalFreeStringArray(
          req.body?.allowedTargetEntityTypes,
          'allowedTargetEntityTypes'
        ),
        allowedTargetEntityIds: optionalFreeStringArray(
          req.body?.allowedTargetEntityIds,
          'allowedTargetEntityIds'
        ),
      },
    });

    res.status(policy.version === 1 ? 201 : 200).json({
      policy,
    });
  } catch (error) {
    handleError(res, error);
  }
  }
);

automationRouter.get('/policy/history', async (req, res) => {
  try {
    const { accountId } = identity(res);

    res.json({
      history: await automationRuntimeService.listPolicyHistory({
        accountId,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/control', async (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      control: await automationRuntimeService.getControl(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/control/history', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      history: await automationRuntimeService.listControlHistory({
        accountId,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.post('/control/disable', async (req, res) => {
  try {
    const requestIdentity = identity(res);
    const control = await automationRuntimeService.disableControl({
      accountId: requestIdentity.accountId,
      identity: requestIdentity,
      reason:
        typeof req.body?.reason === 'string'
          ? req.body.reason
          : undefined,
    });
    res.json({ control });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.post('/control/enable', async (req, res) => {
  try {
    const requestIdentity = identity(res);
    const control = await automationRuntimeService.enableControl({
      accountId: requestIdentity.accountId,
      identity: requestIdentity,
      reason:
        typeof req.body?.reason === 'string'
          ? req.body.reason
          : undefined,
    });
    res.json({ control });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/runs', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      runs: await automationRuntimeService.listRuns({
        accountId,
        proposalId:
          typeof req.query.proposalId === 'string'
            ? req.query.proposalId
            : undefined,
        status: automationRunStatus(req.query.status),
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.post('/runs/:runId/feedback', async (req, res) => {
  try {
    const requestIdentity = identity(res);
    const raw =
      typeof req.body?.feedback === 'string'
        ? req.body.feedback.trim().toUpperCase()
        : '';
    const allowed: AutomationRunFeedback[] = [
      'CORRECT',
      'FALSE_TRIGGER',
      'NEEDS_CORRECTION',
    ];

    if (!allowed.includes(raw as AutomationRunFeedback)) {
      throw new AutomationQualityError(
        'AUTOMATION_FEEDBACK_INVALID',
        400,
        'feedback must be CORRECT, FALSE_TRIGGER, or NEEDS_CORRECTION.'
      );
    }

    const run = await automationRuntimeService.setFeedback({
      accountId: requestIdentity.accountId,
      runId: req.params.runId,
      feedback: raw as AutomationRunFeedback,
      identity: requestIdentity,
      note:
        typeof req.body?.note === 'string'
          ? req.body.note
          : undefined,
    });

    res.json({
      run,
      quality: await automationRuntimeService.quality(
        requestIdentity.accountId
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/runs/:runId', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      run: await automationRuntimeService.requireRun(
        accountId,
        req.params.runId
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.post(
  '/runs/:runId/compensate',
  async (req, res) => {
    try {
      const requestIdentity = identity(res);
      const result = await automationRuntimeService.compensate({
        accountId: requestIdentity.accountId,
        runId: req.params.runId,
        identity: requestIdentity,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof AutomationExecutionError) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          evaluation: error.evaluation,
          runId: error.runId,
        });
        return;
      }
      handleError(res, error);
    }
  }
);

automationRouter.get('/approvals', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      approvals: await automationRuntimeService.listApprovals({
        accountId,
        proposalId:
          typeof req.query.proposalId === 'string'
            ? req.query.proposalId
            : undefined,
        status: approvalStatus(req.query.status),
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.post(
  '/approvals/:proposalId/request',
  async (req, res) => {
    try {
      const requestIdentity = identity(res);
      const approval = await automationRuntimeService.requestApproval({
        accountId: requestIdentity.accountId,
        proposalId: req.params.proposalId,
        identity: requestIdentity,
      });
      res.status(201).json({ approval });
    } catch (error) {
      handleError(res, error);
    }
  }
);

automationRouter.post(
  '/approvals/:approvalId/approve',
  async (req, res) => {
    try {
      const requestIdentity = identity(res);
      const approval = await automationRuntimeService.approve({
        accountId: requestIdentity.accountId,
        approvalId: req.params.approvalId,
        identity: requestIdentity,
        note:
          typeof req.body?.note === 'string'
            ? req.body.note
            : undefined,
      });
      res.json({ approval });
    } catch (error) {
      handleError(res, error);
    }
  }
);

automationRouter.post(
  '/approvals/:approvalId/reject',
  async (req, res) => {
    try {
      const requestIdentity = identity(res);
      const approval = await automationRuntimeService.reject({
        accountId: requestIdentity.accountId,
        approvalId: req.params.approvalId,
        identity: requestIdentity,
        note:
          typeof req.body?.note === 'string'
            ? req.body.note
            : undefined,
      });
      res.json({ approval });
    } catch (error) {
      handleError(res, error);
    }
  }
);

automationRouter.post(
  '/execute-jobs/:proposalId',
  async (req, res) => {
    try {
      if (
        !automationRuntimeService
          .usesPostgres()
      ) {
        res.status(503).json({
          error:
            'Queued Automation execution requires PostgreSQL worker infrastructure.',
          code:
            'AUTOMATION_WORKER_QUEUE_REQUIRES_POSTGRES',
        });
        return;
      }

      const requestIdentity =
        identity(res);
      const job =
        await enqueueAutomationExecutionJob({
          accountId:
            requestIdentity.accountId,
          proposalId:
            req.params.proposalId,
          identity:
            requestIdentity,
        });

      res.status(202).json({
        job,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

automationRouter.get(
  '/execute-jobs/:proposalId',
  async (req, res) => {
    try {
      if (
        !automationRuntimeService
          .usesPostgres()
      ) {
        res.status(503).json({
          error:
            'Queued Automation execution requires PostgreSQL worker infrastructure.',
          code:
            'AUTOMATION_WORKER_QUEUE_REQUIRES_POSTGRES',
        });
        return;
      }

      const { accountId } =
        identity(res);
      res.json({
        jobs:
          await listAutomationExecutionJobs({
            accountId,
            proposalId:
              req.params.proposalId,
            limit:
              limitFrom(
                req.query.limit,
                40
              ),
          }),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

automationRouter.get(
  '/execute-jobs/:proposalId/:jobId',
  async (req, res) => {
    try {
      if (
        !automationRuntimeService
          .usesPostgres()
      ) {
        res.status(503).json({
          error:
            'Queued Automation execution requires PostgreSQL worker infrastructure.',
          code:
            'AUTOMATION_WORKER_QUEUE_REQUIRES_POSTGRES',
        });
        return;
      }

      const { accountId } =
        identity(res);
      const job =
        await getAutomationExecutionJob({
          accountId,
          proposalId:
            req.params.proposalId,
          jobId:
            req.params.jobId,
        });

      if (!job) {
        res.status(404).json({
          error:
            'Automation execution job was not found in the current account/proposal scope.',
          code:
            'AUTOMATION_EXECUTION_JOB_NOT_FOUND',
        });
        return;
      }

      res.json({ job });
    } catch (error) {
      handleError(res, error);
    }
  }
);

automationRouter.post(
  '/execute/:proposalId',
  async (req, res) => {
    try {
      const requestIdentity = identity(res);
      const result = await automationRuntimeService.execute({
        accountId: requestIdentity.accountId,
        proposalId: req.params.proposalId,
        identity: requestIdentity,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof AutomationExecutionError) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          evaluation: error.evaluation,
          runId: error.runId,
        });
        return;
      }
      handleError(res, error);
    }
  }
);

automationRouter.post(
  '/evaluate/:proposalId',
  async (req, res) => {
    try {
      const requestIdentity = identity(res);
      const evaluation = await automationRuntimeService.evaluate({
        accountId: requestIdentity.accountId,
        proposalId: req.params.proposalId,
        identity: requestIdentity,
      });

      res.json({ evaluation });
    } catch (error) {
      handleError(res, error);
    }
  }
);
