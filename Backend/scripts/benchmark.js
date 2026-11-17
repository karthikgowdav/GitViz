'use strict';

/**
 * Measure, don't claim. This script records the numbers P4 is allowed to put
 * on a slide for one repository.
 *
 *   npm run bench -- /path/to/repo
 *
 * It migrates, parses, bulk-inserts, then times the dashboard/file queries.
 * The 50k-commit benchmark repo is P2's W7 job; this makes the measurement
 * repeatable by anyone.
 */

const { getPool, closePool } = require('../src/config/database');
const { runMigrations } = require('../src/db/migrate');
const { parseGitRepository } = require('../src/services/git-log');
const { ingestParsedRepo } = require('../src/db/ingest');
const { resolveRepo } = require('../src/db/queries/repos');
const { listCommits, getFileHistory, listFiles } = require('../src/db/queries/commits');
const { getChurn, getBusFactor, getTimeToMerge } = require('../src/db/queries/metrics');

async function time(label, fn) {
  const startedAt = process.hrtime.bigint();
  const value = await fn();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return { label, elapsedMs, value };
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('Usage: npm run bench -- <repo-path>');
    process.exit(1);
  }

  const pool = getPool();
  try {
    await runMigrations(pool);

    const parse = await time('git log parse', () => parseGitRepository(source));
    const parsed = parse.value;
    console.log(`commits parsed: ${parsed.commits.length}`);

    const sourcePath = parsed.repo.path;
    const ingest = await time('bulk insert + metrics', () => ingestParsedRepo(pool, parsed));
    const repo = await resolveRepo(pool, ingest.value.repoId);

    const fileList = await time('GET files', () => listFiles(pool, repo.id));
    const firstFile = fileList.value[0]?.path;

    const results = [
      parse,
      ingest,
      fileList,
      await time('GET commits (50)', () => listCommits(pool, repo.id, { limit: 50 })),
      await time('GET churn', () => getChurn(pool, repo.id)),
      await time('GET bus-factor', () => getBusFactor(pool, repo.id)),
      await time('GET time-to-merge', () => getTimeToMerge(pool, repo.id)),
    ];

    if (firstFile) {
      results.push(
        await time(`GET file history (${firstFile})`, () => getFileHistory(pool, repo.id, firstFile))
      );
    }

    console.log('');
    console.log('Measurement (this machine, this run):');
    for (const result of results) {
      console.log(`  ${result.label.padEnd(38)} ${result.elapsedMs.toFixed(0).padStart(8)} ms`);
    }
    console.log('');
    console.log(`Repo id: ${repo.id}`);
    console.log(`Commits: ${ingest.value.commitCount}`);
    console.log(`File rows: ${ingest.value.fileChangeCount}`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
