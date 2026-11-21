import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { USE_MOCK } from '../api/client';
import { STORAGE_KEY_CURRENT_REPO } from '../components/load/loadUtils';

export interface RepoInfo {
  repoId: string;
  name: string;
  path: string;
  status: 'ingesting' | 'done' | 'error';
  commitCount?: number;
}

export interface RepoContextValue {
  repo: RepoInfo | null;
  activeRepoId: string | null;
  setRepo: (repo: RepoInfo | null) => void;
  clearRepo: () => void;
  updateRepoStatus: (status: 'ingesting' | 'done' | 'error', commitCount?: number) => void;
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
  // Current loaded repository lives strictly in memory for the active session.
  // Clean up any legacy or prior session persisted repo key so sessions never restore across refreshes.
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

  const setRepo = useCallback((newRepo: RepoInfo | null) => {
    setRepoState(newRepo);
  }, []);

  const clearRepo = useCallback(() => {
    setRepoState(null);
  }, []);

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
      setRepo,
      clearRepo,
      updateRepoStatus,
    }),
    [repo, activeRepoId, setRepo, clearRepo, updateRepoStatus]
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

