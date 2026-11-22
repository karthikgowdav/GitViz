import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Database, AlertCircle, FolderGit2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useCreateRepo } from '../api/hooks';
import { USE_MOCK } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { RepoPathForm } from '../components/load/RepoPathForm';
import { ImportProgress } from '../components/load/ImportProgress';
import { WhatHappensCard } from '../components/load/WhatHappensCard';
import { getRepoNameFromPath } from '../components/load/loadUtils';
import './LoadRepo.css';

export const LoadRepo: React.FC = () => {
  usePageTitle('Load Repository');
  const location = useLocation();

  const { repo, activeImport, startImport, clearRepo, clearActiveImport } = useRepo();
  const createRepoMutation = useCreateRepo();

  // Local state for active input path & errors
  const [activePath, setActivePath] = useState(repo?.path || '');
  const [serverError, setServerError] = useState<Error | null>(null);
  const [formKey, setFormKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

    try {
      const res = await createRepoMutation.mutateAsync({ path: submittedPath });
      const repoName = getRepoNameFromPath(submittedPath);

      startImport({
        repoId: res.repo_id,
        runId: (res as { run_id?: number }).run_id,
        name: repoName,
        path: submittedPath,
      });
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err
          : new Error('Failed to start repository ingestion')
      );
    }
  };

  // Handle fresh parameter from Header / Mobile / CTA / ChangeRepoButton
  // Trigger on location.key so repeated clicks on /load work cleanly
  const lastFreshKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (location.state?.fresh && lastFreshKeyRef.current !== location.key) {
      lastFreshKeyRef.current = location.key;
      clearActiveImport();
      setActivePath('');
      setServerError(null);
      setInterruptedNotice(false);
      setFormKey((k) => k + 1);
      try {
        window.scrollTo(0, 0);
      } catch {
        // Safe in test environments
      }
      try {
        window.history.replaceState({}, document.title);
      } catch {
        // Ignore
      }
    }
  }, [location.key, location.state, clearActiveImport]);

  // Auto-start import if triggered from Home quick-start location state (guard against StrictMode)
  const lastAutoLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const autoLoadPath = location.state?.autoLoadPath;
    if (
      autoLoadPath &&
      typeof autoLoadPath === 'string' &&
      lastAutoLoadKeyRef.current !== location.key
    ) {
      lastAutoLoadKeyRef.current = location.key;
      try {
        window.history.replaceState({}, document.title);
      } catch {
        // Ignore
      }
      setActivePath(autoLoadPath);
      handleSubmitPath(autoLoadPath);
    }
  }, [location.key, location.state]);

  const handleResetImport = (keepPath: boolean = true) => {
    createRepoMutation.reset();
    setServerError(null);
    clearActiveImport();
    if (!keepPath) {
      setActivePath('');
    }
    setFormKey((k) => k + 1);
  };

  const handleClearAndLoadAnother = () => {
    clearRepo();
    clearActiveImport();
    setActivePath('');
    setServerError(null);
    setFormKey((k) => k + 1);
  };

  const showImportProgress = Boolean(activeImport);
  // Teammate contract: activeRepoId must return '' when USE_MOCK is false
  const activeRepoId = repo?.repoId || (USE_MOCK ? 'sample-repo' : '');
  const displayPath = activeImport?.path || activePath || repo?.path || '';

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

            {/* Current Loaded Repository Card (Bug 3) */}
            {repo?.status === 'done' && (
              <Card className="current-repo-card">
                <div className="current-repo-header">
                  <div className="current-repo-title-wrap">
                    <span className="current-repo-badge">Current Repository</span>
                    <h2 className="current-repo-name">{repo.name}</h2>
                    <code className="current-repo-path" title={repo.path}>
                      {repo.path}
                    </code>
                  </div>
                  <div className="current-repo-actions">
                    <Badge variant="success" icon={<CheckCircle2 size={13} aria-hidden="true" />}>
                      Loaded · {(repo.commitCount || 0).toLocaleString()} commits
                    </Badge>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      leadingIcon={<RefreshCw size={15} />}
                      onClick={handleClearAndLoadAnother}
                      className="current-repo-clear-btn"
                    >
                      Clear and load another
                    </Button>
                  </div>
                </div>
                <p className="current-repo-note">
                  Loading a new repository replaces the current one.
                </p>
              </Card>
            )}

            {showImportProgress ? (
              <ImportProgress
                importInfo={activeImport}
                repoId={activeRepoId}
                repoPath={displayPath}
                onReset={handleResetImport}
              />
            ) : (
              <div className="load-repo-form-wrapper">
                <RepoPathForm
                  key={formKey}
                  onSubmit={handleSubmitPath}
                  isSubmitting={createRepoMutation.isPending}
                  serverError={serverError}
                  onClearServerError={() => setServerError(null)}
                  initialPath={activePath}
                  onResetProgress={() => handleResetImport(false)}
                  inputRef={inputRef}
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
