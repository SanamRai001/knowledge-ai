import { structuredAnalyticsEngine } from '../datasets/structuredAnalyticsEngine.js';
import { companyKnowledgeStore } from '../companyKnowledge/companyKnowledgeStore.js';
import { effectiveCompanyStateService } from '../companyKnowledge/effectiveCompanyStateService.js';
import { watchStore } from './watchStore.js';
import {
  WatchCondition,
  WatchEvaluationMode,
  WatchRule,
  WatchRuleOrigin,
  WatchRuleStatus,
} from './types.js';

export class WatchValidationError extends Error {
  public readonly statusCode = 422;
  public readonly code:
    | 'WATCH_NAME_INVALID'
    | 'WATCH_CONDITION_INVALID'
    | 'WATCH_INTERVAL_INVALID'
    | 'WATCH_ENTITY_STATE_INVALID'
    | 'WATCH_DATASET_QUERY_INVALID'
    | 'WATCH_STATUS_INVALID';

  constructor(
    code:
      | 'WATCH_NAME_INVALID'
      | 'WATCH_CONDITION_INVALID'
      | 'WATCH_INTERVAL_INVALID'
      | 'WATCH_ENTITY_STATE_INVALID'
      | 'WATCH_DATASET_QUERY_INVALID'
      | 'WATCH_STATUS_INVALID',
    message: string
  ) {
    super(message);
    this.name = 'WatchValidationError';
    this.code = code;
  }
}

function normalizePredicate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '_');
}

export class WatchService {
  public createRule(params: {
    accountId: string;
    name: string;
    description?: string;
    condition: WatchCondition;
    origin?: WatchRuleOrigin;
    evaluationMode?: WatchEvaluationMode;
    intervalMinutes?: number;
  }): WatchRule {
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

    const condition = this.validateCondition(
      params.accountId,
      params.condition
    );

    return watchStore.createRule({
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

  public setStatus(params: {
    accountId: string;
    watchRuleId: string;
    status: WatchRuleStatus;
  }): WatchRule {
    const current = watchStore.requireRule(
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

    return watchStore.setRuleStatus(
      params.accountId,
      params.watchRuleId,
      params.status
    );
  }

  public validateCondition(
    accountId: string,
    condition: WatchCondition
  ): WatchCondition {
    if (
      !Number.isFinite(condition.threshold)
    ) {
      throw new WatchValidationError(
        'WATCH_CONDITION_INVALID',
        'Watch threshold must be a finite number.'
      );
    }

    if (condition.kind === 'ENTITY_NUMERIC_THRESHOLD') {
      const entity = companyKnowledgeStore.requireEntity(
        accountId,
        condition.entityId
      );
      const predicate = normalizePredicate(condition.predicate);
      if (!predicate) {
        throw new WatchValidationError(
          'WATCH_CONDITION_INVALID',
          'Entity watch predicate is required.'
        );
      }

      const state = effectiveCompanyStateService.resolve(
        accountId,
        entity.id,
        predicate
      );
      if (
        state.status !== 'RESOLVED' ||
        typeof state.value !== 'number'
      ) {
        throw new WatchValidationError(
          'WATCH_ENTITY_STATE_INVALID',
          state.status === 'CONFLICT'
            ? 'The watched entity has conflicting highest-authority values for this predicate.'
            : 'The watched entity does not currently expose a numeric value for this predicate.'
        );
      }

      return {
        ...condition,
        predicate,
      };
    }

    if (
      !condition.datasetId.trim() ||
      !condition.tableName.trim()
    ) {
      throw new WatchValidationError(
        'WATCH_CONDITION_INVALID',
        'Dataset aggregate watches require datasetId and tableName.'
      );
    }

    try {
      const alias = 'watch_validation_value';
      const result = structuredAnalyticsEngine.execute({
        accountId,
        datasetId: condition.datasetId,
        plan: {
          tableName: condition.tableName,
          filters: condition.filters || [],
          aggregates: [
            {
              ...condition.aggregate,
              alias,
            },
          ],
          limit: 1,
        },
      });

      const value = result.rows[0]?.[alias];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Aggregate did not produce a finite number.');
      }
    } catch (error: any) {
      throw new WatchValidationError(
        'WATCH_DATASET_QUERY_INVALID',
        error?.message ||
          'The dataset watch query could not be evaluated.'
      );
    }

    return structuredClone(condition);
  }
}

export const watchService = new WatchService();
