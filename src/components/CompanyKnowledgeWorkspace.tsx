import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  GitCompareArrows,
  History,
  Loader2,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Split,
  Users,
} from 'lucide-react';
import { DatasetSummary } from '../datasetTypes';
import {
  BusinessEvent,
  CompanyEntity,
  CompanyEntityType,
  CompanyRelationship,
  KnowledgeChangeReport,
  KnowledgeClaim,
  KnowledgeConflict,
  KnowledgeProjectionRun,
} from '../companyKnowledgeTypes';

type KnowledgeView = 'entities' | 'changes' | 'timeline';

interface EntityDetail {
  entity: CompanyEntity;
  relationships: CompanyRelationship[];
  claims: KnowledgeClaim[];
  events: BusinessEvent[];
}

interface CompanyKnowledgeWorkspaceProps {
  activeKnowledgeBaseId?: string;
  activeKnowledgeBaseName?: string;
  documentCount: number;
  onOpenDataset?: (datasetId: string) => void;
}

const ENTITY_TYPES: Array<CompanyEntityType | 'ALL'> = [
  'ALL',
  'CUSTOMER',
  'PRODUCT',
  'SUPPLIER',
  'ORDER',
  'INVOICE',
  'BRANCH',
  'CONTRACT',
  'PROJECT',
  'EMPLOYEE',
  'ORGANIZATION',
  'OTHER',
];

