import express from 'express';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import { CompanyKnowledgeAccessError } from '../companyKnowledge/companyKnowledgeStore.js';
import {
  ActionAccessError,
} from './actionStore.js';
import { actionPersistence } from './actionPersistence.js';
import {
  ActionExecutionError,
} from './actionExecutionService.js';
import { actionRuntimeExecutionService } from './actionRuntimeExecutionService.js';
import {
  ActionInterpretationError,
} from './hybridActionInterpreter.js';
import { hybridActionRuntimeInterpreter } from './hybridActionRuntimeInterpreter.js';
import {
  ActionProposalError,
} from './actionProposalService.js';
import {
  ActionRefinementError,
} from './actionRefinementService.js';
import { actionRuntimeRefinementService } from './actionRuntimeRefinementService.js';
import { EffectiveStateError } from '../companyKnowledge/effectiveCompanyStateService.js';
import { ActionProposalStatus } from './types.js';

export const actionRouter = express.Router();

actionRouter.use((req, res, next) => {
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

function handleError(res: express.Response, error: any): void {
  if (
    error instanceof RequestIdentityError ||
    error instanceof CompanyKnowledgeAccessError ||
    error instanceof ActionAccessError ||
    error instanceof ActionExecutionError ||
    error instanceof ActionInterpretationError ||
    error instanceof ActionProposalError ||
    error instanceof ActionRefinementError ||
    error instanceof EffectiveStateError
  ) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  res.status(500).json({
    error: error?.message || 'Business action request failed.',
  });
}

function proposalStatus(value: unknown): ActionProposalStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed: ActionProposalStatus[] = [
    'PROPOSED',
    'NEEDS_INPUT',
    'CONFIRMED',
    'CANCELLED',
    'STALE',
    'FAILED',
  ];
  return allowed.includes(normalized as ActionProposalStatus)
    ? (normalized as ActionProposalStatus)
    : undefined;
}

function limitFrom(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

actionRouter.post('/propose', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const instruction =
      typeof req.body?.instruction === 'string'
        ? req.body.instruction
        : '';

    const result =
      await hybridActionRuntimeInterpreter.interpret({
      accountId,
      instruction,
      allowLlmParsing: req.body?.allowLlmParsing !== false,
    });

    res.status(201).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

actionRouter.get('/', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      proposals: await actionPersistence.listProposals({
        accountId,
        status: proposalStatus(req.query.status),
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

actionRouter.get('/:id', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const proposal = await actionPersistence.requireProposal(
      accountId,
      req.params.id
    );
    res.json({
      proposal,
      execution:
        await actionPersistence.getExecutionByProposal(
          accountId,
          proposal.id
        ),
      audit: await actionPersistence.listAudit({
        accountId,
        proposalId: proposal.id,
        limit: 100,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

actionRouter.get('/:id/audit', async (req, res) => {
  try {
    const { accountId } = identity(res);
    await actionPersistence.requireProposal(
      accountId,
      req.params.id
    );
    res.json({
      audit: await actionPersistence.listAudit({
        accountId,
        proposalId: req.params.id,
        limit: limitFrom(req.query.limit, 200),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

actionRouter.post('/:id/select-target', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const entityId =
      typeof req.body?.entityId === 'string'
        ? req.body.entityId.trim()
        : '';

    if (!entityId) {
      res.status(400).json({
        error: 'entityId is required.',
        code: 'ACTION_TARGET_REQUIRED',
      });
      return;
    }

    const proposal =
      await actionRuntimeRefinementService.selectTarget({
      accountId,
      proposalId: req.params.id,
      entityId,
    });
    res.status(201).json({ proposal });
  } catch (error) {
    handleError(res, error);
  }
});

actionRouter.post('/:id/confirm', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const result =
      await actionRuntimeExecutionService.confirm({
      accountId,
      proposalId: req.params.id,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

actionRouter.post('/:id/cancel', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const proposal =
      await actionRuntimeExecutionService.cancel({
      accountId,
      proposalId: req.params.id,
    });
    res.json({ proposal });
  } catch (error) {
    handleError(res, error);
  }
});
