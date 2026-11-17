'use strict';

const { getPool, closePool } = require('../src/config/database');
const { runMigrations } = require('../src/db/migrate');

async function main() {
  const pool = getPool();
  try {
    const applied = await runMigrations(pool);
    if (applied.length === 0) {
      console.log('Database is up to date.');
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const file of applied) console.log(`  - ${file}`);
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
