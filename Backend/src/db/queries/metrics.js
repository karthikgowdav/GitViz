'use strict';

/**
 * Metrics engine — the numbers the dashboard shows.
 *
 * Every number below is derived from `commits` + `file_changes` (or their
 * materialised forms `metrics` / `author_stats`). No estimates beyond the ones
 * the product promises:
 *   - churn: commit count and lines changed per file
 *   - bus factor: authors needed to cover 80% of commits (labelled estimate)
 *   - time-to-merge: branch age at merge along the first-parent chain (estimate)
 */

const { buildIgnoreClause, getIgnorePatterns, mergeCommitsCounted } = require('../../config/ignore-list');
const { mergeClause } = require('../metrics-store');
const { getRepoSummary, toIso } = require('./repos');

const BUS_FACTOR_COVERAGE = 0.8;
const MAX_MODULES = 50;
const MAX_MERGE_SAMPLES = 50;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getTopFiles(db, repoId, { limit = 10 } = {}) {
  const ignore = buildIgnoreClause('m.path', getIgnorePatterns(), 2);
  const result = await db.query(
    `
    SELECT m.path, m.churn_commits, m.churn_lines, m.last_touch_at
    FROM metrics m
    WHERE m.repo_id = $1
      AND m.churn_commits > 0
      AND ${ignore.sql}
    ORDER BY m.churn_commits DESC, m.churn_lines DESC, m.path ASC
    LIMIT $${ignore.params.length + 2}
    `,
    [repoId, ...ignore.params, limit]
  );

  return result.rows.map((row) => ({
    path: row.path,
    churn_commits: toNumber(row.churn_commits),
    churn_lines: toNumber(row.churn_lines),
    last_touch_at: toIso(row.last_touch_at),
  }));
}

async function getCommitsPerAuthor(db, repoId) {
  const ignore = buildIgnoreClause('fc.path', getIgnorePatterns(), 2);
  const result = await db.query(
    `
    SELECT
      a.name,
      count(DISTINCT c.id)::int AS commits,
      COALESCE(
        sum(fc.additions) FILTER (
          WHERE NOT c.is_merge
            AND NOT fc.is_generated
            AND ${ignore.sql}
        ),
        0
      )::bigint AS lines_added
    FROM authors a
    LEFT JOIN commits c ON c.author_id = a.id
    LEFT JOIN file_changes fc ON fc.commit_id = c.id
    WHERE a.repo_id = $1
    GROUP BY a.id, a.name
    ORDER BY commits DESC, a.name ASC
    `,
    [repoId, ...ignore.params]
  );

  return result.rows.map((row) => ({
    name: row.name,
    commits: toNumber(row.commits),
    lines_added: toNumber(row.lines_added),
  }));
}

