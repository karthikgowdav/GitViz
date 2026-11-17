# GitViz Backend — P2 Data Layer

This folder implements **PRD P2 (Data)** and serves the frozen REST contract the
React frontend already consumes. P1's Git endpoints and final ingest job are
still pending; a small dev adapter stands in so the whole stack runs today.

> **One line:** store every commit once, compute churn / bus factor /
> time-to-merge with honest SQL, and serve the exact JSON shapes in
> `Frontend/src/api/types.ts`.

## What is here

| Path | Purpose |
|---|---|
| `db/migrations/` | Frozen PostgreSQL schema + read-path indices (plain SQL) |
| `src/config/database.js` | `pg` pool, bigint parsing, env loading |
| `src/config/ignore-list.js` | Editable generated-file ignore list + glob → SQL |
| `src/db/migrate.js` | Transactional migration runner (`schema_migrations`) |
| `src/db/ingest.js` | **One transaction** bulk ingest from P1's parsed rows |
| `src/db/metrics-store.js` | Rebuild `metrics` + `author_stats` from raw rows |
| `src/db/queries/` | Repo, commit, file and metric read queries (churn, bus factor, time-to-merge) |
| `src/services/export.js` | JSON / CSV snapshot generator |
| `src/services/git-log.js` | **Temporary** dev parser until P1 lands |
| `src/services/ingest-job.js` | In-memory background job + status polling |
| `src/routes/data.routes.js` | Read API for the frontend contract |
| `src/app.js`, `src/server.js` | Express app + process entry point |
| `scripts/` | migrate / ingest / recompute / benchmark |
| `test/` | 27 tests, including a real git repo end to end |
| `docs/` | Schema, metric definitions, API and handoff notes |

## Quick start

Requires Node.js LTS and PostgreSQL 13+.

```bash
cd Backend
npm install
cp .env.example .env          # edit DATABASE_URL

# 1. create the database once (example)
createdb gitviz

# 2. schema + indices
npm run db:migrate

# 3. ingest any local repo (dev adapter)
npm run ingest -- /path/to/a/git/repo

# 4. serve the API on :3000
npm start
```

The server applies pending migrations on boot unless
`GITVIZ_AUTO_MIGRATE=false`.

### Connect the frontend

The Vite dev proxy in `Frontend/vite.config.ts` already targets
`http://localhost:3000`. In `Frontend/.env`:

```env
VITE_USE_MOCK=false
```

Then run `npm run dev` in `Frontend/`. Load a repository at `/load` using a path
on the machine running the backend.

### Tests

```bash
npm test
```

The test helper starts a throwaway PostgreSQL cluster with `initdb`/`pg_ctl`
(no Docker required). In CI, point `TEST_DATABASE_URL` at a disposable database
instead.

## Commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run ingest -- <path \| rows.json \| ->` | Ingest a local repo or P1's parsed JSON |
| `npm run recompute -- <repo>` | Rebuild derived metrics (after a merge-policy change) |
| `npm run bench -- <path>` | Measure parse, insert and read queries on this machine |
| `npm test` | Full test suite |

## Read this before changing anything

1. **The schema is frozen.** Read `docs/schema.md`. A change is a cross-team
   event, not a commit.
2. **Never insert row-by-row.** Use `ingestParsedRepo`; the whole import is one
   transaction.
3. **Merge commits are excluded from churn** (configurable, default `false`).
   The UI must keep saying so.
4. **Bus factor is an estimate.** It measures concentration of commits, not
   knowledge.
5. **Never claim performance without a number.** Run `npm run bench` on the
   target repo and record the output.

For the exact handoff to P1/P3 and future agents, see
[`docs/handoff.md`](docs/handoff.md).
