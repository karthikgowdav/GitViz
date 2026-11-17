'use strict';

require('dotenv').config();

const { getPool, closePool } = require('./config/database');
const { runMigrations } = require('./db/migrate');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
    const pool = getPool();

    // Run pending database migrations before starting the API.
    if (process.env.GITVIZ_AUTO_MIGRATE !== 'false') {
        const applied = await runMigrations(pool);

        if (applied.length > 0) {
            console.log(`[db] applied migrations: ${applied.join(', ')}`);
        }
    }

    // Create Express application.
    const app = createApp({ pool });

    // Start HTTP server.
    const server = app.listen(PORT, HOST, () => {
        console.log(`[api] GitViz backend listening on http://${HOST}:${PORT}`);
    });

    // Graceful shutdown.
    const shutdown = async (signal) => {
        console.log(`[api] ${signal} received, shutting down`);

        server.close(async () => {
            try {
                await closePool();
                process.exit(0);
            } catch (error) {
                console.error('[api] shutdown error:', error.message);
                process.exit(1);
            }
        });

        // Prevent shutdown from hanging indefinitely.
        setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
    console.error('[api] failed to start:', error);
    process.exit(1);
});