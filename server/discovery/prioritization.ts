import { Insight } from './types.js';

function numericEvidence(insight: Insight, key: string): number | null {
  const value = insight.evidence.values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function prioritizeInsight(insight: Insight): Insight {
  const reasons: string[] = [];

  const severityScore =
    insight.severity === 'HIGH' ? 45 : insight.severity === 'MEDIUM' ? 30 : 15;
  reasons.push('severity:' + insight.severity.toLowerCase());

  const typeScore =
    insight.type === 'DEADLINE'
      ? 22
      : insight.type === 'RISK'
        ? 20
        : insight.type === 'ANOMALY'
          ? 18
          : insight.type === 'OPPORTUNITY'
            ? 16
            : insight.type === 'CHANGE'
              ? 14
              : 8;
  reasons.push('type:' + insight.type.toLowerCase());

  const confidenceScore = Math.round(insight.confidence * 20);
  if (insight.confidence >= 0.95) reasons.push('high-confidence');

  let impactScore = 0;
  const affectedRatio =
    numericEvidence(insight, 'affectedRatio') ??
    numericEvidence(insight, 'duplicateRatio') ??
    numericEvidence(insight, 'missingRatio');

  if (affectedRatio !== null) {
    impactScore = Math.max(impactScore, Math.min(10, Math.round(affectedRatio * 20)));
    if (affectedRatio >= 0.2) reasons.push('broad-impact');
  }

  const percentChange = numericEvidence(insight, 'percentChange');
  if (percentChange !== null) {
    const magnitude = Math.abs(percentChange);
    impactScore = Math.max(impactScore, Math.min(10, Math.round(magnitude / 5)));
    if (magnitude >= 25) reasons.push('material-change');
  }

  const stockouts = numericEvidence(insight, 'stockoutRecords');
  if (stockouts !== null && stockouts > 0) {
    impactScore = 10;
    reasons.push('stockout');
  }

  const affectedRecords = numericEvidence(insight, 'affectedRecords');
  if (affectedRecords !== null && affectedRecords >= 3) {
    impactScore = Math.max(impactScore, 6);
    reasons.push('multiple-records');
  }

  return {
    ...insight,
    priorityScore: Math.min(
      100,
      severityScore + typeScore + confidenceScore + impactScore
    ),
    priorityReasons: Array.from(new Set(reasons)),
  };
}
