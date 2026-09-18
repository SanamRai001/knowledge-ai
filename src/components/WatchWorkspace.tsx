import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  TimerReset,
  X,
} from 'lucide-react';
import {
  WatchAlert,
  WatchCondition,
  WatchDraft,
  WatchEvaluation,
  WatchJob,
  WatchRule,
  WatchRuleStatus,
} from '../watchTypes';

type RuleDetail = {
  rule: WatchRule;
  evaluations: WatchEvaluation[];
  alerts: WatchAlert[];
};

function pretty(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function number(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value);
}

function dateTime(value?: number): string {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleString();
}

function operatorLabel(value: string): string {
  const labels: Record<string, string> = {
    GT: '>',
    GTE: '≥',
    LT: '<',
    LTE: '≤',
    EQ: '=',
    NEQ: '≠',
  };
  return labels[value] || value;
}

function conditionText(condition: WatchCondition): string {
  if (condition.kind === 'ENTITY_NUMERIC_THRESHOLD') {
    return (
      pretty(condition.predicate) +
      ' ' +
      operatorLabel(condition.operator) +
      ' ' +
      number(condition.threshold)
    );
  }

  if (condition.kind === 'DATASET_AGGREGATE_THRESHOLD') {
    const aggregate =
      condition.aggregate.operator +
      '(' +
      (condition.aggregate.column || 'rows') +
      ')';
    return (
      aggregate +
      ' ' +
      operatorLabel(condition.operator) +
      ' ' +
      number(condition.threshold)
    );
  }

  if (condition.kind === 'ENTITY_DATE_WINDOW') {
    return (
      String(condition.daysBefore) +
      ' day' +
      (condition.daysBefore === 1 ? '' : 's') +
      ' before ' +
      pretty(condition.predicate)
    );
  }

  return 'At ' + new Date(condition.triggerAt).toLocaleString();
}

