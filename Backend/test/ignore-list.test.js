'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isIgnored, buildIgnoreClause } = require('../src/config/ignore-list');

describe('generated-file ignore list', () => {
  it('matches lockfiles, directories and globs at any depth', () => {
    assert.equal(isIgnored('package-lock.json'), true);
    assert.equal(isIgnored('web/package-lock.json'), true);
    assert.equal(isIgnored('node_modules/react/index.js'), true);
    assert.equal(isIgnored('packages/ui/dist/index.js'), true);
    assert.equal(isIgnored('assets/app.min.js'), true);
    assert.equal(isIgnored('src/app.ts'), false);
    assert.equal(isIgnored('distx/app.js'), false);
    assert.equal(isIgnored('lockfile-notes.md'), false);
  });

  it('builds a parameterised NOT predicate with stable placeholder offsets', () => {
    const clause = buildIgnoreClause('m.path', ['dist/', 'package-lock.json'], 3);
    assert.equal(clause.params.length, 2);
    assert.match(clause.sql, /^\s*NOT \(/);
    assert.match(clause.sql, /\$3/);
    assert.match(clause.sql, /\$4/);
    assert.ok(!clause.sql.includes('package-lock.json'));
  });

  it('returns TRUE when the list is empty', () => {
    assert.deepEqual(buildIgnoreClause('m.path', [], 1), { sql: 'TRUE', params: [] });
  });
});
