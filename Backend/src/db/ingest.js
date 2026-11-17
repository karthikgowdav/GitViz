'use strict';

/**
 * Bulk ingest path — P1 hands parsed rows, P2 writes them.
 *
 * Contract (also in docs/schema.md):
 *
 *   {
 *     repo: { path, name, default_branch },
 *     commits: [{
 *       sha, parents: string[], author: { name, email },
 *       committed_at: ISO string, message,
 *       files: [{ path, old_path, additions, deletions, is_binary, is_generated }]
 *     }]
 *   }
 *
 * One Postgres transaction for the whole import (rule #1 and #6). Rows go in
 * as JSON batches and are expanded by jsonb_array_elements, so there is never
 * a per-row round trip.
 */

const { recomputeMetrics } = require('./metrics-store');
const { getIgnorePatterns, mergeCommitsCounted } = require('../config/ignore-list');

const DEFAULT_BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 1000);

class IngestInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IngestInputError';
    this.status = 400;
  }
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string' && value.length > 0) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  return null;
}

function toInt(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function normalizeAuthor(commit) {
  if (commit.author && typeof commit.author === 'object') {
    return {
      name: String(commit.author.name || commit.author.email || 'Unknown').trim() || 'Unknown',
      email: String(commit.author.email || '').trim().toLowerCase(),
    };
  }
  return {
    name: String(commit.author_name || commit.author || 'Unknown').trim() || 'Unknown',
    email: String(commit.author_email || '').trim().toLowerCase(),
  };
}

function normalizeParsedRepo(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new IngestInputError('Parsed repo payload must be an object');
  }

  const repoPath = parsed.repo?.path || parsed.path;
  if (!repoPath || typeof repoPath !== 'string') {
    throw new IngestInputError('Parsed repo payload is missing repo.path');
  }

  const commitsInput = parsed.commits;
  if (!Array.isArray(commitsInput)) {
    throw new IngestInputError('Parsed repo payload is missing commits[]');
  }

  const repoName =
    parsed.repo?.name ||
    parsed.name ||
    repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ||
    'repository';

  const seenShas = new Set();
  const commits = [];

  for (const raw of commitsInput) {
    if (!raw || typeof raw !== 'object') {
      throw new IngestInputError('Every commit must be an object');
    }
    const sha = String(raw.sha || '').trim();
    if (!sha) throw new IngestInputError('Commit is missing sha');
    if (seenShas.has(sha)) continue; // P1's graph is authoritative; ignore duplicates.
    seenShas.add(sha);

    const committedAt = toIsoString(raw.committed_at || raw.date);
    if (!committedAt) {
      throw new IngestInputError(`Commit ${sha} has an invalid committed_at`);
    }

    const parents = Array.isArray(raw.parents)
      ? raw.parents.map((p) => String(p))
      : [];
    const author = normalizeAuthor(raw);
    const filesInput = raw.files || raw.file_changes || [];

    const files = [];
    for (const file of filesInput) {
      if (!file || typeof file.path !== 'string' || file.path.length === 0) continue;
      files.push({
        path: file.path,
        old_path: file.old_path ? String(file.old_path) : null,
        additions: toInt(file.additions),
        deletions: toInt(file.deletions),
        is_binary: Boolean(file.is_binary),
        is_generated: Boolean(file.is_generated),
      });
    }

    commits.push({
      sha,
      parents,
      author,
      committed_at: committedAt,
      message: String(raw.message || ''),
      is_merge: Boolean(raw.is_merge) || parents.length > 1,
      files,
    });
  }

  return {
    repo: {
      path: repoPath,
      name: String(repoName),
      default_branch: parsed.repo?.default_branch ?? parsed.default_branch ?? null,
    },
    commits,
  };
}

function chunk(array, size) {
  const output = [];
  for (let i = 0; i < array.length; i += size) {
    output.push(array.slice(i, i + size));
  }
  return output;
}

async function upsertRepo(client, repo) {
  const result = await client.query(
    `
    INSERT INTO repos (path, name, default_branch, ingested_at, commit_count)
    VALUES ($1, $2, $3, NULL, 0)
    ON CONFLICT (path) DO UPDATE
      SET name = EXCLUDED.name,
          default_branch = EXCLUDED.default_branch,
          ingested_at = NULL,
          commit_count = 0
    RETURNING id
    `,
    [repo.path, repo.name, repo.default_branch]
  );
  return result.rows[0].id;
}

async function clearRepoData(client, repoId) {
  // Explicit order: derived tables first, then leaves to roots.
  await client.query('DELETE FROM author_stats WHERE repo_id = $1', [repoId]);
  await client.query('DELETE FROM metrics WHERE repo_id = $1', [repoId]);
  await client.query('DELETE FROM file_changes WHERE repo_id = $1', [repoId]);
  await client.query('DELETE FROM commits WHERE repo_id = $1', [repoId]);
  await client.query('DELETE FROM authors WHERE repo_id = $1', [repoId]);
}

