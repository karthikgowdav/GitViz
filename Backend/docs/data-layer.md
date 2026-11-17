# P2 Data Layer — Metric Definitions, Queries and Performance

This document is the "how the numbers are made" reference. If a number on a
slide disagrees with this, the slide is wrong until proven otherwise.

## 1. Ingest path

```
P1 parsed rows
   │  (or src/services/git-log.js dev adapter today)
   ▼
ingestParsedRepo()            one pooled client
   ├─ BEGIN
   ├─ upsert repos row (path UNIQUE)
   ├─ delete previous rows for this repo
   ├─ insert authors      (deduped by lower-cased email)
   ├─ insert commits      (JSON batches → jsonb_array_elements)
   ├─ insert file_changes (JSON batches)
   ├─ update authors.commits
   ├─ rebuild metrics + author_stats
   ├─ update repos.commit_count / ingested_at
   └─ COMMIT
```

- Batches default to 1000 rows (`INGEST_BATCH_SIZE`).
- There is no per-row round trip and no autocommit.
- Re-ingesting the same path replaces that repo atomically.
- `is_merge` is `parents.length > 1`.
- `authors.email` is lower-cased for identity, display `name` is kept as-is.

## 2. Metric definitions

### Churn per file (`metrics`)

For every file path:

- `churn_commits` = number of **distinct non-merge commits** touching it.
- `churn_lines` = `sum(additions + deletions)` on those commits.
- `last_touch_at` = latest commit time touching it, including merges.

Binary file changes contribute 0 lines. `is_generated = true` rows are excluded
from the materialised values. Ignored paths are filtered at **read** time.

### Top files (`GET .../metrics/churn`)

- `metrics` rows with `churn_commits > 0`
- ignore-list predicate applied to the path
- `ORDER BY churn_commits DESC, churn_lines DESC, path ASC LIMIT 10`

This is why the top-10 chart is not just lockfiles.

### Commits per author

```sql
count(DISTINCT c.id)                                   -- all commits by author
sum(fc.additions) FILTER (non-merge, non-generated, non-ignored) -- lines_added
```

Commit totals therefore reconcile with `repos.commit_count` (merges included).
`lines_added` intentionally excludes merges and generated/ignored noise. The two
columns answer different questions; do not sum them together.

### Churn over time

Monthly buckets (`YYYY-MM`) over **non-merge** commits, excluding generated and
ignored file changes:

- `commits` = distinct commits with at least one contributing file change
- `lines_changed` = `sum(additions + deletions)`

Months with no activity are omitted; the frontend chart handles gaps.

### Bus factor

Per repo:

- Count **commits per author** (merge policy applies, each commit once).
- Sort descending, accumulate until coverage ≥ **80%** of commits.
- `score` = number of authors in that prefix (`1` for a single-author repo).

Per module:

- Module = directory containing the file (`src/components/graph/`); root files
  become `(root)/`.
- Aggregate `author_stats.commits` per module/author.
- Apply the same 80% coverage rule.
- `top_author_share` = top author's commits / module commits.

The 80% coverage constant is `BUS_FACTOR_COVERAGE` in
`src/db/queries/metrics.js`. The response always includes
`label: "estimate (concentration of commits)"`.

### Time-to-merge

`GET .../metrics/time-to-merge` (not consumed by the dashboard yet) and the JSON
export.

