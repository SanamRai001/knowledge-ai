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
  watchStore,
} from './watchStore.js';
import {
  WatchEvaluationError,
  watchEvaluator,
} from './watchEvaluator.js';
import {
  WatchValidationError,
  watchService,
} from './watchService.js';
import {
  WatchDraftError,
  watchDraftService,
} from './watchDraftService.js';
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

    const draft = await watchDraftService.propose({
      accountId,
      instruction,
      allowLlmParsing: req.body?.allowLlmParsing !== false,
    });

    res.status(201).json({ draft });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/drafts', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      drafts: watchStore.listDrafts({
        accountId,
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/drafts/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      draft: watchStore.requireDraft(accountId, req.params.id),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/drafts/:id/select-target', (req, res) => {
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

    const draft = watchDraftService.selectTarget({
      accountId,
      draftId: req.params.id,
      candidateKey,
    });

    res.json({ draft });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/drafts/:id/save', (req, res) => {
  try {
    const { accountId } = identity(res);
    const saved = watchDraftService.save({
      accountId,
      draftId: req.params.id,
    });
    const rule = watchStore.requireRule(accountId, saved.ruleId);

    res.status(201).json({
      draft: saved.draft,
      rule,
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/drafts/:id/cancel', (req, res) => {
  try {
    const { accountId } = identity(res);
    const draft = watchDraftService.cancel({
      accountId,
      draftId: req.params.id,
    });
    res.json({ draft });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules', (req, res) => {
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

    const rule = watchService.createRule({
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

watchRouter.get('/rules', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      rules: watchStore.listRules({
        accountId,
        status: ruleStatus(req.query.status),
        limit: limitFrom(req.query.limit, 100),
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/rules/:id', (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = watchStore.requireRule(accountId, req.params.id);

    res.json({
      rule,
      evaluations: watchStore.listEvaluations({
        accountId,
        watchRuleId: rule.id,
        limit: 100,
      }),
      alerts: watchStore.listAlerts({
        accountId,
        watchRuleId: rule.id,
        limit: 100,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/evaluate', (req, res) => {
  try {
    const { accountId } = identity(res);
    const result = watchEvaluator.evaluate({
      accountId,
      watchRuleId: req.params.id,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/pause', (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = watchService.setStatus({
      accountId,
      watchRuleId: req.params.id,
      status: 'PAUSED',
    });
    res.json({ rule });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/resume', (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = watchService.setStatus({
      accountId,
      watchRuleId: req.params.id,
      status: 'ACTIVE',
    });
    res.json({ rule });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/rules/:id/archive', (req, res) => {
  try {
    const { accountId } = identity(res);
    const rule = watchService.setStatus({
      accountId,
      watchRuleId: req.params.id,
      status: 'ARCHIVED',
    });
    res.json({ rule });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.get('/jobs', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      jobs: watchStore.listJobs({
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

watchRouter.get('/alerts', (req, res) => {
  try {
    const { accountId } = identity(res);
    res.json({
      alerts: watchStore.listAlerts({
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

watchRouter.post('/alerts/:id/acknowledge', (req, res) => {
  try {
    const { accountId } = identity(res);
    const alert = watchStore.updateAlertStatus({
      accountId,
      alertId: req.params.id,
      status: 'ACKNOWLEDGED',
    });
    res.json({ alert });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/alerts/:id/resolve', (req, res) => {
  try {
    const { accountId } = identity(res);
    const alert = watchStore.updateAlertStatus({
      accountId,
      alertId: req.params.id,
      status: 'RESOLVED',
    });
    res.json({ alert });
  } catch (error) {
    handleError(res, error);
  }
});

watchRouter.post('/alerts/:id/snooze', (req, res) => {
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

    const alert = watchStore.updateAlertStatus({
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
