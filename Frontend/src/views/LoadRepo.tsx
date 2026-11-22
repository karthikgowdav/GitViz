import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Database, AlertCircle, Info, FolderGit2 } from 'lucide-react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useCreateRepo } from '../api/hooks';
import { USE_MOCK } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Badge } from '../components/ui/Badge';
import { RepoPathForm } from '../components/load/RepoPathForm';
import { ImportProgress } from '../components/load/ImportProgress';
import { WhatHappensCard } from '../components/load/WhatHappensCard';
import { getRepoNameFromPath } from '../components/load/loadUtils';
import './LoadRepo.css';

export const LoadRepo: React.FC = () => {
  usePageTitle('Load Repository');
  const location = useLocation();

  const { repo, setRepo } = useRepo();
  const createRepoMutation = useCreateRepo();

  // Local state for active session path & error
  const [activePath, setActivePath] = useState(repo?.path || '');
  const [serverError, setServerError] = useState<Error | null>(null);
  const [isImportStarted, setIsImportStarted] = useState(false);
  const autoLoadedRef = useRef(false);

  // Check if a prior import was interrupted by a page refresh
  const [interruptedNotice, setInterruptedNotice] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const wasInterrupted = sessionStorage.getItem('gitviz_import_in_progress') === 'true';
      if (wasInterrupted) {
        sessionStorage.removeItem('gitviz_import_in_progress');
        return true;
      }
    } catch {
      // Ignore sessionStorage errors
    }
    return false;
  });

  const handleSubmitPath = async (submittedPath: string) => {
    setServerError(null);
    setInterruptedNotice(false);
    setActivePath(submittedPath);
    setIsImportStarted(true);

    try {
      sessionStorage.setItem('gitviz_import_in_progress', 'true');
    } catch {
      // Ignore
    }

    try {
      const res = await createRepoMutation.mutateAsync({ path: submittedPath });

      // Save initial ingestion state into RepoContext
      const repoName = getRepoNameFromPath(submittedPath);
      setRepo({
        repoId: res.repo_id,
        name: repoName,
        path: submittedPath,
        status: 'ingesting',
        commitCount: 0,
      });
    } catch (err) {
      try {
        sessionStorage.removeItem('gitviz_import_in_progress');
      } catch {
        // Ignore
      }
      setServerError(
        err instanceof Error
          ? err
          : new Error('Failed to start repository ingestion')
      );
    }
  };

  // Handle fresh parameter from ChangeRepoButton
  useEffect(() => {
    if (location.state?.fresh) {
      setActivePath('');
      setServerError(null);
      setIsImportStarted(false);
      try {
        window.history.replaceState({}, document.title);
      } catch {
        // Ignore
      }
    }
  }, [location.state]);

  // Auto-start import if triggered from Home quick-start location state
  useEffect(() => {
    const autoLoadPath = location.state?.autoLoadPath;
    if (autoLoadPath && typeof autoLoadPath === 'string' && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      try {
        window.history.replaceState({}, document.title);
      } catch {
        // Ignore
      }
      handleSubmitPath(autoLoadPath);
    }
  }, [location.state]);

  const handleResetImport = (keepPath: boolean = true) => {
    createRepoMutation.reset();
    setServerError(null);
    setIsImportStarted(false);
    try {
      sessionStorage.removeItem('gitviz_import_in_progress');
    } catch {
      // Ignore
    }
    if (!keepPath) {
      setActivePath('');
    }
    // Clear in-progress repo from context so form is displayed
    if (repo?.status === 'ingesting' || repo?.status === 'error') {
      setRepo(null);
    }
  };

  const isCurrentlyImporting =
    (repo?.status === 'ingesting' && Boolean(repo.repoId)) ||
    createRepoMutation.isPending;

  const showImportProgress = isImportStarted && (isCurrentlyImporting || repo?.status === 'done' || repo?.status === 'error');
  const activeRepoId = repo?.repoId || (USE_MOCK ? 'sample-repo' : '');
  const displayPath = activePath || repo?.path || '';

  return (
    <div className="load-repo-view">
      <div className="load-repo-container">
        {/* Page Header */}
        <header className="load-repo-header">
          <div className="load-repo-title-row">
            <div className="page-header-icon-tile" aria-hidden="true">
              <FolderGit2 size={20} />
            </div>
            <h1 className="load-repo-title">Load a Repository</h1>
            {USE_MOCK && (
              <Badge variant="info" icon={<Database size={12} />}>
                Sample data
              </Badge>
            )}
          </div>
          <p className="load-repo-subtitle">
            Enter the path of a local Git folder. GitViz reads its history once and shows
            progress while it imports.
          </p>
        </header>

        {/* Two-Column Responsive Layout */}
        <div className="load-repo-grid">
          {/* Left Column: Form OR Import Progress */}
          <section className="load-repo-main" aria-label="Repository input and status">
            {interruptedNotice && (
              <div className="import-interrupted-banner" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                <span>Import was interrupted by the page refresh. Please enter the path again.</span>
              </div>
            )}

            {showImportProgress ? (
              <ImportProgress
                repoId={activeRepoId}
                repoPath={displayPath}
                onReset={handleResetImport}
              />
            ) : (
              <div className="load-repo-form-wrapper">
                {repo?.status === 'done' && (
                  <div className="replace-repo-note" role="note">
                    <Info size={15} aria-hidden="true" />
                    <span>Loading a new repository replaces the current one.</span>
                  </div>
                )}
                <RepoPathForm
                  onSubmit={handleSubmitPath}
                  isSubmitting={createRepoMutation.isPending}
                  serverError={serverError}
                  onClearServerError={() => setServerError(null)}
                  initialPath={activePath || repo?.path || ''}
                />
                {USE_MOCK && (
                  <p className="mock-mode-note">
                    Mock mode: any path loads the same sample data.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Right Column: What Happens Card */}
          <aside className="load-repo-aside" aria-label="Import information and guidelines">
            <WhatHappensCard />
          </aside>
        </div>
      </div>
    </div>
  );
};

export default LoadRepo;
