# Handoff — P2 Data Layer → P1 Backend / P3 Frontend / next agent

Updated: 2026-11-17

## 1. Current state

| Area | State | Evidence |
|---|---|---|
| Frozen Postgres schema + migrations | **Done** | `db/migrations/*.sql`, `docs/schema.md` |
| Bulk ingest (one transaction, batched) | **Done** | `src/db/ingest.js` |
| Churn, commits-per-author, churn over time | **Done** | `src/db/queries/metrics.js` |
| Bus factor (repo + module, labelled estimate) | **Done** | same |
| Time-to-merge (first-parent estimate) | **Done** | same, extra endpoint + JSON export |
| File history with rename lineage + visible breaks | **Done** | `src/db/queries/commits.js` |
| Cursor pagination for commits | **Done** | same |
| Ignore list (editable, read-time) | **Done** | `config/ignore-list.json` |
| JSON / CSV snapshot export | **Done** | `src/services/export.js` |
| Read API matching `Frontend/src/api/types.ts` | **Done** | `src/routes/data.routes.js`, `docs/api.md` |
| Automated tests (happy + weird cases) | **Done, 27 passing** | `npm test` |
| Real git parser + streaming progress | **Pending P1** | dev adapter only |
| Per-commit / file diffs (`git show`) | **Pending P1** | UI hides diff when absent |
| Persistent ingest jobs across restarts | **Pending P1** | in-memory `ingest-jobs` |
| 50k-commit benchmark / EXPLAIN pass | **Pending P2 W7** | run `npm run bench`, record in `docs/data-layer.md` |
| Slide-number verification | **Pending P4 + P2 W8** | compare exports against manual counts |

No schema changes were made beyond the PRD's six tables. No frontend contract
changes were made; two integration bugs were fixed (see §4).

## 2. How to run the whole stack today

```bash
# terminal 1 — database (any Postgres 13+)
createdb gitviz
cd Backend
cp .env.example .env       # set DATABASE_URL
npm install
npm run db:migrate
npm start                  # http://localhost:3000

# terminal 2 — frontend
cd Frontend
printf 'VITE_USE_MOCK=false\n' > .env
npm install
npm run dev                # http://localhost:5173
```

Then `/load` → enter an absolute path on the backend machine → wait for `done` →
Graph / Files / Dashboard all read from Postgres.

Try it without the UI:

```bash
curl -s localhost:3000/api/v1/health
curl -s -X POST localhost:3000/api/v1/repos \
  -H 'content-type: application/json' \
  -d '{"path":"/absolute/path/to/repo"}'
```

## 3. What P1 should do next (without breaking P3)

### 3.1 Replace the temporary git adapter

- Keep `src/db/ingest.js` unchanged. It is the hand-off contract.
- Replace `src/services/git-log.js` with `src/services/git_reader.js` +
  `src/services/ingest.js` per the P1 PRD. The output must still be the payload
  documented in `docs/schema.md` §2.
- Keep the one-pass rule: one `git log --numstat` spawn, parse everything, hand
  rows to `ingestParsedRepo`.
- Prefer streaming parse + progress over the current buffered `execFile`.
- Keep `execFile` with an args array; never interpolate a shell string. Read-only
  commands only.

### 3.2 Own the job runner

`src/services/ingest-job.js` is deliberately small and in-memory. P1's real job
runner should:

- persist job state (or derive `pct` from parsed/inserted counts),
- report realistic `pct` and `commit_count`,
- keep one job per repo path,
- return the same `POST /repos` and `GET /repos/:id/status` shapes.

`repos.ingested_at` is already the durable "done" flag; leave it as the source
of truth for `status: done`.

### 3.3 Add diffs at the route layer

The DB intentionally stores no patches. For `GET /commits/:sha` and
`GET /files/:path/history`, use `git show`/`git diff` on demand and add
`diff: "<unified diff>"` to file-history entries. The frontend already:

- hides "Inspect diff" when `diff` is absent,
- renders it when present,
- shows the "No diff available" empty state otherwise.

### 3.4 Add P1 endpoints

