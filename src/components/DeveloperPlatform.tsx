import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Copy,
  FileJson,
  Gauge,
  Key,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  ApiKey,
  ApiUsage,
  KnowledgeBase,
} from '../types';

interface DeveloperPlatformProps {
  activeKb: KnowledgeBase | null;
}

type PlatformTab =
  | 'overview'
  | 'keys'
  | 'capabilities'
  | 'explorer'
  | 'usage';

type PlatformOperation = {
  operationId: string;
  version: string;
  method: 'GET' | 'POST';
  path: string;
  family: string;
  requiredScopes: string[];
  mutation: boolean;
  riskClass: string;
  rateLimitClass: string;
  stability: string;
  description: string;
};

type PlatformManifest = {
  api: string;
  version: string;
  basePath: string;
  stability: string;
  principles: Record<string, string>;
  scopes: string[];
  operations: PlatformOperation[];
};

type CapabilityState = {
  tools: any[];
  detectors: any[];
  packs: any[];
};

const EMPTY_CAPABILITIES: CapabilityState = {
  tools: [],
  detectors: [],
  packs: [],
};

function methodClass(method: string): string {
  return method === 'POST'
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function scopeGroup(scope: string): string {
  const parts = scope.split(':');
  return parts[1] || 'platform';
}

function dateTime(value?: number | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export const DeveloperPlatform: React.FC<
  DeveloperPlatformProps
> = ({ activeKb: _activeKb }) => {
  const [tab, setTab] = useState<PlatformTab>('overview');
  const [manifest, setManifest] =
    useState<PlatformManifest | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<{
    totalRequests: number;
    averageLatencyMs: number;
    recentLogs: ApiUsage[];
  } | null>(null);
  const [platformSecret, setPlatformSecret] = useState('');
  const [createdSecret, setCreatedSecret] = useState('');
  const [newKeyName, setNewKeyName] =
    useState('Platform API Key');
  const [newKeyEnvironment, setNewKeyEnvironment] = useState<
    'live' | 'test'
  >('test');
  const [selectedScopes, setSelectedScopes] = useState<
    string[]
  >([]);
  const [capabilities, setCapabilities] =
    useState<CapabilityState>(EMPTY_CAPABILITIES);
  const [isLoadingCapabilities, setIsLoadingCapabilities] =
    useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [explorerOperationId, setExplorerOperationId] =
    useState('platform.manifest.get');
  const [explorerResult, setExplorerResult] =
    useState<any>(null);
  const [explorerStatus, setExplorerStatus] =
    useState<number | null>(null);
  const [explorerLatency, setExplorerLatency] =
    useState<number | null>(null);

  const fetchManifest = useCallback(async () => {
    const response = await fetch('/api/platform/v1/manifest');
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body?.error?.message ||
          'Could not load stable platform manifest.'
      );
    }
    setManifest(body);

    setSelectedScopes((current) => {
      if (current.length > 0) return current;
      return (body.scopes || []).filter(
        (scope: string) =>
          scope.endsWith(':read') ||
          scope === 'platform:ask:query'
      );
    });
  }, []);

  const fetchKeys = useCallback(async () => {
    const response = await fetch('/api/v1/developer/keys');
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body?.error || 'Could not load API keys.'
      );
    }
    setKeys(body.keys || []);
  }, []);

  const fetchUsage = useCallback(async () => {
    const response = await fetch('/api/v1/developer/usage');
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body?.error || 'Could not load API usage.'
      );
    }
    setUsage(body);
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchManifest(),
        fetchKeys(),
        fetchUsage(),
      ]);
    } catch (err: any) {
      setError(
        err?.message || 'Could not load developer platform.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [fetchKeys, fetchManifest, fetchUsage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stableKeys = useMemo(
    () =>
      keys.filter((key) =>
        key.scopes.some((scope) =>
          scope.startsWith('platform:')
        )
      ),
    [keys]
  );

  const groupedScopes = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const scope of manifest?.scopes || []) {
      const group = scopeGroup(scope);
      grouped.set(group, [
        ...(grouped.get(group) || []),
        scope,
      ]);
    }
    return Array.from(grouped.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [manifest]);

  const readOperations = useMemo(
    () =>
      (manifest?.operations || []).filter(
        (operation) =>
          operation.method === 'GET' &&
          !operation.path.includes(':')
      ),
    [manifest]
  );

  const selectedExplorer = readOperations.find(
    (operation) =>
      operation.operationId === explorerOperationId
  );

  useEffect(() => {
    if (
      readOperations.length > 0 &&
      !readOperations.some(
        (operation) =>
          operation.operationId === explorerOperationId
      )
    ) {
      setExplorerOperationId(
        readOperations[0].operationId
      );
    }
  }, [readOperations, explorerOperationId]);

  const createKey = async () => {
    if (selectedScopes.length === 0) {
      setError('Select at least one platform scope.');
      return;
    }

    setBusyKey('create-key');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        '/api/v1/developer/keys',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name:
              newKeyName.trim() || 'Platform API Key',
            environment: newKeyEnvironment,
            scopes: selectedScopes,
          }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body?.error || 'Could not create API key.'
        );
      }

      setCreatedSecret(body.secret);
      setPlatformSecret(body.secret);
      setNotice(
        'Platform key created. Its secret is shown once—store it securely.'
      );
      await fetchKeys();
    } catch (err: any) {
      setError(err?.message || 'Could not create API key.');
    } finally {
      setBusyKey(null);
    }
  };

  const revokeKey = async (keyId: string) => {
    setBusyKey('revoke:' + keyId);
    setError(null);
    try {
      const response = await fetch(
        '/api/v1/developer/keys/' + keyId,
        { method: 'DELETE' }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body?.error || 'Could not revoke API key.'
        );
      }
      setNotice('API key revoked.');
      await fetchKeys();
    } catch (err: any) {
      setError(err?.message || 'Could not revoke API key.');
    } finally {
      setBusyKey(null);
    }
  };

  const authenticatedFetch = useCallback(
    async (path: string) => {
      if (!platformSecret.trim()) {
        throw new Error(
          'Paste or create a scoped Platform API key first.'
        );
      }
      const response = await fetch(path, {
        headers: {
          Authorization:
            'Bearer ' + platformSecret.trim(),
        },
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body?.error?.message ||
            'Stable Platform API request failed.'
        );
      }
      return body;
    },
    [platformSecret]
  );

  const loadCapabilities = async () => {
    setIsLoadingCapabilities(true);
    setError(null);
    try {
      const [tools, detectors, packs] = await Promise.all([
        authenticatedFetch('/api/platform/v1/tools'),
        authenticatedFetch(
          '/api/platform/v1/detectors'
        ),
        authenticatedFetch(
          '/api/platform/v1/domain-packs'
        ),
      ]);
      setCapabilities({
        tools: tools.tools || [],
        detectors: detectors.detectors || [],
        packs: packs.packs || [],
      });
      setNotice(
        'Loaded governed capabilities using the selected Platform API key.'
      );
    } catch (err: any) {
      setError(
        err?.message || 'Could not load capabilities.'
      );
    } finally {
      setIsLoadingCapabilities(false);
    }
  };

  const runExplorer = async () => {
    if (!selectedExplorer) return;
    setBusyKey('explorer');
    setExplorerResult(null);
    setExplorerStatus(null);
    setExplorerLatency(null);
    setError(null);

    const started = performance.now();
    try {
      const publicOperation =
        selectedExplorer.requiredScopes.length === 0;

      if (
        !publicOperation &&
        !platformSecret.trim()
      ) {
        throw new Error(
          'This operation requires a scoped Platform API key.'
        );
      }

      const response = await fetch(
        '/api/platform/v1' + selectedExplorer.path,
        {
          headers: publicOperation
            ? undefined
            : {
                Authorization:
                  'Bearer ' + platformSecret.trim(),
              },
        }
      );
      const body = await response.json();
      setExplorerStatus(response.status);
      setExplorerLatency(
        Math.round(performance.now() - started)
      );
      setExplorerResult(body);
    } catch (err: any) {
      setExplorerStatus(0);
      setExplorerLatency(
        Math.round(performance.now() - started)
      );
      setExplorerResult({
        error: err?.message || 'Request failed.',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const exampleCurl = selectedExplorer
    ? [
        'curl -X GET "https://your-domain.com/api/platform/v1' +
          selectedExplorer.path +
          '"',
        ...(selectedExplorer.requiredScopes.length > 0
          ? [
              '  -H "Authorization: Bearer kn_live_your_platform_key"',
            ]
          : []),
      ].join(' \\\n')
    : '';

  const summaryCards = [
    {
      label: 'Stable operations',
      value: manifest?.operations.length || 0,
      note: '/api/platform/v1',
      icon: FileJson,
    },
    {
      label: 'Platform scopes',
      value: manifest?.scopes.length || 0,
      note: 'Explicit least privilege',
      icon: ShieldCheck,
    },
    {
      label: 'Scoped keys',
      value: stableKeys.filter(
        (key) => key.status === 'active'
      ).length,
      note: 'Active platform credentials',
      icon: Key,
    },
    {
      label: 'Registered extensions',
      value:
        capabilities.tools.length +
        capabilities.detectors.length +
        capabilities.packs.length,
      note: 'Tools, detectors, domain packs',
      icon: Package,
    },
  ];

  return (
    <main
      id="platform-workspace"
      className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]"
    >
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
        <header className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5 mb-6">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700 mb-2">
              Extensible company intelligence
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] leading-[1.08] text-slate-950">
              Knowledge AI Platform
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Stable, versioned developer contracts for company
              knowledge, tools, detectors, and domain packs—without
              bypassing tenant isolation, provenance, audit, or
              controlled action boundaries.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                Stable API v1
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-500">
                /api/platform/v1
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">
                /api/v1 is legacy compatibility
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            className="inline-flex self-start items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              className={
                'w-3.5 h-3.5 ' +
                (isLoading ? 'animate-spin' : '')
              }
            />
            Refresh platform
          </button>
        </header>

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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-[0.12em] text-slate-400">
                  {card.label}
                </span>
                <card.icon className="w-3.5 h-3.5 text-slate-300" />
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {card.value}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {card.note}
              </div>
            </div>
          ))}
        </div>

        <nav className="mb-5 flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5">
          {[
            ['overview', 'Overview', Gauge],
            ['keys', 'API Keys', Key],
            ['capabilities', 'Extensions', Sparkles],
            ['explorer', 'API Explorer', Terminal],
            ['usage', 'Usage', Activity],
          ].map(([id, label, Icon]: any) => (
            <button
              key={id}
              id={'platform-tab-' + id}
              type="button"
              onClick={() => setTab(id as PlatformTab)}
              className={
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ' +
                (tab === id
                  ? 'bg-slate-950 text-white'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900')
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && manifest && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)] gap-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3 mb-5">
                <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
                  <Code2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Stable contract
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    The manifest is the authoritative map of externally
                    supported operations. Internal cognitive/admin routes
                    are intentionally absent.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {manifest.operations.map((operation) => (
                  <div
                    key={operation.operationId}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          'rounded-md border px-1.5 py-0.5 text-[9px] font-bold ' +
                          methodClass(operation.method)
                        }
                      >
                        {operation.method}
                      </span>
                      <code className="text-[11px] text-slate-700">
                        {operation.path}
                      </code>
                      <span className="ml-auto text-[9px] text-slate-400">
                        {operation.operationId}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
                      {operation.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {operation.requiredScopes.length === 0 ? (
                        <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[9px] text-slate-500">
                          Public manifest
                        </span>
                      ) : (
                        operation.requiredScopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded-full bg-white border border-slate-200 px-2 py-0.5 font-mono text-[9px] text-slate-500"
                          >
                            {scope}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-900">
                  Platform guarantees
                </h3>
                <div className="mt-4 space-y-3">
                  {Object.entries(manifest.principles).map(
                    ([key, value]) => (
                      <div key={key} className="flex gap-2.5">
                        <ShieldCheck className="mt-0.5 w-3.5 h-3.5 shrink-0 text-emerald-600" />
                        <div>
                          <div className="text-[10px] font-semibold text-slate-700">
                            {key}
                          </div>
                          <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                            {value}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white">
                <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  Extension boundary
                </div>
                <div className="mt-3 font-mono text-[11px] leading-6 text-slate-200">
                  stable API / registered contract
                  <br />
                  <span className="text-slate-500">↓</span>
                  <br />
                  explicit scope + schema
                  <br />
                  <span className="text-slate-500">↓</span>
                  <br />
                  authoritative core service
                  <br />
                  <span className="text-slate-500">↓</span>
                  <br />
                  provenance + audit + isolation
                </div>
              </section>
            </div>
          </div>
        )}

        {tab === 'keys' && manifest && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  Scoped Platform API keys
                </h3>
                <p className="mt-1 text-[10px] text-slate-400">
                  Existing secrets cannot be recovered. Create a new
                  key when you need different scopes.
                </p>
              </div>

              {keys.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400">
                  No API keys yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {keys.map((key) => (
                    <div key={key.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-slate-800">
                            {key.name}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">
                            {key.maskedKey}
                          </div>
                        </div>
                        <span
                          className={
                            'rounded-full border px-2 py-0.5 text-[9px] font-semibold ' +
                            (key.status === 'active'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-slate-50 text-slate-500')
                          }
                        >
                          {key.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded-md border border-slate-100 bg-slate-50 px-1.5 py-0.5 font-mono text-[8px] text-slate-500"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[9px] text-slate-400">
                        <span>
                          Last used: {dateTime(key.lastUsedAt)}
                        </span>
                        {key.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => revokeKey(key.id)}
                            disabled={
                              busyKey === 'revoke:' + key.id
                            }
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-3 h-3" />
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Create scoped key
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                Default selection is read/query only. Add mutation
                scopes explicitly when required.
              </p>

              <label className="mt-4 block text-[10px] font-semibold text-slate-600">
                Name
              </label>
              <input
                value={newKeyName}
                onChange={(event) =>
                  setNewKeyName(event.target.value)
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />

              <label className="mt-3 block text-[10px] font-semibold text-slate-600">
                Environment
              </label>
              <select
                value={newKeyEnvironment}
                onChange={(event) =>
                  setNewKeyEnvironment(
                    event.target.value as 'live' | 'test'
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>

              <div className="mt-4 space-y-3 max-h-[340px] overflow-y-auto pr-1">
                {groupedScopes.map(([group, scopes]) => (
                  <div key={group}>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400">
                      {group}
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      {scopes.map((scope) => {
                        const selected =
                          selectedScopes.includes(scope);
                        return (
                          <label
                            key={scope}
                            className="flex items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() =>
                                setSelectedScopes((current) =>
                                  selected
                                    ? current.filter(
                                        (item) =>
                                          item !== scope
                                      )
                                    : [...current, scope]
                                )
                              }
                              className="mt-0.5"
                            />
                            <span className="font-mono text-[9px] leading-4 text-slate-600">
                              {scope}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <button
                id="platform-create-key-button"
                type="button"
                onClick={createKey}
                disabled={busyKey === 'create-key'}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busyKey === 'create-key' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Key className="w-3.5 h-3.5" />
                )}
                Create Platform key
              </button>

              {createdSecret && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-[10px] font-semibold text-emerald-800">
                    Secret shown once
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 text-[9px] text-emerald-900">
                      {createdSecret}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copy(createdSecret, 'new-secret')
                      }
                      className="rounded-lg border border-emerald-200 bg-white p-2 text-emerald-700"
                    >
                      {copied === 'new-secret' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'capabilities' && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Governed extension inventory
                  </h3>
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">
                    Protected capability metadata is loaded through the
                    stable Platform API using your scoped key.
                  </p>
                </div>
                <button
                  id="platform-load-capabilities-button"
                  type="button"
                  onClick={loadCapabilities}
                  disabled={isLoadingCapabilities}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isLoadingCapabilities ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Load with API key
                </button>
              </div>

              <label className="mt-4 block text-[9px] uppercase tracking-wider text-slate-400">
                Platform API key
              </label>
              <input
                type="password"
                value={platformSecret}
                onChange={(event) =>
                  setPlatformSecret(event.target.value)
                }
                placeholder="Paste a scoped kn_... secret or create one in API Keys"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-mono text-[10px] focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </section>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <CapabilityPanel
                title="Registered tools"
                icon={Wrench}
                items={capabilities.tools}
                empty="Load capabilities with a key that has platform:tools:read."
                render={(item) => (
                  <>
                    <div className="text-[11px] font-semibold text-slate-800">
                      {item.id}
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">
                      v{item.version} · {item.executionMode}
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-slate-500">
                      {item.description}
                    </p>
                    <div className="mt-2 text-[9px] text-slate-400">
                      {item.invokable
                        ? 'Invokable with this key'
                        : 'Missing: ' +
                          (item.missingScopes || []).join(', ')}
                    </div>
                  </>
                )}
              />

              <CapabilityPanel
                title="Registered detectors"
                icon={Search}
                items={capabilities.detectors}
                empty="Load capabilities with platform:detectors:read."
                render={(item) => (
                  <>
                    <div className="text-[11px] font-semibold text-slate-800">
                      {item.id}
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">
                      v{item.version} · {item.executionMode}
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-slate-500">
                      {item.description}
                    </p>
                    <div className="mt-2 text-[9px] text-slate-400">
                      {Object.keys(
                        item.configSchema?.properties || {}
                      ).length}{' '}
                      config field(s)
                    </div>
                  </>
                )}
              />

              <CapabilityPanel
                title="Domain packs"
                icon={Package}
                items={capabilities.packs}
                empty="Load capabilities with platform:domain-packs:read."
                render={(item) => (
                  <>
                    <div className="text-[11px] font-semibold text-slate-800">
                      {item.name}
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">
                      {item.id} · v{item.version} ·{' '}
                      {item.executionMode}
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-slate-500">
                      {item.description}
                    </p>
                    <div className="mt-2 flex gap-2 text-[9px] text-slate-400">
                      <span>
                        {item.detectorTemplates?.length || 0}{' '}
                        detector
                      </span>
                      <span>·</span>
                      <span>
                        {item.watchTemplates?.length || 0} watch
                      </span>
                      <span>·</span>
                      <span>
                        {item.actionTemplates?.length || 0} action
                      </span>
                    </div>
                  </>
                )}
              />
            </div>
          </div>
        )}

        {tab === 'explorer' && manifest && (
          <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Safe read explorer
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                The browser explorer intentionally exposes only
                parameter-free GET operations. Mutation examples stay
                in the manifest/docs and require explicit client code.
              </p>

              <label className="mt-4 block text-[9px] uppercase tracking-wider text-slate-400">
                Operation
              </label>
              <select
                value={explorerOperationId}
                onChange={(event) =>
                  setExplorerOperationId(
                    event.target.value
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs"
              >
                {readOperations.map((operation) => (
                  <option
                    key={operation.operationId}
                    value={operation.operationId}
                  >
                    {operation.operationId}
                  </option>
                ))}
              </select>

              {selectedExplorer && (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        'rounded border px-1.5 py-0.5 text-[9px] font-bold ' +
                        methodClass(selectedExplorer.method)
                      }
                    >
                      {selectedExplorer.method}
                    </span>
                    <code className="text-[10px] text-slate-700">
                      {selectedExplorer.path}
                    </code>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-slate-500">
                    {selectedExplorer.description}
                  </p>
                </div>
              )}

              <label className="mt-4 block text-[9px] uppercase tracking-wider text-slate-400">
                API key for protected reads
              </label>
              <input
                type="password"
                value={platformSecret}
                onChange={(event) =>
                  setPlatformSecret(event.target.value)
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[10px]"
                placeholder="kn_..."
              />

              <button
                id="platform-explorer-run-button"
                type="button"
                onClick={runExplorer}
                disabled={!selectedExplorer || busyKey === 'explorer'}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busyKey === 'explorer' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Send stable request
              </button>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400">
                    cURL
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copy(exampleCurl, 'curl')
                    }
                    className="text-slate-400 hover:text-slate-700"
                  >
                    {copied === 'curl' ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-950 p-3 text-[9px] leading-5 text-slate-200">
                  {exampleCurl}
                </pre>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Response
                </h3>
                {explorerStatus !== null && (
                  <div className="text-[9px] text-slate-400">
                    status {explorerStatus} ·{' '}
                    {explorerLatency}ms
                  </div>
                )}
              </div>
              <pre className="mt-4 min-h-[420px] overflow-auto rounded-xl bg-slate-950 p-4 text-[10px] leading-5 text-slate-200">
                {explorerResult
                  ? JSON.stringify(
                      explorerResult,
                      null,
                      2
                    )
                  : 'Run a stable read operation to inspect its response.'}
              </pre>
            </section>
          </div>
        )}

        {tab === 'usage' && (
          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  API usage
                </h3>
                <p className="mt-1 text-[10px] text-slate-400">
                  Stable platform requests share the existing
                  account-scoped API usage audit.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchUsage}
                className="text-slate-400 hover:text-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-slate-100 border-b border-slate-100">
              <UsageMetric
                label="Total requests"
                value={usage?.totalRequests ?? 0}
              />
              <UsageMetric
                label="Average latency"
                value={
                  String(
                    Math.round(
                      usage?.averageLatencyMs || 0
                    )
                  ) + ' ms'
                }
              />
              <UsageMetric
                label="Recent records"
                value={usage?.recentLogs?.length ?? 0}
              />
            </div>

            <div className="divide-y divide-slate-100">
              {(usage?.recentLogs || []).length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400">
                  No API activity recorded yet.
                </div>
              ) : (
                usage!.recentLogs.slice(0, 100).map((log) => (
                  <div
                    key={log.id}
                    className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                  >
                    <span
                      className={
                        'w-12 rounded-md border px-1.5 py-0.5 text-center text-[9px] font-semibold ' +
                        (log.status < 400
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-red-200 bg-red-50 text-red-700')
                      }
                    >
                      {log.status}
                    </span>
                    <code className="min-w-0 flex-1 truncate text-[10px] text-slate-600">
                      {log.endpoint}
                    </code>
                    <span className="text-[9px] text-slate-400">
                      {log.latencyMs}ms
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {dateTime(log.timestamp)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
};

const CapabilityPanel: React.FC<{
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: any[];
  empty: string;
  render: (item: any) => React.ReactNode;
}> = ({ title, icon: Icon, items, empty, render }) => (
  <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
    <div className="px-4 py-3.5 border-b border-slate-100 flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-indigo-600" />
      <h4 className="text-xs font-semibold text-slate-800">
        {title}
      </h4>
      <span className="ml-auto text-[9px] text-slate-400">
        {items.length}
      </span>
    </div>
    {items.length === 0 ? (
      <div className="p-6 text-center text-[10px] leading-4 text-slate-400">
        {empty}
      </div>
    ) : (
      <div className="divide-y divide-slate-100">
        {items.map((item, index) => (
          <div
            key={item.id || index}
            className="px-4 py-3.5"
          >
            {render(item)}
          </div>
        ))}
      </div>
    )}
  </section>
);

const UsageMetric: React.FC<{
  label: string;
  value: string | number;
}> = ({ label, value }) => (
  <div className="bg-white px-5 py-4">
    <div className="text-[9px] uppercase tracking-wider text-slate-400">
      {label}
    </div>
    <div className="mt-1 text-lg font-semibold text-slate-900">
      {value}
    </div>
  </div>
);
