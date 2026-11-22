import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateRepoPath,
  getRepoNameFromPath,
  getStepFromPct,
  getStepItems,
  addRecentRepo,
  removeRecentRepo,
  loadRecentRepos,
  saveRecentRepos,
  clearRecentRepos,
  dedupeRecentRepos,
  normalizePathKey,
  shouldShowSecondaryPath,
  truncateMiddle,
  STORAGE_KEY_RECENT_REPOS,
  RecentRepo,
} from './loadUtils';

describe('loadUtils', () => {
  describe('validateRepoPath', () => {
    it('returns error when path is empty or whitespace-only', () => {
      expect(validateRepoPath('')).toBe('Repository path is required.');
      expect(validateRepoPath('   ')).toBe('Repository path is required.');
      expect(validateRepoPath(null as unknown as string)).toBe('Repository path is required.');
    });

    it('returns error when path contains control characters or newlines', () => {
      expect(validateRepoPath('C:\\projects\\my-repo\n')).toBe(
        'Path contains invalid control characters or line breaks.'
      );
      expect(validateRepoPath('/home/user/repo\r\n')).toBe(
        'Path contains invalid control characters or line breaks.'
      );
      expect(validateRepoPath('repo\twith\ttabs')).toBe(
        'Path contains invalid control characters or line breaks.'
      );
      expect(validateRepoPath('bad\x00path')).toBe(
        'Path contains invalid control characters or line breaks.'
      );
    });

    it('accepts valid Windows and Unix paths', () => {
      expect(validateRepoPath('C:\\Users\\you\\projects\\my-repo')).toBeNull();
      expect(validateRepoPath('D:/dev/gitviz')).toBeNull();
      expect(validateRepoPath('~/projects/my-repo')).toBeNull();
      expect(validateRepoPath('/var/git/linux.git')).toBeNull();
      expect(validateRepoPath('./local-repository')).toBeNull();
      expect(validateRepoPath('C:\\code\\folder with spaces\\project')).toBeNull();
      expect(validateRepoPath('/home/user/projets/développement')).toBeNull();
    });
  });

  describe('getRepoNameFromPath', () => {
    it('extracts name from Unix paths', () => {
      expect(getRepoNameFromPath('/home/user/projects/gitviz')).toBe('gitviz');
      expect(getRepoNameFromPath('~/code/awesome-tool')).toBe('awesome-tool');
    });

    it('extracts name from Windows paths with backslashes', () => {
      expect(getRepoNameFromPath('C:\\Users\\dev\\projects\\my-app')).toBe('my-app');
      expect(getRepoNameFromPath('D:\\repositories\\gitviz-backend')).toBe('gitviz-backend');
    });

    it('handles trailing slashes and backslashes cleanly', () => {
      expect(getRepoNameFromPath('/home/user/projects/gitviz/')).toBe('gitviz');
      expect(getRepoNameFromPath('/home/user/projects/gitviz///')).toBe('gitviz');
      expect(getRepoNameFromPath('C:\\Users\\dev\\projects\\my-app\\')).toBe('my-app');
      expect(getRepoNameFromPath('C:\\Users\\dev\\projects\\my-app\\\\\\')).toBe('my-app');
    });

    it('handles paths with spaces and punctuation', () => {
      expect(getRepoNameFromPath('/var/www/my cool website')).toBe('my cool website');
      expect(getRepoNameFromPath('C:\\code\\project (v2)')).toBe('project (v2)');
    });

    it('handles root or empty inputs gracefully', () => {
      expect(getRepoNameFromPath('')).toBe('repository');
      expect(getRepoNameFromPath('/')).toBe('repository');
      expect(getRepoNameFromPath('C:\\')).toBe('drive-c');
    });
  });

  describe('getStepFromPct & getStepItems', () => {
    it('maps pct ranges to correct milestone step id', () => {
      expect(getStepFromPct(0)).toBe('queued');
      expect(getStepFromPct(10)).toBe('reading');
      expect(getStepFromPct(50)).toBe('reading');
      expect(getStepFromPct(80)).toBe('saving');
      expect(getStepFromPct(95)).toBe('saving');
      expect(getStepFromPct(100)).toBe('done');
    });

    it('derives accurate step statuses for 0% (Queued)', () => {
      const items = getStepItems(0);
      expect(items).toEqual([
        { id: 'queued', label: 'Queued', status: 'active' },
        { id: 'reading', label: 'Reading history', status: 'pending' },
        { id: 'saving', label: 'Saving results', status: 'pending' },
        { id: 'done', label: 'Done', status: 'pending' },
      ]);
    });

    it('derives accurate step statuses for 50% (Reading history)', () => {
      const items = getStepItems(50);
      expect(items).toEqual([
        { id: 'queued', label: 'Queued', status: 'completed' },
        { id: 'reading', label: 'Reading history', status: 'active' },
        { id: 'saving', label: 'Saving results', status: 'pending' },
        { id: 'done', label: 'Done', status: 'pending' },
      ]);
    });

    it('derives accurate step statuses for 85% (Saving results)', () => {
      const items = getStepItems(85);
      expect(items).toEqual([
        { id: 'queued', label: 'Queued', status: 'completed' },
        { id: 'reading', label: 'Reading history', status: 'completed' },
        { id: 'saving', label: 'Saving results', status: 'active' },
        { id: 'done', label: 'Done', status: 'pending' },
      ]);
    });

    it('derives accurate step statuses for 100% (Done)', () => {
      const items = getStepItems(100);
      expect(items).toEqual([
        { id: 'queued', label: 'Queued', status: 'completed' },
        { id: 'reading', label: 'Reading history', status: 'completed' },
        { id: 'saving', label: 'Saving results', status: 'completed' },
        { id: 'done', label: 'Done', status: 'completed' },
      ]);
    });
  });

  describe('normalizePathKey', () => {
    it('normalizes trimming, slashes, trailing slashes and lowercases', () => {
      expect(normalizePathKey('  ~/projects/gitviz/  ')).toBe('~/projects/gitviz');
      expect(normalizePathKey('C:\\Users\\dev\\Repo/')).toBe('c:/users/dev/repo');
      expect(normalizePathKey('C:/Users/dev/Repo')).toBe('c:/users/dev/repo');
      expect(normalizePathKey('ABC')).toBe('abc');
      expect(normalizePathKey('abc/')).toBe('abc');
      expect(normalizePathKey('/')).toBe('/');
      expect(normalizePathKey('\\')).toBe('/');
      expect(normalizePathKey('')).toBe('');
    });
  });

  describe('shouldShowSecondaryPath', () => {
    it('returns false when name equals path', () => {
      expect(shouldShowSecondaryPath('abc', 'abc')).toBe(false);
      expect(shouldShowSecondaryPath('abc', 'abc/')).toBe(false);
      expect(shouldShowSecondaryPath('ABC', 'abc')).toBe(false);
      expect(shouldShowSecondaryPath('abcdefgh', 'abcdefgh')).toBe(false);
    });

    it('returns true when name differs from path', () => {
      expect(shouldShowSecondaryPath('gitviz', '~/projects/gitviz')).toBe(true);
      expect(shouldShowSecondaryPath('repo', 'C:\\Users\\dev\\repo')).toBe(true);
      expect(shouldShowSecondaryPath('submodule', 'packages/submodule')).toBe(true);
    });
  });

  describe('truncateMiddle', () => {
    it('returns original path if within maxLength', () => {
      expect(truncateMiddle('src/App.tsx', 30)).toBe('src/App.tsx');
    });

    it('middle-truncates long paths with ellipsis', () => {
      const longPath = 'C:/Users/developer/projects/gitviz-frontend-monorepo';
      const truncated = truncateMiddle(longPath, 25);
      expect(truncated.length).toBe(25);
      expect(truncated).toContain('...');
      expect(truncated.startsWith('C:/Users/')).toBe(true);
      expect(truncated.endsWith('monorepo')).toBe(true);
    });
  });

  describe('dedupeRecentRepos', () => {
    it('deduplicates with different capitalization, trailing slash, and backslash vs slash', () => {
      const input: RecentRepo[] = [
        { path: 'C:\\Users\\dev\\Repo/', name: 'Repo', lastLoadedAt: '2026-10-01' },
        { path: 'c:/users/dev/repo', name: 'repo', lastLoadedAt: '2026-10-02' },
        { path: '~/projects/alpha/', name: 'alpha', lastLoadedAt: '2026-10-03' },
        { path: '~/PROJECTS/ALPHA', name: 'ALPHA', lastLoadedAt: '2026-10-04' },
      ];

      const result = dedupeRecentRepos(input);
      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('C:\\Users\\dev\\Repo/');
      expect(result[1].path).toBe('~/projects/alpha/');
    });
  });

  describe('addRecentRepo', () => {
    it('adds entry to an empty recent list', () => {
      const result = addRecentRepo([], { path: '~/projects/gitviz' });
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('~/projects/gitviz');
      expect(result[0].name).toBe('gitviz');
      expect(result[0].lastLoadedAt).toBeDefined();
    });

    it('deduplicates with different capitalization', () => {
      const initial: RecentRepo[] = [
        { path: '~/projects/my-repo', name: 'my-repo', lastLoadedAt: '2026-10-01T00:00:00Z' },
      ];

      const result = addRecentRepo(initial, { path: '~/PROJECTS/MY-REPO' });
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('~/PROJECTS/MY-REPO');
    });

    it('deduplicates with trailing slash', () => {
      const initial: RecentRepo[] = [
        { path: '~/projects/alpha', name: 'alpha', lastLoadedAt: '2026-10-01T00:00:00Z' },
      ];

      const result = addRecentRepo(initial, { path: '~/projects/alpha/' });
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('~/projects/alpha/');
    });

    it('deduplicates Windows backslash vs slash', () => {
      const initial: RecentRepo[] = [
        { path: 'C:\\Projects\\GitViz', name: 'GitViz', lastLoadedAt: '2026-10-01T00:00:00Z' },
      ];

      const result = addRecentRepo(initial, { path: 'C:/Projects/GitViz' });
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('C:/Projects/GitViz');
    });

    it('moves existing entry to the top on reload and updates lastLoadedAt', () => {
      const initial: RecentRepo[] = [
        { path: '~/projects/first', name: 'first', lastLoadedAt: '2026-10-01T00:00:00Z' },
        { path: '~/projects/second', name: 'second', lastLoadedAt: '2026-10-02T00:00:00Z' },
      ];

      const result = addRecentRepo(initial, { path: '~/projects/second' });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('second');
      expect(result[1].name).toBe('first');
      expect(new Date(result[0].lastLoadedAt).getTime()).toBeGreaterThanOrEqual(
        new Date('2026-10-02T00:00:00Z').getTime()
      );
    });

    it('limits list to a maximum of 5 recent repositories', () => {
      const initial: RecentRepo[] = [
        { path: '/repo/1', name: 'repo-1', lastLoadedAt: '2026-10-01' },
        { path: '/repo/2', name: 'repo-2', lastLoadedAt: '2026-10-02' },
        { path: '/repo/3', name: 'repo-3', lastLoadedAt: '2026-10-03' },
        { path: '/repo/4', name: 'repo-4', lastLoadedAt: '2026-10-04' },
        { path: '/repo/5', name: 'repo-5', lastLoadedAt: '2026-10-05' },
      ];

      const result = addRecentRepo(initial, { path: '/repo/repo-6' });
      expect(result).toHaveLength(5);
      expect(result[0].name).toBe('repo-6');
      expect(result.some((r) => r.name === 'repo-5')).toBe(false); // Oldest dropped
    });
  });

  describe('removeRecentRepo', () => {
    it('removes one entry by normalized path', () => {
      const initial: RecentRepo[] = [
        { path: 'C:\\projects\\alpha', name: 'alpha', lastLoadedAt: '2026-10-01' },
        { path: '~/projects/beta', name: 'beta', lastLoadedAt: '2026-10-02' },
      ];

      // Remove with forward slashes and different casing
      const result = removeRecentRepo(initial, 'c:/projects/alpha/');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('beta');
    });

    it('returns unchanged list if path does not exist', () => {
      const initial: RecentRepo[] = [
        { path: '~/projects/alpha', name: 'alpha', lastLoadedAt: '2026-10-01' },
      ];

      const result = removeRecentRepo(initial, '~/projects/nonexistent');
      expect(result).toHaveLength(1);
    });
  });

  describe('loadRecentRepos and saveRecentRepos', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('cleans an already-duplicated stored list when read and writes back', () => {
      const duplicatedList: RecentRepo[] = [
        { path: 'abc', name: 'abc', lastLoadedAt: '2026-10-01' },
        { path: 'ABC', name: 'ABC', lastLoadedAt: '2026-10-02' },
        { path: 'abc/', name: 'abc', lastLoadedAt: '2026-10-03' },
        { path: 'other', name: 'other', lastLoadedAt: '2026-10-04' },
      ];

      window.localStorage.setItem(STORAGE_KEY_RECENT_REPOS, JSON.stringify(duplicatedList));

      const loaded = loadRecentRepos();
      expect(loaded).toHaveLength(2);
      expect(loaded[0].path).toBe('abc');
      expect(loaded[1].path).toBe('other');

      // Verify that the cleaned list was written back to localStorage
      const storedAfter = JSON.parse(window.localStorage.getItem(STORAGE_KEY_RECENT_REPOS) || '[]');
      expect(storedAfter).toHaveLength(2);
      expect(storedAfter[0].path).toBe('abc');
      expect(storedAfter[1].path).toBe('other');
    });

    it('clearRecentRepos removes recent repositories from localStorage', () => {
      saveRecentRepos([{ path: 'test', name: 'test', lastLoadedAt: '2026-10-01' }]);
      expect(loadRecentRepos()).toHaveLength(1);

      clearRecentRepos();
      expect(loadRecentRepos()).toHaveLength(0);
      expect(window.localStorage.getItem(STORAGE_KEY_RECENT_REPOS)).toBeNull();
    });
  });
});
