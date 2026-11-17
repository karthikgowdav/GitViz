'use strict';

/**
 * Editable generated-file ignore list (P2 rule #5).
 *
 * Defaults live in config/ignore-list.json and can be overridden with the
 * GITVIZ_IGNORE_LIST env var. Patterns are glob-ish:
 *   package-lock.json   -> that basename at any depth
 *   dist/               -> that directory at any depth
 *   *.min.*             -> any basename containing ".min."
 *
 * Filtering happens at read time (top files, bus factor, churn over time), so
 * editing the list takes effect on the next request without re-ingesting.
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'ignore-list.json');

const DEFAULT_PATTERNS = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'dist/',
  'build/',
  'node_modules/',
  '*.min.*',
  'go.sum',
  'Cargo.lock',
];

function configPath() {
  const configured = process.env.GITVIZ_IGNORE_LIST;
  if (!configured) return DEFAULT_CONFIG_PATH;
  return path.isAbsolute(configured) ? configured : path.resolve(PROJECT_ROOT, configured);
}

function loadIgnoreConfig() {
  const file = configPath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const patterns = Array.isArray(parsed.patterns)
      ? parsed.patterns.filter((p) => typeof p === 'string' && p.length > 0)
      : DEFAULT_PATTERNS;
    return {
      patterns,
      merge_commits_counted: parsed.merge_commits_counted === true,
      source: file,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[ignore-list] could not read ${file}: ${error.message}`);
    }
    return { patterns: DEFAULT_PATTERNS, merge_commits_counted: false, source: file };
  }
}

function getIgnorePatterns() {
  return loadIgnoreConfig().patterns;
}

/** W1 decision: merge commits are excluded from churn (displayed in the UI). */
function mergeCommitsCounted() {
  return loadIgnoreConfig().merge_commits_counted;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern) {
  let isDirectory = pattern.endsWith('/');
  let body = isDirectory ? pattern.slice(0, -1) : pattern;
  const hasSlash = body.includes('/');

  let source = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }

  if (isDirectory) {
    // Match the directory itself or anything below it, at any depth.
    return new RegExp(`(^|/)${source}(/|$)`);
  }
  if (hasSlash) {
    return new RegExp(`(^|/)${source}$`);
  }
  // A bare filename/glob matches the basename at any depth.
  return new RegExp(`(^|/)${source}$`);
}

function compileIgnoreMatchers(patterns = getIgnorePatterns()) {
  return patterns.map((pattern) => {
    try {
      return globToRegExp(pattern);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function isIgnored(filePath, patterns = getIgnorePatterns()) {
  if (!filePath) return false;
  return compileIgnoreMatchers(patterns).some((matcher) => matcher.test(filePath));
}

function globToLike(pattern) {
  // Escape LIKE metacharacters, then translate glob wildcards.
  return pattern
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '%')
    .replace(/\?/g, '_');
}

/**
 * Build a parameterised SQL predicate that excludes ignored paths.
 *
 * Returns { sql, params } where sql is e.g. `NOT ((m.path = $1 OR ...))`.
 * Returns sql `TRUE` and no params when the list is empty.
 *
 * @param {string} column qualified path column, e.g. "m.path"
 * @param {string[]} patterns
 * @param {number} startIndex first $n placeholder to use
 */
function buildIgnoreClause(column, patterns = getIgnorePatterns(), startIndex = 1) {
  const params = [];
  const fragments = [];

  for (const rawPattern of patterns) {
    if (typeof rawPattern !== 'string' || rawPattern.length === 0) continue;
    const isDirectory = rawPattern.endsWith('/');
    const body = isDirectory ? rawPattern.slice(0, -1) : rawPattern;
    if (body.length === 0) continue;

    const like = globToLike(body);
    const placeholder = `$${startIndex + params.length}`;

    if (isDirectory) {
      fragments.push(
        `(${column} = ${placeholder} OR ${column} LIKE ${placeholder} || '/%' OR ${column} LIKE '%/' || ${placeholder} || '/%')`
      );
      params.push(body);
    } else {
      fragments.push(
        `(${column} LIKE ${placeholder} OR ${column} LIKE '%/' || ${placeholder})`
      );
      params.push(like);
    }
  }

  if (fragments.length === 0) {
    return { sql: 'TRUE', params };
  }

  return { sql: `NOT (${fragments.join(' OR ')})`, params };
}

module.exports = {
  DEFAULT_PATTERNS,
  configPath,
  loadIgnoreConfig,
  getIgnorePatterns,
  mergeCommitsCounted,
  compileIgnoreMatchers,
  isIgnored,
  globToRegExp,
  globToLike,
  buildIgnoreClause,
};
