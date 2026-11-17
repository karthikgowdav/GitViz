'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getTestPool, resetDatabase, destroyTestPool } = require('./helpers/pg');
const { runMigrations } = require('../src/db/migrate');
const { ingestParsedRepo } = require('../src/db/ingest');
const { listCommits, getCommitDetail, getFileHistory, listFiles } = require('../src/db/queries/commits');
const { getChurn, getBusFactor, getTimeToMerge } = require('../src/db/queries/metrics');
const { buildExport } = require('../src/services/export');
const { resolveRepo } = require('../src/db/queries/repos');

function commit({ sha, parents = [], name, email, at, message = '', files = [] }) {
  return {
    sha,
    parents,
    author: { name, email },
    committed_at: at,
    message,
    is_merge: parents.length > 1,
    files,
  };
}

function file(filePath, additions, deletions = 0, extra = {}) {
  return { path: filePath, old_path: null, additions, deletions, is_binary: false, is_generated: false, ...extra };
}

function happyFixture(repoPath = '/fixtures/happy') {
  return {
    repo: { path: repoPath, name: 'happy', default_branch: 'main' },
    commits: [
      commit({
        sha: 'c1'.padEnd(40, '1'),
        name: 'Alice',
        email: 'alice@example.com',
        at: '2026-01-01T10:00:00Z',
        message: 'initial',
        files: [file('src/a.js', 10), file('package-lock.json', 1000)],
      }),
      commit({
        sha: 'c2'.padEnd(40, '2'),
        parents: ['c1'.padEnd(40, '1')],
        name: 'Bob',
        email: 'bob@example.com',
        at: '2026-01-02T10:00:00Z',
        message: 'main work',
        files: [file('src/a.js', 2, 1), file('src/b.js', 5)],
      }),
      commit({
        sha: 'b1'.padEnd(40, 'a'),
        parents: ['c1'.padEnd(40, '1')],
        name: 'Bob',
        email: 'bob@example.com',
        at: '2026-01-03T10:00:00Z',
        message: 'branch start',
        files: [file('src/b.js', 8)],
      }),
      commit({
        sha: 'b2'.padEnd(40, 'b'),
        parents: ['b1'.padEnd(40, 'a')],
        name: 'Bob',
        email: 'bob@example.com',
        at: '2026-01-04T10:00:00Z',
        message: 'branch work',
        files: [file('src/b.js', 4)],
      }),
      commit({
        sha: 'c3'.padEnd(40, '3'),
        parents: ['c2'.padEnd(40, '2')],
        name: 'Alice',
        email: 'alice@example.com',
        at: '2026-01-05T10:00:00Z',
        message: 'docs',
        files: [file('docs/readme.md', 3)],
      }),
      commit({
        sha: 'm1'.padEnd(40, 'm'),
        parents: ['c3'.padEnd(40, '3'), 'b2'.padEnd(40, 'b')],
        name: 'Alice',
        email: 'alice@example.com',
        at: '2026-01-08T10:00:00Z',
        message: "Merge branch 'feature'",
        files: [file('src/b.js', 1), file('src/a.js', 0)],
      }),
      commit({
        sha: 'r1'.padEnd(40, 'r'),
        parents: ['m1'.padEnd(40, 'm')],
        name: 'Bob',
        email: 'bob@example.com',
        at: '2026-01-12T10:00:00Z',
        message: 'move a',
        files: [file('src/core/a.js', 1, 1, { old_path: 'src/a.js' })],
      }),
    ],
  };
}

