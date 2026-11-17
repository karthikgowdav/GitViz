-- Indices for the read paths the dashboard and file view use every day.
-- (W4 EXPLAIN pass lives in docs/data-layer.md.)

-- Cursor pagination: ORDER BY committed_at DESC, sha DESC.
CREATE INDEX IF NOT EXISTS commits_pagination_idx
  ON commits (repo_id, committed_at DESC, sha DESC);

-- Commit detail / file history joins.
CREATE INDEX IF NOT EXISTS commits_repo_author_idx ON commits (repo_id, author_id);
CREATE INDEX IF NOT EXISTS file_changes_commit_idx ON file_changes (commit_id);
CREATE INDEX IF NOT EXISTS file_changes_repo_path_idx ON file_changes (repo_id, path);
CREATE INDEX IF NOT EXISTS file_changes_rename_idx
  ON file_changes (repo_id, old_path)
  WHERE old_path IS NOT NULL;

-- Top-churn / file list queries.
CREATE INDEX IF NOT EXISTS metrics_rank_idx
  ON metrics (repo_id, churn_commits DESC, churn_lines DESC);

-- Bus-factor module aggregation.
CREATE INDEX IF NOT EXISTS author_stats_repo_path_idx ON author_stats (repo_id, path);
