'use strict';

const { getPool, closePool } = require('./config/database');
const { runMigrations } = require('./db/migrate');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const pool = getPool();

  if (process.env.GITVIZ_AUTO_MIGRATE !== 'false') {
    const applied = await runMigrations(pool);
    if (applied.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[db] applied migrations: ${applied.join(', ')}`);
    }
  }

  const app = createApp({ pool });
  const server = app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] GitViz data API listening on http://${HOST}:${PORT}`);
  });

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Do not hang forever on keep-alive connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[api] failed to start:', error);
  process.exit(1);
});
