import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ActionProposal } from '../actionTypes';

function pretty(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

export const ActionProposalPanel: React.FC<{
  proposal: ActionProposal;
  isWorking: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onSelectTarget: (entityId: string) => void;
}> = ({
  proposal,
  isWorking,
  error,
  onConfirm,
  onCancel,
  onSelectTarget,
}) => {
  const confirmed = proposal.status === 'CONFIRMED';
  const needsInput = proposal.status === 'NEEDS_INPUT';
  const stale = proposal.status === 'STALE';
  const cancelled = proposal.status === 'CANCELLED';
  const failed = proposal.status === 'FAILED';

  return (
    <section className="w-full max-w-3xl mx-auto rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div
                className={
                  'w-7 h-7 rounded-lg flex items-center justify-center ' +
                  (confirmed
                    ? 'bg-emerald-50 text-emerald-700'
                    : stale || failed
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-slate-100 text-slate-700')
                }
              >
                {confirmed ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : stale || failed ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {confirmed
                    ? 'Change confirmed'
                    : needsInput
                      ? 'I need one choice before I can prepare this change'
                      : stale
                        ? 'This proposal is stale'
                        : cancelled
                          ? 'Change cancelled'
                          : failed
                            ? 'Change failed'
                            : 'Proposed change'}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {pretty(proposal.intent)} ·{' '}
                  {proposal.parserSource === 'DETERMINISTIC'
                    ? 'deterministic parser'
                    : 'language model parser + deterministic validation'}
                </div>
              </div>
            </div>
          </div>

          <span
            className={
              'self-start rounded-full border px-2.5 py-1 text-[9px] font-semibold ' +
              (confirmed
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : needsInput
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : stale || failed
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : cancelled
                      ? 'border-slate-200 bg-slate-50 text-slate-500'
                      : 'border-slate-200 bg-slate-50 text-slate-700')
            }
          >
            {pretty(proposal.status)}
          </span>
        </div>

        <div className="mt-3 rounded-xl bg-[#f7f7f3] px-3.5 py-3 text-xs leading-5 text-slate-600">
          “{proposal.instruction}”
        </div>
      </div>

      <div className="px-5 py-5">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {needsInput ? (
          <div>
            <div className="text-xs font-semibold text-slate-800">
              Choose the intended target
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {proposal.needsInputReason ||
                'Knowledge AI found more than one safe interpretation and will not guess.'}
            </p>

            {proposal.targetCandidates &&
              proposal.targetCandidates.length > 0 && (
                <div className="mt-4 space-y-2">
                  {proposal.targetCandidates.map((candidate) => (
                    <button
                      key={candidate.entityId}
                      type="button"
                      disabled={isWorking}
                      onClick={() => onSelectTarget(candidate.entityId)}
                      className="w-full text-left rounded-xl border border-slate-200 px-3.5 py-3 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-slate-800">
                            {candidate.label}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {pretty(candidate.entityType)} · {candidate.reason}
                          </div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
          </div>
        ) : (
          <>
            {proposal.mutations.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Exact changes
                </div>
                <div className="mt-2 space-y-2">
                  {proposal.mutations.map((mutation) => (
                    <div
                      key={mutation.entityId + ':' + mutation.predicate}
                      className="rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-slate-800">
                            {mutation.entityLabel}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {pretty(mutation.predicate)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-500">
                            {formatValue(mutation.beforeValue)}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                          <span
                            className={
                              'rounded-lg border px-2.5 py-1.5 font-semibold ' +
                              (confirmed
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-slate-300 bg-white text-slate-900')
                            }
                          >
                            {formatValue(mutation.afterValue)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-slate-400">
                        <span>
                          {mutation.valueSource === 'USER_PROVIDED'
                            ? 'Explicitly requested'
                            : 'Calculated by application logic'}
                        </span>
                        <span>·</span>
                        <span>{mutation.explanation}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {proposal.calculationSummary && (
              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3.5 py-3">
                <div className="text-[10px] font-semibold text-emerald-800">
                  Validation
                </div>
                <div className="mt-1 text-[10px] leading-4 text-emerald-700">
                  {proposal.calculationSummary}
                </div>
              </div>
            )}

            {proposal.preconditions.length > 0 && !confirmed && !cancelled && (
              <div className="mt-4 flex items-start gap-2 text-[10px] leading-4 text-slate-400">
                <Clock3 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Before confirmation, Knowledge AI will re-check the current state used to build this preview. If it changed, this proposal will not execute.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {!confirmed && !cancelled && !stale && !failed && (
        <div className="px-5 py-4 border-t border-slate-100 bg-[#fcfcfa] flex flex-wrap items-center justify-between gap-3">
          <div className="text-[10px] text-slate-400">
            Nothing is written until you confirm.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isWorking}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-40"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            {proposal.status === 'PROPOSED' && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={isWorking}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3.5 py-2 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {isWorking ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                Confirm change
              </button>
            )}
          </div>
        </div>
      )}

      {confirmed && (
        <div className="px-5 py-4 border-t border-emerald-100 bg-emerald-50/50 text-[10px] text-emerald-800">
          Confirmed company state is stored separately from the original imported evidence, with an audit event and USER_CONFIRMED authority.
        </div>
      )}

      {stale && (
        <div className="px-5 py-4 border-t border-amber-100 bg-amber-50/60 text-[10px] text-amber-800">
          The underlying company state changed after this preview. Submit the update again to generate a fresh proposal.
        </div>
      )}
    </section>
  );
};
