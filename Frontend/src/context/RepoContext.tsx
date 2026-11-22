import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { USE_MOCK, getNextImportRunId } from '../api/client';
import { useRepoStatus, REPO_STATUS_QUERY_KEY } from '../api/hooks';
import {
  loadRecentRepos,
  addRecentRepo,
  saveRecentRepos,
  STORAGE_KEY_CURRENT_REPO,
} from '../components/load/loadUtils';

export interface RepoInfo {
  repoId: string;
  name: string;
  path: string;
  status: 'ingesting' | 'done' | 'error';
  commitCount?: number;
}

export interface ActiveImportInfo {
  repoId: string;
  runId: number;
  name: string;
  path: string;
  status: 'ingesting' | 'done' | 'error';
  pct: number;
  commitCount: number;
  error?: string;
}

export interface RepoContextValue {
  repo: RepoInfo | null;
  activeRepoId: string | null;
  activeImport: ActiveImportInfo | null;
  setRepo: (repo: RepoInfo | null) => void;
  clearRepo: () => void;
  updateRepoStatus: (status: 'ingesting' | 'done' | 'error', commitCount?: number) => void;
  startImport: (params: { repoId: string; runId?: number; name: string; path: string }) => void;
  clearActiveImport: () => void;
}

const RepoContext = createContext<RepoContextValue | undefined>(undefined);

// Clean up any legacy or prior session persisted repo key on startup so sessions never leak
if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem(STORAGE_KEY_CURRENT_REPO);
  } catch {
    // Ignore storage errors
  }
}

export const RepoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();

  // Current loaded repository lives strictly in memory for the active session.
  const [repo, setRepoState] = useState<RepoInfo | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY_CURRENT_REPO);
      } catch {
        // Ignore storage errors
      }
    }
    return null;
  });

  const [activeImport, setActiveImport] = useState<ActiveImportInfo | null>(null);

  // Background status polling for active import run
  const { data: statusData, error: statusError } = useRepoStatus(
    activeImport?.repoId,
    activeImport?.status === 'ingesting',
    activeImport?.runId
  );

  // Synchronize status polling into activeImport and finalize into repo upon completion
  useEffect(() => {
    if (!activeImport || activeImport.status !== 'ingesting') return;

    if (statusError) {
      setActiveImport((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              error: statusError.message || 'Failed to complete repository import',
            }
          : null
      );
      try {
        sessionStorage.removeItem('gitviz_import_in_progress');
      } catch {
        // Ignore
      }
      return;
    }

    if (statusData) {
      const isDone = statusData.status === 'done' || statusData.pct >= 100;
      const isError = statusData.status === 'error';

      if (isError) {
        setActiveImport((prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error: statusData.error || 'Failed to complete repository import',
              }
            : null
        );
        try {
          sessionStorage.removeItem('gitviz_import_in_progress');
        } catch {
          // Ignore
        }
      } else if (isDone) {
        setActiveImport((prev) =>
          prev
            ? {
                ...prev,
                status: 'done',
                pct: 100,
                commitCount: statusData.commit_count,
              }
            : null
        );

        // Crucial: The moment the import reports done, set repo in RepoContext
        setRepoState({
          repoId: activeImport.repoId,
          name: activeImport.name,
          path: activeImport.path,
          status: 'done',
          commitCount: statusData.commit_count,
        });

        // Add to recent repositories list
        try {
          const recents = loadRecentRepos();
          const updated = addRecentRepo(recents, {
            path: activeImport.path,
            name: activeImport.name,
          });
          saveRecentRepos(updated);
          sessionStorage.removeItem('gitviz_import_in_progress');
        } catch {
          // Ignore
        }
      } else {
        // Normal in-progress update
        setActiveImport((prev) =>
          prev
            ? {
                ...prev,
                pct: Math.max(0, Math.min(100, statusData.pct)),
                commitCount: statusData.commit_count,
              }
            : null
        );
      }
    }
  }, [statusData, statusError, activeImport?.repoId, activeImport?.runId, activeImport?.status, activeImport?.name, activeImport?.path]);

  const setRepo = useCallback((newRepo: RepoInfo | null) => {
    setRepoState(newRepo);
    if (!newRepo) {
      setActiveImport(null);
    }
  }, []);

  const clearRepo = useCallback(() => {
    setRepoState(null);
    setActiveImport(null);
    try {
      queryClient.removeQueries({ queryKey: [REPO_STATUS_QUERY_KEY] });
      sessionStorage.removeItem('gitviz_import_in_progress');
    } catch {
      // Ignore
    }
  }, [queryClient]);

  const clearActiveImport = useCallback(() => {
    setActiveImport(null);
    try {
      queryClient.removeQueries({ queryKey: [REPO_STATUS_QUERY_KEY] });
      sessionStorage.removeItem('gitviz_import_in_progress');
    } catch {
      // Ignore
    }
  }, [queryClient]);

  const startImport = useCallback(
    ({
      repoId,
      runId,
      name,
      path,
    }: {
      repoId: string;
      runId?: number;
      name: string;
      path: string;
    }) => {
      const assignedRunId = runId ?? getNextImportRunId();
      // Remove any prior status queries so old cached progress can never leak into the new run
      queryClient.removeQueries({ queryKey: [REPO_STATUS_QUERY_KEY] });

      setActiveImport({
        repoId,
        runId: assignedRunId,
        name,
        path,
        status: 'ingesting',
        pct: 0,
        commitCount: 0,
      });

      try {
        sessionStorage.setItem('gitviz_import_in_progress', 'true');
      } catch {
        // Ignore
      }
    },
    [queryClient]
  );

  const updateRepoStatus = useCallback(
    (status: 'ingesting' | 'done' | 'error', commitCount?: number) => {
      setRepoState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          status,
          commitCount: commitCount !== undefined ? commitCount : prev.commitCount,
        };
      });
    },
    []
  );

  // When a repo is loaded, use its repoId.
  // When no repo is loaded:
  // - In mock mode, returns null (no silent fallback to 'sample-repo')
  // - When USE_MOCK is false, returns '' (maintains teammate's contract)
  const activeRepoId = useMemo(() => {
    if (repo?.repoId) return repo.repoId;
    return USE_MOCK ? null : '';
  }, [repo?.repoId]);

  const value = useMemo<RepoContextValue>(
    () => ({
      repo,
      activeRepoId,
      activeImport,
      setRepo,
      clearRepo,
      updateRepoStatus,
      startImport,
      clearActiveImport,
    }),
    [repo, activeRepoId, activeImport, setRepo, clearRepo, updateRepoStatus, startImport, clearActiveImport]
  );

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
};

export function useRepo(): RepoContextValue {
  const context = useContext(RepoContext);
  if (!context) {
    throw new Error('useRepo must be used within a RepoProvider');
  }
  return context;
}
