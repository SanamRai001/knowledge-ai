import express from 'express';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import { ActionAccessError, actionStore } from '../actions/actionStore.js';
import { ActionExecutionError } from '../actions/actionExecutionService.js';
import { CompanyKnowledgeAccessError } from '../companyKnowledge/companyKnowledgeStore.js';
import { ActionIntent } from '../actions/types.js';
import {
  AutomationActorRole,
  AutomationApprovalStatus,
  AutomationPolicyMode,
  AutomationRiskClass,
} from './types.js';
import { automationPolicyStore } from './automationPolicyStore.js';
import { automationPolicyEvaluator } from './automationPolicyEvaluator.js';
import {
  AutomationApprovalError,
  automationApprovalService,
} from './automationApprovalService.js';
import {
  AutomationExecutionError,
  automationExecutionService,
} from './automationExecutionService.js';
import {
  AutomationControlError,
  automationControlService,
} from './automationControlService.js';
import { automationControlStore } from './automationControlStore.js';
import {
  AutomationRunAccessError,
  automationRunStore,
} from './automationRunStore.js';
import {
  AutomationApprovalAccessError,
  automationApprovalStore,
} from './automationApprovalStore.js';

export const automationRouter = express.Router();

automationRouter.use((req, res, next) => {
  try {
    res.locals.requestIdentity = resolveRequestIdentity(req);
    next();
  } catch (error: any) {
    if (error instanceof RequestIdentityError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
      return;
    }
    res.status(500).json({
      error: 'Failed to resolve request identity.',
    });
  }
});

function identity(res: express.Response): RequestIdentity {
  return res.locals.requestIdentity as RequestIdentity;
}

function actorLabel(value: RequestIdentity): string {
  return value.source === 'API_KEY'
    ? 'api-key:' + (value.apiKeyId || 'unknown')
    : 'web:default';
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
    error instanceof AutomationRunAccessError
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

automationRouter.get('/policy', (_req, res) => {
  try {
    const { accountId } = identity(res);
    const policy = automationPolicyStore.getPolicy(accountId);

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

automationRouter.put('/policy', (req, res) => {
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

    const policy = automationPolicyStore.upsertPolicy({
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
});

automationRouter.get('/policy/history', (req, res) => {
  try {
    const { accountId } = identity(res);

    res.json({
      history: automationPolicyStore.listHistory({
        accountId,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/control', (_req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      control: automationControlService.get(accountId),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.get('/control/history', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      history: automationControlStore.listHistory({
        accountId,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

automationRouter.post('/control/disable', (req, res) => {
  try {
    const requestIdentity = identity(res);
    const control = automationControlService.disable({
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

automationRouter.post('/control/enable', (req, res) => {
  try {
    const requestIdentity = identity(res);
    const control = automationControlService.enable({
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

automationRouter.get('/runs', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      runs: automationRunStore.list({
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

automationRouter.get('/runs/:runId', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      run: automationRunStore.require(
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
  (req, res) => {
    try {
      const requestIdentity = identity(res);
      const result = automationExecutionService.compensate({
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

automationRouter.get('/approvals', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      approvals: automationApprovalStore.list({
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
  (req, res) => {
    try {
      const requestIdentity = identity(res);
      const approval = automationApprovalService.request({
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
  (req, res) => {
    try {
      const requestIdentity = identity(res);
      const approval = automationApprovalService.approve({
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
  (req, res) => {
    try {
      const requestIdentity = identity(res);
      const approval = automationApprovalService.reject({
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
  '/execute/:proposalId',
  (req, res) => {
    try {
      const requestIdentity = identity(res);
      const result = automationExecutionService.executeEligible({
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
  (req, res) => {
    try {
      const requestIdentity = identity(res);
      const proposal = actionStore.requireProposal(
        requestIdentity.accountId,
        req.params.proposalId
      );

      const evaluation = automationPolicyEvaluator.evaluate({
        accountId: requestIdentity.accountId,
        proposal,
        identity: requestIdentity,
      });

      res.json({ evaluation });
    } catch (error) {
      handleError(res, error);
    }
  }
);
