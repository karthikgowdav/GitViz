'use strict';

/**
 * Rebuild derived metrics for one repository.
 *
 *   npm run recompute -- <repo-id | repo-name | repo-path>
 *
 * Needed after changing the merge policy in config/ignore-list.json. Ignore-list
 * edits do not need this: they are applied at read time.
 */

const { getPool, closePool } = require('../src/config/database');
const { resolveRepo } = require('../src/db/queries/repos');
const { recomputeMetrics } = require('../src/db/metrics-store');

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npm run recompute -- <repo-id | repo-name | repo-path>');
    process.exit(1);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const repo = await resolveRepo(client, target);
    if (!repo) {
      console.error(`Repository not found: ${target}`);
      process.exitCode = 1;
      return;
    }

    const startedAt = Date.now();
    await client.query('BEGIN');
    const totals = await recomputeMetrics(client, repo.id);
    await client.query('COMMIT');

    console.log(`Recomputed ${repo.name} (${repo.id})`);
    console.log(`  commits: ${totals.commit_count}`);
    console.log(`  authors: ${totals.author_count}`);
    console.log(`  files:   ${totals.file_count}`);
    console.log(`  took:    ${Date.now() - startedAt}ms`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
