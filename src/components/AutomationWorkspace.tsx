import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleGauge,
  Clock3,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  UserCheck,
  XCircle,
  Zap,
} from 'lucide-react';

type AutomationActorRole =
  | 'OWNER'
  | 'ADMIN'
  | 'APPROVER'
  | 'OPERATOR'
  | 'SERVICE'
  | 'MEMBER';

type AutomationRunStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'BLOCKED'
  | 'FAILED'
  | 'COMPENSATED'
  | 'RECOVERY_REQUIRED';

type AutomationRunFeedback =
  | 'CORRECT'
  | 'FALSE_TRIGGER'
  | 'NEEDS_CORRECTION';

type DashboardRun = {
  run: {
    id: string;
    proposalId: string;
    status: AutomationRunStatus;
    attemptCount: number;
    maxAttempts: number;
    actor: string;
    actorRole: AutomationActorRole;
    policyId?: string;
    policyVersion?: number;
    executionId?: string;
    failureCategory?: string;
    retryable?: boolean;
    lastError?: string;
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
    compensationProposalId?: string;
    compensationExecutionId?: string;
    feedback?: AutomationRunFeedback;
    feedbackAt?: number;
    feedbackBy?: string;
    feedbackNote?: string;
  };
  proposal: null | {
    id: string;
    intent: string;
    instruction: string;
    status: string;
    createdAt: number;
  };
};

type DashboardApproval = {
  approval: {
    id: string;
    proposalId: string;
    policyId: string;
    policyVersion: number;
    status:
      | 'PENDING'
      | 'APPROVED'
      | 'REJECTED'
      | 'CANCELLED'
      | 'EXPIRED';
    requestedBy: string;
    requestedByRole: AutomationActorRole;
    eligibleRoles: AutomationActorRole[];
    decisionReasonCodes: string[];
    decisionReasons: string[];
    requestedAt: number;
    expiresAt: number;
    resolvedAt?: number;
    resolvedBy?: string;
    resolvedByRole?: AutomationActorRole;
    resolutionNote?: string;
  };
  proposal: null | {
    id: string;
    intent: string;
    instruction: string;
    status: string;
    createdAt: number;
  };
};

type AutomationQuality = {
  accountId: string;
  generatedAt: number;
  population: {
    automationRuns: number;
    approvalRequests: number;
    feedbackRatedRuns: number;
  };
  executions: {
    attempted: number;
    successful: number;
    failed: number;
    successRate: number | null;
    failureRate: number | null;
  };
  governance: {
    blockedRuns: number;
    policyDenials: number;
    approvalEscalations: number;
    approvalEscalationRate: number | null;
    approvalsGranted: number;
    approvalsRejected: number;
    approvalsPending: number;
  };
  recovery: {
    compensatedRuns: number;
    compensationRate: number | null;
    recoveryRequiredRuns: number;
    technicalFailures: number;
    staleStateFailures: number;
  };
  feedback: {
    correct: number;
    falseTriggers: number;
    needsCorrection: number;
    falseTriggerRate: number | null;
    humanCorrectionSignals: number;
  };
  timeSaved: {
    estimatedMinutes: null;
    reason: string;
  };
};

type AutomationDashboard = {
  quality: AutomationQuality;
  policy: null | {
    id: string;
    version: number;
    enabled: boolean;
    mode:
      | 'SUGGEST_ONLY'
      | 'REQUIRE_APPROVAL'
      | 'AUTO_EXECUTE_LOW_RISK';
    allowedActionIntents: string[];
    maxRiskClass: 'LOW' | 'MEDIUM' | 'HIGH';
    maxAmount?: number;
    maxQuantity?: number;
    allowedIdentitySources: string[];
    allowedActorRoles?: AutomationActorRole[];
    approvalRoles?: AutomationActorRole[];
    allowedTargetEntityTypes?: string[];
    allowedTargetEntityIds?: string[];
    updatedAt: number;
    updatedBy: string;
  };
  control: {
    version: number;
    emergencyDisabled: boolean;
    reason?: string;
    updatedAt: number;
    updatedBy: string;
  };
  runs: DashboardRun[];
  approvals: DashboardApproval[];
};

type AutomationContext = {
  actor: string;
  role: AutomationActorRole;
  source: string;
  capabilities: {
    canControlEmergencyStop: boolean;
    canResolveApprovals: boolean;
    canCompensate: boolean;
    canExecuteAutomation: boolean;
    canRecordFeedback: boolean;
  };
};

