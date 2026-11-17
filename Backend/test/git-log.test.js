'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  parseGitRepository,
  parseNumstatPath,
  validateRepoPath,
} = require('../src/services/git-log');

const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitviz-gitlog-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('dev git adapter', () => {
  it('parses an empty repository as zero commits instead of failing', async () => {
    const dir = tempDir();
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    const parsed = await parseGitRepository(dir);
    assert.equal(parsed.commits.length, 0);
    assert.equal(parsed.repo.path, fs.realpathSync(dir));
    assert.equal(parsed.repo.default_branch, 'main');
  });

  it('parses rename path notation, including the empty-side form', () => {
    assert.deepEqual(parseNumstatPath('src/{a.js => core/a.js}'), {
      path: 'src/core/a.js',
      old_path: 'src/a.js',
    });
    assert.deepEqual(parseNumstatPath('src/{ => core}/a.js'), {
      path: 'src/core/a.js',
      old_path: 'src/a.js',
    });
    assert.deepEqual(parseNumstatPath('docs/{old => new}/file.md'), {
      path: 'docs/new/file.md',
      old_path: 'docs/old/file.md',
    });
    assert.deepEqual(parseNumstatPath('src/plain.ts'), {
      path: 'src/plain.ts',
      old_path: null,
    });
  });

  it('rejects non-repositories with a 400-class error', async () => {
    const dir = tempDir();
    await assert.rejects(() => validateRepoPath(dir), (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /not found|not a Git repository/i);
      return true;
    });
  });
});
