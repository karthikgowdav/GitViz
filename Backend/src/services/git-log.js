'use strict';

/**
 * Local dev adapter for P1's parser — NOT the final ingest implementation.
 *
 * The data layer's contract is "P1 hands me parsed rows". Until P1's W2 parser
 * exists, this module reads a local repo with ONE `git log --numstat` spawn so
 * the data layer and the frontend can be exercised end to end.
 *
 * P1 should replace this with src/services/git_reader.js + ingest.js and keep
 * the same output shape. Read-only git commands only.
 */

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const execFileAsync = promisify(execFile);

const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

class RepoPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RepoPathError';
    this.status = 400;
  }
}

function expandHome(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

async function git(repoPath, args, options = {}) {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', repoPath, '-c', 'core.quotepath=false', '--no-pager', ...args],
    {
      maxBuffer: Number(process.env.GIT_LOG_MAX_BUFFER || 1024 * 1024 * 1024),
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      ...options,
    }
  );
  return stdout;
}

/**
 * Validate and normalise a user-supplied repository path.
 * Treats the path as hostile: no shell interpolation, read-only commands only.
 */
async function validateRepoPath(input) {
  const expanded = expandHome(input);
  if (!expanded) {
    throw new RepoPathError('Repository path is required');
  }

  const resolved = path.resolve(expanded);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new RepoPathError('Path not found or not a Git repository');
  }
  if (!stat.isDirectory()) {
    throw new RepoPathError('Path is not a directory');
  }

  try {
    const result = await git(resolved, ['rev-parse', '--is-inside-work-tree']);
    if (result.trim() !== 'true') {
      throw new Error('not a work tree');
    }
  } catch {
    throw new RepoPathError('Path not found or not a Git repository');
  }

  // Resolve symlinks so the same repo is not ingested twice under two paths.
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

async function readDefaultBranch(repoPath) {
  try {
    const result = await git(repoPath, ['symbolic-ref', '--short', 'HEAD']);
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Git's numstat path field for renames looks like one of:
 *   old/path.ts => new/path.ts
 *   src/{old => new}/file.ts
 * Returns { path, old_path }.
 */
function parseNumstatPath(rawPath) {
  const value = rawPath.trim();
  const normalize = (candidate) => candidate.replace(/\/{2,}/g, '/');

  const braceMatch = value.match(/^(.*?)\{(.*?) => (.*?)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, oldMiddle, newMiddle, suffix] = braceMatch;
    return {
      old_path: normalize(`${prefix}${oldMiddle}${suffix}`),
      path: normalize(`${prefix}${newMiddle}${suffix}`),
    };
  }

  const arrowIndex = value.indexOf(' => ');
  if (arrowIndex !== -1) {
    return {
      old_path: normalize(value.slice(0, arrowIndex)),
      path: normalize(value.slice(arrowIndex + 4)),
    };
  }

  return { path: normalize(value), old_path: null };
}

function parseNumstatLine(line) {
  const firstTab = line.indexOf('\t');
  if (firstTab === -1) return null;
  const secondTab = line.indexOf('\t', firstTab + 1);
  if (secondTab === -1) return null;

  const additionsRaw = line.slice(0, firstTab);
  const deletionsRaw = line.slice(firstTab + 1, secondTab);
  const rawPath = line.slice(secondTab + 1);
  if (!rawPath) return null;

  const isBinary = additionsRaw === '-' || deletionsRaw === '-';
  const { path: filePath, old_path } = parseNumstatPath(rawPath);

  return {
    path: filePath,
    old_path,
    additions: isBinary ? 0 : Number(additionsRaw) || 0,
    deletions: isBinary ? 0 : Number(deletionsRaw) || 0,
    is_binary: isBinary,
    is_generated: false,
  };
}

function parseGitLogOutput(stdout, repo) {
  const chunks = stdout.split(RECORD_SEPARATOR);
  const commits = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;

    const newlineIndex = chunk.indexOf('\n');
    const header = newlineIndex === -1 ? chunk : chunk.slice(0, newlineIndex);
    const body = newlineIndex === -1 ? '' : chunk.slice(newlineIndex + 1);
    const fields = header.split(FIELD_SEPARATOR);

    if (fields.length < 6) continue;
    const [sha, parentsRaw, authorName, authorEmail, committedAt, ...messageParts] = fields;
    const parents = parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : [];

    const files = [];
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      const parsed = parseNumstatLine(line);
      if (parsed) files.push(parsed);
    }

    commits.push({
      sha,
      parents,
      author: { name: authorName || 'Unknown', email: authorEmail || '' },
      committed_at: committedAt,
      message: messageParts.join(FIELD_SEPARATOR),
      is_merge: parents.length > 1,
      files,
    });
  }

  return { repo, commits };
}

async function parseGitRepository(repoPath, { onProgress } = {}) {
  const resolved = await validateRepoPath(repoPath);
  const defaultBranch = await readDefaultBranch(resolved);
  if (onProgress) onProgress(10);

  const repo = {
    path: resolved,
    name: path.basename(resolved) || 'repository',
    default_branch: defaultBranch,
  };

  const format = [
    '%x1e%H',
    '%P',
    '%an',
    '%ae',
    '%cI',
    '%s',
  ].join('%x1f');

  let stdout;
  try {
    stdout = await git(resolved, [
      'log',
      '--date-order',
      '--numstat',
      '-M',
      '--date=iso-strict',
      `--pretty=format:${format}`,
      '--branches',
      '--remotes',
      '--tags',
      'HEAD',
    ]);
  } catch (error) {
    const message = String(error.stderr || error.message || '');
    // A freshly initialised repo is valid: zero commits, not an ingest error.
    if (/does not have any commits yet|bad default revision|unknown revision/i.test(message)) {
      if (onProgress) onProgress(100);
      return { repo, commits: [] };
    }
    throw error;
  }

  if (onProgress) onProgress(80);

  const parsed = parseGitLogOutput(stdout, repo);
  if (onProgress) onProgress(100);
  return parsed;
}

module.exports = {
  RepoPathError,
  expandHome,
  validateRepoPath,
  parseGitRepository,
  parseGitLogOutput,
  parseNumstatPath,
};
