import { structuredAnalyticsEngine } from '../datasets/structuredAnalyticsEngine.js';
import { companyKnowledgeStore } from '../companyKnowledge/companyKnowledgeStore.js';
import { effectiveCompanyStateService } from '../companyKnowledge/effectiveCompanyStateService.js';
import { watchStore } from './watchStore.js';
import {
  WatchComparisonOperator,
  WatchDatasetEvidence,
  WatchEntityEvidence,
  WatchEvaluationResult,
  WatchEvidence,
  WatchRule,
} from './types.js';

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

export class WatchEvaluator {
  public evaluate(params: {
    accountId: string;
    watchRuleId: string;
    evaluatedAt?: number;
  }): WatchEvaluationResult {
    const rule = watchStore.requireRule(
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

    try {
      const measured = this.measure({
        accountId: params.accountId,
        rule,
      });
      const threshold = rule.condition.threshold;
      const operator = rule.condition.operator;
      const matched = compare(
        measured.observedValue,
        operator,
        threshold
      );

      const evaluation = watchStore.createEvaluation({
        accountId: params.accountId,
        watchRuleId: rule.id,
        ruleVersion: rule.version,
        status: 'COMPLETED',
        conditionMatched: matched,
        observedValue: measured.observedValue,
        comparisonOperator: operator,
        threshold,
        previousConditionState: previousState,
        nextConditionState: matched ? 'TRUE' : 'FALSE',
        evidence: measured.evidence,
        evaluatedAt,
      });

      let alert = undefined;

      if (matched) {
        const activeAlert = watchStore.getActiveAlertForRule(
          params.accountId,
          rule.id
        );

        if (activeAlert) {
          alert = watchStore.recordRepeatedTrigger({
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
          alert = watchStore.createAlert({
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
        watchStore.resolveActiveAlertForRule({
          accountId: params.accountId,
          watchRuleId: rule.id,
          at: evaluatedAt,
        });
      }

      const updatedRule = watchStore.updateRule(
        params.accountId,
        rule.id,
        {
          currentState: matched ? 'TRUE' : 'FALSE',
          lastEvaluationAt: evaluatedAt,
          lastTriggeredAt: matched
            ? evaluatedAt
            : rule.lastTriggeredAt,
          nextEvaluationAt: nextEvaluationAt(rule, evaluatedAt),
        }
      );

      return {
        rule: updatedRule,
        evaluation,
        alert,
      };
    } catch (error: any) {
      if (error instanceof WatchEvaluationError) throw error;

      const evaluation = watchStore.createEvaluation({
        accountId: params.accountId,
        watchRuleId: rule.id,
        ruleVersion: rule.version,
        status: 'FAILED',
        comparisonOperator: rule.condition.operator,
        threshold: rule.condition.threshold,
        previousConditionState: previousState,
        nextConditionState: 'ERROR',
        evaluatedAt,
        error: error?.message || 'Watch evaluation failed.',
      });

      const updatedRule = watchStore.updateRule(
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
  }): {
    observedValue: number;
    evidence: WatchEvidence;
  } {
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
    };
  }
}

export const watchEvaluator = new WatchEvaluator();
