'use strict';

/**
 * Commit and file-history queries.
 *
 * Shapes match the frozen frontend contract (Frontend/src/api/types.ts):
 *   CommitListResponse, CommitDetail, FileHistoryResponse
 *
 * Diffs are deliberately absent: P1's route enriches file-history entries with
 * `git show` output. The DB stores numbers, not patches (frozen schema).
 */

const { buildIgnoreClause } = require('../../config/ignore-list');

const MAX_LIMIT = 200;

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function shortSha(sha) {
  return String(sha).slice(0, 7);
}

function encodeCursor(row) {
  return Buffer.from(
    JSON.stringify({ t: toIso(row.committed_at), s: row.sha }),
    'utf8'
  ).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.s !== 'string' || !parsed.t) return null;
    const date = new Date(parsed.t);
    if (Number.isNaN(date.getTime())) return null;
    return { committedAt: date.toISOString(), sha: parsed.s };
  } catch {
    return null;
  }
}

class InvalidCursorError extends Error {
  constructor(message = 'Invalid cursor') {
    super(message);
    this.name = 'InvalidCursorError';
    this.status = 400;
  }
}

function formatCommitRow(row) {
  return {
    sha: row.sha,
    short_sha: shortSha(row.sha),
    parents: row.parents || [],
    author: {
      name: row.author_name || 'Unknown',
      email: row.author_email || '',
    },
    committed_at: toIso(row.committed_at),
    message: row.message,
    is_merge: row.is_merge,
    files_changed: row.files_changed || 0,
    additions: row.additions || 0,
    deletions: row.deletions || 0,
  };
}

async function listCommits(db, repoId, { cursor = null, limit = 50 } = {}) {
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 50));
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) throw new InvalidCursorError();

  const params = [repoId];
  let cursorClause = '';

  if (decoded) {
    params.push(decoded.committedAt, decoded.sha);
    cursorClause = `AND (c.committed_at, c.sha) < ($2::timestamptz, $3)`;
  }

  params.push(safeLimit + 1);
  const limitPlaceholder = `$${params.length}`;

  const result = await db.query(
    `
    SELECT
      c.sha,
      c.parents,
      a.name  AS author_name,
      a.email AS author_email,
      c.committed_at,
      c.message,
      c.is_merge,
      COALESCE(stats.files_changed, 0)::int AS files_changed,
      COALESCE(stats.additions, 0)::int     AS additions,
      COALESCE(stats.deletions, 0)::int     AS deletions
    FROM commits c
    LEFT JOIN authors a ON a.id = c.author_id
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS files_changed,
        sum(fc.additions)::int AS additions,
        sum(fc.deletions)::int AS deletions
      FROM file_changes fc
      WHERE fc.commit_id = c.id
    ) stats ON TRUE
    WHERE c.repo_id = $1
      ${cursorClause}
    ORDER BY c.committed_at DESC, c.sha DESC
    LIMIT ${limitPlaceholder}
    `,
    params
  );

  const hasMore = result.rows.length > safeLimit;
  const rows = hasMore ? result.rows.slice(0, safeLimit) : result.rows;

  return {
    commits: rows.map(formatCommitRow),
    next_cursor: hasMore && rows.length > 0 ? encodeCursor(rows[rows.length - 1]) : null,
  };
}

async function getCommitDetail(db, repoId, sha) {
  const result = await db.query(
    `
    SELECT
      c.sha,
      c.parents,
      a.name  AS author_name,
      a.email AS author_email,
      c.committed_at,
      c.message,
      c.is_merge,
      COALESCE(stats.files_changed, 0)::int AS files_changed,
      COALESCE(stats.additions, 0)::int     AS additions,
      COALESCE(stats.deletions, 0)::int     AS deletions
    FROM commits c
    LEFT JOIN authors a ON a.id = c.author_id
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS files_changed,
        sum(fc.additions)::int AS additions,
        sum(fc.deletions)::int AS deletions
      FROM file_changes fc
      WHERE fc.commit_id = c.id
    ) stats ON TRUE
    WHERE c.repo_id = $1 AND c.sha = $2
    `,
    [repoId, sha]
  );

  const row = result.rows[0];
  if (!row) return null;

  const filesResult = await db.query(
    `
    SELECT path, old_path, additions, deletions, is_binary, is_generated
    FROM file_changes
    WHERE commit_id = (SELECT id FROM commits WHERE repo_id = $1 AND sha = $2)
    ORDER BY path ASC
    `,
    [repoId, sha]
  );

  return {
    ...formatCommitRow(row),
    files: filesResult.rows.map((file) => ({
      path: file.path,
      old_path: file.old_path,
      additions: file.additions,
      deletions: file.deletions,
      is_binary: file.is_binary,
    })),
  };
}

