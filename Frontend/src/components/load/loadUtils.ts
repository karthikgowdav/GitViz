/**
 * Pure helper utilities for repository loading, path validation, step mapping,
 * and recent repository storage.
 */

export interface RecentRepo {
  path: string;
  name: string;
  lastLoadedAt: string;
}

export type StepState = 'completed' | 'active' | 'pending';

export interface ImportStepItem {
  id: 'queued' | 'reading' | 'saving' | 'done';
  label: string;
  status: StepState;
}

export const STORAGE_KEY_CURRENT_REPO = 'gitviz_current_repo';
export const STORAGE_KEY_RECENT_REPOS = 'gitviz_recent_repos';
export const MAX_RECENT_REPOS = 5;

/**
 * Validate repository path on client side.
 * Checks for empty input, whitespace, and control/newline characters.
 * Does NOT check filesystem existence; backend handles that.
 */
export function validateRepoPath(path: string): string | null {
  if (!path || typeof path !== 'string' || path.trim().length === 0) {
    return 'Repository path is required.';
  }

  // Check for ASCII control characters (0-31) and DEL (127), including newlines and tabs
  // eslint-disable-next-line no-control-regex
  const controlCharRegex = /[\x00-\x1F\x7F]/;
  if (controlCharRegex.test(path)) {
    return 'Path contains invalid control characters or line breaks.';
  }

  return null;
}

/**
 * Extract repository name from path string.
 * Handles Windows backslashes, Unix forward slashes, spaces, and trailing slashes.
 */
export function getRepoNameFromPath(path: string): string {
  if (!path || typeof path !== 'string') {
    return 'repository';
  }

  // Strip trailing slashes and backslashes
  const trimmed = path.trim().replace(/[/\\]+$/, '');
  if (!trimmed) {
    return 'repository';
  }

  // Split on slashes/backslashes
  const segments = trimmed.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0) {
    return 'repository';
  }

  const lastSegment = segments[segments.length - 1];

  // If last segment is a Windows drive like "C:", fallback to drive name or repository
  if (/^[a-zA-Z]:$/.test(lastSegment)) {
    return `drive-${lastSegment.charAt(0).toLowerCase()}`;
  }

  return lastSegment;
}

/**
 * Map completion percentage (0 - 100) to current milestone step ID
 */
export function getStepFromPct(
  pct: number
): 'queued' | 'reading' | 'saving' | 'done' {
  if (pct >= 100) return 'done';
  if (pct >= 80) return 'saving';
  if (pct > 0) return 'reading';
  return 'queued';
}

/**
 * Derive full 4-step progress list from completion percentage
 */
export function getStepItems(pct: number): ImportStepItem[] {
  const clamped = Math.max(0, Math.min(100, pct));

  if (clamped >= 100) {
    return [
      { id: 'queued', label: 'Queued', status: 'completed' },
      { id: 'reading', label: 'Reading history', status: 'completed' },
      { id: 'saving', label: 'Saving results', status: 'completed' },
      { id: 'done', label: 'Done', status: 'completed' },
    ];
  }

  if (clamped >= 80) {
    return [
      { id: 'queued', label: 'Queued', status: 'completed' },
      { id: 'reading', label: 'Reading history', status: 'completed' },
      { id: 'saving', label: 'Saving results', status: 'active' },
      { id: 'done', label: 'Done', status: 'pending' },
    ];
  }

  if (clamped > 0) {
    return [
      { id: 'queued', label: 'Queued', status: 'completed' },
      { id: 'reading', label: 'Reading history', status: 'active' },
      { id: 'saving', label: 'Saving results', status: 'pending' },
      { id: 'done', label: 'Done', status: 'pending' },
    ];
  }

  return [
    { id: 'queued', label: 'Queued', status: 'active' },
    { id: 'reading', label: 'Reading history', status: 'pending' },
    { id: 'saving', label: 'Saving results', status: 'pending' },
    { id: 'done', label: 'Done', status: 'pending' },
  ];
}

/**
 * Normalize path for deduplication comparisons:
 * - Trims whitespace
 * - Replaces Windows backslashes (\) with forward slashes (/)
 * - Removes trailing slashes (/ and \)
 * - Compares case-insensitively (.toLowerCase())
 */
export function normalizePathKey(path: string): string {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim();
  const unified = trimmed.replace(/\\/g, '/');
  const withoutTrailing = unified.replace(/\/+$/, '');
  return (withoutTrailing || unified).toLowerCase();
}

