# GitViz — Frozen PostgreSQL Schema (P2)

Status: **frozen Week 1 schema** from
`GitViz - PRD - P2 Data.md`. The six tables below are the only hand-off point
between P1 (reading Git), P2 (storing/computing) and P3 (fixtures/UI).

Migration files:

- `db/migrations/001_initial_schema.sql`
- `db/migrations/002_indices.sql`

Never edit an applied migration. Add a new numbered file instead, and tell the
other roles before changing a column.

---

## 1. Tables

### `repos`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, `gen_random_uuid()` | repo_id served to the frontend |
| `path` | `text` UNIQUE | absolute, symlink-resolved path |
| `name` | `text` | display name (folder basename) |
| `default_branch` | `text` NULL | informational |
| `ingested_at` | `timestamptz` NULL | durable "ingest finished" flag |
| `commit_count` | `integer` | maintained after ingest |

### `authors`

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `repo_id` | `uuid` FK → repos | cascade delete |
| `name` | `text` | latest display name seen |
| `email` | `text` | lower-cased; identity key per repo |
| `commits` | `integer` | filled from `commits` after ingest |

Unique: `(repo_id, email)`.

### `commits`

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `repo_id` | `uuid` FK → repos | cascade |
| `sha` | `text` | full 40/64-char hash |
| `author_id` | `bigint` FK → authors NULL | `ON DELETE SET NULL` |
| `parents` | `text[]` | ordered; `parents[1]` is the first parent |
| `committed_at` | `timestamptz` | committer time, ISO string from Git |
| `message` | `text` | subject or full message (P1 decides) |
| `is_merge` | `boolean` | `parents.length > 1` |

Unique: `(repo_id, sha)`. Cursor index:
`(repo_id, committed_at DESC, sha DESC)`.

### `file_changes`

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `commit_id` | `bigint` FK → commits | cascade |
| `repo_id` | `uuid` FK → repos | cascade (denormalised for cheap filtering) |
| `path` | `text` | new/current path |
| `old_path` | `text` NULL | Git-detected rename source |
| `additions` | `integer` | 0 for binaries |
| `deletions` | `integer` | 0 for binaries |
| `is_binary` | `boolean` | |
| `is_generated` | `boolean` | parser/flag-detected generated file |

No `diff` column on purpose: patches are P1's `git show` territory, not metric
data.

### `metrics` (derived)

| Column | Type | Notes |
|---|---|---|
| `repo_id` | `uuid` FK → repos | |
| `path` | `text` | |
| `churn_commits` | `integer` | non-merge commits touching the file |
| `churn_lines` | `bigint` | additions + deletions on those commits |
| `last_touch_at` | `timestamptz` | latest touch, including merges |
| `computed_at` | `timestamptz` | |

Primary key: `(repo_id, path)`. Rebuilt by `recomputeMetrics()`.

### `author_stats` (derived)

| Column | Type | Notes |
|---|---|---|
| `repo_id` | `uuid` FK → repos | |
| `author_id` | `bigint` FK → authors | |
| `path` | `text` | |
| `commits` | `integer` | non-merge commits by this author touching the file |
| `lines_added` | `bigint` | additions on those commits |

Primary key: `(repo_id, author_id, path)`. Rows with zero commits are not
inserted. Feeds module-level bus factor.

---

## 2. P1 → P2 ingest contract

`ingestParsedRepo(pool, payload)` accepts:

```json
{
  "repo": {
    "path": "/absolute/path",
    "name": "my-repo",
    "default_branch": "main"
  },
  "commits": [
    {
      "sha": "full-sha",
      "parents": ["parent-sha", "second-parent-sha"],
      "author": { "name": "Ada", "email": "ada@example.com" },
      "committed_at": "2026-01-31T12:00:00Z",
      "message": "subject or full message",
      "is_merge": false,
      "files": [
        {
          "path": "src/app.ts",
          "old_path": null,
          "additions": 12,
          "deletions": 3,
          "is_binary": false,
          "is_generated": false
        }
      ]
    }
  ]
}
```

Rules:

- `repo.path` and every `commits[].sha` are required, and `committed_at` must
  parse as a date; anything else throws `IngestInputError` **before** touching
  rows.
- `files` may also be named `file_changes`.
- `is_merge` is derived from `parents.length > 1` if omitted.
- Duplicate SHAs within one payload are ignored (first wins).
- `old_path` is Git's detected rename source. If Git could not detect a rename,
  leave it `null` — the read layer surfaces the uncertainty instead of inventing
  a link.
- The whole payload is replaced for that repo path, inside **one transaction**
  (`BEGIN … COMMIT`).

Example from the CLI:

```bash
npm run ingest -- parsed-rows.json
cat parsed-rows.json | npm run ingest -- -
```

## 3. Decisions written down (the project's scars)

1. **Merge commits are not churn by default.** `merge_commits_counted` in
   `config/ignore-list.json` controls the materialised tables. Changing it
   requires `npm run recompute -- <repo>`.
2. **Ignore list is read-time.** Lockfiles, `dist/`, `node_modules/`,
   `*.min.*` etc. are filtered in queries. Editing the list takes effect on the
   next request; no re-ingest.
3. **`is_generated` is parser truth.** Distinct from the ignore list. Generated
   rows are excluded when materialising metrics.
4. **Bus factor = authors needed to cover 80% of commits**, per repo and per
   directory module. Always labelled `estimate (concentration of commits)`.
5. **Time-to-merge is first-parent only** and estimates branch age at merge.
   It is a graph computation over commits, not a PR timer.
6. **Renames** are followed backwards through `old_path`. A likely
   rename-detection cutoff produces `history_complete: false` and a
   `break_after` message on the oldest entry.
7. **Repos are replaced atomically** on re-ingest; there is no merge of
   partial histories.

## 4. Invariants to preserve

- `commits.repo_id` and `file_changes.repo_id` always agree.
- `metrics` / `author_stats` are derived; they can always be rebuilt from raw
  rows. Never make them the only copy of a fact.
- No query mutates a target repository.
- All writes for one import happen on one pooled client, in one transaction.
