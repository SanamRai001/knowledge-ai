import { structuredAnalyticsEngine } from '../datasets/structuredAnalyticsEngine.js';
import { companyKnowledgeStore } from '../companyKnowledge/companyKnowledgeStore.js';
import { effectiveCompanyStateService } from '../companyKnowledge/effectiveCompanyStateService.js';
import { watchPersistence } from './watchPersistence.js';
import {
  WatchComparisonOperator,
  WatchDatasetEvidence,
  WatchDateEvidence,
  WatchEntityEvidence,
  WatchEvaluation,
  WatchEvaluationResult,
  WatchEvidence,
  WatchRule,
  WatchTimeEvidence,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class WatchEvaluationError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'WATCH_NOT_ACTIVE'
    | 'WATCH_STATE_MISSING'
    | 'WATCH_STATE_CONFLICT'
    | 'WATCH_STATE_TYPE_MISMATCH'
    | 'WATCH_RESULT_INVALID';

  constructor(
    code:
      | 'WATCH_NOT_ACTIVE'
      | 'WATCH_STATE_MISSING'
      | 'WATCH_STATE_CONFLICT'
      | 'WATCH_STATE_TYPE_MISMATCH'
      | 'WATCH_RESULT_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'WatchEvaluationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function compare(
  value: number,
  operator: WatchComparisonOperator,
  threshold: number
): boolean {
  switch (operator) {
    case 'GT':
      return value > threshold;
    case 'GTE':
      return value >= threshold;
    case 'LT':
      return value < threshold;
    case 'LTE':
      return value <= threshold;
    case 'EQ':
      return value === threshold;
    case 'NEQ':
      return value !== threshold;
  }
}

function operatorLabel(operator: WatchComparisonOperator): string {
  switch (operator) {
    case 'GT':
      return '>';
    case 'GTE':
      return '>=';
    case 'LT':
      return '<';
    case 'LTE':
      return '<=';
    case 'EQ':
      return '=';
    case 'NEQ':
      return '!=';
  }
}

function nextEvaluationAt(
  rule: WatchRule,
  evaluatedAt: number
): number | undefined {
  if (
    rule.evaluationMode !== 'INTERVAL' ||
    !rule.intervalMinutes ||
    rule.intervalMinutes <= 0
  ) {
    return undefined;
  }

  return evaluatedAt + rule.intervalMinutes * 60 * 1000;
}

function parseDateValue(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const parsed = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? text + 'T00:00:00Z'
      : text
  );
  return Number.isNaN(parsed) ? null : parsed;
}

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function evaluationShape(rule: WatchRule): {
  operator: WatchComparisonOperator;
  threshold: number;
} {
  const condition = rule.condition;

  if (
    condition.kind === 'ENTITY_NUMERIC_THRESHOLD' ||
    condition.kind === 'DATASET_AGGREGATE_THRESHOLD'
  ) {
    return {
      operator: condition.operator,
      threshold: condition.threshold,
    };
  }

  if (condition.kind === 'ENTITY_DATE_WINDOW') {
    return {
      operator: 'LTE',
      threshold: condition.daysBefore,
    };
  }

  return {
    operator: 'GTE',
    threshold: condition.triggerAt,
  };
}

function alertCopy(params: {
  rule: WatchRule;
  observedValue: number;
}): { title: string; summary: string } {
  const condition = params.rule.condition;

  if (condition.kind === 'ENTITY_NUMERIC_THRESHOLD') {
    return {
      title: params.rule.name,
      summary:
        condition.predicate.replace(/_/g, ' ').toLowerCase() +
        ' is ' +
        String(params.observedValue) +
        ', which matches ' +
        operatorLabel(condition.operator) +
        ' ' +
        String(condition.threshold) +
        '.',
    };
  }

  if (condition.kind === 'DATASET_AGGREGATE_THRESHOLD') {
    const aggregateLabel =
      condition.aggregate.operator +
      (condition.aggregate.column
        ? '(' + condition.aggregate.column + ')'
        : '(rows)');

    return {
      title: params.rule.name,
      summary:
        aggregateLabel +
        ' is ' +
        String(params.observedValue) +
        ', which matches ' +
        operatorLabel(condition.operator) +
        ' ' +
        String(condition.threshold) +
        '.',
    };
  }

  if (condition.kind === 'ENTITY_DATE_WINDOW') {
    return {
      title: params.rule.name,
      summary:
        condition.predicate.replace(/_/g, ' ').toLowerCase() +
        ' is ' +
        String(params.observedValue) +
        ' day' +
        (params.observedValue === 1 ? '' : 's') +
        ' away, inside the ' +
        String(condition.daysBefore) +
        '-day reminder window.',
    };
  }

  return {
    title: params.rule.name,
    summary:
      'The scheduled reminder time has been reached (' +
      new Date(condition.triggerAt).toISOString() +
      ').',
  };
}

type Measurement = {
  observedValue: number;
  evidence: WatchEvidence;
  operator: WatchComparisonOperator;
  threshold: number;
  matched: boolean;
};

export interface PreparedScheduledWatchEvaluation {
  rule: WatchRule;
  evaluation: Omit<
    WatchEvaluation,
    'id' | 'jobId'
  >;
  newAlertCopy?: {
    title: string;
    summary: string;
  };
}

export class WatchRuntimeEvaluator {
  public async prepareScheduledEvaluation(params: {
    accountId: string;
    watchRuleId: string;
    evaluatedAt?: number;
  }): Promise<PreparedScheduledWatchEvaluation> {
    const rule = await watchPersistence.requireRule(
      params.accountId,
      params.watchRuleId
    );

    if (rule.status !== 'ACTIVE') {
      throw new WatchEvaluationError(
        'WATCH_NOT_ACTIVE',
        409,
        'Only ACTIVE watch rules can be evaluated.'
      );
    }

    const evaluatedAt =
      params.evaluatedAt ?? Date.now();
    const previousState =
      rule.currentState;
    const fallbackShape =
      evaluationShape(rule);

    try {
      const measured = this.measure({
        accountId: params.accountId,
        rule,
        evaluatedAt,
      });

      return {
        rule,
        evaluation: {
          accountId:
            params.accountId,
          watchRuleId: rule.id,
          ruleVersion: rule.version,
          status: 'COMPLETED',
          conditionMatched:
            measured.matched,
          observedValue:
            measured.observedValue,
          comparisonOperator:
            measured.operator,
          threshold:
            measured.threshold,
          previousConditionState:
            previousState,
          nextConditionState:
            measured.matched
              ? 'TRUE'
              : 'FALSE',
          evidence:
            measured.evidence,
          evaluatedAt,
        },
        newAlertCopy:
          measured.matched &&
          previousState !== 'TRUE'
            ? alertCopy({
                rule,
                observedValue:
                  measured.observedValue,
              })
            : undefined,
      };
    } catch (error: any) {
      return {
        rule,
        evaluation: {
          accountId:
            params.accountId,
          watchRuleId: rule.id,
          ruleVersion: rule.version,
          status: 'FAILED',
          comparisonOperator:
            fallbackShape.operator,
          threshold:
            fallbackShape.threshold,
          previousConditionState:
            previousState,
          nextConditionState:
            'ERROR',
          evaluatedAt,
          error:
            error?.message ||
            'Watch evaluation failed.',
        },
      };
    }
  }

  public async evaluate(params: {
    accountId: string;
    watchRuleId: string;
    evaluatedAt?: number;
  }): Promise<WatchEvaluationResult> {
    const rule = await watchPersistence.requireRule(
      params.accountId,
      params.watchRuleId
    );

    if (rule.status !== 'ACTIVE') {
      throw new WatchEvaluationError(
        'WATCH_NOT_ACTIVE',
        409,
        'Only ACTIVE watch rules can be evaluated.'
      );
    }

    const evaluatedAt = params.evaluatedAt ?? Date.now();
    const previousState = rule.currentState;
    const fallbackShape = evaluationShape(rule);

    try {
      const measured = this.measure({
        accountId: params.accountId,
        rule,
        evaluatedAt,
      });

      const evaluation = await watchPersistence.createEvaluation({
        accountId: params.accountId,
        watchRuleId: rule.id,
        ruleVersion: rule.version,
        status: 'COMPLETED',
        conditionMatched: measured.matched,
        observedValue: measured.observedValue,
        comparisonOperator: measured.operator,
        threshold: measured.threshold,
        previousConditionState: previousState,
        nextConditionState: measured.matched ? 'TRUE' : 'FALSE',
        evidence: measured.evidence,
        evaluatedAt,
      });

      let alert = undefined;

      if (measured.matched) {
        const activeAlert = await watchPersistence.getActiveAlertForRule(
          params.accountId,
          rule.id
        );

        if (activeAlert) {
          alert = await watchPersistence.recordRepeatedTrigger({
            accountId: params.accountId,
            alertId: activeAlert.id,
            evaluationId: evaluation.id,
            triggeredAt: evaluatedAt,
            evidence: measured.evidence,
          });
        } else if (previousState !== 'TRUE') {
          const copy = alertCopy({
            rule,
            observedValue: measured.observedValue,
          });
          alert = await watchPersistence.createAlert({
            accountId: params.accountId,
            watchRuleId: rule.id,
            ruleVersion: rule.version,
            status: 'OPEN',
            title: copy.title,
            summary: copy.summary,
            firstTriggeredAt: evaluatedAt,
            lastTriggeredAt: evaluatedAt,
            occurrenceCount: 1,
            evaluationIds: [evaluation.id],
            lastEvaluationId: evaluation.id,
            evidence: measured.evidence,
          });
        }
      } else if (previousState === 'TRUE') {
        alert =
          await watchPersistence.resolveActiveAlertForRule({
            accountId: params.accountId,
            watchRuleId: rule.id,
            at: evaluatedAt,
          }) || undefined;
      }

      const oneShotReminderCompleted =
        rule.condition.kind === 'TIME_REACHED' && measured.matched;

      const updatedRule = await watchPersistence.updateRule(
        params.accountId,
        rule.id,
        {
          status: oneShotReminderCompleted ? 'PAUSED' : rule.status,
          currentState: measured.matched ? 'TRUE' : 'FALSE',
          lastEvaluationAt: evaluatedAt,
          lastTriggeredAt: measured.matched
            ? evaluatedAt
            : rule.lastTriggeredAt,
          nextEvaluationAt: oneShotReminderCompleted
            ? undefined
            : nextEvaluationAt(rule, evaluatedAt),
        }
      );

      return {
        rule: updatedRule,
        evaluation,
        alert,
      };
    } catch (error: any) {
      const evaluation = await watchPersistence.createEvaluation({
        accountId: params.accountId,
        watchRuleId: rule.id,
        ruleVersion: rule.version,
        status: 'FAILED',
        comparisonOperator: fallbackShape.operator,
        threshold: fallbackShape.threshold,
        previousConditionState: previousState,
        nextConditionState: 'ERROR',
        evaluatedAt,
        error: error?.message || 'Watch evaluation failed.',
      });

      const updatedRule = await watchPersistence.updateRule(
        params.accountId,
        rule.id,
        {
          currentState: 'ERROR',
          lastEvaluationAt: evaluatedAt,
          nextEvaluationAt: nextEvaluationAt(rule, evaluatedAt),
        }
      );

      return {
        rule: updatedRule,
        evaluation,
      };
    }
  }

  private measure(params: {
    accountId: string;
    rule: WatchRule;
    evaluatedAt: number;
  }): Measurement {
    const condition = params.rule.condition;

    if (condition.kind === 'ENTITY_NUMERIC_THRESHOLD') {
      const entity = companyKnowledgeStore.requireEntity(
        params.accountId,
        condition.entityId
      );
      const state = effectiveCompanyStateService.resolve(
        params.accountId,
        entity.id,
        condition.predicate
      );

      if (state.status === 'MISSING') {
        throw new WatchEvaluationError(
          'WATCH_STATE_MISSING',
          422,
          'The watched entity does not currently have ' +
            condition.predicate +
            '.'
        );
      }
      if (state.status === 'CONFLICT') {
        throw new WatchEvaluationError(
          'WATCH_STATE_CONFLICT',
          422,
          'The watched entity has conflicting highest-authority values for ' +
            condition.predicate +
            '.'
        );
      }
      if (typeof state.value !== 'number') {
        throw new WatchEvaluationError(
          'WATCH_STATE_TYPE_MISMATCH',
          422,
          'The watched entity value for ' +
            condition.predicate +
            ' is not numeric.'
        );
      }

      const evidence: WatchEntityEvidence = {
        sourceType: 'ENTITY',
        entityId: entity.id,
        entityLabel: entity.canonicalName,
        predicate: condition.predicate,
        effectiveClaimId: state.effectiveClaim.id,
        effectiveValue: state.value,
        authorityLevel: state.effectiveClaim.authority.level,
        sourceName: state.effectiveClaim.sourceRef.sourceName,
        sourceVersionId:
          state.effectiveClaim.sourceRef.sourceVersionId,
      };

      return {
        observedValue: state.value,
        evidence,
        operator: condition.operator,
        threshold: condition.threshold,
        matched: compare(
          state.value,
          condition.operator,
          condition.threshold
        ),
      };
    }

    if (condition.kind === 'ENTITY_DATE_WINDOW') {
      const entity = companyKnowledgeStore.requireEntity(
        params.accountId,
        condition.entityId
      );
      const state = effectiveCompanyStateService.resolve(
        params.accountId,
        entity.id,
        condition.predicate
      );

      if (state.status === 'MISSING') {
        throw new WatchEvaluationError(
          'WATCH_STATE_MISSING',
          422,
          'The watched entity does not currently have ' +
            condition.predicate +
            '.'
        );
      }
      if (state.status === 'CONFLICT') {
        throw new WatchEvaluationError(
          'WATCH_STATE_CONFLICT',
          422,
          'The watched entity has conflicting highest-authority values for ' +
            condition.predicate +
            '.'
        );
      }

      const targetAt = parseDateValue(state.value);
      if (targetAt === null || typeof state.value !== 'string') {
        throw new WatchEvaluationError(
          'WATCH_STATE_TYPE_MISMATCH',
          422,
          'The watched entity value for ' +
            condition.predicate +
            ' is not a parseable date.'
        );
      }

      const daysUntil = Math.ceil(
        (utcDayStart(targetAt) - utcDayStart(params.evaluatedAt)) /
          DAY_MS
      );
      const matched =
        daysUntil >= 0 && daysUntil <= condition.daysBefore;

      const evidence: WatchDateEvidence = {
        sourceType: 'ENTITY_DATE',
        entityId: entity.id,
        entityLabel: entity.canonicalName,
        predicate: condition.predicate,
        effectiveClaimId: state.effectiveClaim.id,
        dateValue: state.value,
        targetAt,
        evaluatedAt: params.evaluatedAt,
        daysUntil,
        authorityLevel: state.effectiveClaim.authority.level,
        sourceName: state.effectiveClaim.sourceRef.sourceName,
        sourceVersionId:
          state.effectiveClaim.sourceRef.sourceVersionId,
      };

      return {
        observedValue: daysUntil,
        evidence,
        operator: 'LTE',
        threshold: condition.daysBefore,
        matched,
      };
    }

    if (condition.kind === 'TIME_REACHED') {
      const evidence: WatchTimeEvidence = {
        sourceType: 'TIME',
        triggerAt: condition.triggerAt,
        evaluatedAt: params.evaluatedAt,
        timezone: condition.timezone,
      };

      return {
        observedValue: params.evaluatedAt,
        evidence,
        operator: 'GTE',
        threshold: condition.triggerAt,
        matched: params.evaluatedAt >= condition.triggerAt,
      };
    }

    const alias = 'watch_value';
    const result = structuredAnalyticsEngine.execute({
      accountId: params.accountId,
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

    const raw = result.rows[0]?.[alias];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new WatchEvaluationError(
        'WATCH_RESULT_INVALID',
        422,
        'Dataset watch did not produce a finite numeric aggregate.'
      );
    }

    const evidence: WatchDatasetEvidence = {
      sourceType: 'DATASET',
      datasetId: result.provenance.datasetId,
      datasetVersionId: result.provenance.datasetVersionId,
      datasetVersionNumber:
        result.provenance.datasetVersionNumber,
      sourceFilename: result.provenance.sourceFilename,
      sourceSha256: result.provenance.sourceSha256,
      tableId: result.provenance.tableId,
      tableName: result.provenance.tableName,
      aggregateOperator: condition.aggregate.operator,
      aggregateColumn: condition.aggregate.column,
      filters: result.provenance.filters,
      matchedRowCount: result.provenance.matchedRowCount,
      observedValue: raw,
      companyStateOverlay:
        result.provenance.companyStateOverlay,
    };

    return {
      observedValue: raw,
      evidence,
      operator: condition.operator,
      threshold: condition.threshold,
      matched: compare(
        raw,
        condition.operator,
        condition.threshold
      ),
    };
  }
}

export const watchRuntimeEvaluator = new WatchRuntimeEvaluator();
