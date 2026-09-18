import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  ActionAuditEntry,
  ActionExecution,
  ActionProposal,
  ActionProposalStatus,
} from '../actionTypes';
import { ActionProposalPanel } from './ActionProposalPanel';

const STATUS_OPTIONS: Array<ActionProposalStatus | 'ALL'> = [
  'ALL',
  'PROPOSED',
  'NEEDS_INPUT',
  'CONFIRMED',
  'STALE',
  'CANCELLED',
  'FAILED',
];

function pretty(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: ActionProposalStatus): string {
  if (status === 'CONFIRMED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'PROPOSED') {
    return 'border-slate-300 bg-slate-50 text-slate-700';
  }
  if (status === 'NEEDS_INPUT') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (status === 'STALE' || status === 'FAILED') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

export const ActionsWorkspace: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<ActionProposalStatus | 'ALL'>(
    'ALL'
  );
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] =
    useState<ActionProposal | null>(null);
  const [execution, setExecution] = useState<ActionExecution | null>(null);
  const [audit, setAudit] = useState<ActionAuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (statusFilter !== 'ALL') params.set('status', statusFilter);

      const response = await fetch('/api/actions?' + params.toString());
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not load action history.');
      }

      const next = (body.proposals || []) as ActionProposal[];
      setProposals(next);
      setSelectedId((current) => {
        if (current && next.some((proposal) => proposal.id === current)) {
          return current;
        }
        return next[0]?.id || null;
      });
    } catch (err: any) {
      setError(err.message || 'Could not load action history.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  const loadDetail = useCallback(async (proposalId: string) => {
    setError(null);
    try {
      const response = await fetch('/api/actions/' + proposalId);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not inspect this action.');
      }

      setSelectedProposal(body.proposal as ActionProposal);
      setExecution((body.execution || null) as ActionExecution | null);
      setAudit((body.audit || []) as ActionAuditEntry[]);
    } catch (err: any) {
      setError(err.message || 'Could not inspect this action.');
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setSelectedProposal(null);
      setExecution(null);
      setAudit([]);
    }
  }, [selectedId, loadDetail]);

  const refreshAfterMutation = async (proposalId: string) => {
    await Promise.all([loadList(), loadDetail(proposalId)]);
  };

  const confirm = async () => {
    if (!selectedProposal || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/actions/' + selectedProposal.id + '/confirm',
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        await loadDetail(selectedProposal.id);
        throw new Error(body.error || 'Could not confirm this action.');
      }
      await refreshAfterMutation(selectedProposal.id);
    } catch (err: any) {
      setError(err.message || 'Could not confirm this action.');
    } finally {
      setIsWorking(false);
    }
  };

  const cancel = async () => {
    if (!selectedProposal || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/actions/' + selectedProposal.id + '/cancel',
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not cancel this action.');
      }
      await refreshAfterMutation(selectedProposal.id);
    } catch (err: any) {
      setError(err.message || 'Could not cancel this action.');
    } finally {
      setIsWorking(false);
    }
  };

  const selectTarget = async (entityId: string) => {
    if (!selectedProposal || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/actions/' + selectedProposal.id + '/select-target',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityId }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not select this target.');
      }
      const refined = body.proposal as ActionProposal;
      setSelectedId(refined.id);
      await loadList();
      await loadDetail(refined.id);
    } catch (err: any) {
      setError(err.message || 'Could not select this target.');
    } finally {
      setIsWorking(false);
    }
  };

  const counts = useMemo(() => {
    const all = proposals.length;
    const pending = proposals.filter(
      (proposal) =>
        proposal.status === 'PROPOSED' ||
        proposal.status === 'NEEDS_INPUT'
    ).length;
    const confirmed = proposals.filter(
      (proposal) => proposal.status === 'CONFIRMED'
    ).length;
    return { all, pending, confirmed };
  }, [proposals]);

  return (
    <main className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]">
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-6">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-2">
              Controlled company changes
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] text-slate-950 leading-[1.08]">
              Every proposed write stays reviewable and auditable.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500 max-w-2xl">
              Natural-language instructions become explicit proposals first. Confirmed actions preserve
              the original evidence, write higher-authority company state, and keep a complete audit trail.
            </p>
          </div>

          <button
            type="button"
            onClick={loadList}
            className="inline-flex items-center gap-1.5 self-start lg:self-auto rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:border-slate-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </section>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <SummaryCard label="In this view" value={counts.all} icon={History} />
          <SummaryCard
            label="Needs review"
            value={counts.pending}
            icon={Clock3}
          />
          <SummaryCard
            label="Confirmed"
            value={counts.confirmed}
            icon={CheckCircle2}
          />
        </div>

        <div className="flex flex-wrap gap-1.5 mb-5">
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={
                'rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-colors ' +
                (statusFilter === status
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800')
              }
            >
              {status === 'ALL' ? 'All' : pretty(status)}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-700" />
          </div>
        ) : proposals.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
            <ShieldCheck className="w-6 h-6 mx-auto text-slate-300" />
            <div className="mt-3 text-sm font-semibold text-slate-700">
              No actions match this view.
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Use Update mode in Ask to prepare a safe company change.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)] gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="max-h-[720px] overflow-y-auto p-2">
                {proposals.map((proposal) => (
                  <button
                    key={proposal.id}
                    type="button"
                    onClick={() => setSelectedId(proposal.id)}
                    className={
                      'w-full text-left rounded-xl border px-3.5 py-3 mb-1 transition-colors ' +
                      (selectedId === proposal.id
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-transparent hover:bg-slate-50')
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold text-slate-500">
                          {pretty(proposal.intent)}
                        </div>
                        <div className="mt-1 text-xs font-medium text-slate-800 line-clamp-2">
                          {proposal.instruction}
                        </div>
                      </div>
                      <span
                        className={
                          'shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-semibold ' +
                          statusClass(proposal.status)
                        }
                      >
                        {pretty(proposal.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-[9px] text-slate-400">
                      {new Date(proposal.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="min-w-0">
              {selectedProposal ? (
                <div className="space-y-4">
                  <ActionProposalPanel
                    proposal={selectedProposal}
                    isWorking={isWorking}
                    error={null}
                    onConfirm={confirm}
                    onCancel={cancel}
                    onSelectTarget={selectTarget}
                  />

                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          Audit trail
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          Proposal lifecycle and execution history.
                        </div>
                      </div>
                      {execution && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-semibold text-emerald-700">
                          Execution recorded
                        </span>
                      )}
                    </div>

                    <div className="mt-4 border-l border-slate-200 ml-1.5 pl-4 space-y-4">
                      {audit.length === 0 ? (
                        <div className="text-xs text-slate-400">
                          No audit entries yet.
                        </div>
                      ) : (
                        audit.map((entry) => (
                          <div key={entry.id} className="relative">
                            <div className="absolute -left-[19px] top-1.5 w-2 h-2 rounded-full bg-slate-300 ring-4 ring-white" />
                            <div className="text-[10px] font-semibold text-slate-700">
                              {pretty(entry.action)}
                            </div>
                            <div className="mt-0.5 text-[10px] leading-4 text-slate-500">
                              {entry.detail}
                            </div>
                            <div className="mt-1 text-[9px] text-slate-400">
                              {new Date(entry.timestamp).toLocaleString()}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-xs text-slate-400">
                  Select an action to inspect it.
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
};

const SummaryCard: React.FC<{
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ label, value, icon: Icon }) => (
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
  </div>
);
