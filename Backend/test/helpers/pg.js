'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createPool } = require('../../src/config/database');

const PG_BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const INITDB = path.join(PG_BIN, 'initdb.exe');
const PG_CTL = path.join(PG_BIN, 'pg_ctl.exe');

const pgEnv = {
  ...process.env,
  PATH: `${PG_BIN};${process.env.PATH || ''}`,
};

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

      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Could not allocate port'));
      });
    });
  });
}

function runPgCtl(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(PG_CTL, args, {
      env: pgEnv,
      windowsHide: true,
      stdio: 'ignore',
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`pg_ctl timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pg_ctl failed. Exit code: ${code}, signal: ${signal}`));
      }
    });
  });
}

function stopCluster() {
  if (!ownedCluster || !clusterDir) return;

  spawnSync(
    PG_CTL,
    ['-D', clusterDir, '-m', 'immediate', 'stop'],
    {
      env: pgEnv,
      encoding: 'utf8',
      stdio: 'ignore',
      timeout: 15000,
      windowsHide: true,
    }
  );

  fs.rmSync(clusterDir, { recursive: true, force: true });

  clusterDir = null;
  ownedCluster = false;
}

async function startCluster() {
  if (started) return;
  started = true;

  if (process.env.TEST_DATABASE_URL) return;

  clusterDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gitviz-pg-')
  );

  clusterPort = await findFreePort();

  console.log('[TEST DB] Initializing temporary PostgreSQL cluster...');

  const init = spawnSync(
    INITDB,
    [
      '-D', clusterDir,
      '-U', 'postgres',
      '--auth=trust',
      '--no-sync',
      '-E', 'UTF8',
    ],
    {
      env: pgEnv,
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    }
  );

  if (init.status !== 0) {
    throw new Error(
      `initdb failed: ${init.stderr || init.stdout || init.error?.message}`
    );
  }

  console.log('[TEST DB] initdb completed.');

  const logPath = path.join(clusterDir, 'postgres.log');

  console.log('[TEST DB] Starting temporary PostgreSQL server...');

  try {
    await runPgCtl(
      [
        '-D', clusterDir,
        '-l', logPath,
        '-o',
        `-p ${clusterPort} -k "${clusterDir}" -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
        '-w',
        'start',
      ],
      30000
    );
  } catch (error) {
    const log = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8')
      : '';

    throw new Error(`${error.message}\n${log}`);
  }

  ownedCluster = true;
  process.once('exit', stopCluster);

  console.log('[TEST DB] PostgreSQL server started.');

  const admin = createPool({
    connectionString: `postgres://postgres@127.0.0.1:${clusterPort}/postgres`,
    ssl: false,
    max: 1,
  });

  try {
    await admin.query('CREATE DATABASE gitviz_test');
    console.log('[TEST DB] Test database created successfully.');
  } finally {
    await admin.end();
  }
}

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  if (!clusterPort) {
    throw new Error('Test cluster is not running');
  }

  return `postgres://postgres@127.0.0.1:${clusterPort}/gitviz_test`;
}

async function getTestPool() {
  await startCluster();

  if (!pool) {
    pool = createPool({
      connectionString: testDatabaseUrl(),
      ssl: false,
      max: 5,
    });
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

module.exports = {
  getTestPool,
  resetDatabase,
  destroyTestPool,
  testDatabaseUrl,
};