async function insertAuthors(client, repoId, commits, batchSize) {
  const byEmail = new Map();
  for (const commit of commits) {
    const key = commit.author.email || `${commit.author.name} <unknown>`;
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        name: commit.author.name || 'Unknown',
        email: key,
      });
    }
  }

  const authors = [...byEmail.values()];
  const idByEmail = new Map();

  for (const batch of chunk(authors, batchSize)) {
    const result = await client.query(
      `
      INSERT INTO authors (repo_id, name, email, commits)
      SELECT $1, item->>'name', item->>'email', 0
      FROM jsonb_array_elements($2::jsonb) AS item
      ON CONFLICT (repo_id, email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, email
      `,
      [repoId, JSON.stringify(batch)]
    );
    for (const row of result.rows) idByEmail.set(row.email, row.id);
  }

  return idByEmail;
}

async function insertCommits(client, repoId, commits, idByEmail, batchSize, onProgress) {
  const idBySha = new Map();
  const total = Math.max(1, commits.length);
  let inserted = 0;

  const batches = chunk(commits, batchSize);
  for (let index = 0; index < batches.length; index += 1) {
    const payload = batches[index].map((commit) => ({
      sha: commit.sha,
      author_id: idByEmail.get(commit.author.email || `${commit.author.name} <unknown>`) ?? null,
      parents: commit.parents,
      committed_at: commit.committed_at,
      message: commit.message,
      is_merge: commit.is_merge,
    }));

    const result = await client.query(
      `
      INSERT INTO commits (repo_id, sha, author_id, parents, committed_at, message, is_merge)
      SELECT
        $1,
        item->>'sha',
        (item->>'author_id')::bigint,
        ARRAY(SELECT jsonb_array_elements_text(item->'parents')),
        (item->>'committed_at')::timestamptz,
        COALESCE(item->>'message', ''),
        COALESCE((item->>'is_merge')::boolean, false)
      FROM jsonb_array_elements($2::jsonb) AS item
      RETURNING id, sha
      `,
      [repoId, JSON.stringify(payload)]
    );

    for (const row of result.rows) idBySha.set(row.sha, row.id);
    inserted += batches[index].length;
    if (onProgress) onProgress(10 + Math.round((inserted / total) * 45));
  }

  return idBySha;
}

async function insertFileChanges(client, repoId, commits, idBySha, batchSize, onProgress) {
  const rows = [];
  for (const commit of commits) {
    const commitId = idBySha.get(commit.sha);
    if (!commitId) continue;
    for (const file of commit.files) {
      rows.push({ ...file, commit_id: commitId });
    }
  }

  const total = Math.max(1, rows.length);
  let inserted = 0;

  for (const batch of chunk(rows, batchSize)) {
    await client.query(
      `
      INSERT INTO file_changes
        (commit_id, repo_id, path, old_path, additions, deletions, is_binary, is_generated)
      SELECT
        (item->>'commit_id')::bigint,
        $1,
        item->>'path',
        item->>'old_path',
        COALESCE((item->>'additions')::int, 0),
        COALESCE((item->>'deletions')::int, 0),
        COALESCE((item->>'is_binary')::boolean, false),
        COALESCE((item->>'is_generated')::boolean, false)
      FROM jsonb_array_elements($2::jsonb) AS item
      `,
      [repoId, JSON.stringify(batch)]
    );

    inserted += batch.length;
    if (onProgress) onProgress(55 + Math.round((inserted / total) * 30));
  }

  return rows.length;
}

async function finaliseRepo(client, repoId, repo) {
  await client.query(
    `
    UPDATE authors a
    SET commits = counts.n
    FROM (
      SELECT author_id, count(*)::int AS n
      FROM commits
      WHERE repo_id = $1 AND author_id IS NOT NULL
      GROUP BY author_id
    ) counts
    WHERE a.id = counts.author_id
    `,
    [repoId]
  );

  await client.query(
    `
    UPDATE repos
    SET commit_count = (SELECT count(*)::int FROM commits WHERE repo_id = $1),
        ingested_at = now(),
        default_branch = COALESCE($2, default_branch)
    WHERE id = $1
    `,
    [repoId, repo.default_branch]
  );
}

/**
 * Ingest a parsed repository. Always replaces any previous data for the same
 * path, inside one transaction. Throws IngestInputError for bad input.
 */
async function ingestParsedRepo(pool, parsed, options = {}) {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    onProgress = null,
    ignoredPatterns = getIgnorePatterns(),
  } = options;

  const normalized = normalizeParsedRepo(parsed);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (onProgress) onProgress(2);

    const repoId = await upsertRepo(client, normalized.repo);
    await clearRepoData(client, repoId);
    if (onProgress) onProgress(5);

    const authors = await insertAuthors(client, repoId, normalized.commits, batchSize);
    if (onProgress) onProgress(8);

    const commitIds = await insertCommits(
      client,
      repoId,
      normalized.commits,
      authors,
      batchSize,
      onProgress
    );

    const fileChangeCount = await insertFileChanges(
      client,
      repoId,
      normalized.commits,
      commitIds,
      batchSize,
      onProgress
    );
    if (onProgress) onProgress(88);

    const totals = await recomputeMetrics(client, repoId, { onProgress });
    await finaliseRepo(client, repoId, normalized.repo);

    await client.query('COMMIT');
    if (onProgress) onProgress(100);

    return {
      repoId,
      commitCount: totals.commit_count,
      authorCount: totals.author_count,
      fileChangeCount,
      fileCount: totals.file_count,
      ignoredPatterns,
      mergeCommitsCounted: mergeCommitsCounted(),
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  IngestInputError,
  normalizeParsedRepo,
  ingestParsedRepo,
  DEFAULT_BATCH_SIZE,
};
