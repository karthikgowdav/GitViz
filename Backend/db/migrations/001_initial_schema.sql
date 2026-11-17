-- GitViz P2 — frozen Week 1 schema
-- Six tables, no more. See docs/schema.md before changing anything.

CREATE TABLE IF NOT EXISTS repos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path           text NOT NULL UNIQUE,
  name           text NOT NULL,
  default_branch text,
  ingested_at    timestamptz,
  commit_count   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS authors (
  id        bigserial PRIMARY KEY,
  repo_id   uuid NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name      text NOT NULL,
  email     text NOT NULL,
  commits   integer NOT NULL DEFAULT 0,
  UNIQUE (repo_id, email)
);

CREATE TABLE IF NOT EXISTS commits (
  id           bigserial PRIMARY KEY,
  repo_id      uuid NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  sha          text NOT NULL,
  author_id    bigint REFERENCES authors(id) ON DELETE SET NULL,
  parents      text[] NOT NULL DEFAULT '{}',
  committed_at timestamptz NOT NULL,
  message      text NOT NULL DEFAULT '',
  is_merge     boolean NOT NULL DEFAULT false,
  UNIQUE (repo_id, sha)
);

CREATE TABLE IF NOT EXISTS file_changes (
  id           bigserial PRIMARY KEY,
  commit_id    bigint NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  repo_id      uuid NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  path         text NOT NULL,
  old_path     text,
  additions    integer NOT NULL DEFAULT 0,
  deletions    integer NOT NULL DEFAULT 0,
  is_binary    boolean NOT NULL DEFAULT false,
  is_generated boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS metrics (
  repo_id       uuid NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  path          text NOT NULL,
  churn_commits integer NOT NULL DEFAULT 0,
  churn_lines   bigint NOT NULL DEFAULT 0,
  last_touch_at timestamptz,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, path)
);

CREATE TABLE IF NOT EXISTS author_stats (
  repo_id     uuid NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  author_id   bigint NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  path        text NOT NULL,
  commits     integer NOT NULL DEFAULT 0,
  lines_added bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, author_id, path)
);
