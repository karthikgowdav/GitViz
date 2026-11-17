'use strict';

/**
 * End-to-end contract test: real git repo -> dev adapter -> Postgres ->
 * Express -> the exact URLs Frontend/src/api/client.ts calls.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const { getTestPool, resetDatabase, destroyTestPool } = require('./helpers/pg');
const { runMigrations } = require('../src/db/migrate');
const { createApp } = require('../src/app');

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitviz-e2e-'));
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { encoding: 'utf8' });
  git(dir, ['config', 'user.name', 'E2E Agent']);
  git(dir, ['config', 'user.email', 'e2e@example.com']);

  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"e2e"}\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lock":true}\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 1;\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'initial commit']);

  fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(dir, 'src/b.js'), 'export const b = 1;\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'add b']);

  fs.mkdirSync(path.join(dir, 'src/core'));
  git(dir, ['mv', 'src/a.js', 'src/core/a.js']);
  git(dir, ['commit', '-q', '-m', 'move a into core']);

  return dir;
}

describe('data API contract', () => {
  let pool;
  let server;
  let baseUrl;
  let repoDir;
  let repoId;

  before(async () => {
    pool = await getTestPool();
    await runMigrations(pool);
    await resetDatabase(pool);

    repoDir = makeRepo();
    server = createApp({ pool }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
    await destroyTestPool();
  });

  it('health check reaches Postgres', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', db: 'ok' });
  });

  it('rejects a non-repository path with a JSON error', async () => {
    const response = await fetch(`${baseUrl}/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/does/not/exist' }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.message, /not found|not a Git repository/i);
  });

  it('ingests a real repo and reports progress until done', async () => {
    const response = await fetch(`${baseUrl}/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: repoDir }),
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    assert.equal(typeof created.repo_id, 'string');
    repoId = created.repo_id;

    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const statusResponse = await fetch(`${baseUrl}/repos/${repoId}/status`);
      assert.equal(statusResponse.status, 200);
      status = await statusResponse.json();
      if (status.status === 'done' || status.status === 'error') break;
      await delay(100);
    }

    assert.equal(status.status, 'done', status.error);
    assert.equal(status.pct, 100);
    assert.equal(status.commit_count, 3);
  });

  it('serves cursor-paginated commits', async () => {
    const first = await fetch(`${baseUrl}/repos/${repoId}/commits?limit=2`).then((r) => r.json());
    assert.equal(first.commits.length, 2);
    assert.equal(typeof first.next_cursor, 'string');
    assert.equal(first.commits[0].short_sha.length, 7);

    const second = await fetch(
      `${baseUrl}/repos/${repoId}/commits?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`
    ).then((r) => r.json());
    assert.equal(second.commits.length, 1);
    assert.equal(second.next_cursor, null);

    const shas = [...first.commits, ...second.commits].map((commit) => commit.sha);
    assert.equal(new Set(shas).size, 3);
  });

  it('serves commit detail, files and rename-aware file history', async () => {
    const commits = await fetch(`${baseUrl}/repos/${repoId}/commits?limit=1`).then((r) => r.json());
    const sha = commits.commits[0].sha;

    const detail = await fetch(`${baseUrl}/repos/${repoId}/commits/${sha}`).then((r) => r.json());
    assert.equal(detail.sha, sha);
    assert.ok(Array.isArray(detail.files));

    const files = await fetch(`${baseUrl}/repos/${repoId}/files`).then((r) => r.json());
    assert.ok(files.some((entry) => entry.path === 'src/core/a.js'));
    assert.ok(!files.some((entry) => entry.path === 'package-lock.json'));

    // Encoded path, exactly how the frontend sends it.
    const encoded = encodeURIComponent('src/core/a.js');
    const history = await fetch(`${baseUrl}/repos/${repoId}/files/${encoded}/history`).then((r) => r.json());
    assert.equal(history.path, 'src/core/a.js');
    assert.equal(history.entries.length, 3);
    assert.equal(history.history_complete, true);
    assert.ok(history.entries.some((entry) => entry.old_path === 'src/a.js'));

    // Unencoded path also works (regex fallback).
    const plain = await fetch(`${baseUrl}/repos/${repoId}/files/src/core/a.js/history`).then((r) => r.json());
    assert.equal(plain.path, 'src/core/a.js');
  });

  it('serves dashboard metrics with honest labels', async () => {
    const churn = await fetch(`${baseUrl}/repos/${repoId}/metrics/churn`).then((r) => r.json());
    assert.equal(churn.repo.commit_count, 3);
    assert.equal(churn.repo.author_count, 1);
    assert.equal(churn.merge_commits_counted, false);
    assert.ok(churn.ignored_patterns.includes('package-lock.json'));
    assert.ok(!churn.top_files.some((entry) => entry.path === 'package-lock.json'));
    assert.equal(churn.churn_over_time.length, 1);

    const bus = await fetch(`${baseUrl}/repos/${repoId}/metrics/bus-factor`).then((r) => r.json());
    assert.equal(bus.score, 1);
    assert.equal(bus.label, 'estimate (concentration of commits)');
    assert.ok(bus.modules.length > 0);

    const ttm = await fetch(`${baseUrl}/repos/${repoId}/metrics/time-to-merge`).then((r) => r.json());
    assert.equal(ttm.merge_count, 0);
  });

  it('downloads JSON and CSV exports', async () => {
    const jsonResponse = await fetch(`${baseUrl}/repos/${repoId}/export?format=json`);
    assert.equal(jsonResponse.status, 200);
    assert.match(jsonResponse.headers.get('content-type'), /application\/json/);
    const payload = await jsonResponse.json();
    assert.equal(payload.repository.repo_id, repoId);
    assert.equal(payload.churn.repo.commit_count, 3);

    const csvResponse = await fetch(`${baseUrl}/repos/${repoId}/export?format=csv`);
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
    const csv = await csvResponse.text();
    assert.equal(csv.split('\n')[0], 'path,churn_commits,churn_lines,last_touch_at');
  });

  it('returns 404 for unknown repositories and commits', async () => {
    const repo = await fetch(`${baseUrl}/repos/nope/commits`);
    assert.equal(repo.status, 404);

    const commit = await fetch(`${baseUrl}/repos/${repoId}/commits/deadbeef`);
    assert.equal(commit.status, 404);
  });
});
