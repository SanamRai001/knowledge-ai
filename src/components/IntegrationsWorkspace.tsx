import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  History,
  KeyRound,
  Link2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Unplug,
  XCircle,
} from 'lucide-react';
import {
  DrivePicker,
  DrivePickerDocsView,
} from '@googleworkspace/drive-picker-react';
import {
  ExternalImportRecord,
  IntegrationSyncRun,
  PublicIntegrationConnection,
} from '../integrationTypes';

type ProviderKey = 'GOOGLE_DRIVE' | 'MICROSOFT_ONEDRIVE';

type ConnectionDetail = {
  connection: PublicIntegrationConnection;
  runs: IntegrationSyncRun[];
  imports: ExternalImportRecord[];
};

function pretty(value?: string): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function when(value?: number): string {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleString();
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const entry = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('ka_csrf='));
  if (!entry) return '';
  return decodeURIComponent(entry.slice('ka_csrf='.length));
}

function providerName(provider: string): string {
  if (provider === 'GOOGLE_DRIVE') return 'Google Drive';
  if (provider === 'MICROSOFT_ONEDRIVE') return 'Microsoft OneDrive';
  return pretty(provider);
}

function providerDescription(provider: ProviderKey): string {
  return provider === 'GOOGLE_DRIVE'
    ? 'Select specific Drive files with Google Picker, then keep CSV, XLSX, and Google Sheets synchronized.'
    : 'Continuously synchronize CSV and XLSX files from the signed-in user’s OneDrive through Microsoft Graph.';
}

