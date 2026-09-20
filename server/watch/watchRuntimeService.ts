import { watchPersistence } from './watchPersistence.js';
import { watchService, WatchValidationError } from './watchService.js';
import type {
  WatchCondition,
  WatchEvaluationMode,
  WatchRule,
  WatchRuleOrigin,
  WatchRuleStatus,
} from './types.js';

export class WatchRuntimeService {
  public usesPostgres(): boolean {
    return watchPersistence.usesPostgres();
  }

  public async createRule(params: {
    accountId: string;
    name: string;
    description?: string;
    condition: WatchCondition;
    origin?: WatchRuleOrigin;
    evaluationMode?: WatchEvaluationMode;
    intervalMinutes?: number;
  }): Promise<WatchRule> {
    if (!this.usesPostgres()) {
      return watchService.createRule(params);
    }

    const name = params.name.trim();
    if (!name || name.length > 120) {
      throw new WatchValidationError(
        'WATCH_NAME_INVALID',
        'Watch name must contain 1–120 characters.'
      );
    }

    const evaluationMode = params.evaluationMode || 'MANUAL';
    if (evaluationMode === 'INTERVAL') {
      if (
        !Number.isInteger(params.intervalMinutes) ||
        (params.intervalMinutes || 0) < 5 ||
        (params.intervalMinutes || 0) > 10080
      ) {
        throw new WatchValidationError(
          'WATCH_INTERVAL_INVALID',
          'Interval watches require intervalMinutes between 5 and 10080.'
        );
      }
    }

    const condition = watchService.validateCondition(
      params.accountId,
      params.condition
    );

    return watchPersistence.createRule({
      accountId: params.accountId,
      name,
      description: params.description?.trim() || undefined,
      status: 'ACTIVE',
      origin: params.origin || 'MANUAL',
      condition,
      evaluationMode,
      intervalMinutes:
        evaluationMode === 'INTERVAL'
          ? params.intervalMinutes
          : undefined,
      nextEvaluationAt:
        evaluationMode === 'INTERVAL' && params.intervalMinutes
          ? Date.now() + params.intervalMinutes * 60 * 1000
          : undefined,
    });
  }

  public async setStatus(params: {
    accountId: string;
    watchRuleId: string;
    status: WatchRuleStatus;
  }): Promise<WatchRule> {
    if (!this.usesPostgres()) {
      return watchService.setStatus(params);
    }

    const current = await watchPersistence.requireRule(
      params.accountId,
      params.watchRuleId
    );

    if (params.status === 'INVALID') {
      throw new WatchValidationError(
        'WATCH_STATUS_INVALID',
        'INVALID is reserved for rule validation/runtime failures.'
      );
    }

    if (current.status === 'ARCHIVED') {
      if (params.status === 'ARCHIVED') return current;
      throw new WatchValidationError(
        'WATCH_STATUS_INVALID',
        'Archived watch rules cannot be reactivated.'
      );
    }

    if (
      params.status === 'ACTIVE' &&
      current.status !== 'PAUSED' &&
      current.status !== 'ACTIVE'
    ) {
      throw new WatchValidationError(
        'WATCH_STATUS_INVALID',
        'Only paused watch rules can be resumed.'
      );
    }

    return watchPersistence.setRuleStatus(
      params.accountId,
      params.watchRuleId,
      params.status
    );
  }

  public validateCondition(
    accountId: string,
    condition: WatchCondition
  ): WatchCondition {
    return watchService.validateCondition(accountId, condition);
  }
}

export const watchRuntimeService = new WatchRuntimeService();
