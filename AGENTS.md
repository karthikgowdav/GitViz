# GitViz — Repository Guide for Agents

GitViz turns a local `.git` folder into a commit graph, file-evolution timeline
and health dashboard. The browser never touches Git or Postgres.

## Layout and ownership

| Folder | Role | Status |
|---|---|---|
| `Backend/` | **P2 Data** (Postgres schema, ingest, metrics, export) + a runnable read API | implemented |
| `Backend/src/services/git-log.js` | temporary P1 parser stand-in | replace with P1's parser |
| `Backend/src/routes/`, `src/controllers/` (empty files) | P1 scaffolding | P1 to fill |
| `Frontend/` | **P3 Frontend** (React + Vite + TypeScript) | implemented |
| `Research/` | PRDs, plans, project memory | read-only context |

Role numbering is defined by the 2026-10-11 PRDs:
**P1 = Backend (Node/Express), P2 = Data, P3 = Frontend, P4 = Product + QA.**
Ignore the older Development Plan numbering (Python/FastAPI).

## Commands

```bash
# Backend (from Backend/)
npm install
npm run db:migrate
npm start                 # data API on :3000
npm run ingest -- <path>  # local repo or P1 parsed JSON
npm run recompute -- <repo>
npm run bench -- <path>
npm test                  # 27 tests, ephemeral Postgres

# Frontend (from Frontend/)
npm install
npm run dev               # :5173, proxies /api -> :3000
npm test
npm run build
```

Live mode: `Frontend/.env` → `VITE_USE_MOCK=false`.

## Contracts you must not break

1. **Postgres schema is frozen.** Six tables only:
   `repos, authors, commits, file_changes, metrics, author_stats`.
   See `Backend/docs/schema.md`. A change needs a new migration **and** a team
   sync; never edit an applied migration.
2. **REST shapes are frozen.** `Frontend/src/api/types.ts` is authoritative.
   Additive fields are fine; renames/removals are not. See `Backend/docs/api.md`.
3. **One ingest transaction.** P1 hands parsed rows to
   `Backend/src/db/ingest.js`; never insert row-by-row.
4. **Merge policy is visible.** Merge commits are excluded from churn by
   default (`config/ignore-list.json`). The UI states it.
5. **Bus factor is an estimate** (authors covering 80% of commits), never
   knowledge concentration.
6. **No performance claims without a measured run.** Use `npm run bench`.
7. **Read-only git.** `execFile('git', [args])` with an args array; never
   shell-interpolate user paths.

## Where to look first

- Data behavior: `Backend/docs/data-layer.md`
- Schema + P1→P2 payload: `Backend/docs/schema.md`
- Endpoint shapes: `Backend/docs/api.md`
- Current state + next steps: `Backend/docs/handoff.md`
- Frontend API choke point: `Frontend/src/api/client.ts`
- Frontend mock contract: `Frontend/src/mock/*.json` + `contract.test.ts`

## Known gaps

- P1's real git parser/streaming job and diffs are not implemented yet.
- Ingest status is in memory (durable "done" is `repos.ingested_at`).
- 50k-commit benchmark not yet recorded; indices are in place.
- Time-to-merge is served/exported but not shown in the dashboard.
