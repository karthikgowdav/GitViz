# GitViz Data API (served by P2, consumed by P3)

Base URL: `/api/v1` (dev server: `http://localhost:3000/api/v1`).
All responses are JSON unless the endpoint is an export download.
Errors: `{ "message": "human-readable reason" }` with `400` / `404` / `503` / `500`.

The frontend contract in `Frontend/src/api/types.ts` is authoritative. Fields
may be **added**; existing names and types must not change.

## Endpoints used by the frontend

| Method | Path | Frontend hook |
|---|---|---|
| `POST` | `/repos` | `useCreateRepo()` |
| `GET` | `/repos/:id/status` | `useRepoStatus()` |
| `GET` | `/repos/:id/commits?cursor=&limit=` | `useCommits()` |
| `GET` | `/repos/:id/commits/:sha` | `useCommit()` |
| `GET` | `/repos/:id/files` | `useFiles()` |
| `GET` | `/repos/:id/files/:path/history` | `useFileHistory()` |
| `GET` | `/repos/:id/metrics/churn` | `useChurn()` |
| `GET` | `/repos/:id/metrics/bus-factor` | `useBusFactor()` |
| `GET` | `/repos/:id/export?format=json\|csv` | Export button |

`:id` is the `repos.id` uuid. The resolver also accepts the repo name or path as
a convenience for stale links; new callers should always use the uuid.

## Repository lifecycle

### `POST /repos`

```json
{ "path": "/home/me/project" }
```

`202 Accepted`:

```json
{ "repo_id": "2f2a…", "status": "ingesting" }
```

- `path` is expanded (`~`), resolved and validated as a Git work tree. Invalid
  paths return `400` with `{ "message": "Path not found or not a Git repository" }`.
- If the path was already ingested, the existing `repo_id` is returned and the
  status endpoint reports `done` immediately.
- Send `{ "path": "...", "reingest": true }` to force a full replace.
- `P1 owns the final job runner`. Today `src/services/ingest-job.js` runs it in
  the background with in-memory progress.

### `GET /repos/:id/status`

```json
{ "pct": 100, "commit_count": 4821, "status": "done" }
```

`status` is `ingesting | done | error`; `error` is present only for failures.
An empty repository is `done` with `commit_count: 0`.

### `GET /repos`

Convenience list of ingested repos (not used by the current UI):

```json
[
  {
    "repo_id": "2f2a…",
    "path": "/home/me/project",
    "name": "project",
    "default_branch": "main",
    "ingested_at": "2026-11-17T01:10:33.550Z",
    "commit_count": 4821
  }
]
```

## Commits

### `GET /repos/:id/commits?cursor=&limit=`

```json
{
  "commits": [
    {
      "sha": "a9f7e21b…",
      "short_sha": "a9f7e21",
      "parents": ["7c32e01a…", "e4b8912c…"],
      "author": { "name": "Ada", "email": "ada@example.com" },
      "committed_at": "2026-10-28T16:45:00.000Z",
      "message": "Merge branch 'feature'",
      "is_merge": true,
      "files_changed": 5,
      "additions": 142,
      "deletions": 28
    }
  ],
  "next_cursor": "eyJ0IjoiMjAyNi0xMC0yOFQxNjo0NTowMC4wMDBaIiwicyI6ImE5ZjdlMjFiIn0"
}
```

- Cursor is opaque, base64url, and returned as `next_cursor`.
- `next_cursor` is `null` on the last page.
- `limit` defaults to 50, clamped to 1–200.
- Sorting: `committed_at DESC, sha DESC`.
- `branch_hint` is optional in the contract and is not populated by the data
  layer (no branch column in the frozen schema).

### `GET /repos/:id/commits/:sha`

Same commit fields plus:

```json
"files": [
  {
    "path": "src/api/client.ts",
    "old_path": null,
    "additions": 18,
    "deletions": 4,
    "is_binary": false
  }
]
```

`404` when the SHA is not in this repo.

## Files

### `GET /repos/:id/files`

Derived from `metrics`, sorted by commit count. Ignored paths are excluded.
Returns a plain array (the frontend expects that, not an envelope):

```json
[
  { "path": "src/core/router.ts", "commit_count": 42, "last_touch_at": "2026-10-24T18:30:00.000Z" }
]
```

Optional `?limit=` (default 1000, max 5000).

