'use strict';

/**
 * Test helper: start a throwaway PostgreSQL cluster when TEST_DATABASE_URL is
 * not provided. This keeps `npm test` green on a machine with Postgres binaries
 * and never touches a developer's real database.
 *
 * In CI, set TEST_DATABASE_URL to a disposable database instead.
 */

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPool } = require('../../src/config/database');

let clusterDir = null;
let clusterPort = null;
let ownedCluster = false;
let pool = null;
let started = false;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error('Could not allocate port'))));
    });
  });
}

function stopCluster() {
  if (!ownedCluster || !clusterDir) return;
  spawnSync('pg_ctl', ['-D', clusterDir, '-m', 'immediate', 'stop'], { encoding: 'utf8' });
  fs.rmSync(clusterDir, { recursive: true, force: true });
  clusterDir = null;
  ownedCluster = false;
}

async function startCluster() {
  if (started) return;
  started = true;

  if (process.env.TEST_DATABASE_URL) return;

  clusterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitviz-pg-'));
  clusterPort = await findFreePort();

  const init = spawnSync(
    'initdb',
    ['-D', clusterDir, '-U', 'postgres', '--auth=trust', '--no-sync', '-E', 'UTF8'],
    { encoding: 'utf8' }
  );
  if (init.status !== 0) {
    throw new Error(`initdb failed (is PostgreSQL installed?): ${init.stderr || init.stdout}`);
  }

  const logPath = path.join(clusterDir, 'postgres.log');
  const start = spawnSync(
    'pg_ctl',
    [
      '-D',
      clusterDir,
      '-l',
      logPath,
      '-o',
      `-p ${clusterPort} -k ${clusterDir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
      '-w',
      'start',
    ],
    { encoding: 'utf8' }
  );
  if (start.status !== 0) {
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    throw new Error(`pg_ctl failed: ${start.stderr || start.stdout}\n${log}`);
  }

  ownedCluster = true;
  process.once('exit', stopCluster);

  const admin = createPool({
    connectionString: `postgres://postgres@127.0.0.1:${clusterPort}/postgres`,
    max: 1,
  });
  try {
    await admin.query('CREATE DATABASE gitviz_test');
  } finally {
    await admin.end();
  }
}

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!clusterPort) throw new Error('Test cluster is not running');
  return `postgres://postgres@127.0.0.1:${clusterPort}/gitviz_test`;
}

async function getTestPool() {
  await startCluster();
  if (!pool) {
    pool = createPool({ connectionString: testDatabaseUrl(), max: 5 });
  }
  return pool;
}

async function resetDatabase(testPool) {
  await testPool.query('TRUNCATE repos CASCADE');
}

async function destroyTestPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  stopCluster();
}

module.exports = { getTestPool, resetDatabase, destroyTestPool, testDatabaseUrl };
