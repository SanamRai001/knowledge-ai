import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
} from 'lucide-react';
import {
  readApiResponse,
} from '../session';

type DiagnosticStatus =
  | 'OPERATIONAL'
  | 'DEGRADED';

interface DiagnosticCheck {
  id:
    | 'runtime'
    | 'database'
    | 'schema'
    | 'object-storage'
    | 'secret-protection';
  label: string;
  status: DiagnosticStatus;
  guidance: string;
}

interface DiagnosticsResponse {
  status: DiagnosticStatus;
  checkedAt: number;
  checks: DiagnosticCheck[];
  recovery: {
    mode: 'DEPLOYMENT_OPERATED';
    inAppRestoreAvailable: false;
    targetRpoMinutes: number;
    targetRtoMinutes: number;
    minimumRecoverableDeleteWindowDays: number;
    validationMaxAgeDays: number;
    guidance: string;
  };
  release: {
    mode: 'DEPLOYMENT_OPERATED';
    inAppPromotionAvailable: false;
    buildOncePromotion: true;
    requiresWebReadiness: true;
    requiresWorkerReadiness: true;
    requiresRecoveryEvidence: true;
    automaticDownMigration: false;
    guidance: string;
  };
}

function statusClass(
  status: DiagnosticStatus
): string {
  return status === 'OPERATIONAL'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-amber-200 bg-amber-50 text-amber-800';
}

function checkIcon(id: DiagnosticCheck['id']) {
  switch (id) {
    case 'database':
      return (
        <Database className="w-4 h-4" />
      );
    case 'object-storage':
      return (
        <HardDrive className="w-4 h-4" />
      );
    case 'secret-protection':
      return (
        <KeyRound className="w-4 h-4" />
      );
    case 'schema':
      return (
        <ShieldCheck className="w-4 h-4" />
      );
    default:
      return (
        <ServerCog className="w-4 h-4" />
      );
  }
}

function dateTime(value: number): string {
  if (!Number.isFinite(value)) {
    return 'Unknown';
  }
  return new Date(value).toLocaleString();
}

export const DiagnosticsWorkspace: React.FC =
  () => {
    const [report, setReport] =
      useState<DiagnosticsResponse | null>(
        null
      );
    const [isLoading, setIsLoading] =
      useState(true);
    const [error, setError] =
      useState<string | null>(null);

    const load = useCallback(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          '/api/organization/diagnostics',
          {
            credentials: 'same-origin',
          }
        );

        const body =
          await readApiResponse<DiagnosticsResponse>(
            response,
            'Could not load production diagnostics.'
          );

        setReport(body);
      } catch (err: any) {
        setReport(null);
        setError(
          err?.message ||
            'Could not load production diagnostics.'
        );
      } finally {
        setIsLoading(false);
      }
    }, []);

    useEffect(() => {
      void load();
    }, [load]);

    return (
      <main
        id="diagnostics-workspace"
        className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]"
      >
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
          <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-6">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700 mb-2">
                Operations
              </div>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] leading-[1.08] text-slate-950">
                Production diagnostics
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Review sanitized readiness and
                recovery policy without exposing
                credentials, infrastructure
                topology, or internal failure
                details.
              </p>
            </div>

            <button
              id="diagnostics-refresh"
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="inline-flex self-start items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={
                  'w-3.5 h-3.5 ' +
                  (isLoading
                    ? 'animate-spin'
                    : '')
                }
              />
              Refresh
            </button>
          </header>

          <div
            id="diagnostics-read-only-boundary"
            className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600"
          >
            This surface is read only. Restore,
            promotion, rollback, migrations, and
            infrastructure changes remain
            deployment-operated workflows and are
            not executable from the browser.
          </div>

          {error && (
            <div
              id="diagnostics-load-error"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
            >
              {error}
            </div>
          )}

          {isLoading && !report ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">
              Loading sanitized diagnostics…
            </div>
          ) : report ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Activity className="w-4 h-4 text-amber-600" />
                      Runtime readiness
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Last checked{' '}
                      {dateTime(
                        report.checkedAt
                      )}
                    </p>
                  </div>

                  <span
                    id="diagnostics-overall-status"
                    className={
                      'inline-flex self-start rounded-full border px-2.5 py-1 text-[10px] font-semibold ' +
                      statusClass(
                        report.status
                      )
                    }
                  >
                    {report.status ===
                    'OPERATIONAL'
                      ? 'Operational'
                      : 'Degraded'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-5">
                  {report.checks.map(
                    (check) => (
                      <article
                        key={check.id}
                        id={
                          'diagnostic-check-' +
                          check.id
                        }
                        className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <span className="text-slate-500">
                              {checkIcon(
                                check.id
                              )}
                            </span>
                            {check.label}
                          </div>
                          {check.status ===
                          'OPERATIONAL' ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                          )}
                        </div>

                        <p className="mt-3 text-xs leading-5 text-slate-600">
                          {check.guidance}
                        </p>
                      </article>
                    )
                  )}
                </div>
              </section>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
                <section
                  id="diagnostics-recovery-policy"
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <RotateCcw className="w-4 h-4 text-indigo-600" />
                    Recovery policy
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {
                      report.recovery
                        .guidance
                    }
                  </p>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <PolicyValue
                      label="Recovery point target"
                      value={
                        report.recovery
                          .targetRpoMinutes +
                        ' min'
                      }
                    />
                    <PolicyValue
                      label="Restore-time target"
                      value={
                        report.recovery
                          .targetRtoMinutes +
                        ' min'
                      }
                    />
                    <PolicyValue
                      label="Recoverable delete window"
                      value={
                        report.recovery
                          .minimumRecoverableDeleteWindowDays +
                        '+ days'
                      }
                    />
                    <PolicyValue
                      label="Validation freshness"
                      value={
                        report.recovery
                          .validationMaxAgeDays +
                        ' days max'
                      }
                    />
                  </dl>

                  <div
                    id="diagnostics-no-restore-action"
                    className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] text-indigo-800"
                  >
                    No in-app restore action is
                    available.
                  </div>
                </section>

                <section
                  id="diagnostics-release-policy"
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Release & rollback policy
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {
                      report.release
                        .guidance
                    }
                  </p>

                  <ul className="mt-4 space-y-2 text-xs text-slate-600">
                    <PolicyCheck>
                      Build-once immutable promotion
                    </PolicyCheck>
                    <PolicyCheck>
                      Web and worker readiness
                      required
                    </PolicyCheck>
                    <PolicyCheck>
                      Recovery evidence required
                    </PolicyCheck>
                    <PolicyCheck>
                      Automatic database down
                      migration is disabled
                    </PolicyCheck>
                  </ul>

                  <div
                    id="diagnostics-no-promotion-action"
                    className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800"
                  >
                    No in-app promote, rollback, or
                    migration action is available.
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </div>
      </main>
    );
  };

const PolicyValue: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
    <dt className="text-[10px] uppercase tracking-wide text-slate-400">
      {label}
    </dt>
    <dd className="mt-1 font-semibold text-slate-800">
      {value}
    </dd>
  </div>
);

const PolicyCheck: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => (
  <li className="flex items-start gap-2">
    <CheckCircle2 className="mt-0.5 w-3.5 h-3.5 shrink-0 text-emerald-600" />
    <span>{children}</span>
  </li>
);
