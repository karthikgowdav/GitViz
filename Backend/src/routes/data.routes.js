'use strict';

/**
 * Read API over the P2 data layer.
 *
 * These are thin wrappers around src/db/queries/* and src/services/*, exposing
 * the frozen frontend contract. P1 can mount this router as-is and add the
 * git-reading endpoints on top.
 */

const express = require('express');

const { resolveRepo, listRepos } = require('../db/queries/repos');
const {
  InvalidCursorError,
  listCommits,
  getCommitDetail,
  getFileHistory,
  listFiles,
} = require('../db/queries/commits');
const { getChurn, getBusFactor, getTimeToMerge } = require('../db/queries/metrics');
const { recomputeMetrics } = require('../db/metrics-store');
const { startIngest, getRepoStatus, listJobs } = require('../services/ingest-job');
const { buildExport } = require('../services/export');

const router = express.Router();

function poolOf(req) {
  return req.app.locals.pool;
}

function decodePathParam(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    const error = new Error('Invalid URL-encoded file path');
    error.status = 400;
    throw error;
  }
}

async function repoMiddleware(req, res, next) {
  const repo = await resolveRepo(poolOf(req), req.params.id);
  if (!repo) {
    return res.status(404).json({ message: `Repository not found: ${req.params.id}` });
  }
  req.repo = repo;
  return next();
}

// --- Repository lifecycle -------------------------------------------------

router.get('/repos', async (req, res) => {
  res.json(await listRepos(poolOf(req)));
});

router.post('/repos', async (req, res) => {
  const { path: repoPath, reingest } = req.body || {};
  const result = await startIngest(poolOf(req), repoPath, { force: Boolean(reingest) });
  res.status(202).json(result);
});

router.get('/repos/:id/status', async (req, res) => {
  const status = await getRepoStatus(poolOf(req), req.params.id);
  if (!status) {
    return res.status(404).json({ message: `Repository not found: ${req.params.id}` });
  }
  return res.json(status);
});

router.get('/ingest-jobs', (req, res) => {
  res.json(listJobs());
});

// --- Commits --------------------------------------------------------------

router.get('/repos/:id/commits', repoMiddleware, async (req, res, next) => {
  try {
    const result = await listCommits(poolOf(req), req.repo.id, {
      cursor: req.query.cursor || null,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      res.status(400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

router.get('/repos/:id/commits/:sha', repoMiddleware, async (req, res) => {
  const detail = await getCommitDetail(poolOf(req), req.repo.id, req.params.sha);
  if (!detail) {
    return res.status(404).json({ message: `Commit not found: ${req.params.sha}` });
  }
  return res.json(detail);
});

// --- Files ----------------------------------------------------------------

router.get('/repos/:id/files', repoMiddleware, async (req, res) => {
  res.json(await listFiles(poolOf(req), req.repo.id, { limit: req.query.limit }));
});

// Regex route so file paths may arrive encoded (%2F) or with real slashes.
router.get(/^\/repos\/([^/]+)\/files\/(.+)\/history$/, async (req, res) => {
  const repo = await resolveRepo(poolOf(req), req.params[0]);
  if (!repo) {
    return res.status(404).json({ message: `Repository not found: ${req.params[0]}` });
  }
  const filePath = decodePathParam(req.params[1]);
  return res.json(await getFileHistory(poolOf(req), repo.id, filePath));
});

// --- Metrics --------------------------------------------------------------

router.get('/repos/:id/metrics/churn', repoMiddleware, async (req, res) => {
  res.json(await getChurn(poolOf(req), req.repo.id));
});

router.get('/repos/:id/metrics/bus-factor', repoMiddleware, async (req, res) => {
  res.json(await getBusFactor(poolOf(req), req.repo.id));
});

router.get('/repos/:id/metrics/time-to-merge', repoMiddleware, async (req, res) => {
  res.json(await getTimeToMerge(poolOf(req), req.repo.id));
});

router.post('/repos/:id/recompute', repoMiddleware, async (req, res) => {
  const pool = poolOf(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const totals = await recomputeMetrics(client, req.repo.id);
    await client.query('COMMIT');
    res.json({ repo_id: req.repo.id, ...totals });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// --- Export ---------------------------------------------------------------

router.get('/repos/:id/export', repoMiddleware, async (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  if (format !== 'json' && format !== 'csv') {
    return res.status(400).json({ message: 'format must be json or csv' });
  }

  const snapshot = await buildExport(poolOf(req), req.repo, format);
  res.setHeader('Content-Type', snapshot.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${snapshot.filename}"`);
  return res.send(snapshot.body);
});

module.exports = router;
