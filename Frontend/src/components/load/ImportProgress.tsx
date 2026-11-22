import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  GitBranch,
  FileClock,
  Activity,
  Circle,
  Loader2,
  FolderGit2,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useRepo, ActiveImportInfo } from '../../context/RepoContext';
import { getStepItems, getRepoNameFromPath } from './loadUtils';
import './ImportProgress.css';

interface ImportProgressProps {
  importInfo?: ActiveImportInfo | null;
  repoId?: string;
  repoPath?: string;
  onReset: (keepPath?: boolean) => void;
}

export const ImportProgress: React.FC<ImportProgressProps> = ({
  importInfo,
  repoPath: propRepoPath,
  onReset,
}) => {
  const navigate = useNavigate();
  const { repo, activeImport } = useRepo();

  const current = importInfo || activeImport;
  const effectiveRepoPath = current?.path || propRepoPath || '';
  const effectiveRepoName = current?.name || getRepoNameFromPath(effectiveRepoPath);

  const pct = current ? Math.max(0, Math.min(100, current.pct)) : 0;
  const commitCount = current?.commitCount ?? 0;
  const isDone = current?.status === 'done' || pct >= 100;
  const isError = current?.status === 'error';
  const errorMessage = current?.error || 'Failed to complete repository import';

  // Live region milestone announcer (only at 25, 50, 75, 100%)
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncedMilestoneRef = useRef<number>(0);

  useEffect(() => {
    const milestones = [25, 50, 75, 100];
    for (const m of milestones) {
      if (pct >= m && lastAnnouncedMilestoneRef.current < m) {
        lastAnnouncedMilestoneRef.current = m;
        if (m === 100) {
          setAnnouncement(`Import finished: ${commitCount.toLocaleString()} commits indexed.`);
        } else {
          setAnnouncement(`Import progress: ${m}% complete.`);
        }
        break;
      }
    }
  }, [pct, commitCount]);

  const stepItems = getStepItems(pct);

  return (
    <Card className="import-progress-card">
      {/* Screen reader live region for milestones */}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

      {/* Header */}
      <div className="import-progress-header">
        <div>
          <span className="import-target-label">Importing repository</span>
          <h2 className="import-target-name">{effectiveRepoName}</h2>
          <code className="import-target-path" title={effectiveRepoPath}>
            {effectiveRepoPath}
          </code>
        </div>

        {isDone ? (
          <div className="status-indicator done">
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>Complete</span>
          </div>
        ) : isError ? (
          <div className="status-indicator error">
            <AlertTriangle size={20} aria-hidden="true" />
            <span>Failed</span>
          </div>
        ) : (
          <div className="status-indicator ingesting">
            <Loader2 size={18} className="spinner-icon" aria-hidden="true" />
            <span>Ingesting</span>
          </div>
        )}
      </div>

      {/* Progress Bar & Stats (Shown while in progress or completed) */}
      {!isError && (
        <div className="import-bar-section">
          <div className="import-bar-labels">
            <span className="import-pct-text">{pct}%</span>
            <span className="import-commits-count">
              {commitCount > 0
                ? `${commitCount.toLocaleString()} commits read so far`
                : 'Reading git history…'}
            </span>
          </div>

          <div
            className="import-progressbar-track"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Repository import progress"
          >
            <div
              className={`import-progressbar-fill ${isDone ? 'is-done' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* 4-Step Milestone Checklist */}
      {!isError && (
        <div className="import-steps-list" role="list" aria-label="Import milestones">
          {stepItems.map((step) => {
            const isStepCompleted = step.status === 'completed';
            const isStepActive = step.status === 'active';

            return (
              <div
                key={step.id}
                role="listitem"
                className={`import-step-item status-${step.status}`}
              >
                <div className="step-icon-wrap" aria-hidden="true">
                  {isStepCompleted ? (
                    <CheckCircle2 size={16} className="step-check" />
                  ) : isStepActive ? (
                    <div className="step-active-dot" />
                  ) : (
                    <Circle size={14} className="step-pending-circle" />
                  )}
                </div>
                <span className="step-label">{step.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Success Completion State */}
      {isDone && (
        <div className="import-success-block" role="status">
          <div className="success-banner">
            <CheckCircle2 size={24} className="success-icon" aria-hidden="true" />
            <div>
              <h3 className="success-title">Import finished</h3>
              <p className="success-desc">
                {commitCount.toLocaleString()} commits indexed. Ready to explore repository history.
              </p>
            </div>
          </div>

          <div className="success-nav-actions">
            <Button
              variant="primary"
              size="lg"
              onClick={() => navigate('/graph')}
              leadingIcon={<GitBranch size={16} />}
            >
              Open Commit Graph
            </Button>

            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate('/files')}
              leadingIcon={<FileClock size={16} />}
            >
              File Evolution
            </Button>

            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate('/dashboard')}
              leadingIcon={<Activity size={16} />}
            >
              Health Dashboard
            </Button>
          </div>
        </div>
      )}

      {/* Error Failure State */}
      {isError && (
        <div className="import-error-block" role="alert">
          <div className="error-banner">
            <AlertTriangle size={24} className="error-icon" aria-hidden="true" />
            <div>
              <h3 className="error-title">Import encountered an error</h3>
              <p className="error-desc">{errorMessage}</p>
              {repo?.status === 'done' ? (
                <p className="error-safe-note">
                  The previous repository (<strong>{repo.name}</strong>) remains active.
                </p>
              ) : (
                <p className="error-safe-note">Your repository was not changed.</p>
              )}
            </div>
          </div>

          <div className="error-nav-actions">
            <Button
              variant="primary"
              size="md"
              onClick={() => onReset(true)}
              leadingIcon={<RotateCcw size={14} />}
            >
              Try again
            </Button>

            <Button
              variant="ghost"
              size="md"
              onClick={() => onReset(false)}
              leadingIcon={<FolderGit2 size={14} />}
            >
              Choose different path
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