async function getChurnOverTime(db, repoId) {
  const ignore = buildIgnoreClause('fc.path', getIgnorePatterns(), 2);
  const result = await db.query(
    `
    SELECT
      to_char(date_trunc('month', c.committed_at), 'YYYY-MM') AS period,
      count(DISTINCT c.id)::int AS commits,
      COALESCE(sum(fc.additions + fc.deletions), 0)::bigint AS lines_changed
    FROM commits c
    JOIN file_changes fc ON fc.commit_id = c.id
    WHERE c.repo_id = $1
      AND ${mergeClause()}
      AND fc.is_generated = false
      AND ${ignore.sql}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    [repoId, ...ignore.params]
  );

  return result.rows.map((row) => ({
    period: row.period,
    commits: toNumber(row.commits),
    lines_changed: toNumber(row.lines_changed),
  }));
}

async function getChurn(db, repoId) {
  const [repo, topFiles, commitsPerAuthor, churnOverTime] = await Promise.all([
    getRepoSummary(db, repoId),
    getTopFiles(db, repoId),
    getCommitsPerAuthor(db, repoId),
    getChurnOverTime(db, repoId),
  ]);

  return {
    repo,
    merge_commits_counted: mergeCommitsCounted(),
    ignored_patterns: getIgnorePatterns(),
    top_files: topFiles,
    commits_per_author: commitsPerAuthor,
    churn_over_time: churnOverTime,
  };
}

function coverageFactor(authorTotals, coverage = BUS_FACTOR_COVERAGE) {
  const total = authorTotals.reduce((sum, entry) => sum + entry.commits, 0);
  if (total <= 0) return 0;

  const sorted = [...authorTotals].sort((a, b) => b.commits - a.commits);
  let cumulative = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    cumulative += sorted[index].commits;
    if (cumulative >= total * coverage) return index + 1;
  }
  return sorted.length;
}

function moduleFromPath(filePath) {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return '(root)/';
  return `${filePath.slice(0, lastSlash)}/`;
}

async function getBusFactorRows(db, repoId) {
  const ignore = buildIgnoreClause('s.path', getIgnorePatterns(), 2);
  const result = await db.query(
    `
    SELECT s.path, a.name AS author, sum(s.commits)::int AS commits
    FROM author_stats s
    JOIN authors a ON a.id = s.author_id
    WHERE s.repo_id = $1
      AND s.commits > 0
      AND ${ignore.sql}
    GROUP BY s.path, a.name
    `,
    [repoId, ...ignore.params]
  );
  return result.rows.map((row) => ({
    path: row.path,
    module: moduleFromPath(row.path),
    author: row.author,
    commits: toNumber(row.commits),
  }));
}

async function getOverallAuthorCommits(db, repoId) {
  // Overall concentration counts a commit once, regardless of how many files
  // it touched. Module concentration (below) is per path by design.
  const result = await db.query(
    `
    SELECT a.name AS author, count(DISTINCT c.id)::int AS commits
    FROM authors a
    JOIN commits c ON c.author_id = a.id
    WHERE a.repo_id = $1
      AND ${mergeClause()}
    GROUP BY a.id, a.name
    `,
    [repoId]
  );
  return result.rows.map((row) => ({
    author: row.author,
    commits: toNumber(row.commits),
  }));
}

function summariseBusFactor(rows, overallRows = []) {
  const modules = new Map();

  for (const row of rows) {
    if (!modules.has(row.module)) modules.set(row.module, new Map());
    const authors = modules.get(row.module);
    authors.set(row.author, (authors.get(row.author) || 0) + row.commits);
  }

  const authorTotals = overallRows.length > 0
    ? overallRows
    : [...new Map(rows.map((row) => [row.author, 0])).keys()].map((author) => ({ author, commits: 0 }));
  const total = authorTotals.reduce((sum, entry) => sum + entry.commits, 0);
  const top = [...authorTotals].sort((a, b) => b.commits - a.commits)[0];

  const moduleSummaries = [...modules.entries()].map(([modulePath, authors]) => {
    const totals = [...authors.entries()].map(([author, commits]) => ({ author, commits }));
    const moduleTotal = totals.reduce((sum, entry) => sum + entry.commits, 0);
    const moduleTop = [...totals].sort((a, b) => b.commits - a.commits)[0];
    return {
      path: modulePath,
      bus_factor: coverageFactor(totals),
      top_author: moduleTop ? moduleTop.author : 'Unknown',
      top_author_share: moduleTotal > 0 && moduleTop ? moduleTop.commits / moduleTotal : 0,
      total_commits: moduleTotal,
    };
  });

  moduleSummaries.sort(
    (a, b) =>
      a.bus_factor - b.bus_factor ||
      b.top_author_share - a.top_author_share ||
      b.total_commits - a.total_commits ||
      a.path.localeCompare(b.path)
  );

  return {
    score: coverageFactor(authorTotals),
    label: 'estimate (concentration of commits)',
    top_contributor_share: total > 0 && top ? top.commits / total : 0,
    modules: moduleSummaries.slice(0, MAX_MODULES).map(({ total_commits, ...module }) => module),
  };
}

async function getBusFactor(db, repoId) {
  const [rows, overallRows] = await Promise.all([
    getBusFactorRows(db, repoId),
    getOverallAuthorCommits(db, repoId),
  ]);
  return summariseBusFactor(rows, overallRows);
}

function median(sortedValues) {
  if (sortedValues.length === 0) return null;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(fraction * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

/**
 * Time-to-merge, first-parent chain only (P2 rule #2).
 *
 * We treat the first-parent chain from the newest tip as the mainline. For each
 * merge on that line, the branch's unique commits are the commits reachable
 * from parents[1..] that are not already reachable from the first parent. The
 * branch's oldest unique commit is the branch start; the merge commit time
 * minus that is the branch age at merge. This is an estimate, not a PR timer.
 */
async function getTimeToMerge(db, repoId, { maxMerges = 1000 } = {}) {
  const result = await db.query(
    `
    SELECT sha, parents, committed_at, is_merge
    FROM commits
    WHERE repo_id = $1
    ORDER BY committed_at ASC, sha ASC
    `,
    [repoId]
  );

  const commits = result.rows.map((row) => ({
    sha: row.sha,
    parents: row.parents || [],
    time: new Date(row.committed_at).getTime(),
    isMerge: row.is_merge,
  }));

  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const referenced = new Set();
  for (const commit of commits) {
    for (const parent of commit.parents) referenced.add(parent);
  }

  let tip = null;
  for (const commit of commits) {
    if (!referenced.has(commit.sha) && (!tip || commit.time > tip.time)) tip = commit;
  }
  if (!tip) {
    return {
      merge_commits_counted: mergeCommitsCounted(),
      label: 'estimate (branch age at merge, first-parent chain)',
      merge_count: 0,
      average_hours: null,
      median_hours: null,
      p95_hours: null,
      max_hours: null,
      samples: [],
    };
  }

  // Walk the first-parent chain from the tip, then process oldest -> newest so
  // the first parent's full ancestor set is already known at each merge.
  const chain = [];
  const seen = new Set();
  let current = tip;
  while (current && !seen.has(current.sha)) {
    seen.add(current.sha);
    chain.push(current);
    const firstParent = current.parents[0];
    current = firstParent ? bySha.get(firstParent) : null;
  }
  chain.reverse();

  const reachable = new Set();
  const samples = [];

  for (const commit of chain) {
    if (commit.isMerge && commit.parents.length > 1) {
      const branchTimes = [];
      const visited = new Set();
      const queue = commit.parents.slice(1);

      while (queue.length > 0) {
        const sha = queue.pop();
        if (!sha || visited.has(sha) || reachable.has(sha)) continue;
        visited.add(sha);
        const node = bySha.get(sha);
        if (!node) continue;
        branchTimes.push(node.time);
        for (const parent of node.parents) queue.push(parent);
      }

      if (branchTimes.length > 0) {
        const branchStart = Math.min(...branchTimes);
        const hours = (commit.time - branchStart) / 3_600_000;
        if (hours >= 0) {
          samples.push({
            sha: commit.sha,
            merged_at: new Date(commit.time).toISOString(),
            branch_started_at: new Date(branchStart).toISOString(),
            hours: Math.round(hours * 100) / 100,
          });
        }
        for (const sha of visited) reachable.add(sha);
      }
    }
    reachable.add(commit.sha);
  }

  const limited = samples.slice(-maxMerges);
  const values = limited.map((sample) => sample.hours).sort((a, b) => a - b);
  const average = values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

  return {
    merge_commits_counted: mergeCommitsCounted(),
    label: 'estimate (branch age at merge, first-parent chain)',
    merge_count: values.length,
    average_hours: average === null ? null : Math.round(average * 100) / 100,
    median_hours: median(values),
    p95_hours: percentile(values, 0.95),
    max_hours: values.length > 0 ? values[values.length - 1] : null,
    samples: samples.slice(-MAX_MERGE_SAMPLES).reverse(),
  };
}

module.exports = {
  BUS_FACTOR_COVERAGE,
  MAX_MODULES,
  getTopFiles,
  getCommitsPerAuthor,
  getChurnOverTime,
  getChurn,
  getBusFactorRows,
  getOverallAuthorCommits,
  getBusFactor,
  getTimeToMerge,
  coverageFactor,
  moduleFromPath,
};