1. Load the commit graph for the repo.
2. Pick the newest tip (a commit not referenced as anyone's parent).
3. Walk the **first-parent chain** from that tip.
4. For each merge, collect commits reachable from `parents[1..]` that are not
   already reachable from the first parent.
5. Branch start = earliest unique branch commit. `hours = merge time − branch
   start`.
6. Report count, average, median, p95, max and up to 50 samples.

This is **branch age at merge**, not GitHub PR time-to-merge. The label says so.

### File history and rename breaks

`GET .../files/:path/history` uses a recursive CTE:

```sql
WITH RECURSIVE lineage(path, depth) AS (
  SELECT :requested_path, 0
  UNION
  SELECT fc.old_path, lineage.depth + 1
  FROM file_changes fc
  JOIN lineage ON fc.path = lineage.path
  WHERE fc.old_path IS NOT NULL AND lineage.depth < 100
)
SELECT … WHERE fc.path IN (SELECT path FROM lineage)
```

- Entries are grouped per commit, newest first.
- `old_path` is shown only for the rename commit.
- **Possible break heuristic:** if the oldest visible commit adds this lineage's
  file while deleting a different, unlinked file in the same commit, we mark
  `history_complete: false` and put a `break_after` message on the oldest entry.
  This is deliberately conservative and honest; it does not fabricate lineage.
- `diff` is absent from DB responses. P1 adds it with `git show`; the frontend
  hides the "Inspect diff" button when `diff` is missing.

### Cursor pagination

`GET .../commits?cursor=&limit=`:

- Cursor is base64url `{ "t": "<committed_at ISO>", "s": "<sha>" }`.
- Query: `WHERE (committed_at, sha) < ($t, $sha) ORDER BY committed_at DESC, sha DESC`.
- Limit is clamped to 1–200; default 50.
- `next_cursor` is `null` exactly on the last page.
- Offsets are never used (they fall apart at 50k commits).

## 3. Ignore list

File: `config/ignore-list.json` (override with `GITVIZ_IGNORE_LIST`).

```json
{
  "patterns": ["package-lock.json", "dist/", "*.min.*", "go.sum"],
  "merge_commits_counted": false
}
```

Glob → SQL translation:

| Pattern | Matches |
|---|---|
| `package-lock.json` | that basename at any depth |
| `dist/` | `dist/…` and `vendor/dist/…` |
| `*.min.*` | any basename containing `.min.` |
| `src/generated/*` | paths under `src/generated/` |

Ignored paths are filtered from: top files, files list, commits-per-author lines,
churn-over-time, bus-factor modules. They are **not** deleted from the DB —
turning the filter off restores the data without re-ingesting.

## 4. Performance — measured, not claimed

Run:

```bash
npm run bench -- /path/to/repo
```

It prints parse time, bulk-insert time and read-query timings for that machine
and that run.

### Reference run (this repo, 2026-11-17, local NVMe, PostgreSQL 18.3, Node 26)

Repo: GitViz itself — **1 commit, 171 file rows** (too small to be a stress
test; recorded only so the method is visible).

```
git log parse                            16 ms
bulk insert + metrics                    16 ms
GET files                                 3 ms
GET commits (50)                          1 ms
GET churn                                 6 ms
GET bus-factor                            3 ms
GET time-to-merge                         1 ms
GET file history                          3 ms
```

Test suite (27 tests, includes ephemeral Postgres startup and a real git repo
end to end): **~2.0 s wall clock**.

> There is **no 50k-commit claim** yet. That is P2's W7 job: cluster has the
> right indices (`commits_pagination_idx`, `file_changes_repo_path_idx`,
> `metrics_rank_idx`, `author_stats_repo_path_idx`), but the W1 spike and W4/W7
> EXPLAIN pass on a ~50k-commit public repo still need to be run and recorded
> here. Do not put a number on a slide before that.

### Why it should hold up

- One `git log --numstat` pass (dev adapter; P1 will own the final parser).
- One bulk insert transaction with batched JSON expansion.
- Derived tables are `INSERT … SELECT` aggregations, not row loops.
- Cursor pagination has a matching composite index.
- Read queries filter by `repo_id` first.

## 5. Known limits (state them honestly)

- `src/services/git-log.js` buffers the entire `git log` output (branches,
  remotes, tags and HEAD) in memory. It is a dev stand-in, not P1's final
  streaming parser. A repo with no commits parses to an empty payload.
- Ingest job progress/status is in memory; a server restart loses `pct` but
  `repos.ingested_at` still distinguishes done from interrupted.
- Diffs are not stored. P1 supplies them at request time.
- Time-to-merge is an estimate and is not shown in the dashboard yet.
- Module grouping is the file's directory; it is not a build-system module.
- Bus factor counts commits, not knowledge. Always label it an estimate.
- An empty repo is valid: it returns `commit_count: 0` and empty metric arrays,
  not fabricated numbers.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ECONNREFUSED` | Postgres is not running or `DATABASE_URL` is wrong |
| `relation "repos" does not exist` | run `npm run db:migrate` |
| Metrics look stale after changing merge policy | `npm run recompute -- <repo>` |
| Lockfile still in top files | edit `config/ignore-list.json`; no re-ingest needed |
| File history stops early | inspect for `history_complete: false` / `break_after`; Git lost the rename |
| `Invalid cursor` | cursor is opaque; send back `next_cursor` unchanged |
| Ingest status stuck at 8% | parsing is buffered; check server log for git errors |
