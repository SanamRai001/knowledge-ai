import express from 'express';
import {
  RequestIdentity,
  RequestIdentityError,
  resolveRequestIdentity,
} from '../requestIdentity.js';
import { CompanyKnowledgeAccessError } from '../companyKnowledge/companyKnowledgeStore.js';
import {
  WatchAccessError,
  WatchStateError,
} from './watchPersistence.js';
import { watchPersistence } from './watchPersistence.js';
import {
  WatchEvaluationError,
} from './watchRuntimeEvaluator.js';
import { watchRuntimeEvaluator } from './watchRuntimeEvaluator.js';
import {
  WatchValidationError,
} from './watchRuntimeService.js';
import { watchRuntimeService } from './watchRuntimeService.js';
import {
  WatchDraftError,
} from './watchDraftRuntimeService.js';
import { watchDraftRuntimeService } from './watchDraftRuntimeService.js';
import {
  WatchAlertStatus,
  WatchCondition,
  WatchRuleStatus,
} from './types.js';

export const watchRouter = express.Router();

watchRouter.use((req, res, next) => {
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
    error instanceof WatchAccessError ||
    error instanceof WatchStateError ||
    error instanceof WatchEvaluationError ||
    error instanceof WatchValidationError ||
    error instanceof WatchDraftError
  ) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  if (
    error &&
    typeof error.statusCode === 'number' &&
    typeof error.code === 'string'
  ) {
    res.status(error.statusCode).json({
      error: error.message || 'Watch request failed.',
      code: error.code,
    });
    return;
  }

  res.status(500).json({
    error: error?.message || 'Watch request failed.',
  });
}

function limitFrom(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ruleStatus(value: unknown): WatchRuleStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed: WatchRuleStatus[] = [
    'ACTIVE',
    'PAUSED',
    'INVALID',
    'ARCHIVED',
  ];
  return allowed.includes(normalized as WatchRuleStatus)
    ? (normalized as WatchRuleStatus)
    : undefined;
}

function alertStatus(value: unknown): WatchAlertStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed: WatchAlertStatus[] = [
    'OPEN',
    'ACKNOWLEDGED',
    'SNOOZED',
    'RESOLVED',
  ];
  return allowed.includes(normalized as WatchAlertStatus)
    ? (normalized as WatchAlertStatus)
    : undefined;
}

watchRouter.post('/drafts/propose', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const instruction =
      typeof req.body?.instruction === 'string'
        ? req.body.instruction
        : '';

    const draft = await watchDraftRuntimeService.propose({
      accountId,
      instruction,
      allowLlmParsing: req.body?.allowLlmParsing !== false,
    });

    res.status(201).json({ draft });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/drafts', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      drafts: await watchPersistence.listDrafts({
        accountId,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/drafts/:id', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      draft: await watchPersistence.requireDraft(accountId, req.params.id),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/drafts/:id/select-target', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const candidateKey =
      typeof req.body?.candidateKey === 'string'
        ? req.body.candidateKey.trim()
        : '';

    if (!candidateKey) {
      res.status(400).json({
        error: 'candidateKey is required.',
        code: 'WATCH_DRAFT_TARGET_REQUIRED',
      });
      return;
    }

    const draft = await watchDraftRuntimeService.selectTarget({
      accountId,
      draftId: req.params.id,
      candidateKey,
    });

    res.json({ draft });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/drafts/:id/save', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const saved = await watchDraftRuntimeService.save({
      accountId,
      draftId: req.params.id,
    });
    const rule = await watchPersistence.requireRule(accountId, saved.ruleId);

    res.status(201).json({
      draft: saved.draft,
      rule,
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/drafts/:id/cancel', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const draft = await watchDraftRuntimeService.cancel({
      accountId,
      draftId: req.params.id,
    });
    res.json({ draft });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const name =
      typeof req.body?.name === 'string' ? req.body.name : '';
    const condition = req.body?.condition as WatchCondition | undefined;

    if (!condition || typeof condition !== 'object') {
      res.status(400).json({
        error: 'condition is required.',
        code: 'WATCH_CONDITION_REQUIRED',
      });
      return;
    }

    const rule = await watchRuntimeService.createRule({
      accountId,
      name,
      description:
        typeof req.body?.description === 'string'
          ? req.body.description
          : undefined,
      condition,
      origin: 'MANUAL',
      evaluationMode:
        req.body?.evaluationMode === 'INTERVAL' ||
        req.body?.evaluationMode === 'EVENT'
          ? req.body.evaluationMode
          : 'MANUAL',
      intervalMinutes:
        typeof req.body?.intervalMinutes === 'number'
          ? req.body.intervalMinutes
          : undefined,
    });

    res.status(201).json({ rule });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/rules', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      rules: await watchPersistence.listRules({
        accountId,
        status: ruleStatus(req.query.status),
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/rules/:id', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = await watchPersistence.requireRule(accountId, req.params.id);

    res.json({
      rule,
      evaluations: await watchPersistence.listEvaluations({
        accountId,
        watchRuleId: rule.id,
        limit: 100,
      }),
      alerts: await watchPersistence.listAlerts({
        accountId,
        watchRuleId: rule.id,
        limit: 100,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/evaluate', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const result = await watchRuntimeEvaluator.evaluate({
      accountId,
      watchRuleId: req.params.id,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/pause', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = await watchRuntimeService.setStatus({
      accountId,
      watchRuleId: req.params.id,
      status: 'PAUSED',
    });
    res.json({ rule });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/resume', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = await watchRuntimeService.setStatus({
      accountId,
      watchRuleId: req.params.id,
      status: 'ACTIVE',
    });
    res.json({ rule });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/archive', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = await watchRuntimeService.setStatus({
      accountId,
      watchRuleId: req.params.id,
      status: 'ARCHIVED',
    });
    res.json({ rule });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/jobs', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      jobs: await watchPersistence.listJobs({
        accountId,
        watchRuleId:
          typeof req.query.watchRuleId === 'string'
            ? req.query.watchRuleId
            : undefined,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/alerts', async (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      alerts: watchPersistence.listAlerts({
        accountId,
        watchRuleId:
          typeof req.query.watchRuleId === 'string'
            ? req.query.watchRuleId
            : undefined,
        status: alertStatus(req.query.status),
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/alerts/:id/acknowledge', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const alert = await watchPersistence.updateAlertStatus({
      accountId,
      alertId: req.params.id,
      status: 'ACKNOWLEDGED',
    });
    res.json({ alert });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/alerts/:id/resolve', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const alert = await watchPersistence.updateAlertStatus({
      accountId,
      alertId: req.params.id,
      status: 'RESOLVED',
      resolutionReason: 'USER_RESOLVED',
    });
    res.json({ alert });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/alerts/:id/snooze', async (req, res) => {
  try {
    const { accountId } = identity(res);
    const until =
      typeof req.body?.until === 'number'
        ? req.body.until
        : Number.NaN;

    if (!Number.isFinite(until) || until <= Date.now()) {
      res.status(400).json({
        error: 'until must be a future timestamp.',
        code: 'WATCH_SNOOZE_UNTIL_INVALID',
      });
      return;
    }

    const alert = await watchPersistence.updateAlertStatus({
      accountId,
      alertId: req.params.id,
      status: 'SNOOZED',
      snoozedUntil: until,
    });
    res.json({ alert });
  } catch (error) {
    handleError(res, error);
  }
});
