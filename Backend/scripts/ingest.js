'use strict';

/**
 * Ingest a repository without the HTTP API.
 *
 *   npm run ingest -- /path/to/repo
 *   npm run ingest -- parsed-rows.json
 *   cat parsed-rows.json | npm run ingest -- -
 *
 * A JSON file must match the P1 -> P2 handoff contract in docs/schema.md.
 * Anything else is treated as a local repo path and parsed by the temporary
 * git adapter (src/services/git-log.js) until P1 lands.
 */

const fs = require('node:fs');
const { getPool, closePool } = require('../src/config/database');
const { runMigrations } = require('../src/db/migrate');
const { ingestParsedRepo } = require('../src/db/ingest');
const { parseGitRepository } = require('../src/services/git-log');

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value.startsWith('--')) {
      const [key, inline] = value.slice(2).split('=');
      if (inline !== undefined) {
        flags[key] = inline;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1];
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(value);
    }
  }
  return { positionals, flags };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function loadPayload(source) {
  if (source === '-') {
    return JSON.parse(await readStdin());
  }
  if (source.toLowerCase().endsWith('.json')) {
    return JSON.parse(fs.readFileSync(source, 'utf8'));
  }
  return parseGitRepository(source, {
    onProgress: (pct) => {
      if (pct === 100) console.log('  git log parsed');
    },
  });
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const source = positionals[0];
  if (!source) {
    console.error('Usage: npm run ingest -- <repo-path | parsed-rows.json | ->');
    process.exit(1);
  }

  const pool = getPool();
  try {
    await runMigrations(pool);

    const startedAt = Date.now();
    console.log(`Reading ${source} ...`);
    const payload = await loadPayload(source);
    const parsedAt = Date.now();

    const batchSize = Number(flags['batch-size'] || process.env.INGEST_BATCH_SIZE || 1000);
    const result = await ingestParsedRepo(pool, payload, {
      batchSize,
      onProgress: (pct) => {
        if (pct === 100) return;
        if (pct % 10 === 0) process.stdout.write(`  ${pct}% `);
      },
    });
    const finishedAt = Date.now();

    console.log('');
    console.log(`Repo:        ${result.repoId}`);
    console.log(`Commits:     ${result.commitCount}`);
    console.log(`Authors:     ${result.authorCount}`);
    console.log(`File rows:   ${result.fileChangeCount}`);
    console.log(`Files:       ${result.fileCount}`);
    console.log(`Merge count: ${result.mergeCommitsCounted ? 'yes' : 'no (churn excludes merges)'}`);
    console.log(`Parse:       ${((parsedAt - startedAt) / 1000).toFixed(2)}s`);
    console.log(`Insert:      ${((finishedAt - parsedAt) / 1000).toFixed(2)}s`);
    console.log(`Total:       ${((finishedAt - startedAt) / 1000).toFixed(2)}s`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