function stateClass(state: WatchRule['currentState']): string {
  if (state === 'TRUE') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (state === 'ERROR') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (state === 'FALSE') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function statusClass(status: WatchAlert['status']): string {
  if (status === 'OPEN') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'ACKNOWLEDGED') {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  if (status === 'SNOOZED') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function evidenceText(alert: WatchAlert): string {
  const evidence = alert.evidence;

  if (evidence.sourceType === 'ENTITY') {
    return (
      evidence.entityLabel +
      ' · ' +
      pretty(evidence.predicate) +
      ' = ' +
      String(evidence.effectiveValue) +
      ' · ' +
      evidence.authorityLevel
    );
  }

  if (evidence.sourceType === 'ENTITY_DATE') {
    return (
      evidence.entityLabel +
      ' · ' +
      pretty(evidence.predicate) +
      ' ' +
      evidence.dateValue +
      ' · ' +
      String(evidence.daysUntil) +
      ' day(s) away'
    );
  }

  if (evidence.sourceType === 'TIME') {
    return 'Scheduled for ' + new Date(evidence.triggerAt).toLocaleString();
  }

  return (
    evidence.sourceFilename +
    ' · ' +
    evidence.tableName +
    ' · ' +
    evidence.aggregateOperator +
    '(' +
    (evidence.aggregateColumn || 'rows') +
    ') = ' +
    number(evidence.observedValue)
  );
}

export const WatchWorkspace: React.FC = () => {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [alerts, setAlerts] = useState<WatchAlert[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RuleDetail | null>(null);
  const [jobs, setJobs] = useState<WatchJob[]>([]);
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState<WatchDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProposing, setIsProposing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rulesResponse, alertsResponse] = await Promise.all([
        fetch('/api/watch/rules?limit=200'),
        fetch('/api/watch/alerts?limit=200'),
      ]);
      const [rulesBody, alertsBody] = await Promise.all([
        rulesResponse.json(),
        alertsResponse.json(),
      ]);
      if (!rulesResponse.ok) {
        throw new Error(rulesBody.error || 'Could not load Watch rules.');
      }
      if (!alertsResponse.ok) {
        throw new Error(alertsBody.error || 'Could not load Watch alerts.');
      }

      const nextRules: WatchRule[] = rulesBody.rules || [];
      setRules(nextRules);
      setAlerts(alertsBody.alerts || []);
      setSelectedId((current) =>
        current && nextRules.some((rule) => rule.id === current)
          ? current
          : nextRules[0]?.id || null
      );
    } catch (err: any) {
      setError(err.message || 'Could not load Watch.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (ruleId: string) => {
    try {
      const [detailResponse, jobsResponse] = await Promise.all([
        fetch('/api/watch/rules/' + ruleId),
        fetch(
          '/api/watch/jobs?watchRuleId=' +
            encodeURIComponent(ruleId) +
            '&limit=50'
        ),
      ]);
      const [detailBody, jobsBody] = await Promise.all([
        detailResponse.json(),
        jobsResponse.json(),
      ]);
      if (!detailResponse.ok) {
        throw new Error(detailBody.error || 'Could not load Watch details.');
      }
      if (!jobsResponse.ok) {
        throw new Error(jobsBody.error || 'Could not load Watch jobs.');
      }
      setDetail(detailBody);
      setJobs(jobsBody.jobs || []);
    } catch (err: any) {
      setError(err.message || 'Could not load Watch details.');
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
      setJobs([]);
    }
  }, [selectedId, loadDetail]);

  const activeRules = useMemo(
    () => rules.filter((rule) => rule.status === 'ACTIVE').length,
    [rules]
  );
  const openAlerts = useMemo(
    () =>
      alerts.filter(
        (alert) =>
          alert.status === 'OPEN' ||
          alert.status === 'ACKNOWLEDGED' ||
          alert.status === 'SNOOZED'
      ).length,
    [alerts]
  );
  const triggeredRules = useMemo(
    () => rules.filter((rule) => rule.currentState === 'TRUE').length,
    [rules]
  );

  const propose = async () => {
    const text = instruction.trim();
    if (!text) return;

    setIsProposing(true);
    setError(null);
    setNotice(null);
    setDraft(null);

    try {
      const response = await fetch('/api/watch/drafts/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: text,
          allowLlmParsing: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not understand this watch.');
      }
      setDraft(body.draft);
    } catch (err: any) {
      setError(err.message || 'Could not create Watch preview.');
    } finally {
      setIsProposing(false);
    }
  };

  const selectCandidate = async (candidateKey: string) => {
    if (!draft) return;
    setBusyKey('candidate:' + candidateKey);
    setError(null);
    try {
      const response = await fetch(
        '/api/watch/drafts/' + draft.id + '/select-target',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateKey }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not select this source.');
      }
      setDraft(body.draft);
    } catch (err: any) {
      setError(err.message || 'Could not refine this Watch.');
    } finally {
      setBusyKey(null);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusyKey('save-draft');
    setError(null);
    try {
      const response = await fetch(
        '/api/watch/drafts/' + draft.id + '/save',
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not save this Watch.');
      }

      setNotice(
        'Watch saved. Knowledge AI will evaluate the structured rule without repeatedly calling the language model.'
      );
      setInstruction('');
      setDraft(null);
      await loadOverview();
      setSelectedId(body.rule?.id || null);
    } catch (err: any) {
      setError(err.message || 'Could not save this Watch.');
    } finally {
      setBusyKey(null);
    }
  };

  const cancelDraft = async () => {
    if (!draft) return;
    setBusyKey('cancel-draft');
    try {
      const response = await fetch(
        '/api/watch/drafts/' + draft.id + '/cancel',
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not cancel this preview.');
      }
      setDraft(null);
      setNotice('Watch preview cancelled. No monitoring rule was created.');
    } catch (err: any) {
      setError(err.message || 'Could not cancel this preview.');
    } finally {
      setBusyKey(null);
    }
  };

  const ruleAction = async (
    rule: WatchRule,
    action: 'evaluate' | 'pause' | 'resume' | 'archive'
  ) => {
    setBusyKey(rule.id + ':' + action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        '/api/watch/rules/' + rule.id + '/' + action,
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Watch action failed.');
      }
      setNotice(
        action === 'evaluate'
          ? 'Watch evaluated against current company state.'
          : 'Watch ' + action + 'd.'
      );
      await loadOverview();
      await loadDetail(rule.id);
    } catch (err: any) {
      setError(err.message || 'Watch action failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const alertAction = async (
    alert: WatchAlert,
    action: 'acknowledge' | 'resolve' | 'snooze'
  ) => {
    setBusyKey(alert.id + ':' + action);
    setError(null);
    try {
      const options: RequestInit = { method: 'POST' };
      if (action === 'snooze') {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({
          until: Date.now() + 24 * 60 * 60 * 1000,
        });
      }

      const response = await fetch(
        '/api/watch/alerts/' + alert.id + '/' + action,
        options
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not update alert.');
      }

      setNotice(
        action === 'snooze'
          ? 'Alert snoozed for 24 hours.'
          : 'Alert ' + action + 'd.'
      );
      await loadOverview();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      setError(err.message || 'Could not update alert.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <main className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]">
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-7">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-2">
              Continuous attention
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] text-slate-950 leading-[1.08]">
              Tell Knowledge AI what matters. It keeps watching.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Rules are stored as deterministic conditions. The language model may help
              interpret a request once, but recurring checks run against company state
              and evidence directly.
            </p>
          </div>

          <button
            type="button"
            onClick={loadOverview}
            disabled={isLoading}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              className={'w-3.5 h-3.5 ' + (isLoading ? 'animate-spin' : '')}
            />
            Refresh
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
          <MetricCard
            label="Active watches"
            value={activeRules}
            note="Evaluating current company state"
            icon={Eye}
          />
          <MetricCard
            label="Needs attention"
            value={openAlerts}
            note="Open, acknowledged, or snoozed"
            icon={BellRing}
          />
          <MetricCard
            label="Condition true"
            value={triggeredRules}
            note="Rules currently inside trigger state"
            icon={AlertTriangle}
          />
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 mb-6 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-9 w-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-900">
                Create a watch in plain language
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Try “Tell me if unpaid invoices exceed NPR 500,000”, “Warn me
                when Oak Boards stock drops below 5”, or “Remind me 3 days
                before order O-200 is due.”
              </p>

              <div className="mt-4 flex flex-col md:flex-row gap-2.5">
                <input
                  id="watch-natural-language-input"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      propose();
                    }
                  }}
                  placeholder="What should Knowledge AI watch?"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400"
                />
                <button
                  id="watch-preview-button"
                  type="button"
                  onClick={propose}
                  disabled={isProposing || !instruction.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45"
                >
                  {isProposing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  Preview watch
                </button>
              </div>
            </div>
          </div>

          {draft && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-slate-400">
                  Preview
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {pretty(draft.status)}
                </span>
                <span className="text-[10px] text-slate-400">
                  {draft.parserSource === 'DETERMINISTIC'
                    ? 'Deterministic parser'
                    : 'Language-assisted parser'}
                </span>
              </div>

              <div className="mt-3 text-sm font-semibold text-slate-900">
                {draft.proposedName}
              </div>

              {draft.condition && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Structured condition
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-700">
                    {conditionText(draft.condition)}
                  </div>
                </div>
              )}

              {draft.status === 'NEEDS_INPUT' && (
                <div className="mt-3">
                  <p className="text-xs text-amber-800">
                    {draft.needsInputReason || 'Choose the intended target.'}
                  </p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {(draft.candidates || []).map((candidate) => (
                      <button
                        key={candidate.key}
                        type="button"
                        onClick={() => selectCandidate(candidate.key)}
                        disabled={busyKey === 'candidate:' + candidate.key}
                        className="text-left rounded-xl border border-slate-200 bg-white px-3 py-3 hover:border-emerald-300 hover:bg-emerald-50/30"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-slate-800">
                            {candidate.label}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-slate-400">
                          {candidate.reason}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {draft.status === 'PROPOSED' && (
                <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-start gap-2 text-[11px] text-slate-500">
                    <ShieldCheck className="mt-0.5 w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      Nothing is monitored until you save this preview. Recurring
                      checks use the structured rule above.
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={cancelDraft}
                      disabled={busyKey === 'cancel-draft'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      id="watch-save-draft-button"
                      type="button"
                      onClick={saveDraft}
                      disabled={busyKey === 'save-draft'}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-[11px] font-semibold text-white hover:bg-emerald-800"
                    >
                      {busyKey === 'save-draft' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      Save watch
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {alerts.some((alert) => alert.status !== 'RESOLVED') && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <BellRing className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Triggered alerts
              </h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {alerts
                .filter((alert) => alert.status !== 'RESOLVED')
                .slice(0, 8)
                .map((alert) => (
                  <article
                    key={alert.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {alert.title}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {alert.summary}
                        </p>
                      </div>
                      <span
                        className={
                          'rounded-full border px-2 py-0.5 text-[9px] font-bold ' +
                          statusClass(alert.status)
                        }
                      >
                        {alert.status}
                      </span>
                    </div>

                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-500">
                      <span className="font-semibold text-slate-700">Evidence:</span>{' '}
                      {evidenceText(alert)}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {alert.status === 'OPEN' && (
                        <button
                          type="button"
                          onClick={() => alertAction(alert, 'acknowledge')}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Acknowledge
                        </button>
                      )}
                      {(alert.status === 'OPEN' ||
                        alert.status === 'ACKNOWLEDGED') && (
                        <button
                          type="button"
                          onClick={() => alertAction(alert, 'snooze')}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100"
                        >
                          Snooze 24h
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => alertAction(alert, 'resolve')}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        Resolve
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-5">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Watch rules
                </div>
                <div className="text-[10px] text-slate-400">
                  {rules.length} persisted rule{rules.length === 1 ? '' : 's'}
                </div>
              </div>
              <History className="w-4 h-4 text-slate-300" />
            </div>

            {isLoading ? (
              <div className="p-10 text-center">
                <Loader2 className="w-4 h-4 animate-spin mx-auto text-emerald-700" />
              </div>
            ) : rules.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-slate-400">
                No watches yet. Create one above.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {rules.map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => setSelectedId(rule.id)}
                    className={
                      'w-full text-left px-4 py-3.5 transition-colors ' +
                      (selectedId === rule.id
                        ? 'bg-emerald-50/60'
                        : 'hover:bg-slate-50')
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        {rule.name}
                      </span>
                      <span
                        className={
                          'rounded-full border px-1.5 py-0.5 text-[9px] font-bold ' +
                          stateClass(rule.currentState)
                        }
                      >
                        {rule.currentState}
                      </span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-slate-500">
                      {conditionText(rule.condition)}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[9px] text-slate-400">
                      <span>{rule.status}</span>
                      <span>·</span>
                      <span>
                        {rule.evaluationMode === 'INTERVAL'
                          ? 'Every ' + rule.intervalMinutes + ' min'
                          : pretty(rule.evaluationMode)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            {detail ? (
              <RuleDetailPanel
                detail={detail}
                jobs={jobs}
                busyKey={busyKey}
                onAction={ruleAction}
              />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-xs text-slate-400">
                Select a watch to inspect its current state and history.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: number;
  note: string;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ label, value, note, icon: Icon }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
        {label}
      </span>
      <Icon className="w-3.5 h-3.5 text-slate-300" />
    </div>
    <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
      {value}
    </div>
    <div className="mt-0.5 text-[10px] text-slate-400">{note}</div>
  </div>
);

const RuleDetailPanel: React.FC<{
  detail: RuleDetail;
  jobs: WatchJob[];
  busyKey: string | null;
  onAction: (
    rule: WatchRule,
    action: 'evaluate' | 'pause' | 'resume' | 'archive'
  ) => Promise<void>;
}> = ({ detail, jobs, busyKey, onAction }) => {
  const { rule, evaluations, alerts } = detail;
  const recentEvaluation = evaluations[0];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                {rule.name}
              </h3>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
                {rule.status}
              </span>
              <span
                className={
                  'rounded-full border px-2 py-0.5 text-[9px] font-bold ' +
                  stateClass(rule.currentState)
                }
              >
                Condition {rule.currentState}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {conditionText(rule.condition)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {rule.status === 'ACTIVE' && (
              <>
                <button
                  type="button"
                  onClick={() => onAction(rule, 'evaluate')}
                  disabled={busyKey === rule.id + ':evaluate'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Evaluate now
                </button>
                <button
                  type="button"
                  onClick={() => onAction(rule, 'pause')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </button>
              </>
            )}
            {rule.status === 'PAUSED' &&
              rule.condition.kind !== 'TIME_REACHED' && (
                <button
                  type="button"
                  onClick={() => onAction(rule, 'resume')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  <Play className="w-3.5 h-3.5" />
                  Resume
                </button>
              )}
            {rule.status !== 'ARCHIVED' && (
              <button
                type="button"
                onClick={() => onAction(rule, 'archive')}
                className="rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-50"
              >
                Archive
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniFact label="Last evaluated" value={dateTime(rule.lastEvaluationAt)} />
          <MiniFact label="Next check" value={dateTime(rule.nextEvaluationAt)} />
          <MiniFact label="Last triggered" value={dateTime(rule.lastTriggeredAt)} />
          <MiniFact label="Rule version" value={'v' + rule.version} />
        </div>

        {recentEvaluation && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Latest deterministic evaluation
            </div>
            <div className="mt-1.5 text-xs text-slate-700">
              {recentEvaluation.status === 'FAILED'
                ? recentEvaluation.error || 'Evaluation failed.'
                : 'Observed ' +
                  String(recentEvaluation.observedValue) +
                  ' · condition ' +
                  (recentEvaluation.conditionMatched ? 'matched' : 'did not match')}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HistoryPanel
          title="Evaluation history"
          icon={RefreshCw}
          empty="No evaluations yet."
          rows={evaluations.slice(0, 10).map((item) => ({
            id: item.id,
            primary:
              item.status === 'FAILED'
                ? 'Failed evaluation'
                : item.conditionMatched
                  ? 'Condition matched'
                  : 'Condition clear',
            secondary:
              dateTime(item.evaluatedAt) +
              (item.observedValue !== undefined
                ? ' · observed ' + String(item.observedValue)
                : ''),
          }))}
        />

        <HistoryPanel
          title="Worker history"
          icon={TimerReset}
          empty="No scheduled jobs yet."
          rows={jobs.slice(0, 10).map((job) => ({
            id: job.id,
            primary:
              job.status +
              ' · attempt ' +
              job.attemptCount +
              '/' +
              job.maxAttempts,
            secondary:
              'Scheduled ' +
              dateTime(job.scheduledFor) +
              (job.lastError ? ' · ' + job.lastError : ''),
          }))}
        />
      </div>

      <HistoryPanel
        title="Alert episodes"
        icon={BellRing}
        empty="This watch has not triggered an alert yet."
        rows={alerts.slice(0, 10).map((alert) => ({
          id: alert.id,
          primary:
            alert.status +
            ' · ' +
            alert.occurrenceCount +
            ' occurrence' +
            (alert.occurrenceCount === 1 ? '' : 's'),
          secondary:
            alert.summary +
            ' · last triggered ' +
            dateTime(alert.lastTriggeredAt),
        }))}
      />
    </div>
  );
};

const MiniFact: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
    <div className="text-[9px] uppercase tracking-wide text-slate-400">
      {label}
    </div>
    <div className="mt-1 text-[11px] font-medium text-slate-700 break-words">
      {value}
    </div>
  </div>
);

const HistoryPanel: React.FC<{
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  empty: string;
  rows: Array<{ id: string; primary: string; secondary: string }>;
}> = ({ title, icon: Icon, empty, rows }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-slate-400" />
      <h4 className="text-xs font-semibold text-slate-800">{title}</h4>
    </div>
    {rows.length === 0 ? (
      <div className="py-6 text-center text-[10px] text-slate-400">{empty}</div>
    ) : (
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
          >
            <div className="text-[10px] font-semibold text-slate-700">
              {row.primary}
            </div>
            <div className="mt-1 text-[9px] leading-4 text-slate-400">
              {row.secondary}
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);
