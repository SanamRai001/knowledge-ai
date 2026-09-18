import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Database,
  FileText,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { DatasetSummary } from '../datasetTypes';
import {
  Insight,
  InsightSeverity,
  InsightStatus,
  InsightType,
} from '../insightTypes';

interface InsightsWorkspaceProps {
  activeKnowledgeBaseId?: string;
  activeKnowledgeBaseName?: string;
  documentCount: number;
  onOpenDataset?: (datasetId: string) => void;
}

type SourceFilter =
  | { kind: 'ALL'; id: 'all'; label: 'All sources' }
  | { kind: 'DATASET'; id: string; label: string }
  | { kind: 'DOCUMENT'; id: string; label: string };

const TYPE_FILTERS: Array<{ value: InsightType | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'RISK', label: 'Risks' },
  { value: 'ANOMALY', label: 'Anomalies' },
  { value: 'CHANGE', label: 'Changes' },
  { value: 'OPPORTUNITY', label: 'Opportunities' },
  { value: 'DEADLINE', label: 'Deadlines' },
  { value: 'DATA_QUALITY', label: 'Data quality' },
];

const STATUS_FILTERS: Array<{ value: InsightStatus | 'ALL'; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'ALL', label: 'All status' },
];

function severityClasses(severity: InsightSeverity): string {
  if (severity === 'HIGH') return 'bg-red-50 text-red-700 border-red-200';
  if (severity === 'MEDIUM') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function typeIcon(type: InsightType) {
  if (type === 'OPPORTUNITY') return Lightbulb;
  if (type === 'CHANGE') return TrendingUp;
  if (type === 'DEADLINE') return Clock3;
  if (type === 'DATA_QUALITY') return ShieldCheck;
  if (type === 'ANOMALY') return CircleDot;
  return AlertTriangle;
}

function typeLabel(type: InsightType): string {
  if (type === 'DATA_QUALITY') return 'Data quality';
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value;
}

function sourceName(insight: Insight, datasets: DatasetSummary[]): string {
  if (insight.evidence.sourceType === 'DOCUMENT') {
    return insight.evidence.sourceFilename;
  }
  return (
    datasets.find((dataset) => dataset.id === insight.datasetId)?.name ||
    insight.evidence.sourceFilename
  );
}

function whyItMatters(type: InsightType): string {
  switch (type) {
    case 'RISK':
      return 'A measured condition crossed a business-risk threshold and may deserve attention.';
    case 'ANOMALY':
      return 'The latest measured period differs materially from the recent baseline.';
    case 'CHANGE':
      return 'A material measured change was detected compared with earlier data or a previous version.';
    case 'OPPORTUNITY':
      return 'The data shows a comparatively favorable measured pattern worth investigating.';
    case 'DEADLINE':
      return 'An explicit future date appears in source text with deadline, due, expiry, or renewal language.';
    case 'DATA_QUALITY':
      return 'Missing or duplicate data can weaken the reliability of downstream analysis.';
  }
}

export const InsightsWorkspace: React.FC<InsightsWorkspaceProps> = ({
  activeKnowledgeBaseId,
  activeKnowledgeBaseName,
  documentCount,
  onOpenDataset,
}) => {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>({
    kind: 'ALL',
    id: 'all',
    label: 'All sources',
  });
  const [typeFilter, setTypeFilter] = useState<InsightType | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<InsightStatus | 'ALL'>('OPEN');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    const response = await fetch('/api/datasets');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not load data sources.');
    setDatasets(body.datasets || []);
  }, []);

  const loadInsights = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('latestRunOnly', 'false');
      params.set('limit', '100');

      if (sourceFilter.kind === 'DATASET') {
        params.set('datasetId', sourceFilter.id);
      } else if (sourceFilter.kind === 'DOCUMENT') {
        params.set('knowledgeBaseId', sourceFilter.id);
      }

      if (statusFilter !== 'ALL') params.set('status', statusFilter);

      const response = await fetch('/api/insights?' + params.toString());
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load insights.');
      setInsights(body.insights || []);
    } catch (err: any) {
      setError(err.message || 'Could not load insights.');
    } finally {
      setIsLoading(false);
    }
  }, [sourceFilter, statusFilter]);

  useEffect(() => {
    loadSources().catch((err: any) =>
      setError(err.message || 'Could not load data sources.')
    );
  }, [loadSources]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const sourceOptions: SourceFilter[] = useMemo(() => {
    const options: SourceFilter[] = [
      { kind: 'ALL', id: 'all', label: 'All sources' },
      ...datasets.map(
        (dataset): SourceFilter => ({
          kind: 'DATASET',
          id: dataset.id,
          label: dataset.name,
        })
      ),
    ];

    if (activeKnowledgeBaseId && documentCount > 0) {
      options.push({
        kind: 'DOCUMENT',
        id: activeKnowledgeBaseId,
        label: activeKnowledgeBaseName || 'Documents',
      });
    }
    return options;
  }, [
    datasets,
    activeKnowledgeBaseId,
    activeKnowledgeBaseName,
    documentCount,
  ]);

  const visibleInsights = useMemo(
    () =>
      insights
        .filter(
          (insight) => typeFilter === 'ALL' || insight.type === typeFilter
        )
        .slice(0, 24),
    [insights, typeFilter]
  );

  const analyzeNow = async () => {
    const targets: Array<Record<string, string>> = [];

    if (sourceFilter.kind === 'DATASET') {
      targets.push({ datasetId: sourceFilter.id });
    } else if (sourceFilter.kind === 'DOCUMENT') {
      targets.push({ knowledgeBaseId: sourceFilter.id });
    } else {
      datasets.forEach((dataset) => targets.push({ datasetId: dataset.id }));
      if (activeKnowledgeBaseId && documentCount > 0) {
        targets.push({ knowledgeBaseId: activeKnowledgeBaseId });
      }
    }

    if (targets.length === 0) {
      setError('Add a dataset or processed document before running discovery.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setNotice(null);

    try {
      const results = await Promise.all(
        targets.map(async (target) => {
          const response = await fetch('/api/insights/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(target),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error || 'One source could not be analyzed.');
          }
          return body;
        })
      );

      const findingCount = results.reduce(
        (sum, result) => sum + (result.insights?.length || 0),
        0
      );
      setNotice(
        'Analysis complete across ' +
          targets.length +
          ' source' +
          (targets.length === 1 ? '' : 's') +
          '. ' +
          findingCount +
          ' finding' +
          (findingCount === 1 ? '' : 's') +
          ' observed.'
      );
      await loadInsights();
    } catch (err: any) {
      setError(err.message || 'Discovery analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateStatus = async (insight: Insight, status: InsightStatus) => {
    setUpdatingId(insight.id);
    setError(null);
    try {
      const response = await fetch('/api/insights/' + insight.id + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not update insight.');
      await loadInsights();
    } catch (err: any) {
      setError(err.message || 'Could not update insight.');
    } finally {
      setUpdatingId(null);
    }
  };

  const openCount = insights.filter((insight) => insight.status === 'OPEN').length;
  const highCount = insights.filter(
    (insight) => insight.status === 'OPEN' && insight.severity === 'HIGH'
  ).length;

  return (
    <main className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-7 md:py-9">
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-7">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-2">
              Things worth your attention
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] text-slate-950 leading-[1.08]">
              Knowledge AI looks for what you did not know to ask.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Findings are calculated from your data or extracted from explicit document evidence.
              The most important open items rise to the top.
            </p>
          </div>

          <button
            type="button"
            onClick={analyzeNow}
            disabled={isAnalyzing}
            className="inline-flex items-center justify-center gap-2 self-start lg:self-auto rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45 shadow-sm"
          >
            {isAnalyzing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Analyze now
          </button>
        </section>

        {(notice || error) && (
          <div
            className={
              'mb-5 rounded-xl border px-4 py-3 text-xs ' +
              (error
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800')
            }
          >
            {error || notice}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <QuietMetric
            label="Needs attention"
            value={String(openCount)}
            note="Open findings in this view"
          />
          <QuietMetric
            label="High severity"
            value={String(highCount)}
            note="Open findings"
          />
          <QuietMetric
            label="Sources available"
            value={String(
              datasets.length +
                (activeKnowledgeBaseId && documentCount > 0 ? 1 : 0)
            )}
            note="Datasets + active document workspace"
          />
        </div>

        <section className="mb-5 flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center gap-2.5">
            <label className="relative">
              <span className="sr-only">Insight source</span>
              <select
                value={sourceFilter.kind + ':' + sourceFilter.id}
                onChange={(event) => {
                  const option = sourceOptions.find(
                    (item) =>
                      item.kind + ':' + item.id === event.target.value
                  );
                  if (option) setSourceFilter(option);
                }}
                className="appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-9 py-2.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700"
              >
                {sourceOptions.map((option) => (
                  <option
                    key={option.kind + ':' + option.id}
                    value={option.kind + ':' + option.id}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              <Search className="absolute left-3 top-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <ChevronDown className="absolute right-3 top-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </label>

            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  className={
                    'rounded-lg px-2.5 py-2 text-[11px] font-medium border transition-colors ' +
                    (statusFilter === filter.value
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-200 hover:text-slate-800')
                  }
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setTypeFilter(filter.value)}
                className={
                  'rounded-full px-3 py-1.5 text-[10px] font-semibold border transition-colors ' +
                  (typeFilter === filter.value
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')
                }
              >
                {filter.label}
              </button>
            ))}
          </div>
        </section>

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-700" />
            <p className="mt-3 text-xs text-slate-500">Loading findings…</p>
          </div>
        ) : visibleInsights.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-800">
              Nothing matches this view.
            </h3>
            <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
              Run analysis after importing business data or documents. Knowledge AI only surfaces a
              finding when a detector has enough evidence to support it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleInsights.map((insight, index) => {
              const Icon = typeIcon(insight.type);
              const expanded = expandedId === insight.id;

              return (
                <article
                  key={insight.id}
                  className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : insight.id)}
                    className="w-full text-left px-5 py-4 md:px-6 md:py-5"
                  >
                    <div className="flex items-start gap-4">
                      <div className="pt-0.5 text-slate-500">
                        <Icon className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {index < 3 && insight.status === 'OPEN' && (
                            <span className="text-[10px] font-semibold text-emerald-700">
                              Top attention
                            </span>
                          )}
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {typeLabel(insight.type)}
                          </span>
                          <span
                            className={
                              'rounded-full border px-2 py-0.5 text-[9px] font-bold ' +
                              severityClasses(insight.severity)
                            }
                          >
                            {insight.severity}
                          </span>
                          {insight.status !== 'OPEN' && (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-500">
                              {insight.status === 'ACKNOWLEDGED'
                                ? 'Acknowledged'
                                : 'Resolved'}
                            </span>
                          )}
                        </div>

                        <h3 className="text-base md:text-lg font-semibold tracking-tight text-slate-900">
                          {insight.title}
                        </h3>
                        <p className="mt-1.5 text-xs md:text-sm leading-5 text-slate-500 max-w-3xl">
                          {insight.summary}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            {insight.evidence.sourceType === 'DATASET' ? (
                              <Database className="w-3 h-3" />
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            {sourceName(insight, datasets)}
                          </span>
                          <span>{Math.round(insight.confidence * 100)}% confidence</span>
                          <span>
                            Last seen {new Date(insight.lastSeenAt).toLocaleString()}
                          </span>
                          {insight.occurrenceCount > 1 && (
                            <span>Seen {insight.occurrenceCount} times</span>
                          )}
                        </div>
                      </div>

                      <ChevronDown
                        className={
                          'w-4 h-4 text-slate-300 shrink-0 transition-transform ' +
                          (expanded ? 'rotate-180' : '')
                        }
                      />
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-100 bg-[#fcfcfa] px-5 py-5 md:px-6">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                            Why this matters
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-600">
                            {whyItMatters(insight.type)}
                          </p>

                          <div className="mt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                            How it was measured
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-600">
                            {insight.evidence.calculation}
                          </p>

                          {insight.evidence.excerpt && (
                            <>
                              <div className="mt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                Source excerpt
                              </div>
                              <blockquote className="mt-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-xs leading-5 text-slate-600">
                                “{insight.evidence.excerpt}”
                              </blockquote>
                            </>
                          )}
                        </div>

                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                            Evidence
                          </div>
                          <div className="mt-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
                            {Object.entries(insight.evidence.values).map(
                              ([key, value]) => (
                                <div
                                  key={key}
                                  className="flex items-start justify-between gap-4 px-3.5 py-2.5 border-b border-slate-100 last:border-b-0"
                                >
                                  <span className="text-[10px] text-slate-400">
                                    {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                                  </span>
                                  <span className="text-[11px] font-medium text-slate-700 text-right">
                                    {formatValue(value)}
                                  </span>
                                </div>
                              )
                            )}
                          </div>

                          <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[10px] leading-5 text-slate-400">
                            {insight.evidence.sourceType === 'DATASET' ? (
                              <>
                                Dataset version {insight.evidence.datasetVersionNumber ?? '—'}
                                {insight.evidence.tableName
                                  ? ' · ' + insight.evidence.tableName
                                  : ''}
                                {insight.evidence.sourceSha256 ? (
                                  <>
                                    <br />
                                    <span className="font-mono break-all">
                                      {insight.evidence.sourceSha256}
                                    </span>
                                  </>
                                ) : null}
                              </>
                            ) : (
                              <>
                                {insight.evidence.sourceFilename}
                                {insight.evidence.pageNumber
                                  ? ' · Page ' + insight.evidence.pageNumber
                                  : ''}
                                {insight.evidence.knowledgeVersionTag
                                  ? ' · ' + insight.evidence.knowledgeVersionTag
                                  : ''}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {insight.evidence.rowReferences &&
                        insight.evidence.rowReferences.length > 0 && (
                          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="min-w-full text-left text-[10px]">
                              <thead className="bg-slate-50 text-slate-400">
                                <tr>
                                  <th className="px-3 py-2 font-medium">Row</th>
                                  {Object.keys(
                                    insight.evidence.rowReferences[0].values
                                  ).map((key) => (
                                    <th key={key} className="px-3 py-2 font-medium">
                                      {key}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {insight.evidence.rowReferences.map((row) => (
                                  <tr key={row.rowIndex}>
                                    <td className="px-3 py-2 text-slate-400">
                                      {row.rowIndex + 1}
                                    </td>
                                    {Object.values(row.values).map((value, cellIndex) => (
                                      <td
                                        key={cellIndex}
                                        className="px-3 py-2 text-slate-600 whitespace-nowrap"
                                      >
                                        {formatValue(value)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {insight.datasetId && onOpenDataset && (
                            <button
                              type="button"
                              onClick={() => onOpenDataset(insight.datasetId!)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:border-slate-300"
                            >
                              View dataset
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {insight.status !== 'OPEN' && (
                            <button
                              type="button"
                              disabled={updatingId === insight.id}
                              onClick={() => updateStatus(insight, 'OPEN')}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-40"
                            >
                              Reopen
                            </button>
                          )}
                          {insight.status === 'OPEN' && (
                            <button
                              type="button"
                              disabled={updatingId === insight.id}
                              onClick={() =>
                                updateStatus(insight, 'ACKNOWLEDGED')
                              }
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-40"
                            >
                              Acknowledge
                            </button>
                          )}
                          {insight.status !== 'RESOLVED' && (
                            <button
                              type="button"
                              disabled={updatingId === insight.id}
                              onClick={() => updateStatus(insight, 'RESOLVED')}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                            >
                              {updatingId === insight.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              Resolve
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 text-[10px] text-slate-400">
          <span>
            Insights are ordered by measured priority, then recency. Repeated findings are deduplicated.
          </span>
          <button
            type="button"
            onClick={() => loadInsights()}
            className="inline-flex items-center gap-1.5 hover:text-slate-700"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>
    </main>
  );
};

const QuietMetric: React.FC<{
  label: string;
  value: string;
  note: string;
}> = ({ label, value, note }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
      {label}
    </div>
    <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
      {value}
    </div>
    <div className="mt-0.5 text-[10px] text-slate-400">{note}</div>
  </div>
);
