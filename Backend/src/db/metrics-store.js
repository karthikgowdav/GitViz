'use strict';

/**
 * Metrics materialisation (P2's numbers).
 *
 * The raw truth stays in commits + file_changes. `metrics` and `author_stats`
 * are derived tables, rebuilt for one repo inside the caller's transaction —
 * never updated row-by-row.
 *
 * W1 decisions, written down because the UI has to say them out loud:
 *   - Merge commits are NOT counted toward churn or bus-factor commits
 *     (configurable in config/ignore-list.json -> merge_commits_counted).
 *   - Parser-flagged generated files are excluded. The editable ignore list
 *     (lockfiles, dist/, ...) is applied at read time instead, so changing it
 *     needs no re-ingest.
 */

const { mergeCommitsCounted } = require('../config/ignore-list');

function mergeClause() {
  return mergeCommitsCounted() ? 'TRUE' : 'NOT c.is_merge';
}

async function recomputeMetrics(client, repoId, { onProgress } = {}) {
  const counts = mergeClause();

  await client.query('DELETE FROM metrics WHERE repo_id = $1', [repoId]);
  await client.query('DELETE FROM author_stats WHERE repo_id = $1', [repoId]);

  await client.query(
    `
    INSERT INTO metrics (repo_id, path, churn_commits, churn_lines, last_touch_at, computed_at)
    SELECT
      fc.repo_id,
      fc.path,
      count(DISTINCT fc.commit_id) FILTER (WHERE ${counts})::int AS churn_commits,
      COALESCE(sum(fc.additions + fc.deletions) FILTER (WHERE ${counts}), 0)::bigint AS churn_lines,
      max(c.committed_at) AS last_touch_at,
      now()
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE fc.repo_id = $1
      AND fc.is_generated = false
    GROUP BY fc.repo_id, fc.path
    `,
    [repoId]
  );

  if (onProgress) onProgress(92);

  await client.query(
    `
    INSERT INTO author_stats (repo_id, author_id, path, commits, lines_added)
    SELECT
      fc.repo_id,
      c.author_id,
      fc.path,
      count(DISTINCT fc.commit_id) FILTER (WHERE ${counts})::int AS commits,
      COALESCE(sum(fc.additions) FILTER (WHERE ${counts}), 0)::bigint AS lines_added
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE fc.repo_id = $1
      AND fc.is_generated = false
      AND c.author_id IS NOT NULL
    GROUP BY fc.repo_id, c.author_id, fc.path
    HAVING count(DISTINCT fc.commit_id) FILTER (WHERE ${counts}) > 0
    `,
    [repoId]
  );

  if (onProgress) onProgress(96);

  const totals = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM commits WHERE repo_id = $1) AS commit_count,
      (SELECT count(*)::int FROM authors WHERE repo_id = $1) AS author_count,
      (SELECT count(*)::int FROM metrics WHERE repo_id = $1) AS file_count
    `,
    [repoId]
  );

  return totals.rows[0];
}

module.exports = { recomputeMetrics, mergeClause };
