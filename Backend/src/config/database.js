'use strict';

const path = require('node:path');
require('dotenv').config({
    path: process.env.GITVIZ_ENV_FILE || path.resolve(__dirname, '..', '..', '.env'),
});

const { Pool, types } = require('pg');

// Convert PostgreSQL numeric types into JavaScript numbers.
types.setTypeParser(20, value => (value === null ? null : Number(value)));
types.setTypeParser(1700, value => (value === null ? null : Number(value)));

let defaultPool = null;

// Creates a PostgreSQL connection pool.
function createPool(options = {}) {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL || undefined,
        ssl: process.env.DATABASE_URL
            ? { rejectUnauthorized: false }
            : undefined,
        max: Number(process.env.PGPOOL_MAX || 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS || 5000),
        ...options,
    });

    pool.on('connect', () => {
        console.log('[db] Connected to PostgreSQL');
    });

    pool.on('error', error => {
        console.error('[db] Idle client error:', error.message);
    });

    return pool;
}

// Returns the default shared connection pool.
function getPool() {
    if (!defaultPool) {
        defaultPool = createPool();
    }

    return defaultPool;
}

// Closes the database connection pool.
async function closePool() {
    if (defaultPool) {
        await defaultPool.end();
        defaultPool = null;
    }
}

module.exports = {
    createPool,
    getPool,
    closePool,
};