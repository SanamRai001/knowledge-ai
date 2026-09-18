import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  DatasetColumnType,
  DatasetDetail,
  DatasetPreview,
  DatasetSummary,
  DatasetVersion,
} from '../datasetTypes';

const COLUMN_TYPES: DatasetColumnType[] = [
  'TEXT',
  'INTEGER',
  'DECIMAL',
  'CURRENCY',
  'DATE',
  'DATETIME',
  'BOOLEAN',
  'CATEGORICAL',
  'IDENTIFIER',
];

type SchemaOverrides = Record<string, Record<string, DatasetColumnType>>;

interface DatasetWorkspaceProps {
  onDatasetChange?: (datasetId: string | null) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function shortHash(value: string): string {
  return value ? value.slice(0, 10) + '…' + value.slice(-6) : '—';
}

function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

export const DatasetWorkspace: React.FC<DatasetWorkspaceProps> = ({
  onDatasetChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [history, setHistory] = useState<DatasetVersion[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [schemaOverrides, setSchemaOverrides] = useState<SchemaOverrides>({});
  const [datasetName, setDatasetName] = useState('');
  const [description, setDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadDatasets = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const response = await fetch('/api/datasets');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load datasets.');
      setDatasets(body.datasets || []);
    } catch (err: any) {
      setError(err.message || 'Could not load datasets.');
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  const loadDataset = useCallback(async (datasetId: string) => {
    setIsLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch('/api/datasets/' + datasetId);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load dataset.');
      setDetail(body);
      setSelectedDatasetId(datasetId);
      setHistory([body.currentVersion]);
      onDatasetChange?.(datasetId);
    } catch (err: any) {
      setError(err.message || 'Could not load dataset.');
    } finally {
      setIsLoadingDetail(false);
    }
  }, [onDatasetChange]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const previewFile = async (nextFile: File, overrides: SchemaOverrides = {}) => {
    setFile(nextFile);
    setPreview(null);
    setSchemaOverrides(overrides);
    setDatasetName(nextFile.name.replace(/\.(csv|xlsx)$/i, ''));
    setDescription('');
    setError(null);
    setSuccess(null);
    setIsPreviewing(true);

    const formData = new FormData();
    formData.append('file', nextFile);
    if (Object.keys(overrides).length > 0) {
      formData.append('schemaOverrides', JSON.stringify(overrides));
    }

    try {
      const response = await fetch('/api/datasets/preview', {
        method: 'POST',
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not preview this file.');
      setPreview(body);
    } catch (err: any) {
      setError(err.message || 'Could not preview this file.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleFile = (nextFile?: File) => {
    if (!nextFile) return;
    if (!/\.(csv|xlsx)$/i.test(nextFile.name)) {
      setError('Choose a CSV or XLSX file.');
      return;
    }
    previewFile(nextFile);
  };

  const applySchema = async () => {
    if (!file) return;
    await previewFile(file, schemaOverrides);
  };

  const handleSchemaChange = (
    tableName: string,
    columnName: string,
    type: DatasetColumnType
  ) => {
    setSchemaOverrides((current) => ({
      ...current,
      [tableName]: {
        ...(current[tableName] || {}),
        [columnName]: type,
      },
    }));
  };

  const importDataset = async () => {
    if (!file || !preview) return;
    setIsImporting(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('datasetName', datasetName.trim() || file.name);
    if (description.trim()) formData.append('description', description.trim());
    if (Object.keys(schemaOverrides).length > 0) {
      formData.append('schemaOverrides', JSON.stringify(schemaOverrides));
    }

    try {
      const response = await fetch('/api/datasets/import', {
        method: 'POST',
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not import dataset.');

      setSuccess('Dataset imported. It is now available to Ask.');
      setFile(null);
      setPreview(null);
      setSchemaOverrides({});
      await loadDatasets();
      if (body.dataset?.id) await loadDataset(body.dataset.id);
    } catch (err: any) {
      setError(err.message || 'Could not import dataset.');
    } finally {
      setIsImporting(false);
    }
  };

  const loadVersionHistory = async () => {
    if (!detail) return;
    setIsLoadingHistory(true);
    setError(null);
    try {
      const versions = await Promise.all(
        detail.dataset.versionIds.map(async (versionId) => {
          const response = await fetch(
            '/api/datasets/' + detail.dataset.id + '/versions/' + versionId
          );
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Could not load version.');
          return body.version as DatasetVersion;
        })
      );
      versions.sort((a, b) => b.versionNumber - a.versionNumber);
      setHistory(versions);
    } catch (err: any) {
      setError(err.message || 'Could not load dataset history.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const hasSchemaChanges = useMemo(
    () => Object.values(schemaOverrides).some((table) => Object.keys(table).length > 0),
    [schemaOverrides]
  );

  if (detail && selectedDatasetId) {
    const current = detail.currentVersion;
    return (
      <main className="flex-1 overflow-y-auto bg-[#f7f7f3]">
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-7">
          <button
            type="button"
            onClick={() => {
              setDetail(null);
              setSelectedDatasetId(null);
              onDatasetChange?.(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 mb-5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All datasets
          </button>

          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5 mb-7">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                  <ShieldCheck className="w-3 h-3" />
                  Query ready
                </span>
                <span className="text-[11px] text-slate-400">
                  Version {current.versionNumber}
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                {detail.dataset.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500 max-w-2xl">
                {detail.dataset.description || 'Structured business data available for deterministic analysis.'}
              </p>
            </div>

            <button
              type="button"
              onClick={loadVersionHistory}
              disabled={isLoadingHistory}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {isLoadingHistory ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Clock3 className="w-3.5 h-3.5" />
              )}
              Load version history
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-7">
            <InfoCard label="Source" value={current.source.filename} />
            <InfoCard label="Format" value={current.source.format} />
            <InfoCard
              label="Tables"
              value={String(current.tables.length)}
            />
            <InfoCard
              label="Source hash"
              value={shortHash(current.source.sha256)}
              mono
            />
          </div>

          <div className="space-y-6">
            {current.tables.map((table) => (
              <section
                key={table.id}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{table.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {table.rowCount.toLocaleString()} rows · {table.columns.length} columns
                      {table.duplicateRowCount > 0
                        ? ' · ' + table.duplicateRowCount + ' duplicate rows preserved'
                        : ''}
                    </p>
                  </div>
                  <span className="text-[11px] font-medium text-slate-500">
                    Schema is used to validate calculations
                  </span>
                </div>

                <div className="px-5 py-4 flex flex-wrap gap-2 border-b border-slate-100">
                  {table.columns.map((column) => (
                    <div
                      key={column.name}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2"
                    >
                      <div className="text-xs font-medium text-slate-800">{column.name}</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold tracking-wide text-emerald-800">
                          {column.inferredType}
                        </span>
                        {column.nullable && (
                          <span className="text-[10px] text-slate-400">
                            {column.missingCount} missing
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-[#fafaf8] text-slate-500">
                      <tr>
                        {table.columns.map((column) => (
                          <th key={column.name} className="px-4 py-2.5 font-medium whitespace-nowrap">
                            {column.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {table.rows.slice(0, 20).map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-slate-50/70">
                          {table.columns.map((column, columnIndex) => (
                            <td
                              key={column.name}
                              className="px-4 py-2.5 text-slate-700 whitespace-nowrap max-w-xs truncate"
                            >
                              {cellText(row[columnIndex])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.rowCount > 20 && (
                  <div className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-400">
                    Showing the first 20 rows. Ask can analyze the full imported dataset.
                  </div>
                )}
              </section>
            ))}
          </div>

          <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Version history</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Every re-import is immutable so past answers remain reproducible.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {history.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-800">
                      Version {version.versionNumber}
                      {version.id === detail.dataset.currentVersionId && (
                        <span className="ml-2 text-[10px] text-emerald-700">Current</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {version.source.filename} · {new Date(version.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">
                    {shortHash(version.source.sha256)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto bg-[#f7f7f3]">
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-7">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-7">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-2">
              Structured knowledge
            </div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-950">
              Give Knowledge AI your business data.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Import CSV or XLSX files, review how the columns were understood, then ask questions
              that are calculated from the data instead of guessed by the model.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            Add data
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            <Check className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        {!preview && !isPreviewing && (
          <section
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              handleFile(event.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={
              'mb-8 cursor-pointer rounded-2xl border border-dashed px-6 py-9 transition-colors ' +
              (isDragging
                ? 'border-emerald-500 bg-emerald-50'
                : 'border-slate-300 bg-white hover:border-slate-400')
            }
          >
            <div className="max-w-lg mx-auto text-center">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 flex items-center justify-center mx-auto mb-3">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                Drop a CSV or XLSX file here
              </h3>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Nothing is imported immediately. You review the detected tables, column types,
                missing values, and sample rows first.
              </p>
              <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-slate-400">
                <span>CSV up to 10 MB</span>
                <span>•</span>
                <span>XLSX up to 15 MB</span>
                <span>•</span>
                <span>100 columns max</span>
              </div>
            </div>
          </section>
        )}

        {isPreviewing && (
          <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-700 mx-auto" />
            <p className="mt-3 text-sm font-medium text-slate-800">Reading the structure…</p>
            <p className="mt-1 text-xs text-slate-400">No business data is committed yet.</p>
          </section>
        )}

        {preview && file && (
          <section className="mb-8 rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-5 md:px-6 py-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{file.name}</h3>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {preview.source.format}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatBytes(preview.source.sizeBytes)} · {preview.tables.length} table
                  {preview.tables.length === 1 ? '' : 's'} · source hash{' '}
                  <span className="font-mono">{shortHash(preview.source.sha256)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setSchemaOverrides({});
                }}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Choose another file
              </button>
            </div>

            {preview.importRun.warnings.length > 0 && (
              <div className="px-5 md:px-6 py-3 border-b border-amber-100 bg-amber-50/60">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-800 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Review before importing
                </div>
                <ul className="text-[11px] leading-5 text-amber-800/80">
                  {preview.importRun.warnings.slice(0, 6).map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="p-5 md:p-6 space-y-6">
              {preview.tables.map((table) => (
                <div key={table.name} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 bg-[#fafaf8] border-b border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{table.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {table.rowCount.toLocaleString()} rows · {table.columns.length} columns
                      </div>
                    </div>
                    {table.duplicateRowCount > 0 && (
                      <span className="text-[10px] font-medium text-amber-700">
                        {table.duplicateRowCount} duplicate row
                        {table.duplicateRowCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  <div className="px-4 py-3 border-b border-slate-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                      {table.columns.map((column) => {
                        const selected =
                          schemaOverrides[table.name]?.[column.name] || column.inferredType;
                        return (
                          <div
                            key={column.name}
                            className="rounded-lg border border-slate-200 p-2.5 bg-white"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-slate-800 truncate">
                                  {column.name}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {column.distinctCount} distinct
                                  {column.missingCount > 0
                                    ? ' · ' + column.missingCount + ' missing'
                                    : ''}
                                </div>
                              </div>
                              <select
                                value={selected}
                                onChange={(event) =>
                                  handleSchemaChange(
                                    table.name,
                                    column.name,
                                    event.target.value as DatasetColumnType
                                  )
                                }
                                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-emerald-800 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                              >
                                {COLUMN_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {hasSchemaChanges && (
                      <button
                        type="button"
                        onClick={applySchema}
                        disabled={isPreviewing}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        {isPreviewing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Validate schema changes
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          {table.columns.map((column) => (
                            <th key={column.name} className="px-3 py-2 font-medium whitespace-nowrap">
                              {column.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {table.previewRows.slice(0, 8).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {table.columns.map((column, columnIndex) => (
                              <td
                                key={column.name}
                                className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[220px] truncate"
                              >
                                {cellText(row[columnIndex])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-600">Dataset name</span>
                  <input
                    value={datasetName}
                    onChange={(event) => setDatasetName(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-800"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-600">
                    Description <span className="font-normal text-slate-400">optional</span>
                  </span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="e.g. Orders exported from POS"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-800"
                  />
                </label>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                  Import creates an immutable version with source provenance.
                </div>
                <button
                  type="button"
                  onClick={importDataset}
                  disabled={isImporting || isPreviewing || !datasetName.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  {isImporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Database className="w-3.5 h-3.5" />
                  )}
                  Import dataset
                </button>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Your datasets</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                These sources are available for evidence-backed business questions.
              </p>
            </div>
            <button
              type="button"
              onClick={loadDatasets}
              disabled={isLoadingList}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-white"
              title="Refresh datasets"
            >
              <RefreshCw className={'w-3.5 h-3.5 ' + (isLoadingList ? 'animate-spin' : '')} />
            </button>
          </div>

          {isLoadingList ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-slate-500" />
            </div>
          ) : datasets.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center">
              <p className="text-sm font-medium text-slate-700">No datasets imported yet.</p>
              <p className="mt-1 text-xs text-slate-400">
                Start with an orders, sales, inventory, or customer export.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {datasets.map((dataset) => (
                <button
                  key={dataset.id}
                  type="button"
                  onClick={() => loadDataset(dataset.id)}
                  className="group text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600" />
                  </div>
                  <h4 className="mt-4 text-sm font-semibold text-slate-900">{dataset.name}</h4>
                  <p className="mt-1 text-xs text-slate-500 line-clamp-2 min-h-8">
                    {dataset.description || 'Structured business dataset'}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-[10px] text-slate-400">
                    <span>{dataset.versionIds.length} version{dataset.versionIds.length === 1 ? '' : 's'}</span>
                    <span>Updated {new Date(dataset.updatedAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {isLoadingDetail && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-[1px] z-40 flex items-center justify-center">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg flex items-center gap-2 text-xs font-medium text-slate-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            Opening dataset…
          </div>
        </div>
      )}
    </main>
  );
};

const InfoCard: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono = false,
}) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
    <div
      className={
        'mt-1 text-xs font-semibold text-slate-800 truncate ' + (mono ? 'font-mono' : '')
      }
      title={value}
    >
      {value}
    </div>
  </div>
);