describe('P2 data layer', () => {
  let pool;

  before(async () => {
    pool = await getTestPool();
    await runMigrations(pool);
  });

  after(async () => {
    await destroyTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  it('bulk-inserts parsed rows and materialises metrics', async () => {
    const result = await ingestParsedRepo(pool, happyFixture());
    assert.equal(result.commitCount, 7);
    assert.equal(result.authorCount, 2);
    assert.equal(result.fileChangeCount, 10);

    const repo = await resolveRepo(pool, result.repoId);
    assert.equal(repo.commit_count, 7);

    const rows = await pool.query(
      `SELECT (SELECT count(*)::int FROM commits) AS commits,
              (SELECT count(*)::int FROM file_changes) AS file_changes,
              (SELECT count(*)::int FROM metrics) AS metrics,
              (SELECT count(*)::int FROM author_stats) AS author_stats`
    );
    assert.deepEqual(rows.rows[0], {
      commits: 7,
      file_changes: 10,
      metrics: 5, // src/a.js, src/b.js, package-lock.json, docs/readme.md, src/core/a.js
      author_stats: 6, // Alice: a, lock, docs; Bob: a, b, core/a (merge-only rows dropped)
    });
  });

  it('computes churn honestly: merges excluded, lockfiles filtered at read time', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const churn = await getChurn(pool, repoId);

    assert.equal(churn.repo.commit_count, 7);
    assert.equal(churn.repo.author_count, 2);
    assert.equal(churn.merge_commits_counted, false);
    assert.ok(churn.ignored_patterns.includes('package-lock.json'));

    assert.equal(churn.top_files[0].path, 'src/b.js');
    assert.equal(churn.top_files[0].churn_commits, 3);
    assert.equal(churn.top_files[0].churn_lines, 17);
    assert.ok(!churn.top_files.some((entry) => entry.path === 'package-lock.json'));

    const alice = churn.commits_per_author.find((entry) => entry.name === 'Alice');
    const bob = churn.commits_per_author.find((entry) => entry.name === 'Bob');
    assert.equal(alice.commits, 3); // c1, c3, merge m1
    assert.equal(bob.commits, 4); // c2, b1, b2, rename r1
    assert.equal(alice.lines_added, 13);
    assert.equal(bob.lines_added, 20);

    assert.deepEqual(churn.churn_over_time, [
      { period: '2026-01', commits: 6, lines_changed: 35 },
    ]);
  });

  it('estimates bus factor as authors covering 80% of commits', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const bus = await getBusFactor(pool, repoId);

    assert.equal(bus.score, 2);
    assert.equal(bus.label, 'estimate (concentration of commits)');
    assert.ok(bus.top_contributor_share > 0.5);
    assert.ok(bus.modules.some((module) => module.path === 'src/'));

    // Weird case required by the PRD: a single-author repo has bus factor 1.
    const single = {
      repo: { path: '/fixtures/single', name: 'single' },
      commits: [
        commit({
          sha: 's1'.padEnd(40, '1'),
          name: 'Solo',
          email: 'solo@example.com',
          at: '2026-02-01T00:00:00Z',
          files: [file('main.js', 10)],
        }),
        commit({
          sha: 's2'.padEnd(40, '2'),
          parents: ['s1'.padEnd(40, '1')],
          name: 'Solo',
          email: 'solo@example.com',
          at: '2026-02-02T00:00:00Z',
          files: [file('main.js', 2)],
        }),
      ],
    };
    const second = await ingestParsedRepo(pool, single);
    const singleBus = await getBusFactor(pool, second.repoId);
    assert.equal(singleBus.score, 1);
    assert.equal(singleBus.top_contributor_share, 1);
  });

  it('handles an empty repository without inventing numbers', async () => {
    const { repoId } = await ingestParsedRepo(pool, {
      repo: { path: '/fixtures/empty', name: 'empty' },
      commits: [],
    });

    const churn = await getChurn(pool, repoId);
    const bus = await getBusFactor(pool, repoId);
    const ttm = await getTimeToMerge(pool, repoId);

    assert.equal(churn.repo.commit_count, 0);
    assert.deepEqual(churn.top_files, []);
    assert.deepEqual(churn.commits_per_author, []);
    assert.deepEqual(churn.churn_over_time, []);
    assert.equal(bus.score, 0);
    assert.deepEqual(bus.modules, []);
    assert.equal(ttm.merge_count, 0);
  });

  it('paginates commits with a cursor, never offset', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const seen = [];
    let cursor = null;

    for (let page = 0; page < 10; page += 1) {
      const result = await listCommits(pool, repoId, { cursor, limit: 2 });
      assert.ok(result.commits.length <= 2);
      seen.push(...result.commits.map((entry) => entry.sha));
      cursor = result.next_cursor;
      if (!cursor) break;
    }

    assert.equal(seen.length, 7);
    assert.equal(new Set(seen).size, 7);
    assert.equal(cursor, null);

    await assert.rejects(
      () => listCommits(pool, repoId, { cursor: 'not-a-cursor' }),
      /Invalid cursor/
    );
  });

  it('serves commit detail with files, including merge commits', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const detail = await getCommitDetail(pool, repoId, 'm1'.padEnd(40, 'm'));

    assert.equal(detail.is_merge, true);
    assert.equal(detail.parents.length, 2);
    assert.equal(detail.files.length, 2);
    assert.equal(detail.files_changed, 2);
    assert.equal(detail.additions, 1);
  });

  it('follows renames backwards through file history', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const history = await getFileHistory(pool, repoId, 'src/core/a.js');

    assert.equal(history.path, 'src/core/a.js');
    assert.equal(history.history_complete, true);
    assert.equal(history.entries.length, 4); // r1, merge m1, c2, c1
    const rename = history.entries.find((entry) => entry.sha === 'r1'.padEnd(40, 'r'));
    assert.equal(rename.old_path, 'src/a.js');
    assert.ok(history.entries.some((entry) => entry.sha === 'c1'.padEnd(40, '1')));
  });

  it('marks a likely rename-detection break instead of faking continuity', async () => {
    const fixture = {
      repo: { path: '/fixtures/break', name: 'break' },
      commits: [
        commit({
          sha: 'x1'.padEnd(40, '1'),
          name: 'A',
          email: 'a@example.com',
          at: '2026-03-01T00:00:00Z',
          files: [file('legacy/old.js', 20)],
        }),
        commit({
          sha: 'x2'.padEnd(40, '2'),
          parents: ['x1'.padEnd(40, '1')],
          name: 'A',
          email: 'a@example.com',
          at: '2026-03-02T00:00:00Z',
          files: [file('src/new.js', 20), file('legacy/old.js', 0, 20)],
        }),
      ],
    };
    const { repoId } = await ingestParsedRepo(pool, fixture);
    const history = await getFileHistory(pool, repoId, 'src/new.js');

    assert.equal(history.history_complete, false);
    assert.ok(history.entries[history.entries.length - 1].break_after);
  });

  it('lists files from metrics and hides ignored paths', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const files = await listFiles(pool, repoId);

    assert.ok(files.some((entry) => entry.path === 'src/b.js'));
    assert.ok(!files.some((entry) => entry.path === 'package-lock.json'));
    assert.equal(typeof files[0].commit_count, 'number');
    assert.equal(typeof files[0].last_touch_at, 'string');
  });

  it('applies ignore-list edits on the next read without a re-ingest', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitviz-ignore-')), 'ignore.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ patterns: ['src/', 'docs/', 'package-lock.json'], merge_commits_counted: false })
    );

    const previous = process.env.GITVIZ_IGNORE_LIST;
    process.env.GITVIZ_IGNORE_LIST = configFile;
    try {
      const churn = await getChurn(pool, repoId);
      assert.deepEqual(churn.top_files, []);
      assert.deepEqual((await listFiles(pool, repoId)), []);
    } finally {
      if (previous === undefined) delete process.env.GITVIZ_IGNORE_LIST;
      else process.env.GITVIZ_IGNORE_LIST = previous;
      fs.rmSync(path.dirname(configFile), { recursive: true, force: true });
    }
  });

  it('estimates time-to-merge along the first-parent chain', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const ttm = await getTimeToMerge(pool, repoId);

    assert.equal(ttm.merge_count, 1);
    assert.equal(ttm.average_hours, 120); // Jan 3 -> Jan 8
    assert.equal(ttm.samples[0].sha, 'm1'.padEnd(40, 'm'));
  });

  it('exports a JSON snapshot and RFC-4180 CSV', async () => {
    const { repoId } = await ingestParsedRepo(pool, happyFixture());
    const repo = await resolveRepo(pool, repoId);

    const json = await buildExport(pool, repo, 'json');
    const payload = JSON.parse(json.body);
    assert.equal(payload.repository.repo_id, repoId);
    assert.equal(payload.merge_commits_counted, false);
    assert.equal(payload.bus_factor.label, 'estimate (concentration of commits)');
    assert.equal(payload.time_to_merge.merge_count, 1);

    const csv = await buildExport(pool, repo, 'csv');
    const lines = csv.body.split('\n');
    assert.equal(lines[0], 'path,churn_commits,churn_lines,last_touch_at');
    assert.ok(lines.some((line) => line.startsWith('src/b.js,')));
    assert.ok(!csv.body.includes('package-lock.json'));
  });

  it('rejects malformed ingest payloads before touching the database', async () => {
    await assert.rejects(
      () => ingestParsedRepo(pool, { commits: [] }),
      /missing repo.path/
    );
    await assert.rejects(
      () => ingestParsedRepo(pool, { repo: { path: '/x' }, commits: [{ sha: 'a', committed_at: 'nope' }] }),
      /invalid committed_at/
    );
  });
});
