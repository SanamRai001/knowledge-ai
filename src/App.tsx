/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Header, ActiveTab } from './components/Header';
import { DatasetWorkspace } from './components/DatasetWorkspace';
import { UnifiedAskView } from './components/UnifiedAskView';
import { InsightsWorkspace } from './components/InsightsWorkspace';
import { CompanyKnowledgeWorkspace } from './components/CompanyKnowledgeWorkspace';
import { ActionsWorkspace } from './components/ActionsWorkspace';
import { AutomationWorkspace } from './components/AutomationWorkspace';
import { WatchWorkspace } from './components/WatchWorkspace';
import { IntegrationsWorkspace } from './components/IntegrationsWorkspace';
import { SpecializedAIConfig } from './components/SpecializedAIConfig';
import { KnowledgeVersioningView } from './components/KnowledgeVersioningView';
import { EvaluationCenter } from './components/EvaluationCenter';
import { DeveloperPlatform } from './components/DeveloperPlatform';
import { DocumentViewerModal } from './components/DocumentViewerModal';
import { NewKnowledgeBaseModal } from './components/NewKnowledgeBaseModal';
import { SessionBoundary } from './components/SessionBoundary';
import {
  KnowledgeBase,
  KnowledgeDocument,
  SpecializedAI,
  EvaluationTestCase,
} from './types';
import {
  ApiRequestError,
  canManageDeveloperPlatform,
  readApiResponse,
  shellStateFromError,
  type AuthMeResponse,
  type ShellState,
} from './session';
import { AlertCircle, X } from 'lucide-react';

