import React from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Play,
} from 'lucide-react';
import { TestResultItem } from '../types';

interface TestSuiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: TestResultItem[];
  onRunTests: () => void;
  isRunning: boolean;
}

export const TestSuiteModal: React.FC<TestSuiteModalProps> = ({
  isOpen,
  onClose,
  results,
  onRunTests,
  isRunning,
}) => {
  if (!isOpen) return null;

  const passedCount = results.filter((r) => r.status === 'passed').length;
  const totalCount = results.length;

  return (
    <div
      id="test-suite-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        id="test-suite-modal"
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-700 text-white shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Knowledge AI Trust Regression Suite
              </h3>
              <p className="text-xs text-slate-500">
                Supported regression checks across grounding, security, isolation, and core product contracts
              </p>
            </div>
          </div>

          <button
            id="btn-close-test-suite"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Supported trust-suite action */}
        <div className="px-6 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-800">Production Trust Suite</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Runs the supported workspace regression contract.
            </p>
          </div>

          <button
            id="btn-run-tests-modal"
            onClick={onRunTests}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
          >
            {isRunning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isRunning ? 'Running Verification...' : 'Execute Suite'}</span>
          </button>
        </div>

        {/* Status Summary Banner */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Execution Status:</span>
            <span
              className={`font-bold px-2.5 py-0.5 rounded-full ${
                passedCount === totalCount && totalCount > 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {passedCount}/{totalCount} Passed
            </span>
          </div>

          <div className="text-slate-500 font-mono text-[11px]">
            /api/kb/run-tests
          </div>
        </div>

        {/* Tests List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
          {results.map((test) => (
            <div
              key={test.id}
              id={`test-item-${test.id}`}
              className={`p-3 rounded-xl border transition-all ${
                test.status === 'passed'
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : test.status === 'failed'
                  ? 'bg-red-50/40 border-red-200'
                  : 'bg-slate-50/60 border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <span className="text-xs font-mono font-semibold text-slate-400 mt-0.5 w-6 shrink-0">
                    #{test.id}
                  </span>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900">{test.name}</h4>
                    {test.details && (
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed font-mono text-[11px]">
                        {test.details}
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0">
                  {test.status === 'passed' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Passed
                    </span>
                  )}
                  {test.status === 'failed' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Failed
                    </span>
                  )}
                  {test.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      <Clock className="w-3.5 h-3.5" />
                      Pending
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
