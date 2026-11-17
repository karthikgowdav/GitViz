'use strict';

/**
 * Plain-SQL migration runner (W1 choice: no extra migration framework).
 *
 * Every file in db/migrations matching NNN_name.sql runs once, in filename
 * order, inside its own transaction and is recorded in schema_migrations.
 * The file format is intentionally dbmate-compatible-ish: plain SQL only.
 */

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'db', 'migrations');
const ADVISORY_LOCK_KEY = 847231;

function listMigrationFiles(directory = MIGRATIONS_DIR) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function runMigrations(pool, { directory = MIGRATIONS_DIR } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureMigrationTable(client);

    const existing = await client.query('SELECT version FROM schema_migrations');
    const done = new Set(existing.rows.map((row) => row.version));

    for (const file of listMigrationFiles(directory)) {
      if (done.has(file)) continue;

      const sql = fs.readFileSync(path.join(directory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
    }

    return applied;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      // Connection may already be broken; pool will discard it.
    }
    client.release();
  }
}

module.exports = { runMigrations, listMigrationFiles, MIGRATIONS_DIR };