export default function App() {
  const [activeKb, setActiveKb] = useState<KnowledgeBase | null>(null);
  const [allKbs, setAllKbs] = useState<{ id: string; name: string; documentCount: number }[]>([]);
  const [currentTab, setCurrentTab] = useState<ActiveTab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    const supported: ActiveTab[] = [
      'playground',
      'insights',
      'company',
      'actions',
      'automation',
      'watch',
      'integrations',
      'knowledge',
      'datasets',
      'config',
      'evaluations',
      'developer',
    ];
    return supported.includes(requested as ActiveTab)
      ? (requested as ActiveTab)
      : 'playground';
  });
  const [preferredDatasetId, setPreferredDatasetId] = useState<string | null>(null);

  // Loading states
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [isSavingAiConfig, setIsSavingAiConfig] = useState(false);
  const [isRunningEvaluation, setIsRunningEvaluation] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [authContext, setAuthContext] =
    useState<AuthMeResponse | null>(null);
  const [shellState, setShellState] =
    useState<ShellState>({
      status: 'bootstrapping',
    });
  const [isLoggingIn, setIsLoggingIn] =
    useState(false);

  // Modals state
  const [viewingDocument, setViewingDocument] = useState<KnowledgeDocument | null>(null);
  const [viewingInitialPage, setViewingInitialPage] = useState<number>(1);
  const [isNewKbModalOpen, setIsNewKbModalOpen] = useState(false);

  const fetchActiveKb = useCallback(async () => {
    const res = await fetch('/api/kb', {
      credentials: 'same-origin',
    });
    const data =
      await readApiResponse<any>(
        res,
        'Failed to load active knowledge base'
      );
    setActiveKb(data.kb);
    setAllKbs(data.allKbs || []);
    return data;
  }, []);

  const applyRequestFailure = useCallback(
    (
      error: unknown,
      fallbackMessage: string
    ) => {
      const next = shellStateFromError(
        error,
        fallbackMessage
      );
      if (
        next.status ===
          'session-required' ||
        next.status ===
          'permission-denied' ||
        next.status ===
          'rate-limited' ||
        next.status === 'degraded'
      ) {
        setShellState(next);
        return;
      }

      setGlobalError(
        next.message || fallbackMessage
      );
    },
    []
  );

  const bootstrapShell = useCallback(
    async () => {
      setShellState({
        status: 'bootstrapping',
      });
      setGlobalError(null);

      try {
        const authResponse = await fetch(
          '/api/auth/me',
          {
            credentials: 'same-origin',
          }
        );
        const context =
          await readApiResponse<AuthMeResponse>(
            authResponse,
            'Failed to load your session.'
          );

        if (
          !context.membership ||
          context.membership.status !==
            'ACTIVE'
        ) {
          throw new ApiRequestError({
            status: 403,
            code:
              'AUTH_ACCOUNT_MEMBERSHIP_REQUIRED',
            message:
              'An active account membership is required.',
          });
        }

        setAuthContext(context);
        await fetchActiveKb();
        setShellState({
          status: 'authenticated',
        });
      } catch (error) {
        setAuthContext(null);
        setActiveKb(null);
        setAllKbs([]);
        setShellState(
          shellStateFromError(
            error,
            'Knowledge AI could not initialize.'
          )
        );
      }
    },
    [fetchActiveKb]
  );

  useEffect(() => {
    void bootstrapShell();
  }, [bootstrapShell]);

  const handleLogin = useCallback(
    async (
      email: string,
      password: string
    ) => {
      setIsLoggingIn(true);
      try {
        const response = await fetch(
          '/api/auth/login',
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              email,
              password,
            }),
          }
        );
        await readApiResponse(
          response,
          'Sign in failed.'
        );
        await bootstrapShell();
      } catch (error) {
        setShellState(
          shellStateFromError(
            error,
            'Sign in failed.'
          )
        );
      } finally {
        setIsLoggingIn(false);
      }
    },
    [bootstrapShell]
  );

  // Upload PDF files
  const handleUploadFiles = async (files: FileList | File[]) => {
    setIsUploading(true);
    setGlobalError(null);

    const formData = new FormData();
    const fileArray = Array.from(files);
    fileArray.forEach((f) => {
      formData.append('files', f);
    });

    try {
      const res = await fetch('/api/kb/documents/upload', {
        method: 'POST',
        body: formData,
      });

      const data =
        await readApiResponse<any>(
          res,
          'Failed to upload and process PDF documents'
        );

      if (data.kb) {
        setActiveKb(data.kb);
      }
      await fetchActiveKb();
    } catch (err: any) {
      console.error('Upload error:', err);
      applyRequestFailure(
        err,
        'File upload failed'
      );
    } finally {
      setIsUploading(false);
    }
  };

  // Load sample documents
  const handleLoadSampleDocs = async () => {
    setIsLoadingSamples(true);
    setGlobalError(null);
    try {
      const res = await fetch('/api/kb/documents/sample', {
        method: 'POST',
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to load sample documents'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
      await fetchActiveKb();
    } catch (err: any) {
      console.error('Load samples error:', err);
      applyRequestFailure(
        err,
        'Failed to load sample documents'
      );
    } finally {
      setIsLoadingSamples(false);
    }
  };

  // Remove document
  const handleRemoveDocument = async (id: string) => {
    try {
      const res = await fetch(`/api/kb/documents/${id}`, {
        method: 'DELETE',
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to remove document'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
      await fetchActiveKb();
    } catch (err: any) {
      console.error('Remove document error:', err);
      applyRequestFailure(
        err,
        'Failed to remove document'
      );
    }
  };

  // Retry failed document
  const handleRetryDocument = async (id: string) => {
    try {
      const res = await fetch(`/api/kb/documents/${id}/retry`, {
        method: 'POST',
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to retry document'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
      await fetchActiveKb();
    } catch (err: any) {
      console.error('Retry document error:', err);
      applyRequestFailure(
        err,
        'Failed to retry document'
      );
    }
  };

  // Switch active Knowledge Base
  const handleSwitchKb = async (id: string) => {
    try {
      const res = await fetch('/api/kb/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to switch knowledge base'
        );
      setActiveKb(data.kb);
      setAllKbs(data.allKbs || []);
    } catch (err: any) {
      console.error('Switch KB error:', err);
      applyRequestFailure(
        err,
        'Failed to switch knowledge base'
      );
    }
  };

  // Create new Knowledge Base
  const handleCreateKb = async (name: string, description?: string) => {
    try {
      const res = await fetch('/api/kb/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to create knowledge base'
        );
      setActiveKb(data.kb);
      setAllKbs(data.allKbs || []);
    } catch (err: any) {
      console.error('Create KB error:', err);
      applyRequestFailure(
        err,
        'Failed to create knowledge base'
      );
    }
  };

  // Update Knowledge Base details
  const handleUpdateKbDetails = async (name: string, description: string) => {
    if (!activeKb) return;
    try {
      const res = await fetch(`/api/kb/${activeKb.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to update knowledge base'
        );
      setActiveKb(data.kb);
      setAllKbs(data.allKbs || []);
    } catch (err: any) {
      console.error('Update KB error:', err);
      applyRequestFailure(
        err,
        'Failed to update knowledge base'
      );
    }
  };

  // Save Specialized AI Configuration
  const handleSaveAiConfig = async (updated: Partial<SpecializedAI>) => {
    if (!activeKb) return;
    setIsSavingAiConfig(true);
    setGlobalError(null);
    try {
      const res = await fetch(`/api/kb/${activeKb.id}/ai`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to update Specialized AI configuration'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
    } catch (err: any) {
      console.error('Save AI config error:', err);
      applyRequestFailure(
        err,
        'Failed to update Specialized AI'
      );
    } finally {
      setIsSavingAiConfig(false);
    }
  };

  // Create Knowledge Version Snapshot
  const handleCreateVersion = async (label: string) => {
    if (!activeKb) return;
    try {
      const res = await fetch(`/api/kb/${activeKb.id}/versions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to create snapshot'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
    } catch (err: any) {
      console.error('Create version error:', err);
      applyRequestFailure(
        err,
        'Failed to create version snapshot'
      );
    }
  };

  // Rollback to a specific Version Snapshot
  const handleRollbackVersion = async (versionId: string) => {
    if (!activeKb) return;
    try {
      const res = await fetch(`/api/kb/${activeKb.id}/versions/${versionId}/rollback`, {
        method: 'POST',
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to rollback version'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
    } catch (err: any) {
      console.error('Rollback error:', err);
      applyRequestFailure(
        err,
        'Failed to rollback version'
      );
    }
  };

  // Run AI Evaluation Benchmark Suite
  const handleRunEvaluation = async () => {
    if (!activeKb) return;
    setIsRunningEvaluation(true);
    setGlobalError(null);
    try {
      const res = await fetch(`/api/kb/${activeKb.id}/evaluations/run`, {
        method: 'POST',
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to execute evaluation suite'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
    } catch (err: any) {
      console.error('Evaluation run error:', err);
      applyRequestFailure(
        err,
        'Failed to run evaluation benchmark'
      );
    } finally {
      setIsRunningEvaluation(false);
    }
  };

  // Add custom evaluation test case
  const handleAddTestCase = async (tc: Omit<EvaluationTestCase, 'id'>) => {
    if (!activeKb) return;
    try {
      const res = await fetch(`/api/kb/${activeKb.id}/evaluations/test-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tc),
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to add test case'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
    } catch (err: any) {
      console.error('Add test case error:', err);
      applyRequestFailure(
        err,
        'Failed to add test case'
      );
    }
  };

  // Delete custom evaluation test case
  const handleDeleteTestCase = async (id: string) => {
    if (!activeKb) return;
    try {
      const res = await fetch(`/api/kb/${activeKb.id}/evaluations/test-cases/${id}`, {
        method: 'DELETE',
      });
      const data =
        await readApiResponse<any>(
          res,
          'Failed to delete test case'
        );
      if (data.kb) {
        setActiveKb(data.kb);
      }
    } catch (err: any) {
      console.error('Delete test case error:', err);
      applyRequestFailure(
        err,
        'Failed to delete test case'
      );
    }
  };

  const membershipRole =
    authContext?.membership?.role;
  const canManageDeveloper =
    canManageDeveloperPlatform(
      membershipRole
    );
  const effectiveTab: ActiveTab =
    currentTab === 'developer' &&
    !canManageDeveloper
      ? 'playground'
      : currentTab;

  const handleTabChange = (
    tab: ActiveTab
  ) => {
    if (
      tab === 'developer' &&
      !canManageDeveloper
    ) {
      setCurrentTab('playground');
      return;
    }
    setCurrentTab(tab);
  };

  if (
    shellState.status !==
      'authenticated' ||
    !authContext?.membership
  ) {
    return (
      <SessionBoundary
        state={shellState}
        onRetry={() => {
          void bootstrapShell();
        }}
        onLogin={handleLogin}
        isLoggingIn={isLoggingIn}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-slate-900 font-sans antialiased">
      {/* Top Header with Navigation Tabs */}
      <Header
        activeKb={activeKb}
        allKbs={allKbs}
        currentTab={effectiveTab}
        onTabChange={handleTabChange}
        onNewKb={() => setIsNewKbModalOpen(true)}
        onSwitchKb={handleSwitchKb}
        membershipRole={
          authContext.membership.role
        }
      />

      {/* Global Error Banner */}
      {globalError && (
        <div
          id="global-error-banner"
          className="bg-red-50 border-b border-red-200 px-6 py-2.5 flex items-center justify-between text-xs text-red-700 animate-in fade-in shrink-0"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{globalError}</span>
          </div>
          <button
            onClick={() => setGlobalError(null)}
            className="text-red-500 hover:text-red-800 p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Primary Tab Workspaces */}
      <div className="flex-1 flex overflow-hidden">
        {/* Ask: unified structured-data + document knowledge experience */}
        {effectiveTab === 'playground' && (
          <UnifiedAskView
            activeKnowledgeBaseId={activeKb?.id}
            activeKnowledgeBaseName={activeKb?.name}
            documentCount={activeKb?.documents?.length || 0}
            preferredDatasetId={preferredDatasetId}
          />
        )}

        {/* Proactive discovery */}
        {effectiveTab === 'insights' && (
          <InsightsWorkspace
            activeKnowledgeBaseId={activeKb?.id}
            activeKnowledgeBaseName={activeKb?.name}
            documentCount={activeKb?.documents?.length || 0}
            onOpenDataset={(datasetId) => {
              setPreferredDatasetId(datasetId);
              setCurrentTab('datasets');
            }}
          />
        )}

        {/* Living company knowledge: entities, relationships, truth sources, and history */}
        {effectiveTab === 'company' && (
          <CompanyKnowledgeWorkspace
            activeKnowledgeBaseId={activeKb?.id}
            activeKnowledgeBaseName={activeKb?.name}
            documentCount={activeKb?.documents?.length || 0}
            onOpenDataset={(datasetId) => {
              setPreferredDatasetId(datasetId);
              setCurrentTab('datasets');
            }}
          />
        )}

        {/* Safe natural-language write proposals and audit history */}
        {effectiveTab === 'actions' && <ActionsWorkspace />}

        {/* Governed automatic execution, approvals, recovery, and quality */}
        {effectiveTab === 'automation' && <AutomationWorkspace />}

        {/* Continuous monitoring, reminders, and alert lifecycle */}
        {effectiveTab === 'watch' && <WatchWorkspace />}

        {/* External provider connections and sync history */}
        {effectiveTab === 'integrations' && <IntegrationsWorkspace />}

        {/* Structured business datasets */}
        {effectiveTab === 'datasets' && (
          <DatasetWorkspace
            preferredDatasetId={preferredDatasetId}
            onDatasetChange={(datasetId) => {
              if (datasetId) setPreferredDatasetId(datasetId);
            }}
            onAskDataset={(datasetId) => {
              setPreferredDatasetId(datasetId);
              setCurrentTab('playground');
            }}
          />
        )}

        {/* Documents: knowledge base and versions */}
        {effectiveTab === 'knowledge' && activeKb && (
          <KnowledgeVersioningView
            activeKb={activeKb}
            onUploadFiles={handleUploadFiles}
            onRemoveDocument={handleRemoveDocument}
            onRetryDocument={handleRetryDocument}
            onLoadSampleDocs={handleLoadSampleDocs}
            onViewDocument={(doc) => {
              setViewingInitialPage(1);
              setViewingDocument(doc);
            }}
            onCreateVersion={handleCreateVersion}
            onRollbackVersion={handleRollbackVersion}
            onUpdateKbDetails={handleUpdateKbDetails}
            isUploading={isUploading}
            isLoadingSamples={isLoadingSamples}
          />
        )}

        {/* Specialized AI configuration */}
        {effectiveTab === 'config' && activeKb && (
          <SpecializedAIConfig
            specializedAi={
              activeKb.specializedAi || {
                id: `ai_${activeKb.id}`,
                kbId: activeKb.id,
                name: 'Specialized AI',
                description: '',
                roleDefinition: '',
                responseStyle: 'detailed',
                citationMode: 'standard',
                strictRefusal: true,
                confidenceThreshold: 85,
                createdAt: activeKb.createdDate,
                updatedAt: activeKb.updatedAt,
              }
            }
            kbName={activeKb.name}
            currentVersion={activeKb.currentVersion || 'v1.0'}
            onSaveAiConfig={handleSaveAiConfig}
            isSaving={isSavingAiConfig}
          />
        )}

        {/* Evaluation benchmark center */}
        {effectiveTab === 'evaluations' && activeKb && (
          <EvaluationCenter
            activeKb={activeKb}
            onRunEvaluation={handleRunEvaluation}
            onAddTestCase={handleAddTestCase}
            onDeleteTestCase={handleDeleteTestCase}
            isRunningEvaluation={isRunningEvaluation}
          />
        )}

        {/* Developer platform and REST API */}
        {effectiveTab === 'developer' &&
          canManageDeveloper && (
            <DeveloperPlatform
              activeKb={activeKb}
            />
          )}

      </div>

      {/* Document Content / Pages Inspector Modal */}
      <DocumentViewerModal
        document={viewingDocument}
        initialPageNumber={viewingInitialPage}
        onClose={() => setViewingDocument(null)}
      />

      {/* New Knowledge Base Modal */}
      <NewKnowledgeBaseModal
        isOpen={isNewKbModalOpen}
        onClose={() => setIsNewKbModalOpen(false)}
        onCreate={handleCreateKb}
      />
    </div>
  );
}
