'use strict';

/**
 * Background ingest job used by the local data API.
 *
 * P1 owns the real job runner (POST /repos -> background job + status polling).
 * This module exists so the data layer can be run end to end before P1 lands:
 * it validates the path, calls the P1 Git reader, then hands parsed rows to
 * the P2 bulk-insert path. Job state is in-memory; the database's ingested_at
 * column is the durable "done" flag.
 */

const { ingestParsedRepo } = require('../db/ingest');
const { findRepoByPath, resolveRepo } = require('../db/queries/repos');
const { validateRepoPath, parseGitRepository } = require('./git_reader');

const jobs = new Map();

function snapshot(job) {
  return {
    pct: Math.max(0, Math.min(100, Math.round(job.pct))),
    commit_count: job.commit_count || 0,
    status: job.status,
    ...(job.error ? { error: job.error } : {}),
  };
}

async function startIngest(pool, rawPath, { force = false } = {}) {
  const repoPath = await validateRepoPath(rawPath);
  const existing = await findRepoByPath(pool, repoPath);

  // Already ingested and not forced: hand back the same repo id. The status
  // endpoint reports `done` immediately, so the frontend's polling loop ends.
  if (existing && existing.ingested_at && !force) {
    return { repo_id: existing.id, status: 'ingesting' };
  }

  // Reserve the id before parsing so status polling works while git runs.
  const reserved = await pool.query(
    `
    INSERT INTO repos (path, name, default_branch, ingested_at, commit_count)
    VALUES ($1, $2, NULL, NULL, 0)
    ON CONFLICT (path) DO UPDATE
      SET ingested_at = NULL,
          commit_count = 0
    RETURNING id
    `,
    [repoPath, repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'repository']
  );

  const repoId = reserved.rows[0].id;
  const job = {
    repoId,
    repoPath,
    pct: 0,
    commit_count: 0,
    status: 'ingesting',
    error: undefined,
    startedAt: Date.now(),
  };
  jobs.set(repoId, job);

  // Fire and forget; the HTTP response is the job id, exactly like P1's API.
  void (async () => {
    try {
      job.pct = 2;
      const parsed = await parseGitRepository(repoPath, {
        onProgress: (pct) => {
          job.pct = Math.max(job.pct, Math.min(8, pct * 0.08));
        },
      });

      job.commit_count = parsed.commits.length;
      job.pct = 10;

      await ingestParsedRepo(pool, parsed, {
        onProgress: (pct) => {
          job.pct = Math.max(job.pct, 10 + pct * 0.9);
        },
      });

      job.commit_count = parsed.commits.length;
      job.pct = 100;
      job.status = 'done';
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`[ingest] ${repoPath}: ${job.error}`);
    }
  })();

  return { repo_id: repoId, status: 'ingesting' };
}

async function getRepoStatus(pool, idOrName) {
  const job = jobs.get(String(idOrName));
  if (job) return snapshot(job);

  const repo = await resolveRepo(pool, idOrName);
  if (!repo) return null;

  if (repo.ingested_at) {
    return { pct: 100, commit_count: repo.commit_count, status: 'done' };
  }

  return {
    pct: 0,
    commit_count: repo.commit_count || 0,
    status: 'error',
    error: 'Ingest did not finish. Load the repository again to retry.',
  };
}

function listJobs() {
  return [...jobs.values()].map((job) => ({
    repo_id: job.repoId,
    path: job.repoPath,
    started_at: new Date(job.startedAt).toISOString(),
    ...snapshot(job),
  }));
}

module.exports = { startIngest, getRepoStatus, listJobs };