function statusTone(connection: PublicIntegrationConnection): string {
  if (connection.status === 'ACTIVE' && !connection.attentionReason) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (connection.status === 'PAUSED') {
    return 'border-slate-200 bg-slate-50 text-slate-600';
  }
  if (connection.status === 'REVOKED') {
    return 'border-slate-200 bg-slate-100 text-slate-500';
  }
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function attentionCopy(connection: PublicIntegrationConnection): {
  title: string;
  body: string;
} | null {
  switch (connection.attentionReason) {
    case 'REAUTHORIZE':
      return {
        title: 'Authorization expired',
        body: 'Reconnect this provider to replace its encrypted OAuth credential while preserving sync history and cursor state.',
      };
    case 'PERMISSION_LOST':
      return {
        title: 'Permission was removed',
        body: 'The provider rejected access to previously authorized data. Reauthorize before synchronization can continue.',
      };
    case 'CURSOR_RESET_REQUIRED':
      return {
        title: 'Provider checkpoint expired',
        body: 'Knowledge AI will not silently perform a full resync. Reset the cursor explicitly to begin a fresh snapshot.',
      };
    case 'SYNC_FAILED':
      return {
        title: 'Synchronization needs attention',
        body: connection.lastError || 'The latest sync exhausted its bounded retries.',
      };
    default:
      return null;
  }
}

export const IntegrationsWorkspace: React.FC = () => {
  const [connections, setConnections] = useState<PublicIntegrationConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConnectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const googlePickerClientId =
    (import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID as string | undefined)?.trim() || '';
  const googlePickerAppId =
    (import.meta.env.VITE_GOOGLE_DRIVE_APP_ID as string | undefined)?.trim() || '';

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/integrations/connections');
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not load integrations.');
      }
      const next: PublicIntegrationConnection[] = body.connections || [];
      setConnections(next);
      setSelectedId((current) =>
        current && next.some((item) => item.id === current)
          ? current
          : next[0]?.id || null
      );
    } catch (err: any) {
      setError(err.message || 'Could not load integrations.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (connectionId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const [connectionResponse, runsResponse, importsResponse] =
        await Promise.all([
          fetch('/api/integrations/connections/' + connectionId),
          fetch('/api/integrations/connections/' + connectionId + '/runs?limit=40'),
          fetch('/api/integrations/connections/' + connectionId + '/imports?limit=80'),
        ]);

      const [connectionBody, runsBody, importsBody] = await Promise.all([
        connectionResponse.json(),
        runsResponse.json(),
        importsResponse.json(),
      ]);

      if (!connectionResponse.ok) {
        throw new Error(connectionBody.error || 'Could not load integration details.');
      }
      if (!runsResponse.ok) {
        throw new Error(runsBody.error || 'Could not load sync history.');
      }
      if (!importsResponse.ok) {
        throw new Error(importsBody.error || 'Could not load synchronized sources.');
      }

      setDetail({
        connection: connectionBody.connection,
        runs: runsBody.runs || [],
        imports: importsBody.imports || [],
      });
    } catch (err: any) {
      setError(err.message || 'Could not load integration details.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const integrationStatus = params.get('integration');
    const provider = params.get('provider');
    const message = params.get('message');

    if (integrationStatus === 'connected') {
      setNotice(
        (provider === 'google-drive' ? 'Google Drive' : 'Microsoft OneDrive') +
          ' connected. You can synchronize it now.'
      );
    } else if (integrationStatus === 'error') {
      setError(message || 'Integration authorization was not completed.');
    }

    if (integrationStatus) {
      params.delete('integration');
      params.delete('provider');
      params.delete('message');
      const nextQuery = params.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (nextQuery ? '?' + nextQuery : '')
      );
    }

    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const providersConnected = useMemo(
    () =>
      new Set(
        connections
          .filter((item) => item.status !== 'REVOKED')
          .map((item) => item.provider)
      ),
    [connections]
  );

  const activeCount = connections.filter(
    (item) => item.status === 'ACTIVE' && !item.attentionReason
  ).length;
  const attentionCount = connections.filter(
    (item) => Boolean(item.attentionReason)
  ).length;
  const totalImports = detail?.imports.filter((item) => item.status === 'READY').length || 0;

  const beginOAuth = async (
    provider: ProviderKey,
    connectionId?: string
  ) => {
    const key = 'oauth:' + provider + ':' + (connectionId || 'new');
    setBusy(key);
    setError(null);
    setNotice(null);

    try {
      const endpoint =
        provider === 'GOOGLE_DRIVE'
          ? '/api/integrations/google-drive/oauth/start'
          : '/api/integrations/onedrive/oauth/start';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken(),
        },
        body: JSON.stringify({
          displayName:
            provider === 'GOOGLE_DRIVE'
              ? 'Google Drive'
              : 'Microsoft OneDrive',
          connectionId,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || 'Could not start authorization.');
      }
      if (typeof body.authorizationUrl !== 'string') {
        throw new Error('Authorization URL was missing.');
      }

      window.location.assign(body.authorizationUrl);
    } catch (err: any) {
      setError(err.message || 'Could not start authorization.');
      setBusy(null);
    }
  };

  const runAction = async (
    connection: PublicIntegrationConnection,
    action: 'sync' | 'pause' | 'resume' | 'reset-cursor'
  ) => {
    const key = connection.id + ':' + action;
    setBusy(key);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        '/api/integrations/connections/' + connection.id + '/' + action,
        {
          method: 'POST',
          headers: {
            'X-CSRF-Token': csrfToken(),
          },
        }
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || 'Integration action failed.');
      }

      if (action === 'sync') {
        setNotice(
          body.run?.status === 'COMPLETED'
            ? 'Synchronization completed successfully.'
            : 'Synchronization finished with an error that needs attention.'
        );
      } else if (action === 'reset-cursor') {
        setNotice(
          'Provider checkpoint cleared. The next sync will begin a fresh snapshot explicitly.'
        );
      } else {
        setNotice('Integration ' + action + 'd.');
      }

      await loadConnections();
      await loadDetail(connection.id);
    } catch (err: any) {
      setError(err.message || 'Integration action failed.');
      await loadConnections();
      await loadDetail(connection.id);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (connection: PublicIntegrationConnection) => {
    const key = connection.id + ':disconnect';
    setBusy(key);
    setError(null);
    setNotice(null);

    try {
      const endpoint =
        connection.provider === 'GOOGLE_DRIVE'
          ? '/api/integrations/google-drive/connections/' +
            connection.id +
            '/disconnect'
          : '/api/integrations/onedrive/connections/' +
            connection.id +
            '/disconnect';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken(),
        },
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || 'Could not disconnect integration.');
      }

      setNotice(
        providerName(connection.provider) +
          ' disconnected. Local OAuth credentials were removed and future sync is blocked.'
      );
      await loadConnections();
      setSelectedId(null);
      setDetail(null);
    } catch (err: any) {
      setError(err.message || 'Could not disconnect integration.');
    } finally {
      setBusy(null);
    }
  };

  const afterPicker = async () => {
    setPickerVisible(false);
    const google = connections.find(
      (item) =>
        item.provider === 'GOOGLE_DRIVE' &&
        item.status === 'ACTIVE'
    );
    if (!google) {
      setNotice(
        'Files were selected in Google Picker. Connect Google Drive before synchronization.'
      );
      return;
    }

    setNotice(
      'Drive file access was updated. Synchronizing the selected app-authorized files now.'
    );
    await runAction(google, 'sync');
  };

  return (
    <main
      id="integrations-workspace"
      className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]"
    >
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-7">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 mb-2">
              External knowledge
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] text-slate-950 leading-[1.08]">
              Keep company data current without rebuilding your knowledge system.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Connect cloud files through one permission-aware sync layer. Imported
              versions preserve provider provenance and flow into the same datasets,
              company knowledge, insights, actions, and watches you already use.
            </p>
          </div>

          <button
            id="integrations-refresh-button"
            type="button"
            onClick={loadConnections}
            disabled={loading}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} />
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
          <Metric
            label="Healthy connections"
            value={activeCount}
            note="Ready for incremental sync"
            icon={CheckCircle2}
          />
          <Metric
            label="Needs attention"
            value={attentionCount}
            note="Authorization, permission, cursor, or sync issue"
            icon={AlertTriangle}
          />
          <Metric
            label="Selected source versions"
            value={totalImports}
            note="Ready records on the selected connection"
            icon={Database}
          />
        </div>

        <section
          id="integration-provider-cards"
          className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6"
        >
          <ProviderCard
            provider="GOOGLE_DRIVE"
            connected={providersConnected.has('GOOGLE_DRIVE')}
            busy={busy?.startsWith('oauth:GOOGLE_DRIVE') || false}
            onConnect={() => beginOAuth('GOOGLE_DRIVE')}
          >
            {googlePickerClientId && googlePickerAppId ? (
              <>
                <button
                  id="google-drive-picker-button"
                  type="button"
                  onClick={() => setPickerVisible(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Choose Drive files
                </button>

                {pickerVisible && (
                  <DrivePicker
                    client-id={googlePickerClientId}
                    app-id={googlePickerAppId}
                    onPicked={() => {
                      void afterPicker();
                    }}
                    onCanceled={() => setPickerVisible(false)}
                    onOauthError={() => {
                      setPickerVisible(false);
                      setError('Google Picker could not authorize file selection.');
                    }}
                  >
                    <DrivePickerDocsView />
                  </DrivePicker>
                )}
              </>
            ) : (
              <div className="text-[10px] leading-4 text-slate-400">
                Picker becomes available when VITE_GOOGLE_DRIVE_CLIENT_ID and
                VITE_GOOGLE_DRIVE_APP_ID are configured.
              </div>
            )}
          </ProviderCard>

          <ProviderCard
            provider="MICROSOFT_ONEDRIVE"
            connected={providersConnected.has('MICROSOFT_ONEDRIVE')}
            busy={busy?.startsWith('oauth:MICROSOFT_ONEDRIVE') || false}
            onConnect={() => beginOAuth('MICROSOFT_ONEDRIVE')}
          />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-5">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Connections
                </div>
                <div className="text-[10px] text-slate-400">
                  {connections.length} connection{connections.length === 1 ? '' : 's'}
                </div>
              </div>
              <Link2 className="w-4 h-4 text-slate-300" />
            </div>

            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-4 h-4 animate-spin mx-auto text-indigo-600" />
              </div>
            ) : connections.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-slate-400">
                No external systems connected yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {connections.map((connection) => (
                  <button
                    key={connection.id}
                    type="button"
                    onClick={() => setSelectedId(connection.id)}
                    className={
                      'w-full text-left px-4 py-3.5 transition-colors ' +
                      (selectedId === connection.id
                        ? 'bg-indigo-50/60'
                        : 'hover:bg-slate-50')
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          {connection.displayName}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-400">
                          {providerName(connection.provider)}
                        </div>
                      </div>
                      <span
                        className={
                          'rounded-full border px-2 py-0.5 text-[9px] font-bold ' +
                          statusTone(connection)
                        }
                      >
                        {connection.syncInProgress
                          ? 'SYNCING'
                          : connection.attentionReason
                            ? pretty(connection.attentionReason)
                            : connection.status}
                      </span>
                    </div>
                    <div className="mt-2 text-[9px] text-slate-400">
                      Last success: {when(connection.lastSuccessfulSyncAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            {detailLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
                <Loader2 className="w-4 h-4 animate-spin mx-auto text-indigo-600" />
              </div>
            ) : detail ? (
              <ConnectionPanel
                detail={detail}
                busy={busy}
                onAction={runAction}
                onReauthorize={(connection) =>
                  beginOAuth(
                    connection.provider as ProviderKey,
                    connection.id
                  )
                }
                onDisconnect={disconnect}
              />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-xs text-slate-400">
                Select a connection to inspect sync state, history, and external provenance.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

const Metric: React.FC<{
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

const ProviderCard: React.FC<{
  provider: ProviderKey;
  connected: boolean;
  busy: boolean;
  onConnect: () => void;
  children?: React.ReactNode;
}> = ({ provider, connected, busy, onConnect, children }) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
          <Cloud className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {providerName(provider)}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500 max-w-lg">
            {providerDescription(provider)}
          </p>
        </div>
      </div>
      <span
        className={
          'rounded-full border px-2 py-0.5 text-[9px] font-bold ' +
          (connected
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-slate-200 bg-slate-50 text-slate-500')
        }
      >
        {connected ? 'CONNECTED' : 'AVAILABLE'}
      </span>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onConnect}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <KeyRound className="w-3.5 h-3.5" />
        )}
        {connected ? 'Connect another' : 'Connect'}
      </button>
      {children}
    </div>
  </article>
);

const ConnectionPanel: React.FC<{
  detail: ConnectionDetail;
  busy: string | null;
  onAction: (
    connection: PublicIntegrationConnection,
    action: 'sync' | 'pause' | 'resume' | 'reset-cursor'
  ) => Promise<void>;
  onReauthorize: (connection: PublicIntegrationConnection) => void;
  onDisconnect: (connection: PublicIntegrationConnection) => Promise<void>;
}> = ({ detail, busy, onAction, onReauthorize, onDisconnect }) => {
  const { connection, runs, imports } = detail;
  const attention = attentionCopy(connection);
  const latestRun = runs[0];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                {connection.displayName}
              </h3>
              <span className={'rounded-full border px-2 py-0.5 text-[9px] font-bold ' + statusTone(connection)}>
                {connection.status}
              </span>
              {connection.syncInProgress && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">
                  SYNCING
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {providerName(connection.provider)}
            </p>
          </div>

          <div
            id="integration-connection-actions"
            className="flex flex-wrap gap-2"
          >
            {connection.status === 'ACTIVE' && !connection.attentionReason && (
              <>
                <ActionButton
                  label="Sync now"
                  icon={RefreshCw}
                  busy={busy === connection.id + ':sync'}
                  onClick={() => onAction(connection, 'sync')}
                  disabled={connection.syncInProgress}
                />
                <ActionButton
                  label="Pause"
                  icon={Pause}
                  onClick={() => onAction(connection, 'pause')}
                />
              </>
            )}

            {connection.status === 'PAUSED' && (
              <ActionButton
                label="Resume"
                icon={Play}
                onClick={() => onAction(connection, 'resume')}
              />
            )}

            {(connection.attentionReason === 'REAUTHORIZE' ||
              connection.attentionReason === 'PERMISSION_LOST') && (
              <ActionButton
                id="integration-reauthorize-button"
                label="Reauthorize"
                icon={KeyRound}
                onClick={() => onReauthorize(connection)}
              />
            )}

            {connection.attentionReason === 'CURSOR_RESET_REQUIRED' && (
              <ActionButton
                id="integration-reset-cursor-button"
                label="Reset checkpoint"
                icon={RotateCcw}
                onClick={() => onAction(connection, 'reset-cursor')}
              />
            )}

            <button
              id="integration-disconnect-button"
              type="button"
              onClick={() => onDisconnect(connection)}
              disabled={busy === connection.id + ':disconnect'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              <Unplug className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </div>

        {attention && (
          <div
            id="integration-attention-panel"
            className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <div className="flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-amber-900">
                  {attention.title}
                </div>
                <p className="mt-1 text-[11px] leading-5 text-amber-800">
                  {attention.body}
                </p>
                {connection.lastFailureCategory && (
                  <div className="mt-1.5 text-[10px] text-amber-700">
                    Failure category: {pretty(connection.lastFailureCategory)}
                    {connection.consecutiveFailureCount
                      ? ' · ' +
                        connection.consecutiveFailureCount +
                        ' consecutive failure(s)'
                      : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Fact label="Last successful sync" value={when(connection.lastSuccessfulSyncAt)} />
          <Fact label="Last attempt" value={when(connection.lastSyncAt)} />
          <Fact label="Credential" value={connection.hasCredential ? 'Encrypted vault reference' : 'No credential'} />
          <Fact
            label="Checkpoint"
            value={connection.cursor ? 'Incremental cursor stored' : 'Initial snapshot'}
          />
        </div>

        {latestRun && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Latest sync
            </div>
            <div className="mt-1.5 text-xs text-slate-700">
              {latestRun.status} · {latestRun.importedCount} imported ·{' '}
              {latestRun.skippedCount} unchanged · {latestRun.tombstoneCount} removed
              {latestRun.failureCategory
                ? ' · ' + pretty(latestRun.failureCategory)
                : ''}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HistoryPanel
          title="Sync runs"
          icon={History}
          empty="No synchronization has run yet."
          rows={runs.slice(0, 12).map((run) => ({
            id: run.id,
            primary:
              run.status +
              ' · attempt ' +
              run.attemptCount +
              '/' +
              run.maxAttempts,
            secondary:
              when(run.startedAt) +
              ' · ' +
              run.importedCount +
              ' imported · ' +
              run.skippedCount +
              ' skipped · ' +
              run.failedCount +
              ' failed' +
              (run.failureCategory
                ? ' · ' + pretty(run.failureCategory)
                : ''),
            tone: run.status === 'FAILED' ? 'error' : 'normal',
          }))}
        />

        <HistoryPanel
          title="External sources"
          icon={FileSpreadsheet}
          empty="No external source versions have been imported yet."
          rows={imports.slice(0, 16).map((item) => ({
            id: item.id,
            primary:
              item.externalName +
              ' · ' +
              item.status,
            secondary:
              providerName(item.provenance.provider) +
              ' · external ' +
              item.provenance.externalId +
              ' · version ' +
              item.provenance.externalVersion,
            link: item.provenance.webUrl,
            tone: item.status === 'TOMBSTONE' ? 'muted' : 'normal',
          }))}
        />
      </div>
    </div>
  );
};

const ActionButton: React.FC<{
  id?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}> = ({ id, label, icon: Icon, onClick, busy, disabled }) => (
  <button
    id={id}
    type="button"
    onClick={onClick}
    disabled={busy || disabled}
    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
  >
    {busy ? (
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
    ) : (
      <Icon className="w-3.5 h-3.5" />
    )}
    {label}
  </button>
);

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
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
  rows: Array<{
    id: string;
    primary: string;
    secondary: string;
    link?: string;
    tone?: 'normal' | 'error' | 'muted';
  }>;
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
            className={
              'rounded-lg border px-3 py-2.5 ' +
              (row.tone === 'error'
                ? 'border-red-100 bg-red-50/70'
                : row.tone === 'muted'
                  ? 'border-slate-100 bg-slate-50 opacity-70'
                  : 'border-slate-100 bg-slate-50/60')
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-slate-700 break-words">
                  {row.primary}
                </div>
                <div className="mt-1 text-[9px] leading-4 text-slate-400 break-words">
                  {row.secondary}
                </div>
              </div>
              {row.link && (
                <a
                  href={row.link}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open external source"
                  className="shrink-0 rounded p-1 text-slate-400 hover:text-indigo-700 hover:bg-white"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);
