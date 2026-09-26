import React from 'react';
import {
  Database,
  TableProperties,
  Plus,
  ShieldCheck,
  MessageSquare,
  Lightbulb,
  BookOpen,
  Sparkles,
  BarChart2,
  Code2,
  Network,
  BellRing,
  PlugZap,
  Gauge,
  Building2,
  UsersRound,
} from 'lucide-react';
import { KnowledgeBase } from '../types';
import {
  type MembershipRole,
} from '../session';

export type ActiveTab = 'playground' | 'insights' | 'company' | 'actions' | 'automation' | 'watch' | 'integrations' | 'knowledge' | 'datasets' | 'config' | 'evaluations' | 'developer' | 'organization';

interface HeaderProps {
  activeKb: KnowledgeBase | null;
  allKbs: { id: string; name: string; documentCount: number }[];
  currentTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onNewKb: () => void;
  onSwitchKb: (id: string) => void;
  accountMemberships: Array<{
    accountId: string;
    role: MembershipRole;
    status: string;
  }>;
  selectedAccountId: string | null;
  onSwitchAccount: (accountId: string) => void;
  membershipRole: MembershipRole;
}

export const Header: React.FC<HeaderProps> = ({
  activeKb,
  allKbs,
  currentTab,
  onTabChange,
  onNewKb,
  onSwitchKb,
  accountMemberships,
  selectedAccountId,
  onSwitchAccount,
  membershipRole,
}) => {
  const specializedName = activeKb?.specializedAi?.name || 'Assistant';
  const versionTag = activeKb?.currentVersion || 'v1.0';

  return (
    <header
      id="app-header"
      className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs"
    >
      <div className="px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0">
            K
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">
                Knowledge AI
              </h1>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Evidence-backed answers
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-normal">
              Turn company documents and business data into evidence-backed answers, calculations, and decisions.
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <div
            id="account-membership-selector"
            className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs"
          >
            <Building2 className="w-3.5 h-3.5 text-slate-500 mr-1.5 shrink-0" />
            <span className="text-slate-400 mr-1 hidden sm:inline">
              Organization:
            </span>
            {accountMemberships.length > 1 ? (
              <select
                id="account-selector-dropdown"
                value={selectedAccountId || ''}
                onChange={(event) =>
                  onSwitchAccount(event.target.value)
                }
                className="bg-transparent font-medium text-slate-800 focus:outline-hidden cursor-pointer max-w-44"
              >
                {accountMemberships
                  .filter(
                    (membership) =>
                      membership.status === 'ACTIVE'
                  )
                  .map((membership) => (
                    <option
                      key={membership.accountId}
                      value={membership.accountId}
                    >
                      {membership.accountId} · {membership.role}
                    </option>
                  ))}
              </select>
            ) : (
              <span className="font-medium text-slate-800 max-w-44 truncate">
                {selectedAccountId || 'Current account'}
              </span>
            )}
          </div>

          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
            <Database className="w-3.5 h-3.5 text-slate-500 mr-1.5 shrink-0" />
            <span className="text-slate-400 mr-1 hidden sm:inline">Workspace:</span>
            {allKbs.length > 1 ? (
              <select
                id="kb-selector-dropdown"
                value={activeKb?.id || ''}
                onChange={(e) => onSwitchKb(e.target.value)}
                className="bg-transparent font-medium text-slate-800 focus:outline-hidden cursor-pointer"
              >
                {allKbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name} ({kb.documentCount} docs)
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium text-slate-800">
                {activeKb?.name || 'Default Workspace'}
              </span>
            )}
            <span className="ml-1.5 px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 font-mono text-[10px]">
              {versionTag}
            </span>
          </div>

          <button
            id="btn-new-knowledge-base"
            onClick={onNewKb}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Workspace</span>
          </button>

          <span
            id="membership-role-badge"
            className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200"
          >
            {membershipRole}
          </span>
        </div>
      </div>

      <div className="px-6 flex items-center gap-1 border-t border-slate-100 overflow-x-auto">
        <button
          id="nav-tab-playground"
          onClick={() => onTabChange('playground')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'playground'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Ask</span>
        </button>

        <button
          id="nav-tab-insights"
          onClick={() => onTabChange('insights')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'insights'
              ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <Lightbulb className="w-3.5 h-3.5 text-emerald-700" />
          <span>Insights</span>
        </button>

        <button
          id="nav-tab-company"
          onClick={() => onTabChange('company')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'company'
              ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <Network className="w-3.5 h-3.5 text-emerald-700" />
          <span>Knowledge</span>
        </button>

        <button
          id="nav-tab-actions"
          onClick={() => onTabChange('actions')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'actions'
              ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
          <span>Actions</span>
        </button>

        <button
          id="nav-tab-automation"
          onClick={() => onTabChange('automation')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'automation'
              ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <Gauge className="w-3.5 h-3.5 text-emerald-700" />
          <span>Automation</span>
        </button>

        <button
          id="nav-tab-watch"
          onClick={() => onTabChange('watch')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'watch'
              ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <BellRing className="w-3.5 h-3.5 text-emerald-700" />
          <span>Watch</span>
        </button>

        <button
          id="nav-tab-integrations"
          onClick={() => onTabChange('integrations')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'integrations'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <PlugZap className="w-3.5 h-3.5 text-indigo-600" />
          <span>Integrations</span>
        </button>

        <button
          id="nav-tab-knowledge"
          onClick={() => onTabChange('knowledge')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'knowledge'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Documents</span>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full font-mono">
            {activeKb?.documents?.length || 0}
          </span>
        </button>

        <button
          id="nav-tab-datasets"
          onClick={() => onTabChange('datasets')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'datasets'
              ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <TableProperties className="w-3.5 h-3.5 text-emerald-700" />
          <span>Datasets</span>
        </button>

        <button
          id="nav-tab-config"
          onClick={() => onTabChange('config')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'config'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>Assistant Settings</span>
          <span className="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded-md font-normal hidden sm:inline">
            {specializedName}
          </span>
        </button>

        <button
          id="nav-tab-evaluations"
          onClick={() => onTabChange('evaluations')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab === 'evaluations'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Quality</span>
        </button>

        <button
          id="nav-tab-organization"
          onClick={() =>
            onTabChange('organization')
          }
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab ===
            'organization'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <UsersRound className="w-3.5 h-3.5 text-indigo-600" />
          <span>Organization</span>
        </button>

        <button
          id="nav-tab-developer"
          onClick={() =>
            onTabChange('developer')
          }
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            currentTab ===
            'developer'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <Code2 className="w-3.5 h-3.5 text-indigo-600" />
          <span>Developers</span>
        </button>

      </div>
    </header>
  );
};