function prettyToken(value: string): string {
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

function authorityLabel(level: string): string {
  return prettyToken(level);
}

function sourceLabel(
  run: KnowledgeProjectionRun,
  datasets: DatasetSummary[],
  activeKnowledgeBaseId?: string,
  activeKnowledgeBaseName?: string
): string {
  if (run.sourceType === 'DATASET') {
    return (
      datasets.find((dataset) => dataset.id === run.sourceId)?.name ||
      'Dataset'
    );
  }
  if (run.sourceId === activeKnowledgeBaseId) {
    return activeKnowledgeBaseName || 'Documents';
  }
  return 'Document workspace';
}

function sourceRefLabel(source: KnowledgeClaim['sourceRef']): string {
  if (source.sourceType === 'DATASET') {
    return (
      source.sourceName +
      (source.tableName ? ' · ' + source.tableName : '') +
      (source.rowIndex ? ' · row ' + source.rowIndex : '')
    );
  }
  if (source.sourceType === 'DOCUMENT') {
    return (
      source.sourceName +
      (source.pageNumber ? ' · page ' + source.pageNumber : '')
    );
  }
  return source.sourceName;
}

function changeVersionLabels(report: KnowledgeChangeReport): {
  from: string;
  to: string;
} {
  const fromLabel =
    report.fromSourceVersionLabel ||
    report.fromSourceVersionId ||
    'Earlier version';
  const toLabel =
    report.toSourceVersionLabel ||
    report.toSourceVersionId ||
    'Later version';

  if (
    report.fromSourceVersionLabel &&
    report.toSourceVersionLabel &&
    report.fromSourceVersionLabel === report.toSourceVersionLabel &&
    report.fromSourceVersionId &&
    report.toSourceVersionId &&
    report.fromSourceVersionId !== report.toSourceVersionId
  ) {
    return {
      from:
        report.fromSourceVersionLabel +
        ' · ' +
        report.fromSourceVersionId.slice(-8),
      to:
        report.toSourceVersionLabel +
        ' · ' +
        report.toSourceVersionId.slice(-8),
    };
  }

  return { from: fromLabel, to: toLabel };
}

export const CompanyKnowledgeWorkspace: React.FC<
  CompanyKnowledgeWorkspaceProps
> = ({
  activeKnowledgeBaseId,
  activeKnowledgeBaseName,
  documentCount,
  onOpenDataset,
}) => {
  const [view, setView] = useState<KnowledgeView>('entities');
  const [summary, setSummary] = useState({
    entities: 0,
    relationships: 0,
    currentClaims: 0,
    events: 0,
  });
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [entities, setEntities] = useState<CompanyEntity[]>([]);
  const [runs, setRuns] = useState<KnowledgeProjectionRun[]>([]);
  const [events, setEvents] = useState<BusinessEvent[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [conflicts, setConflicts] = useState<KnowledgeConflict[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CompanyEntityType | 'ALL'>('ALL');
  const [selectedChangeSource, setSelectedChangeSource] = useState('');
  const [changeReport, setChangeReport] = useState<KnowledgeChangeReport | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingKnowledge, setIsRefreshingKnowledge] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoadingChanges, setIsLoadingChanges] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [summaryResponse, entitiesResponse, runsResponse, eventsResponse, datasetsResponse] =
        await Promise.all([
          fetch('/api/company-knowledge/summary'),
          fetch('/api/company-knowledge/entities?limit=500'),
          fetch('/api/company-knowledge/projection-runs?limit=200'),
          fetch('/api/company-knowledge/events?limit=150'),
          fetch('/api/datasets'),
        ]);

      const [summaryBody, entitiesBody, runsBody, eventsBody, datasetsBody] =
        await Promise.all([
          summaryResponse.json(),
          entitiesResponse.json(),
          runsResponse.json(),
          eventsResponse.json(),
          datasetsResponse.json(),
        ]);

      if (!summaryResponse.ok) {
        throw new Error(summaryBody.error || 'Could not load company knowledge summary.');
      }
      if (!entitiesResponse.ok) {
        throw new Error(entitiesBody.error || 'Could not load company entities.');
      }
      if (!runsResponse.ok) {
        throw new Error(runsBody.error || 'Could not load knowledge history.');
      }
      if (!eventsResponse.ok) {
        throw new Error(eventsBody.error || 'Could not load company timeline.');
      }
      if (!datasetsResponse.ok) {
        throw new Error(datasetsBody.error || 'Could not load datasets.');
      }

      setSummary(summaryBody.summary);
      setEntities(entitiesBody.entities || []);
      setRuns(runsBody.runs || []);
      setEvents(eventsBody.events || []);
      setDatasets(datasetsBody.datasets || []);

      if (!selectedEntityId && entitiesBody.entities?.length > 0) {
        setSelectedEntityId(entitiesBody.entities[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Could not load living company knowledge.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const loadEntityDetail = useCallback(async (entityId: string) => {
    setIsLoadingDetail(true);
    setError(null);
    try {
      const [detailResponse, conflictResponse] = await Promise.all([
        fetch('/api/company-knowledge/entities/' + entityId),
        fetch(
          '/api/company-knowledge/conflicts?entityId=' +
            encodeURIComponent(entityId)
        ),
      ]);
      const [detailBody, conflictBody] = await Promise.all([
        detailResponse.json(),
        conflictResponse.json(),
      ]);

      if (!detailResponse.ok) {
        throw new Error(detailBody.error || 'Could not inspect entity.');
      }
      if (!conflictResponse.ok) {
        throw new Error(conflictBody.error || 'Could not inspect conflicts.');
      }

      setDetail(detailBody);
      setConflicts(conflictBody.conflicts || []);
    } catch (err: any) {
      setError(err.message || 'Could not inspect entity.');
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedEntityId) {
      loadEntityDetail(selectedEntityId);
    } else {
      setDetail(null);
      setConflicts([]);
    }
  }, [selectedEntityId, loadEntityDetail]);

  const visibleEntities = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return entities.filter((entity) => {
      const typeMatches = typeFilter === 'ALL' || entity.type === typeFilter;
      const searchMatches =
        !normalizedSearch ||
        entity.canonicalName.toLowerCase().includes(normalizedSearch) ||
        entity.identityKey.toLowerCase().includes(normalizedSearch) ||
        entity.aliases.some((alias) =>
          alias.toLowerCase().includes(normalizedSearch)
        );
      return typeMatches && searchMatches;
    });
  }, [entities, search, typeFilter]);

  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities]
  );

  const changeSources = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; runs: KnowledgeProjectionRun[] }
    >();

    for (const run of runs.filter((item) => item.status === 'COMPLETED')) {
      const key = run.sourceType + ':' + run.sourceId;
      const current = groups.get(key) || {
        key,
        label: sourceLabel(
          run,
          datasets,
          activeKnowledgeBaseId,
          activeKnowledgeBaseName
        ),
        runs: [],
      };
      current.runs.push(run);
      groups.set(key, current);
    }

    return Array.from(groups.values())
      .map((group) => {
        const distinct = new Map<string, KnowledgeProjectionRun>();
        for (const run of group.runs.sort((a, b) => b.startedAt - a.startedAt)) {
          const versionKey =
            run.sourceVersionId || run.sourceVersionLabel || run.id;
          if (!distinct.has(versionKey)) distinct.set(versionKey, run);
        }
        return {
          ...group,
          runs: Array.from(distinct.values()),
        };
      })
      .filter((group) => group.runs.length >= 2);
  }, [
    runs,
    datasets,
    activeKnowledgeBaseId,
    activeKnowledgeBaseName,
  ]);

  useEffect(() => {
    if (
      selectedChangeSource &&
      !changeSources.some((source) => source.key === selectedChangeSource)
    ) {
      setSelectedChangeSource('');
      setChangeReport(null);
    }
    if (!selectedChangeSource && changeSources.length > 0) {
      setSelectedChangeSource(changeSources[0].key);
    }
  }, [changeSources, selectedChangeSource]);

  const loadWhatChanged = async () => {
    const source = changeSources.find(
      (candidate) => candidate.key === selectedChangeSource
    );
    if (!source || source.runs.length < 2) {
      setChangeReport(null);
      return;
    }

    setIsLoadingChanges(true);
    setError(null);

    try {
      const toRun = source.runs[0];
      const fromRun = source.runs[1];
      const response = await fetch(
        '/api/company-knowledge/changes/compare?fromRunId=' +
          encodeURIComponent(fromRun.id) +
          '&toRunId=' +
          encodeURIComponent(toRun.id)
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not compare knowledge versions.');
      }
      setChangeReport(body.changes);
    } catch (err: any) {
      setError(err.message || 'Could not compare knowledge versions.');
    } finally {
      setIsLoadingChanges(false);
    }
  };

  useEffect(() => {
    if (view === 'changes' && selectedChangeSource) {
      loadWhatChanged();
    }
  }, [view, selectedChangeSource]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshKnowledge = async () => {
    const targets: Array<{
      endpoint: string;
      body: Record<string, string>;
      label: string;
    }> = datasets.map((dataset) => ({
      endpoint: '/api/company-knowledge/project/dataset',
      body: { datasetId: dataset.id },
      label: dataset.name,
    }));

    if (activeKnowledgeBaseId && documentCount > 0) {
      targets.push({
        endpoint: '/api/company-knowledge/project/documents',
        body: { knowledgeBaseId: activeKnowledgeBaseId },
        label: activeKnowledgeBaseName || 'Documents',
      });
    }

    if (targets.length === 0) {
      setError('Add a dataset or processed document before building company knowledge.');
      return;
    }

    setIsRefreshingKnowledge(true);
    setError(null);
    setNotice(null);

    try {
      const results = await Promise.allSettled(
        targets.map(async (target) => {
          const response = await fetch(target.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(target.body),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(target.label + ': ' + (body.error || 'projection failed'));
          }
          return body;
        })
      );

      const successCount = results.filter(
        (result) => result.status === 'fulfilled'
      ).length;
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      );

      if (failures.length > 0) {
        setError(
          failures
            .map((failure) => String(failure.reason?.message || failure.reason))
            .join(' · ')
        );
      }
      setNotice(
        'Company knowledge refreshed from ' +
          successCount +
          ' of ' +
          targets.length +
          ' source' +
          (targets.length === 1 ? '' : 's') +
          '.'
      );
      await loadWorkspace();
      if (selectedEntityId) {
        await loadEntityDetail(selectedEntityId);
      }
    } catch (err: any) {
      setError(err.message || 'Could not refresh company knowledge.');
    } finally {
      setIsRefreshingKnowledge(false);
    }
  };

  const selectedEntity = detail?.entity || null;
  const currentClaims = (detail?.claims || []).filter((claim) => claim.isCurrent);
  const historicalClaims = (detail?.claims || []).filter(
    (claim) => !claim.isCurrent
  );

  if (isLoading) {
    return (
      <main className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]">
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-700" />
            <p className="mt-3 text-xs text-slate-500">
              Loading company knowledge…
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]">
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-6">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-2">
              Living company knowledge
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] text-slate-950 leading-[1.08]">
              See what the company knows, how it connects, and where it came from.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500 max-w-2xl">
              Entities, relationships, observations, source authority, and history stay linked to
              their original evidence. Conflicting sources remain visible instead of being silently merged.
            </p>
          </div>

          <button
            type="button"
            onClick={refreshKnowledge}
            disabled={isRefreshingKnowledge}
            className="inline-flex items-center justify-center gap-2 self-start lg:self-auto rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45 shadow-sm"
          >
            {isRefreshingKnowledge ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Refresh knowledge
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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Metric label="Entities" value={summary.entities} icon={Users} />
          <Metric
            label="Relationships"
            value={summary.relationships}
            icon={Network}
          />
          <Metric
            label="Current observations"
            value={summary.currentClaims}
            icon={ShieldCheck}
          />
          <Metric label="Events" value={summary.events} icon={History} />
        </div>

        <div className="flex items-center gap-1.5 mb-5">
          {[
            { value: 'entities' as const, label: 'Entities', icon: Users },
            {
              value: 'changes' as const,
              label: 'What changed?',
              icon: GitCompareArrows,
            },
            { value: 'timeline' as const, label: 'Timeline', icon: Clock3 },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setView(item.value)}
                className={
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors ' +
                  (view === item.value
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900')
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {view === 'entities' && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search company entities"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-700"
                  />
                </div>
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                  {ENTITY_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTypeFilter(type)}
                      className={
                        'shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-semibold ' +
                        (typeFilter === type
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-white text-slate-400 border-slate-200')
                      }
                    >
                      {type === 'ALL' ? 'All' : prettyToken(type)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-[650px] overflow-y-auto p-2">
                {visibleEntities.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    No entities match this view.
                  </div>
                ) : (
                  visibleEntities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => setSelectedEntityId(entity.id)}
                      className={
                        'w-full text-left rounded-xl px-3 py-3 mb-1 border transition-colors ' +
                        (selectedEntityId === entity.id
                          ? 'border-emerald-200 bg-emerald-50/60'
                          : 'border-transparent hover:bg-slate-50')
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 truncate">
                            {entity.canonicalName}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400 truncate">
                            {entity.aliases.length > 0
                              ? entity.aliases.join(' · ')
                              : entity.identityKey}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold text-slate-500">
                          {prettyToken(entity.type)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white min-h-[500px]">
              {isLoadingDetail ? (
                <div className="h-full min-h-[500px] flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-700" />
                </div>
              ) : !selectedEntity || !detail ? (
                <div className="h-full min-h-[500px] flex items-center justify-center text-xs text-slate-400">
                  Select an entity to inspect its living knowledge.
                </div>
              ) : (
                <div>
                  <div className="p-5 md:p-6 border-b border-slate-100">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                          {prettyToken(selectedEntity.type)}
                        </div>
                        <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                          {selectedEntity.canonicalName}
                        </h3>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selectedEntity.aliases.map((alias) => (
                            <span
                              key={alias}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] text-slate-500"
                            >
                              {alias}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        First seen{' '}
                        {new Date(selectedEntity.firstObservedAt).toLocaleString()}
                        <br />
                        Last seen{' '}
                        {new Date(selectedEntity.lastObservedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {conflicts.length > 0 && (
                    <div className="mx-5 md:mx-6 mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                        <Split className="w-3.5 h-3.5" />
                        {conflicts.length} conflicting observation
                        {conflicts.length === 1 ? '' : 's'}
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-amber-700">
                        Different current sources disagree. Knowledge AI keeps both and shows source authority rather than silently overwriting one.
                      </p>
                    </div>
                  )}

                  <div className="p-5 md:p-6 space-y-7">
                    <EntityClaims
                      claims={currentClaims}
                      conflicts={conflicts}
                    />

                    <EntityRelationships
                      relationships={detail.relationships}
                      entityById={entityById}
                      selectedEntityId={selectedEntity.id}
                    />

                    <EntitySources
                      entity={selectedEntity}
                      datasets={datasets}
                      onOpenDataset={onOpenDataset}
                    />

                    {historicalClaims.length > 0 && (
                      <div>
                        <SectionTitle
                          title="History"
                          subtitle="Previous observations remain available instead of being overwritten."
                        />
                        <div className="mt-3 space-y-2">
                          {historicalClaims.slice(0, 20).map((claim) => (
                            <div
                              key={claim.id}
                              className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-semibold text-slate-500">
                                  {prettyToken(claim.predicate)}
                                </span>
                                <span className="text-[9px] text-slate-400">
                                  superseded
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-slate-700">
                                {formatValue(claim.value)}
                              </div>
                              <div className="mt-1 text-[9px] text-slate-400">
                                {sourceRefLabel(claim.sourceRef)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {detail.events.length > 0 && (
                      <div>
                        <SectionTitle
                          title="Entity timeline"
                          subtitle="Observed business events tied to this entity."
                        />
                        <div className="mt-3 border-l border-slate-200 ml-1.5 pl-4 space-y-4">
                          {detail.events.slice(0, 20).map((event) => (
                            <div key={event.id} className="relative">
                              <div className="absolute -left-[19px] top-1.5 w-2 h-2 rounded-full bg-slate-300 ring-4 ring-white" />
                              <div className="text-[10px] font-semibold text-slate-700">
                                {prettyToken(event.type)}
                              </div>
                              <div className="mt-0.5 text-[9px] text-slate-400">
                                {new Date(
                                  event.occurredAt || event.recordedAt
                                ).toLocaleString()}{' '}
                                · {event.sourceRef.sourceName}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {view === 'changes' && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  Deterministic source diff
                </div>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">
                  What changed?
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500 max-w-2xl">
                  Compare the latest two distinct projected source versions. The diff is calculated from entity,
                  relationship, and observation sets—not generated from a free-form model summary.
                </p>
              </div>

              {changeSources.length > 0 && (
                <select
                  value={selectedChangeSource}
                  onChange={(event) => {
                    setSelectedChangeSource(event.target.value);
                    setChangeReport(null);
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700"
                >
                  {changeSources.map((source) => (
                    <option key={source.key} value={source.key}>
                      {source.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {changeSources.length === 0 ? (
              <div className="py-16 text-center">
                <GitCompareArrows className="w-6 h-6 mx-auto text-slate-300" />
                <h4 className="mt-3 text-sm font-semibold text-slate-700">
                  Two source versions are needed.
                </h4>
                <p className="mt-1 text-xs text-slate-400">
                  Re-import a dataset or update/version a document workspace, then refresh company knowledge.
                </p>
              </div>
            ) : isLoadingChanges ? (
              <div className="py-16 text-center">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-700" />
              </div>
            ) : !changeReport ? (
              <div className="py-16 text-center text-xs text-slate-400">
                Select a source to compare.
              </div>
            ) : (
              <ChangeReportView
                report={changeReport}
                entityById={entityById}
              />
            )}
          </section>
        )}

        {view === 'timeline' && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                Company history
              </div>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">
                Knowledge timeline
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Events are append-friendly evidence of what the system observed and when.
              </p>
            </div>

            {events.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400">
                No company events have been projected yet.
              </div>
            ) : (
              <div className="mt-6 border-l border-slate-200 ml-2 pl-5 space-y-5">
                {events.map((event) => (
                  <div key={event.id} className="relative">
                    <div className="absolute -left-[25px] top-1.5 w-2 h-2 rounded-full bg-emerald-600 ring-4 ring-white" />
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-1">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          {prettyToken(event.type)}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          {event.subjectEntityIds
                            .map(
                              (id) =>
                                entityById.get(id)?.canonicalName || id
                            )
                            .join(' · ') || 'Source-level event'}
                        </div>
                      </div>
                      <div className="text-[9px] text-slate-400">
                        {new Date(
                          event.occurredAt || event.recordedAt
                        ).toLocaleString()}
                      </div>
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">
                      {event.sourceRef.sourceName}
                      {event.sourceRef.sourceVersionLabel
                        ? ' · ' + event.sourceRef.sourceVersionLabel
                        : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 text-[10px] text-slate-400">
          <span>
            Imported data and document statements remain observations unless a higher-authority source explicitly confirms them.
          </span>
          <button
            type="button"
            onClick={loadWorkspace}
            className="inline-flex items-center gap-1.5 hover:text-slate-700"
          >
            <RefreshCw className="w-3 h-3" />
            Reload
          </button>
        </div>
      </div>
    </main>
  );
};

const Metric: React.FC<{
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ label, value, icon: Icon }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
    <div className="flex items-center justify-between">
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

const SectionTitle: React.FC<{ title: string; subtitle: string }> = ({
  title,
  subtitle,
}) => (
  <div>
    <div className="text-xs font-semibold text-slate-800">{title}</div>
    <div className="mt-0.5 text-[10px] text-slate-400">{subtitle}</div>
  </div>
);

const EntityClaims: React.FC<{
  claims: KnowledgeClaim[];
  conflicts: KnowledgeConflict[];
}> = ({ claims, conflicts }) => {
  const conflictByPredicate = new Map(
    conflicts.map((conflict) => [conflict.predicate, conflict])
  );

  return (
    <div>
      <SectionTitle
        title="Current knowledge"
        subtitle="Current observations remain labeled by evidence type and source authority."
      />
      {claims.length === 0 ? (
        <div className="mt-3 text-xs text-slate-400">
          No structured observations are attached to this entity yet.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          {claims.slice(0, 30).map((claim) => {
            const conflict = conflictByPredicate.get(claim.predicate);
            const preferred = conflict?.preferredClaimId === claim.id;
            return (
              <div
                key={claim.id}
                className={
                  'rounded-xl border px-3.5 py-3 ' +
                  (conflict
                    ? 'border-amber-200 bg-amber-50/40'
                    : 'border-slate-200 bg-slate-50/40')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[10px] font-semibold text-slate-500">
                    {prettyToken(claim.predicate)}
                  </div>
                  <div className="flex gap-1">
                    <span className="rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[8px] font-semibold text-slate-500">
                      {prettyToken(claim.claimKind)}
                    </span>
                    {preferred && (
                      <span className="rounded-md bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-700">
                        higher authority
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 text-sm font-semibold text-slate-800">
                  {formatValue(claim.value)}
                </div>
                <div className="mt-2 text-[9px] leading-4 text-slate-400">
                  {authorityLabel(claim.authority.level)} ·{' '}
                  {sourceRefLabel(claim.sourceRef)}
                </div>
                {claim.sourceRef.excerpt && (
                  <div className="mt-2 text-[9px] leading-4 text-slate-500 italic line-clamp-3">
                    “{claim.sourceRef.excerpt}”
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const EntityRelationships: React.FC<{
  relationships: CompanyRelationship[];
  entityById: Map<string, CompanyEntity>;
  selectedEntityId: string;
}> = ({ relationships, entityById, selectedEntityId }) => (
  <div>
    <SectionTitle
      title="Relationships"
      subtitle="Connections remain backed by one or more source references."
    />
    {relationships.length === 0 ? (
      <div className="mt-3 text-xs text-slate-400">
        No explicit relationships are attached yet.
      </div>
    ) : (
      <div className="mt-3 space-y-2">
        {relationships.slice(0, 30).map((relationship) => {
          const outgoing = relationship.subjectEntityId === selectedEntityId;
          const otherId = outgoing
            ? relationship.objectEntityId
            : relationship.subjectEntityId;
          const other = entityById.get(otherId);
          return (
            <div
              key={relationship.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/40 px-3.5 py-3"
            >
              <div className="min-w-0 flex-1 text-xs text-slate-700">
                {outgoing ? (
                  <>
                    <span className="font-semibold">
                      {prettyToken(relationship.predicate)}
                    </span>{' '}
                    <ArrowRight className="inline w-3 h-3 mx-1 text-slate-300" />
                    {other?.canonicalName || otherId}
                  </>
                ) : (
                  <>
                    {other?.canonicalName || otherId}{' '}
                    <ArrowRight className="inline w-3 h-3 mx-1 text-slate-300" />
                    <span className="font-semibold">
                      {prettyToken(relationship.predicate)}
                    </span>
                  </>
                )}
              </div>
              <span className="text-[9px] text-slate-400 shrink-0">
                {relationship.sourceRefs.length} source
                {relationship.sourceRefs.length === 1 ? '' : 's'}
              </span>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const EntitySources: React.FC<{
  entity: CompanyEntity;
  datasets: DatasetSummary[];
  onOpenDataset?: (datasetId: string) => void;
}> = ({ entity, datasets, onOpenDataset }) => (
  <div>
    <SectionTitle
      title="Evidence sources"
      subtitle="Where this entity was actually observed."
    />
    <div className="mt-3 space-y-2">
      {entity.sourceRefs.slice(0, 30).map((source, index) => {
        const dataset = datasets.find((item) => item.id === source.sourceId);
        return (
          <div
            key={
              source.sourceType +
              ':' +
              source.sourceId +
              ':' +
              (source.sourceVersionId || '') +
              ':' +
              index
            }
            className="rounded-xl border border-slate-200 px-3.5 py-3 flex items-start gap-3"
          >
            <div className="mt-0.5">
              {source.sourceType === 'DATASET' ? (
                <Database className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <BookOpen className="w-3.5 h-3.5 text-slate-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold text-slate-700">
                {dataset?.name || source.sourceName}
              </div>
              <div className="mt-0.5 text-[9px] text-slate-400">
                {source.sourceVersionLabel || 'source version'}
                {source.tableName ? ' · ' + source.tableName : ''}
                {source.rowIndex ? ' · row ' + source.rowIndex : ''}
                {source.pageNumber ? ' · page ' + source.pageNumber : ''}
              </div>
              {source.excerpt && (
                <div className="mt-1 text-[9px] leading-4 text-slate-500 italic">
                  “{source.excerpt}”
                </div>
              )}
            </div>
            {source.sourceType === 'DATASET' &&
              dataset &&
              onOpenDataset && (
                <button
                  type="button"
                  onClick={() => onOpenDataset(dataset.id)}
                  className="text-[9px] font-semibold text-emerald-700 hover:text-emerald-900"
                >
                  Open
                </button>
              )}
          </div>
        );
      })}
    </div>
  </div>
);

const ChangeReportView: React.FC<{
  report: KnowledgeChangeReport;
  entityById: Map<string, CompanyEntity>;
}> = ({ report, entityById }) => {
  const versionLabels = changeVersionLabels(report);

  return (
  <div className="mt-6">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
      <SmallMetric label="Entities added" value={report.addedEntityIds.length} />
      <SmallMetric
        label="Entities removed"
        value={report.removedEntityIds.length}
      />
      <SmallMetric
        label="Relations changed"
        value={
          report.addedRelationshipIds.length +
          report.removedRelationshipIds.length
        }
      />
      <SmallMetric label="Facts changed" value={report.claimChanges.length} />
    </div>

    <div className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[10px] text-slate-500 mb-5">
      {versionLabels.from}
      <ArrowRight className="inline w-3 h-3 mx-2 text-slate-300" />
      {versionLabels.to}
    </div>

    {report.claimChanges.length === 0 &&
    report.addedEntityIds.length === 0 &&
    report.removedEntityIds.length === 0 &&
    report.addedRelationshipIds.length === 0 &&
    report.removedRelationshipIds.length === 0 ? (
      <div className="py-12 text-center">
        <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-600" />
        <div className="mt-2 text-xs font-semibold text-slate-700">
          No material knowledge changes detected.
        </div>
      </div>
    ) : (
      <div className="space-y-5">
        {report.claimChanges.length > 0 && (
          <div>
            <SectionTitle
              title="Observation changes"
              subtitle="Values added, removed, or changed between the two source projections."
            />
            <div className="mt-3 space-y-2">
              {report.claimChanges.slice(0, 50).map((change, index) => (
                <div
                  key={
                    change.subjectEntityId +
                    ':' +
                    change.predicate +
                    ':' +
                    index
                  }
                  className="rounded-xl border border-slate-200 px-4 py-3"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold text-slate-800">
                        {entityById.get(change.subjectEntityId)?.canonicalName ||
                          change.subjectEntityId}
                        {' · '}
                        {prettyToken(change.predicate)}
                      </div>
                      <div className="mt-1 text-[9px] font-semibold text-slate-400">
                        {change.changeType}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-slate-500">
                        {change.previousValues.length > 0
                          ? change.previousValues.map(formatValue).join(', ')
                          : '—'}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                      <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 font-semibold text-emerald-800">
                        {change.currentValues.length > 0
                          ? change.currentValues.map(formatValue).join(', ')
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(report.addedEntityIds.length > 0 ||
          report.removedEntityIds.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <EntityDeltaList
              title="Appeared"
              ids={report.addedEntityIds}
              entityById={entityById}
            />
            <EntityDeltaList
              title="No longer in source"
              ids={report.removedEntityIds}
              entityById={entityById}
            />
          </div>
        )}
      </div>
    )}
  </div>
  );
};

const SmallMetric: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
    <div className="text-[9px] uppercase tracking-wide text-slate-400">
      {label}
    </div>
    <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
  </div>
);

const EntityDeltaList: React.FC<{
  title: string;
  ids: string[];
  entityById: Map<string, CompanyEntity>;
}> = ({ title, ids, entityById }) => (
  <div className="rounded-xl border border-slate-200 p-4">
    <div className="text-xs font-semibold text-slate-800">{title}</div>
    <div className="mt-2 space-y-1.5">
      {ids.slice(0, 30).map((id) => {
        const entity = entityById.get(id);
        return (
          <div key={id} className="text-[10px] text-slate-500">
            {entity?.canonicalName || id}
            {entity ? ' · ' + prettyToken(entity.type) : ''}
          </div>
        );
      })}
    </div>
  </div>
);
