'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const dataRouter = require('./routes/data.routes');
const { getPool } = require('./config/database');

function corsOptions() {
    const configured = process.env.CORS_ORIGIN || '*';

    if (configured === '*') {
        return { origin: true };
    }

    return {
        origin: configured.split(',').map(value => value.trim()).filter(Boolean)
    };
}

function createApp({ pool = getPool() } = {}) {
    const app = express();

    app.disable('x-powered-by');

    app.locals.pool = pool;

    // Middleware
    app.use(cors(corsOptions()));
    app.use(express.json({ limit: '2mb' }));

    // Existing health check
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'success',
            message: 'GitViz Backend is running'
        });
    });

    // Existing database health check
    app.get('/health/db', async (req, res) => {
        try {
            const result = await pool.query('SELECT NOW()');

            res.status(200).json({
                status: 'success',
                message: 'Supabase database connected successfully',
                databaseTime: result.rows[0].now
            });
        } catch (error) {
            console.error('Database connection failed:', error.message);

            res.status(500).json({
                status: 'error',
                message: 'Database connection failed'
            });
        }
    });

    // P2 API health check
    app.get('/api/v1/health', async (req, res) => {
        try {
            await pool.query('SELECT 1');

            res.json({
                status: 'ok',
                db: 'ok'
            });
        } catch (error) {
            res.status(503).json({
                status: 'error',
                db: 'unavailable',
                message: error.message
            });
        }
    });

    // P2 Data API routes
    app.use('/api/v1', dataRouter);

    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            message: `Not found: ${req.method} ${req.originalUrl}`
        });
    });

    // Global error handler
    app.use((error, req, res, next) => {
        const status = Number(error.status) || 500;

        if (status >= 500) {
            console.error('[api]', error.stack || error.message);
        }

        res.status(status).json({
            message: error.message || 'Internal server error'
        });
    });

    return app;
}

module.exports = { createApp };