function pct(value: number | null): string {
  return value === null ? '—' : Math.round(value * 100) + '%';
}

function dateTime(value?: number): string {
  return value ? new Date(value).toLocaleString() : 'Not yet';
}

function pretty(value?: string): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function runTone(status: AutomationRunStatus): string {
  if (status === 'SUCCEEDED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'COMPENSATED') {
    return 'border-blue-200 bg-blue-50 text-blue-800';
  }
  if (status === 'RECOVERY_REQUIRED') {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (status === 'FAILED' || status === 'BLOCKED') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function approvalTone(status: DashboardApproval['approval']['status']): string {
  if (status === 'APPROVED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'PENDING') {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (status === 'REJECTED') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export const AutomationWorkspace: React.FC = () => {
  const [dashboard, setDashboard] =
    useState<AutomationDashboard | null>(null);
  const [context, setContext] = useState<AutomationContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState(
    'Emergency stop enabled from Automation workspace.'
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [dashboardResponse, contextResponse] = await Promise.all([
        fetch('/api/automation/dashboard'),
        fetch('/api/automation/context'),
      ]);

      const [dashboardBody, contextBody] = await Promise.all([
        dashboardResponse.json(),
        contextResponse.json(),
      ]);

      if (!dashboardResponse.ok) {
        throw new Error(
          dashboardBody.error || 'Could not load automation dashboard.'
        );
      }
      if (!contextResponse.ok) {
        throw new Error(
          contextBody.error || 'Could not resolve automation role.'
        );
      }

      setDashboard(dashboardBody);
      setContext(contextBody);
    } catch (err: any) {
      setError(err.message || 'Could not load automation state.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingApprovals = useMemo(
    () =>
      dashboard?.approvals.filter(
        (item) => item.approval.status === 'PENDING'
      ) || [],
    [dashboard]
  );

  const recoveryRuns = useMemo(
    () =>
      dashboard?.runs.filter(
        (item) => item.run.status === 'RECOVERY_REQUIRED'
      ) || [],
    [dashboard]
  );

  const controlAutomation = async (
    action: 'disable' | 'enable'
  ) => {
    setBusyKey('control:' + action);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        '/api/automation/control/' + action,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason:
              action === 'disable'
                ? stopReason.trim() ||
                  'Emergency automation stop enabled from UI.'
                : 'Emergency condition cleared from Automation workspace.',
          }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not change emergency control.');
      }

      setNotice(
        action === 'disable'
          ? 'Automatic execution is now stopped for this workspace.'
          : 'Emergency stop cleared. Policy still governs every automatic action.'
      );
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not change emergency control.');
    } finally {
      setBusyKey(null);
    }
  };

  const resolveApproval = async (
    approvalId: string,
    action: 'approve' | 'reject'
  ) => {
    setBusyKey('approval:' + approvalId + ':' + action);
    setError(null);

    try {
      const response = await fetch(
        '/api/automation/approvals/' + approvalId + '/' + action,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note:
              action === 'approve'
                ? 'Approved from Automation workspace.'
                : 'Rejected from Automation workspace.',
          }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not resolve approval.');
      }

      setNotice(
        action === 'approve'
          ? 'Approval recorded. Approval alone does not bypass the audited execution path.'
          : 'Approval request rejected.'
      );
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not resolve approval.');
    } finally {
      setBusyKey(null);
    }
  };

  const compensate = async (runId: string) => {
    setBusyKey('compensate:' + runId);
    setError(null);

    try {
      const response = await fetch(
        '/api/automation/runs/' + runId + '/compensate',
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not compensate automation run.');
      }

      setNotice(
        body.replayed
          ? 'This compensation had already been completed; existing result replayed.'
          : 'Compensating action completed through the audited action execution path.'
      );
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not compensate automation run.');
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const recordFeedback = async (
    runId: string,
    feedback: AutomationRunFeedback
  ) => {
    setBusyKey('feedback:' + runId + ':' + feedback);
    setError(null);

    try {
      const response = await fetch(
        '/api/automation/runs/' + runId + '/feedback',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not record automation feedback.');
      }

      setNotice('Automation quality feedback recorded.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not record automation feedback.');
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading && !dashboard) {
    return (
      <main className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]">
        <div className="h-full flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading controlled automation…
          </div>
        </div>
      </main>
    );
  }

  const quality = dashboard?.quality;
  const policy = dashboard?.policy;
  const control = dashboard?.control;

  return (
    <main className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]">
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-6">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-2">
              Governed execution
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] text-slate-950 leading-[1.08]">
              Automation with policy, evidence, and a stop button.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Automatic actions remain bounded by deterministic policy. High-risk or
              unsupported actions cannot promote themselves, and the workspace emergency
              stop overrides ordinary policy immediately.
            </p>
          </div>

          <button
            type="button"
            onClick={load}
            className="inline-flex self-start items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </section>

        {(error || notice) && (
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

        <section
          id="automation-emergency-control"
          className={
            'mb-6 rounded-2xl border p-5 md:p-6 ' +
            (control?.emergencyDisabled
              ? 'border-red-300 bg-red-50'
              : 'border-slate-200 bg-white')
          }
        >
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
            <div className="flex gap-3">
              <div
                className={
                  'h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ' +
                  (control?.emergencyDisabled
                    ? 'bg-red-100 text-red-700'
                    : 'bg-emerald-50 text-emerald-700')
                }
              >
                {control?.emergencyDisabled ? (
                  <ShieldAlert className="w-5 h-5" />
                ) : (
                  <ShieldCheck className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Workspace emergency automation control
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {control?.emergencyDisabled
                    ? 'Automatic execution is stopped regardless of normal policy.'
                    : 'Emergency stop is clear. Normal policy still decides every automatic action.'}
                </div>
                {control?.reason && (
                  <div className="mt-2 text-[11px] text-slate-600">
                    Last reason: {control.reason}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-slate-400">
                  Version {control?.version ?? 0} · updated{' '}
                  {dateTime(control?.updatedAt)} · actor{' '}
                  {control?.updatedBy || 'system'}
                </div>
              </div>
            </div>

            <div className="lg:w-[370px]">
              {context?.capabilities.canControlEmergencyStop ? (
                control?.emergencyDisabled ? (
                  <button
                    id="automation-clear-emergency-stop"
                    type="button"
                    onClick={() => controlAutomation('enable')}
                    disabled={busyKey === 'control:enable'}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    <PlayCircle className="w-4 h-4" />
                    Clear emergency stop
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      id="automation-stop-reason"
                      value={stopReason}
                      onChange={(event) => setStopReason(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300"
                      placeholder="Reason for emergency stop"
                    />
                    <button
                      id="automation-emergency-stop-button"
                      type="button"
                      onClick={() => controlAutomation('disable')}
                      disabled={busyKey === 'control:disable'}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      <Ban className="w-4 h-4" />
                      Stop automatic execution
                    </button>
                  </div>
                )
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[11px] leading-5 text-slate-500">
                  Emergency control requires an OWNER or ADMIN actor. Current role:{' '}
                  <span className="font-semibold text-slate-700">
                    {context?.role || 'Unknown'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

        {quality && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <MetricCard
                label="Clean success"
                value={pct(quality.executions.successRate)}
                note={
                  quality.executions.successful +
                  ' clean / ' +
                  quality.executions.attempted +
                  ' execution attempts'
                }
                icon={CheckCircle2}
              />
              <MetricCard
                label="Execution failures"
                value={pct(quality.executions.failureRate)}
                note={quality.executions.failed + ' failed runs'}
                icon={XCircle}
              />
              <MetricCard
                label="Approval escalation"
                value={pct(
                  quality.governance.approvalEscalationRate
                )}
                note={
                  quality.governance.approvalEscalations +
                  ' approval requests'
                }
                icon={UserCheck}
              />
              <MetricCard
                label="False triggers"
                value={pct(quality.feedback.falseTriggerRate)}
                note={
                  quality.population.feedbackRatedRuns === 0
                    ? 'No human-rated runs yet'
                    : quality.feedback.falseTriggers +
                      ' of ' +
                      quality.population.feedbackRatedRuns +
                      ' rated runs'
                }
                icon={AlertTriangle}
              />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <MetricCard
                label="Policy blocks"
                value={quality.governance.policyDenials}
                note={quality.governance.blockedRuns + ' blocked runs total'}
                icon={Ban}
              />
              <MetricCard
                label="Compensated"
                value={quality.recovery.compensatedRuns}
                note={pct(quality.recovery.compensationRate) + ' of execution attempts'}
                icon={Undo2}
              />
              <MetricCard
                label="Recovery required"
                value={quality.recovery.recoveryRequiredRuns}
                note="Newer state prevented blind rollback"
                icon={RotateCcw}
              />
              <MetricCard
                label="Human correction signals"
                value={quality.feedback.humanCorrectionSignals}
                note="Feedback or recovery indicating intervention"
                icon={Activity}
              />
            </div>
          </>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[0.82fr_1.18fr] gap-5 mb-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <CircleGauge className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Effective automation policy
              </h3>
            </div>

            {policy ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      'rounded-full border px-2.5 py-1 text-[10px] font-bold ' +
                      (policy.enabled
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-slate-50 text-slate-500')
                    }
                  >
                    {policy.enabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-700">
                    {pretty(policy.mode)}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    policy v{policy.version}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <PolicyFact
                    label="Max risk"
                    value={policy.maxRiskClass}
                  />
                  <PolicyFact
                    label="Max quantity"
                    value={
                      policy.maxQuantity === undefined
                        ? 'Not configured'
                        : String(policy.maxQuantity)
                    }
                  />
                  <PolicyFact
                    label="Allowed actions"
                    value={
                      policy.allowedActionIntents.length
                        ? policy.allowedActionIntents
                            .map(pretty)
                            .join(', ')
                        : 'None'
                    }
                  />
                  <PolicyFact
                    label="Actor roles"
                    value={
                      policy.allowedActorRoles?.length
                        ? policy.allowedActorRoles.join(', ')
                        : 'No role allowlist'
                    }
                  />
                </div>

                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3 text-[11px] leading-5 text-slate-500">
                  <span className="font-semibold text-slate-700">
                    Phase 7 execution boundary:
                  </span>{' '}
                  RECEIVE_INVENTORY is the only automatic write path currently
                  implemented. RECORD_PAYMENT, UPDATE_STATUS, and CREATE_ORDER cannot
                  silently become automatic because of prompt wording.
                </div>

                <div className="text-[10px] text-slate-400">
                  Updated {dateTime(policy.updatedAt)} by {policy.updatedBy}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-xs leading-5 text-amber-900">
                No automation policy exists. Automatic execution defaults to denied.
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Approval queue
                </h3>
              </div>
              <span className="text-[10px] text-slate-400">
                {pendingApprovals.length} pending
              </span>
            </div>

            {pendingApprovals.length === 0 ? (
              <EmptyState text="No approval requests are waiting." />
            ) : (
              <div className="space-y-2.5">
                {pendingApprovals.slice(0, 6).map(({ approval, proposal }) => (
                  <div
                    key={approval.id}
                    className="rounded-xl border border-slate-200 px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800">
                          {proposal
                            ? pretty(proposal.intent)
                            : 'Action proposal'}
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                          {proposal?.instruction ||
                            'Proposal details are no longer available.'}
                        </p>
                      </div>
                      <span
                        className={
                          'rounded-full border px-2 py-0.5 text-[9px] font-bold ' +
                          approvalTone(approval.status)
                        }
                      >
                        {approval.status}
                      </span>
                    </div>

                    <div className="mt-2 text-[10px] text-slate-400">
                      Requested by {approval.requestedByRole} · policy v
                      {approval.policyVersion} · expires{' '}
                      {dateTime(approval.expiresAt)}
                    </div>

                    {context?.capabilities.canResolveApprovals && (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            resolveApproval(approval.id, 'approve')
                          }
                          disabled={
                            busyKey ===
                            'approval:' + approval.id + ':approve'
                          }
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            resolveApproval(approval.id, 'reject')
                          }
                          disabled={
                            busyKey ===
                            'approval:' + approval.id + ':reject'
                          }
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {recoveryRuns.length > 0 && (
          <section className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-800" />
              <h3 className="text-sm font-semibold text-amber-950">
                Operator recovery required
              </h3>
            </div>
            <p className="mt-1 text-xs text-amber-800">
              These runs were not blindly rolled back because company state changed
              after the automatic action.
            </p>
            <div className="mt-3 space-y-2">
              {recoveryRuns.map(({ run, proposal }) => (
                <div
                  key={run.id}
                  className="rounded-xl border border-amber-200 bg-white px-3.5 py-3"
                >
                  <div className="text-xs font-semibold text-slate-800">
                    {proposal?.instruction || run.proposalId}
                  </div>
                  <div className="mt-1 text-[10px] text-amber-800">
                    {run.lastError || 'Manual recovery is required.'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Automation run history
              </h3>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Automatic execution, policy blocks, technical failures, and recovery
                stay attributable here.
              </p>
            </div>
            <History className="w-4 h-4 text-slate-300" />
          </div>

          {!dashboard?.runs.length ? (
            <div className="py-12">
              <EmptyState text="No automation runs have been recorded yet." />
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dashboard.runs.slice(0, 40).map(({ run, proposal }) => (
                <article key={run.id} className="px-5 py-4">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            'rounded-full border px-2 py-0.5 text-[9px] font-bold ' +
                            runTone(run.status)
                          }
                        >
                          {run.status}
                        </span>
                        <span className="text-xs font-semibold text-slate-800">
                          {proposal
                            ? pretty(proposal.intent)
                            : 'Automation run'}
                        </span>
                        {run.failureCategory && (
                          <span className="text-[9px] text-slate-400">
                            {pretty(run.failureCategory)}
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-xs leading-5 text-slate-500">
                        {proposal?.instruction ||
                          'Action proposal details are unavailable.'}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                        <span>
                          {run.actorRole} · {run.actor}
                        </span>
                        <span>
                          Attempts {run.attemptCount}/{run.maxAttempts}
                        </span>
                        <span>Started {dateTime(run.startedAt)}</span>
                        {run.policyVersion !== undefined && (
                          <span>Policy v{run.policyVersion}</span>
                        )}
                      </div>

                      {run.lastError && (
                        <div className="mt-2 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-[10px] leading-4 text-red-700">
                          {run.lastError}
                        </div>
                      )}

                      {run.feedback && (
                        <div className="mt-2 text-[10px] text-slate-500">
                          Human feedback:{' '}
                          <span className="font-semibold text-slate-700">
                            {pretty(run.feedback)}
                          </span>
                          {run.feedbackNote ? ' · ' + run.feedbackNote : ''}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap lg:justify-end gap-2 lg:max-w-[330px]">
                      {context?.capabilities.canRecordFeedback &&
                        run.status !== 'RUNNING' && (
                          <>
                            <FeedbackButton
                              active={run.feedback === 'CORRECT'}
                              busy={
                                busyKey ===
                                'feedback:' + run.id + ':CORRECT'
                              }
                              icon={ThumbsUp}
                              label="Correct"
                              onClick={() =>
                                recordFeedback(run.id, 'CORRECT')
                              }
                            />
                            <FeedbackButton
                              active={run.feedback === 'FALSE_TRIGGER'}
                              busy={
                                busyKey ===
                                'feedback:' +
                                  run.id +
                                  ':FALSE_TRIGGER'
                              }
                              icon={ThumbsDown}
                              label="False trigger"
                              onClick={() =>
                                recordFeedback(run.id, 'FALSE_TRIGGER')
                              }
                            />
                            <FeedbackButton
                              active={run.feedback === 'NEEDS_CORRECTION'}
                              busy={
                                busyKey ===
                                'feedback:' +
                                  run.id +
                                  ':NEEDS_CORRECTION'
                              }
                              icon={AlertTriangle}
                              label="Needs correction"
                              onClick={() =>
                                recordFeedback(run.id, 'NEEDS_CORRECTION')
                              }
                            />
                          </>
                        )}

                      {run.status === 'SUCCEEDED' &&
                        context?.capabilities.canCompensate && (
                          <button
                            type="button"
                            onClick={() => compensate(run.id)}
                            disabled={
                              busyKey === 'compensate:' + run.id
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                          >
                            <Undo2 className="w-3 h-3" />
                            Compensate
                          </button>
                        )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {quality && (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 w-4 h-4 text-slate-400 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  Time-saved metric intentionally unavailable
                </div>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  {quality.timeSaved.reason}
                </p>
              </div>
            </div>
          </section>
        )}

        <div className="mt-4 text-[10px] text-slate-400">
          Current actor: {context?.role || 'Unknown'} · source{' '}
          {context?.source || 'Unknown'}. Suggested actions still live in Actions;
          this workspace governs approval, automatic execution, recovery, and quality.
        </div>
      </div>
    </main>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string | number;
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
    <div className="mt-0.5 text-[10px] leading-4 text-slate-400">
      {note}
    </div>
  </div>
);

const PolicyFact: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
    <div className="text-[9px] uppercase tracking-wide text-slate-400">
      {label}
    </div>
    <div className="mt-1 text-[11px] font-medium leading-4 text-slate-700">
      {value}
    </div>
  </div>
);

const FeedbackButton: React.FC<{
  active: boolean;
  busy: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}> = ({ active, busy, icon: Icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className={
      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-50 ' +
      (active
        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
    }
  >
    {busy ? (
      <Loader2 className="w-3 h-3 animate-spin" />
    ) : (
      <Icon className="w-3 h-3" />
    )}
    {label}
  </button>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-center text-xs text-slate-400">{text}</div>
);
