'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  parseGitRepository,
  validateRepoPath,
  isGeneratedFile,
  parseNumstatToken,
} = require('../src/services/git_reader');

const tempDirs = [];

function tempRepo() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gitviz-reader-')
  );

  tempDirs.push(dir);

  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'GitViz Test']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@gitviz.local']);

  return dir;
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
  });
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message, '--quiet']);
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Git reader', () => {
  it('parses an empty repository', async () => {
    const dir = tempRepo();

    const result = await parseGitRepository(dir);

    assert.equal(result.commits.length, 0);
    assert.equal(result.repo.name, path.basename(dir));
    assert.equal(result.repo.default_branch, 'main');
  });

  it('extracts commit metadata and file changes', async () => {
    const dir = tempRepo();

    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log("hello");\n');
    commit(dir, 'Add application file');

    const result = await parseGitRepository(dir);
    const firstCommit = result.commits[0];

    assert.equal(result.commits.length, 1);
    assert.match(firstCommit.sha, /^[a-f0-9]{40,64}$/);
    assert.equal(firstCommit.message, 'Add application file');
    assert.equal(firstCommit.author.name, 'GitViz Test');
    assert.equal(firstCommit.author.email, 'test@gitviz.local');
    assert.equal(firstCommit.parents.length, 0);
    assert.equal(firstCommit.is_merge, false);

    assert.equal(firstCommit.files.length, 1);
    assert.equal(firstCommit.files[0].path, 'src/app.js');
    assert.equal(firstCommit.files[0].additions, 1);
    assert.equal(firstCommit.files[0].deletions, 0);
  });

  it('preserves filenames containing spaces and Unicode', async () => {
    const dir = tempRepo();

    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'hello world.js'),
      'console.log("hello");\n'
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'café.js'),
      'console.log("bonjour");\n'
    );

    commit(dir, 'Add unusual filenames');

    const result = await parseGitRepository(dir);
    const paths = result.commits[0].files.map(file => file.path);

    assert.ok(paths.includes('src/hello world.js'));
    assert.ok(paths.includes('src/café.js'));
  });

  it('detects binary files', async () => {
    const dir = tempRepo();

    fs.writeFileSync(
      path.join(dir, 'image.png'),
      Buffer.from([0, 1, 2, 3, 255, 254])
    );

    commit(dir, 'Add binary image');

    const result = await parseGitRepository(dir);
    const file = result.commits[0].files[0];

    assert.equal(file.path, 'image.png');
    assert.equal(file.is_binary, true);
    assert.equal(file.additions, 0);
    assert.equal(file.deletions, 0);
  });

  it('detects pure file renames', async () => {
    const dir = tempRepo();

    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'old.js'),
      'const value = 123;\n'
    );
    commit(dir, 'Add original file');

    fs.renameSync(
      path.join(dir, 'src', 'old.js'),
      path.join(dir, 'src', 'new.js')
    );
    commit(dir, 'Rename file');

    const result = await parseGitRepository(dir);
    const renameCommit = result.commits[0];
    const renamedFile = renameCommit.files.find(
      file => file.path === 'src/new.js'
    );

    assert.ok(renamedFile);
    assert.equal(renamedFile.old_path, 'src/old.js');
  });

  it('does not invent rename relationships when Git cannot detect them', async () => {
    const dir = tempRepo();

    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'old.js'),
      'old content\n'
    );
    commit(dir, 'Add original file');

    fs.unlinkSync(path.join(dir, 'src', 'old.js'));
    fs.writeFileSync(
      path.join(dir, 'src', 'new.js'),
      'completely different content\nline two\nline three\n'
    );
    commit(dir, 'Replace file');

    const result = await parseGitRepository(dir);
    const files = result.commits[0].files;

    assert.ok(files.some(
      file => file.path === 'src/new.js' && file.old_path === null
    ));

    assert.ok(files.some(
      file => file.path === 'src/old.js' && file.old_path === null
    ));
  });

  it('extracts merge commits and their parents', async () => {
    const dir = tempRepo();

    fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
    commit(dir, 'Initial commit');

    git(dir, ['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
    commit(dir, 'Feature commit');

    git(dir, ['checkout', 'main']);
    fs.writeFileSync(path.join(dir, 'main.txt'), 'main\n');
    commit(dir, 'Main commit');

    git(dir, [
      'merge',
      '--no-ff',
      'feature',
      '-m',
      'Merge feature',
    ]);

    const result = await parseGitRepository(dir);
    const mergeCommit = result.commits.find(
      item => item.message === 'Merge feature'
    );

    assert.ok(mergeCommit);
    assert.equal(mergeCommit.parents.length, 2);
    assert.equal(mergeCommit.is_merge, true);
  });

  it('identifies generated files', () => {
    assert.equal(isGeneratedFile('package-lock.json'), true);
    assert.equal(isGeneratedFile('dist/app.js'), true);
    assert.equal(isGeneratedFile('src/app.js'), false);
  });

it('parses normal and binary numstat tokens', () => {
    assert.deepEqual(
        parseNumstatToken('5\t2\tsrc/app.js'),
        {
            isRename: false,
            file: {
                path: 'src/app.js',
                old_path: null,
                additions: 5,
                deletions: 2,
                is_binary: false,
                is_generated: false,
            },
        }
    );

    assert.deepEqual(
        parseNumstatToken('-\t-\timage.png'),
        {
            isRename: false,
            file: {
                path: 'image.png',
                old_path: null,
                additions: 0,
                deletions: 0,
                is_binary: true,
                is_generated: false,
            },
        }
    );
});

  it('rejects paths that are not Git repositories', async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gitviz-invalid-')
    );

    tempDirs.push(dir);

    await assert.rejects(
      () => validateRepoPath(dir),
      error => {
        assert.equal(error.status, 400);
        return true;
      }
    );
  });
});