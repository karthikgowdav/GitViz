'use strict';

/**
 * PostgreSQL connection for the GitViz data layer.
 *
 * Uses DATABASE_URL when set, otherwise node-postgres' standard PG* env vars.
 * bigint/numeric are parsed to JS numbers because every counter we serve is
 * well below Number.MAX_SAFE_INTEGER and JSON.stringify cannot serialize BigInt.
 */

require('dotenv').config({
  path: process.env.GITVIZ_ENV_FILE || require('node:path').resolve(__dirname, '..', '..', '.env'),
});

const { Pool, types } = require('pg');

types.setTypeParser(20, (value) => (value === null ? null : Number(value))); // int8
types.setTypeParser(1700, (value) => (value === null ? null : Number(value))); // numeric

let defaultPool = null;

function createPool(options = {}) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS || 5_000),
    ...options,
  });

  // A pool error must not take the process down (e.g. Postgres restarted).
  pool.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('[db] idle client error:', error.message);
  });

  return pool;
}

function getPool() {
  if (!defaultPool) {
    defaultPool = createPool();
  }
  return defaultPool;
}

async function closePool() {
  if (defaultPool) {
    await defaultPool.end();
    defaultPool = null;
  }
}

module.exports = { createPool, getPool, closePool };