### `GET /repos/:id/files/:path/history`

`:path` may be URL-encoded (`src%2Fapi%2Fclient.ts`) or contain real slashes;
both are supported. Returns `200` with `entries: []` for an unknown path.

```json
{
  "path": "src/core/router.ts",
  "history_complete": false,
  "entries": [
    {
      "sha": "a1b2c3d…",
      "short_sha": "a1b2c3d",
      "parents": ["b2c3d4e…"],
      "author": { "name": "Ada", "email": "ada@example.com" },
      "committed_at": "2026-10-24T18:30:00.000Z",
      "message": "fix(router): sanitize query parameters",
      "is_merge": false,
      "additions": 14,
      "deletions": 3,
      "old_path": null,
      "break_after": null
    }
  ]
}
```

- Rename lineage is followed backwards using `old_path`.
- `history_complete: false` plus `break_after: "<message>"` on the oldest entry
  means Git likely lost a rename. Show the break; do not hide it.
- `diff` is omitted by P2. P1's final route adds it; the UI already hides the
  diff button when missing.

## Metrics

### `GET /repos/:id/metrics/churn`

```json
{
  "repo": {
    "name": "project",
    "commit_count": 4821,
    "author_count": 6,
    "first_commit_at": "2025-11-04T10:14:00.000Z",
    "last_commit_at": "2026-10-24T18:30:00.000Z"
  },
  "merge_commits_counted": false,
  "ignored_patterns": ["package-lock.json", "yarn.lock", "dist/"],
  "top_files": [
    { "path": "src/core/router.ts", "churn_commits": 42, "churn_lines": 348, "last_touch_at": "…" }
  ],
  "commits_per_author": [
    { "name": "Ada", "commits": 1680, "lines_added": 14200 }
  ],
  "churn_over_time": [
    { "period": "2026-01", "commits": 420, "lines_changed": 5400 }
  ]
}
```

- `merge_commits_counted` is the W1 decision the UI must state in tooltips.
- `ignored_patterns` is the current editable list.
- `top_files` is capped at 10.
- Empty repo: all arrays empty, `commit_count: 0`.

### `GET /repos/:id/metrics/bus-factor`

```json
{
  "score": 2,
  "label": "estimate (concentration of commits)",
  "top_contributor_share": 0.58,
  "modules": [
    {
      "path": "src/core/",
      "bus_factor": 1,
      "top_author": "Ada",
      "top_author_share": 0.88
    }
  ]
}
```

- Score = authors needed to cover 80% of commits.
- Module list is capped at 50, ordered by risk (lowest bus factor first).
- Always an **estimate**; never describe it as knowledge concentration.

### `GET /repos/:id/metrics/time-to-merge` (extra, not in the current UI)

```json
{
  "merge_commits_counted": false,
  "label": "estimate (branch age at merge, first-parent chain)",
  "merge_count": 41,
  "average_hours": 52.4,
  "median_hours": 31.2,
  "p95_hours": 190.1,
  "max_hours": 410.3,
  "samples": [
    {
      "sha": "…",
      "merged_at": "…",
      "branch_started_at": "…",
      "hours": 72.5
    }
  ]
}
```

### `POST /repos/:id/recompute`

Rebuilds `metrics` + `author_stats`. Use after changing the merge policy. The
ignore list does **not** need this.

```json
{ "repo_id": "…", "commit_count": 4821, "author_count": 6, "file_count": 812 }
```

## Export

### `GET /repos/:id/export?format=json|csv`

- `json`: `application/json`, attachment
  `gitviz-metrics-<name>.json`. Contains repository metadata, churn, bus factor,
  time-to-merge, merge policy and ignore list.
- `csv`: `text/csv`, attachment `gitviz-top-churn-<name>.csv`. Header is exactly
  `path,churn_commits,churn_lines,last_touch_at` (same as the frontend's mock
  exporter).
- Any other format returns `400`.

## Contract rules

1. **Additive changes only** without a team sync: new optional fields are fine;
   renaming/removing/altering a type is not.
2. `:id` is a uuid string in normal operation.
3. Keep `repo_id` a string in JSON (uuid), never a number.
4. Cursors are opaque; never construct one by hand.
5. Percentages are fractions in `[0, 1]`, not `0–100`.
6. Timestamps are ISO 8601 strings in UTC with milliseconds.