/**
 * Determine whether secondary path text should be displayed on a chip.
 * Returns false when the repository name and path are identical under normalization.
 */
export function shouldShowSecondaryPath(name: string, path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (!name || typeof name !== 'string') return true;
  return normalizePathKey(name) !== normalizePathKey(path);
}

/**
 * Truncate a path in the middle with an ellipsis (...) if it exceeds maxLength.
 */
export function truncateMiddle(path: string, maxLength: number = 30): string {
  if (!path || typeof path !== 'string') return '';
  if (path.length <= maxLength) return path;
  if (maxLength <= 5) return path.slice(0, maxLength);

  const available = maxLength - 3;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);

  return `${path.slice(0, headLength)}...${path.slice(path.length - tailLength)}`;
}

/**
 * Deduplicate a list of recent repositories by normalized path key.
 * Keeps the newest entry (first occurrence in array), drops subsequent duplicates,
 * and limits list to MAX_RECENT_REPOS (5).
 */
export function dedupeRecentRepos(list: RecentRepo[]): RecentRepo[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: RecentRepo[] = [];

  for (const item of list) {
    if (!item || typeof item.path !== 'string') continue;
    const key = normalizePathKey(item.path);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result.slice(0, MAX_RECENT_REPOS);
}

/**
 * Add or update an entry in recent repositories list.
 * Deduplicates by normalized path key, moves existing entry to index 0,
 * updates its lastLoadedAt date, and limits list to MAX_RECENT_REPOS (5).
 */
export function addRecentRepo(
  currentList: RecentRepo[],
  newEntry: { path: string; name?: string }
): RecentRepo[] {
  const trimmedPath = newEntry?.path?.trim();
  if (!trimmedPath) return dedupeRecentRepos(currentList);

  const key = normalizePathKey(trimmedPath);
  if (!key) return dedupeRecentRepos(currentList);

  const cleanList = dedupeRecentRepos(currentList);
  const existing = cleanList.find((item) => normalizePathKey(item.path) === key);
  const repoName = newEntry.name || (existing ? existing.name : getRepoNameFromPath(trimmedPath));

  const remaining = cleanList.filter((item) => normalizePathKey(item.path) !== key);

  const updatedEntry: RecentRepo = {
    path: trimmedPath,
    name: repoName,
    lastLoadedAt: new Date().toISOString(),
  };

  return [updatedEntry, ...remaining].slice(0, MAX_RECENT_REPOS);
}

/**
 * Remove an entry from recent repositories list by path.
 * Compares paths using normalizePathKey.
 */
export function removeRecentRepo(
  currentList: RecentRepo[],
  pathToRemove: string
): RecentRepo[] {
  if (!pathToRemove || typeof pathToRemove !== 'string' || !Array.isArray(currentList)) {
    return Array.isArray(currentList) ? dedupeRecentRepos(currentList) : [];
  }
  const keyToRemove = normalizePathKey(pathToRemove);
  if (!keyToRemove) return dedupeRecentRepos(currentList);

  return dedupeRecentRepos(currentList).filter(
    (item) => normalizePathKey(item.path) !== keyToRemove
  );
}

/**
 * Remove an entry from localStorage recent repositories safely.
 */
export function removeRecentRepoFromStorage(pathToRemove: string): RecentRepo[] {
  const current = loadRecentRepos();
  const updated = removeRecentRepo(current, pathToRemove);
  saveRecentRepos(updated);
  return updated;
}

/**
 * Load recent repositories from localStorage safely.
 * Cleans up and deduplicates stored lists on read, writing back if cleaned.
 */
export function loadRecentRepos(): RecentRepo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_RECENT_REPOS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const deduped = dedupeRecentRepos(parsed);

    // If duplicates were removed, length changed, or formatting differs, write back the cleaned list
    if (deduped.length !== parsed.length || JSON.stringify(deduped) !== raw) {
      saveRecentRepos(deduped);
    }

    return deduped;
  } catch {
    return [];
  }
}

/**
 * Save recent repositories to localStorage safely
 */
export function saveRecentRepos(repos: RecentRepo[]): void {
  if (typeof window === 'undefined') return;
  try {
    const deduped = dedupeRecentRepos(repos);
    window.localStorage.setItem(
      STORAGE_KEY_RECENT_REPOS,
      JSON.stringify(deduped.slice(0, MAX_RECENT_REPOS))
    );
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * Clear recent repositories list from localStorage safely
 */
export function clearRecentRepos(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_RECENT_REPOS);
  } catch {
    // Ignore storage errors
  }
}
