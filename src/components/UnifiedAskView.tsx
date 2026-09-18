import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Database,
  FileText,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  DatasetSummary,
  UnifiedAnalyticsResponse,
  UnifiedDocumentResponse,
  UnifiedQueryResponse,
} from '../datasetTypes';

type SessionMessage =
  | {
      id: string;
      role: 'user';
      content: string;
      timestamp: number;
    }
  | {
      id: string;
      role: 'assistant';
      content: string;
      timestamp: number;
      response: UnifiedQueryResponse;
    };

interface UnifiedAskViewProps {
  activeKnowledgeBaseId?: string;
  activeKnowledgeBaseName?: string;
  documentCount: number;
  preferredDatasetId?: string | null;
}

function sourceLabel(response: UnifiedQueryResponse): string {
  return response.route === 'DATASET_ANALYTICS'
    ? 'Business data'
    : 'Documents';
}

function routeIcon(response: UnifiedQueryResponse) {
  return response.route === 'DATASET_ANALYTICS' ? BarChart3 : BookOpen;
}

export const UnifiedAskView: React.FC<UnifiedAskViewProps> = ({
  activeKnowledgeBaseId,
  activeKnowledgeBaseName,
  documentCount,
  preferredDatasetId,
}) => {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoadingDatasets(true);
      try {
        const response = await fetch('/api/datasets');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not load datasets.');
        const next = body.datasets || [];
        setDatasets(next);
        setSelectedDatasetId((current) => {
          if (preferredDatasetId && next.some((item: DatasetSummary) => item.id === preferredDatasetId)) {
            return preferredDatasetId;
          }
          if (current && next.some((item: DatasetSummary) => item.id === current)) {
            return current;
          }
          return next[0]?.id || '';
        });
      } catch (err: any) {
        setError(err.message || 'Could not load datasets.');
      } finally {
        setIsLoadingDatasets(false);
      }
    };
    load();
  }, [preferredDatasetId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) || null,
    [datasets, selectedDatasetId]
  );

  const hasSources = Boolean(selectedDatasetId || (activeKnowledgeBaseId && documentCount > 0));

  const ask = async (nextQuestion: string) => {
    const clean = nextQuestion.trim();
    if (!clean || isSending || !hasSources) return;

    setQuestion('');
    setError(null);
    setIsSending(true);
    const userMessage: SessionMessage = {
      id: 'user_' + Date.now(),
      role: 'user',
      content: clean,
      timestamp: Date.now(),
    };
    setMessages((current) => [...current, userMessage]);

    try {
      const response = await fetch('/api/query/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: clean,
          datasetId: selectedDatasetId || undefined,
          knowledgeBaseId:
            activeKnowledgeBaseId && documentCount > 0
              ? activeKnowledgeBaseId
              : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Knowledge AI could not answer that question.');

      const result = body as UnifiedQueryResponse;
      setMessages((current) => [
        ...current,
        {
          id: 'assistant_' + Date.now(),
          role: 'assistant',
          content:
            result.route === 'DATASET_ANALYTICS' && result.explanation
              ? result.answer + '\n\n' + result.explanation
              : result.answer,
          timestamp: Date.now(),
          response: result,
        },
      ]);
    } catch (err: any) {
      setError(err.message || 'Knowledge AI could not answer that question.');
    } finally {
      setIsSending(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    ask(question);
  };

  const suggestions = selectedDatasetId
    ? [
        'How much revenue did we make this month?',
        'Which product generated the most revenue?',
        'Which customers still owe money?',
        'Compare August and September revenue.',
      ]
    : [
        'Summarize the most important policy in these documents.',
        'What deadlines or requirements should I know about?',
        'What does the handbook say about annual leave?',
      ];

  return (
    <main className="flex-1 min-h-0 overflow-hidden bg-[#f7f7f3] flex flex-col">
      <div className="shrink-0 border-b border-slate-200/80 bg-[#fbfbf8] px-5 md:px-8 py-4">
        <div className="max-w-5xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-950 text-white flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-950">Ask your business</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Knowledge AI chooses structured calculations or document evidence based on your question.
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <label className="relative">
              <span className="sr-only">Dataset</span>
              <select
                value={selectedDatasetId}
                onChange={(event) => setSelectedDatasetId(event.target.value)}
                disabled={isLoadingDatasets}
                className="appearance-none rounded-xl border border-slate-200 bg-white pl-8 pr-8 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-800"
              >
                <option value="">No dataset</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </select>
              <Database className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-emerald-700 pointer-events-none" />
              <ChevronDown className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </label>

            {activeKnowledgeBaseId && documentCount > 0 && (
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>{activeKnowledgeBaseName || 'Documents'}</span>
                <span className="text-slate-400">({documentCount})</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-7">
        <div className="max-w-4xl mx-auto">
          {messages.length === 0 && (
            <section className="pt-6 md:pt-12 pb-8">
              <div className="max-w-2xl">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Answers from your own information
                </div>
                <h3 className="mt-3 text-3xl md:text-4xl font-semibold tracking-[-0.035em] text-slate-950 leading-[1.08]">
                  Ask the question. The system decides how to prove the answer.
                </h3>
                <p className="mt-4 text-sm leading-6 text-slate-500 max-w-xl">
                  Numbers are calculated from imported data. Policies and facts are retrieved from
                  documents. The model can interpret and explain, but it does not become the source
                  of truth.
                </p>
              </div>

              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    disabled={!hasSources || isSending}
                    className="group text-left rounded-xl border border-slate-200 bg-white px-4 py-3.5 hover:border-slate-300 hover:shadow-sm disabled:opacity-40 transition-all"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-slate-700">{suggestion}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-700 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>

              {!hasSources && (
                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  Add a dataset or upload a document before asking a business question.
                </div>
              )}
            </section>
          )}

          <div className="space-y-6">
            {messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-2xl rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-sm text-white shadow-sm">
                      {message.content}
                    </div>
                  </div>
                );
              }

              const Icon = routeIcon(message.response);
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-800 flex items-center justify-center">
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-[11px] font-semibold text-slate-700">
                          {sourceLabel(message.response)}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-medium">
                        <ShieldCheck className="w-3 h-3" />
                        Evidence attached
                      </span>
                    </div>

                    <div className="px-5 py-4">
                      <div className="prose prose-sm max-w-none text-slate-800 text-sm leading-6">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>

                      {message.response.route === 'DATASET_ANALYTICS' ? (
                        <AnalyticsEvidence response={message.response} />
                      ) : (
                        <DocumentEvidence response={message.response} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isSending && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                    <span>Checking your sources and calculating the answer…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-[#fbfbf8] px-4 md:px-8 py-4">
        <form onSubmit={submit} className="max-w-4xl mx-auto">
          {error && (
            <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-300">
            <textarea
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (question.trim()) ask(question);
                }
              }}
              disabled={isSending || !hasSources}
              placeholder={
                hasSources
                  ? 'Ask about sales, customers, inventory, policies, contracts, or anything in your business knowledge…'
                  : 'Add business data or documents first…'
              }
              className="w-full resize-none bg-transparent px-2 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between gap-3 px-1 pb-1">
              <div className="flex items-center gap-3 text-[10px] text-slate-400">
                {selectedDataset && (
                  <span className="inline-flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    {selectedDataset.name}
                  </span>
                )}
                {documentCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    {documentCount} doc{documentCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={!question.trim() || isSending || !hasSources}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-35"
              >
                {isSending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Ask
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-400 px-1">
            <span>LLM for language. Deterministic code for business calculations.</span>
            <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
          </div>
        </form>
      </div>
    </main>
  );
};

const AnalyticsEvidence: React.FC<{ response: UnifiedAnalyticsResponse }> = ({ response }) => {
  const provenance = response.result.provenance;
  const rows = response.result.rows || [];

  return (
    <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/40 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-emerald-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-900">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Calculated from dataset version {provenance.datasetVersionNumber}
        </div>
        <span className="text-[10px] text-emerald-700">
          Plan: {response.planSource === 'DETERMINISTIC' ? 'deterministic' : 'validated AI plan'}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto border-b border-emerald-100">
          <table className="min-w-full text-left text-[11px]">
            <thead>
              <tr>
                {Object.keys(rows[0]).map((key) => (
                  <th key={key} className="px-3 py-2 font-semibold text-slate-600">
                    {key.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-emerald-100/70">
                  {Object.keys(rows[0]).map((key) => (
                    <td key={key} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                      {row[key] === null ? '—' : String(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {'firstPeriod' in response.result && response.result.firstPeriod && response.result.secondPeriod && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-emerald-100 border-b border-emerald-100">
          <MetricBlock
            label={response.result.firstPeriod.range.label}
            value={String(response.result.firstPeriod.value)}
          />
          <MetricBlock
            label={response.result.secondPeriod.range.label}
            value={String(response.result.secondPeriod.value)}
          />
          <MetricBlock
            label="Change"
            value={
              String(response.result.absoluteChange ?? 0) +
              (response.result.percentChange === null || response.result.percentChange === undefined
                ? ''
                : ' (' + response.result.percentChange.toFixed(1) + '%)')
            }
          />
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer list-none px-3.5 py-2.5 flex items-center justify-between gap-3 text-[10px] text-slate-500">
          <span>
            {provenance.sourceFilename} · {provenance.tableName} · scanned{' '}
            {provenance.scannedRowCount.toLocaleString()} rows
          </span>
          <span className="text-emerald-700">View provenance</span>
        </summary>
        <div className="px-3.5 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-slate-500">
          <div>
            <span className="font-semibold text-slate-600">Version ID:</span>{' '}
            <span className="font-mono">{provenance.datasetVersionId}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Matched rows:</span>{' '}
            {provenance.matchedRowCount ??
              (provenance.firstPeriodMatchedRowCount || 0) +
                (provenance.secondPeriodMatchedRowCount || 0)}
          </div>
          <div className="sm:col-span-2">
            <span className="font-semibold text-slate-600">Source SHA-256:</span>{' '}
            <span className="font-mono break-all">{provenance.sourceSha256}</span>
          </div>
        </div>
      </details>
    </div>
  );
};

const DocumentEvidence: React.FC<{ response: UnifiedDocumentResponse }> = ({ response }) => (
  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden">
    <div className="px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-700">
        <BookOpen className="w-3.5 h-3.5" />
        Document evidence
      </div>
      <span className="text-[10px] text-slate-400">
        {response.grounded ? 'Grounded' : response.refused ? 'Insufficient evidence' : response.engineUsed}
      </span>
    </div>
    {response.sources.length === 0 ? (
      <div className="px-3.5 py-3 text-[11px] text-slate-500">
        No source excerpt was returned for this answer.
      </div>
    ) : (
      <div className="p-2.5 space-y-2">
        {response.sources.slice(0, 6).map((source, index) => (
          <div key={index} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-slate-700">{source.document_name}</span>
              {source.page && <span className="text-slate-400">Page {source.page}</span>}
            </div>
            {source.section && (
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">{source.section}</div>
            )}
            {source.excerpt && (
              <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{source.excerpt}</p>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

const MetricBlock: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white/70 px-3.5 py-3">
    <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
  </div>
);