async function getLineagePaths(db, repoId, filePath) {
  const result = await db.query(
    `
    WITH RECURSIVE lineage(path, depth) AS (
      SELECT $2::text, 0
      UNION
      SELECT fc.old_path, lineage.depth + 1
      FROM file_changes fc
      JOIN lineage ON fc.path = lineage.path
      WHERE fc.repo_id = $1
        AND fc.old_path IS NOT NULL
        AND lineage.depth < 100
    )
    SELECT DISTINCT path FROM lineage
    `,
    [repoId, filePath]
  );
  return result.rows.map((row) => row.path);
}

/**
 * Detect the honest-uncertainty case: the oldest commit we can see added this
 * file under its current name while also deleting a different file, and Git
 * recorded no rename link. That is a likely rename-detection cutoff, so the UI
 * gets `history_complete: false` + a visible break instead of a fake history.
 */
async function detectPossibleBreak(db, repoId, lineagePaths, oldestCommitId) {
  const rows = await db.query(
    `
    SELECT path, old_path, additions, deletions
    FROM file_changes
    WHERE commit_id = $1 AND repo_id = $2
    `,
    [oldestCommitId, repoId]
  );

  const lineage = new Set(lineagePaths);
  const addedHere = rows.rows.some(
    (row) => lineage.has(row.path) && !row.old_path && row.additions > 0
  );
  if (!addedHere) return false;

  return rows.rows.some(
    (row) => !lineage.has(row.path) && !row.old_path && row.deletions > 0
  );
}

async function getFileHistory(db, repoId, filePath) {
  const result = await db.query(
    `
    WITH RECURSIVE lineage(path, depth) AS (
      SELECT $2::text, 0
      UNION
      SELECT fc.old_path, lineage.depth + 1
      FROM file_changes fc
      JOIN lineage ON fc.path = lineage.path
      WHERE fc.repo_id = $1
        AND fc.old_path IS NOT NULL
        AND lineage.depth < 100
    )
    SELECT
      c.id AS commit_id,
      c.sha,
      c.parents,
      a.name  AS author_name,
      a.email AS author_email,
      c.committed_at,
      c.message,
      c.is_merge,
      COALESCE(sum(fc.additions), 0)::int AS additions,
      COALESCE(sum(fc.deletions), 0)::int AS deletions,
      max(fc.old_path) FILTER (WHERE fc.old_path IS NOT NULL) AS old_path
    FROM commits c
    LEFT JOIN authors a ON a.id = c.author_id
    JOIN file_changes fc ON fc.commit_id = c.id
    WHERE fc.repo_id = $1
      AND fc.path IN (SELECT path FROM lineage)
    GROUP BY c.id, a.name, a.email
    ORDER BY c.committed_at DESC, c.sha DESC
    `,
    [repoId, filePath]
  );

  if (result.rows.length === 0) {
    return { path: filePath, history_complete: true, entries: [] };
  }

  const entries = result.rows.map((row) => ({
    sha: row.sha,
    short_sha: shortSha(row.sha),
    parents: row.parents || [],
    author: {
      name: row.author_name || 'Unknown',
      email: row.author_email || '',
    },
    committed_at: toIso(row.committed_at),
    message: row.message,
    is_merge: row.is_merge,
    additions: row.additions,
    deletions: row.deletions,
    old_path: row.old_path,
    break_after: null,
  }));

  const oldest = result.rows[result.rows.length - 1];
  const lineagePaths = await getLineagePaths(db, repoId, filePath);
  const possibleBreak = await detectPossibleBreak(
    db,
    repoId,
    lineagePaths,
    oldest.commit_id
  );

  if (possibleBreak) {
    entries[entries.length - 1].break_after =
      'Git could not detect a rename at this point. Earlier history, if any, may belong to a different path.';
  }

  return {
    path: filePath,
    history_complete: !possibleBreak,
    entries,
  };
}

/**
 * File picker list. Derived from the metrics table so it is cheap on 50k
 * commits. Ignored generated paths never enter the list.
 */
async function listFiles(db, repoId, { limit = 1000 } = {}) {
  const safeLimit = Math.min(5000, Math.max(1, Number(limit) || 1000));
  const ignore = buildIgnoreClause('m.path', undefined, 2);

  const result = await db.query(
    `
    SELECT m.path, m.churn_commits, m.last_touch_at
    FROM metrics m
    WHERE m.repo_id = $1
      AND m.churn_commits > 0
      AND ${ignore.sql}
    ORDER BY m.churn_commits DESC, m.path ASC
    LIMIT ${safeLimit}
    `,
    [repoId, ...ignore.params]
  );

  return result.rows.map((row) => ({
    path: row.path,
    commit_count: row.churn_commits,
    last_touch_at: toIso(row.last_touch_at),
  }));
}

module.exports = {
  MAX_LIMIT,
  InvalidCursorError,
  encodeCursor,
  decodeCursor,
  listCommits,
  getCommitDetail,
  getFileHistory,
  getLineagePaths,
  listFiles,
};