The empty files under `src/routes/` and `src/controllers/` are P1 scaffolding.
The P2 routes live in `src/routes/data.routes.js`; mount or copy them as needed.
P1 can also add `branch_hint` to commits (the frontend type has it optional) and
populate full commit messages.

### 3.5 Keep the contract

- `:id` stays a uuid string.
- Mutable metric definitions live in `docs/data-layer.md`; do not silently change
  the merge policy. It is displayed in the UI.
- Any schema change requires a team sync and a new migration file — never edit an
  applied migration.

## 4. What P3 should know

- Flip `VITE_USE_MOCK=false`; no code changes needed for the endpoints.
- Two small live-mode fixes were applied:
  - `Dashboard.tsx` export now passes `activeRepoId` (the uuid), not the display
    name. Name lookup remains supported server-side as a fallback.
  - `LoadRepo.tsx` no longer falls back to `'sample-repo'` when mock mode is off.
- Dashboard tooltips already key off `merge_commits_counted` (default `false`:
  merge commits are **not** churn).
- Bus factor data is already labelled; keep the "estimate" wording.
- `history_complete: false` + `break_after` is the visible rename break; render
  it rather than smoothing it over.
- File-history diffs stay hidden until P1 adds them.
- Empty repo (`commit_count: 0`) is a valid `done` state; keep the empty state.
- Module paths are directory names; root files show `(root)/`.
- Extra fields the UI can ignore today: `time_to_merge`, `is_generated` on files,
  `GET /repos`, `GET /ingest-jobs`, `POST /repos/:id/recompute`.

## 5. For the next P2/backend agent

Read in this order:

1. `README.md` — commands and boundaries.
2. `docs/schema.md` — frozen schema + ingest contract.
3. `docs/data-layer.md` — metric definitions and performance method.
4. `docs/api.md` — exact request/response shapes.
5. `test/data.test.js` and `test/api.test.js` — executable expectations.

Safe extension points:

| Task | Where |
|---|---|
| Add a read query | `src/db/queries/` + export it |
| Add a REST shape | `src/routes/data.routes.js` |
| Change metric math | `src/db/queries/metrics.js`, update tests + docs |
| Change derived columns | `src/db/metrics-store.js` + recompute tests |
| Add ignore defaults | `config/ignore-list.json` (no schema change) |
| Change schema | new `db/migrations/NNN_*.sql` + team sync + docs |
| Add a test | `test/*.test.js`; `npm test` starts an ephemeral Postgres |
| Benchmark | `npm run bench -- <repo>`; paste output into `docs/data-layer.md` |

Guardrails:

- Never write rows outside `ingestParsedRepo`'s transaction.
- Never make `metrics`/`author_stats` the only copy of a fact.
- Never use `OFFSET` pagination.
- Never use shell interpolation for repo paths.
- Any performance statement needs a fresh measured run.

## 6. Definition-of-done checklist (P2 PRD)

- [x] Schema + migrations documented (`docs/schema.md`)
- [x] Bulk ingest is one transaction and batched
- [x] Churn, commits-per-author, churn over time
- [x] Bus factor per repo + module, labelled estimate
- [x] Time-to-merge along first-parent chain
- [x] Rename-aware file history, breaks surfaced
- [x] Cursor pagination
- [x] Ignore list, editable, read-time
- [x] JSON/CSV export
- [x] Tests cover happy path + weird cases (merge-heavy, single-author, empty,
      rename break, malformed input)
- [x] Runnable read API + frontend flag flip
- [ ] 50k-commit W1 spike / W7 query benchmark recorded
- [ ] P4 checklist item ticked on a real build
- [ ] Slide numbers reconciled against the DB

## 7. Open questions

1. Which ~50k-commit public repo is the official benchmark? (P2 W7)
2. Do merge commits ever need to count toward churn? Current answer: **no**, and
   the switch exists but changing it requires a recompute + UI copy update.
3. Should time-to-merge be added to the dashboard? It is served and exported but
   unused by the current UI.
4. Should the ignore list be per-repo instead of global? The frozen schema has no
   table for it; today it is a config file applied at read time.
5. Should generated-file detection (`is_generated`) be P1's heuristic or P2's?
   Today P1 supplies the flag; P2 only stores and honours it.
