'use strict';

/**
 * Repository lookup helpers.
 *
 * `repos.id` is a uuid; the REST contract only promises a string repo_id.
 * resolveRepo() also accepts a repository name or path so a stale link or the
 * dashboard's export button (which historically passed the display name) keeps
 * working. Treat names as a convenience, never as the primary key.
 */

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function resolveRepo(db, idOrName) {
  if (!idOrName) return null;
  const result = await db.query(
    `
    SELECT id, path, name, default_branch, ingested_at, commit_count
    FROM repos
    WHERE id::text = $1 OR name = $1 OR path = $1
    ORDER BY (id::text = $1) DESC, ingested_at DESC NULLS LAST
    LIMIT 1
    `,
    [String(idOrName)]
  );
  return result.rows[0] || null;
}

async function findRepoByPath(db, repoPath) {
  const result = await db.query(
    `
    SELECT id, path, name, default_branch, ingested_at, commit_count
    FROM repos
    WHERE path = $1
    LIMIT 1
    `,
    [repoPath]
  );
  return result.rows[0] || null;
}

async function getRepoSummary(db, repoId) {
  const result = await db.query(
    `
    SELECT
      r.name,
      r.commit_count,
      (SELECT count(*)::int FROM authors a WHERE a.repo_id = r.id) AS author_count,
      (SELECT min(c.committed_at) FROM commits c WHERE c.repo_id = r.id) AS first_commit_at,
      (SELECT max(c.committed_at) FROM commits c WHERE c.repo_id = r.id) AS last_commit_at
    FROM repos r
    WHERE r.id = $1
    `,
    [repoId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    name: row.name,
    commit_count: row.commit_count,
    author_count: row.author_count,
    first_commit_at: toIso(row.first_commit_at) || '',
    last_commit_at: toIso(row.last_commit_at) || '',
  };
}

async function listRepos(db) {
  const result = await db.query(
    `
    SELECT id, path, name, default_branch, ingested_at, commit_count
    FROM repos
    ORDER BY ingested_at DESC NULLS LAST, name ASC
    `
  );
  return result.rows.map((row) => ({
    repo_id: row.id,
    path: row.path,
    name: row.name,
    default_branch: row.default_branch,
    ingested_at: toIso(row.ingested_at),
    commit_count: row.commit_count,
  }));
}

module.exports = { resolveRepo, findRepoByPath, getRepoSummary, listRepos, toIso };
