'use strict';

/**
 * Snapshot export (P2 owns the generator, P1 owns the route).
 *
 * JSON is the complete metrics payload; CSV is the dashboard's top-churn table
 * with the exact headers the frontend already downloads in mock mode.
 */

const { getChurn, getBusFactor, getTimeToMerge } = require('../db/queries/metrics');
const { toIso } = require('../db/queries/repos');

function escapeCsvField(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(topFiles) {
  const headers = ['path', 'churn_commits', 'churn_lines', 'last_touch_at'];
  const rows = (topFiles || []).map((file) =>
    [
      escapeCsvField(file.path),
      file.churn_commits,
      file.churn_lines,
      escapeCsvField(file.last_touch_at || ''),
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

function safeFilename(name) {
  return String(name || 'repository').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function buildExport(db, repo, format = 'json') {
  if (format === 'csv') {
    const churn = await getChurn(db, repo.id);
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `gitviz-top-churn-${safeFilename(repo.name)}.csv`,
      body: buildCsv(churn.top_files),
    };
  }

  const [churn, busFactor, timeToMerge] = await Promise.all([
    getChurn(db, repo.id),
    getBusFactor(db, repo.id),
    getTimeToMerge(db, repo.id),
  ]);

  const payload = {
    repository: {
      repo_id: repo.id,
      name: repo.name,
      path: repo.path,
      default_branch: repo.default_branch,
      commit_count: churn.repo.commit_count,
      author_count: churn.repo.author_count,
      first_commit_at: churn.repo.first_commit_at,
      last_commit_at: churn.repo.last_commit_at,
      ingested_at: toIso(repo.ingested_at),
    },
    exported_at: new Date().toISOString(),
    note: 'GitViz health metrics snapshot. Bus factor and time-to-merge are estimates.',
    merge_commits_counted: churn.merge_commits_counted,
    ignored_patterns: churn.ignored_patterns,
    churn,
    bus_factor: busFactor,
    time_to_merge: timeToMerge,
  };

  return {
    contentType: 'application/json; charset=utf-8',
    filename: `gitviz-metrics-${safeFilename(repo.name)}.json`,
    body: JSON.stringify(payload, null, 2),
  };
}

module.exports = { buildExport, buildCsv, escapeCsvField, safeFilename };
