'use strict';

/**
 * Express application for the P2 data API.
 *
 * P1's final app can import createApp() and mount its own routes beside this
 * router, or copy src/routes/data.routes.js into api/src/routes/. The point of
 * this file is that the frozen frontend contract is served from Postgres today,
 * with no dependency on unfinished git endpoints.
 */

const express = require('express');
const cors = require('cors');

const dataRouter = require('./routes/data.routes');
const { getPool } = require('./config/database');

function corsOptions() {
  const configured = process.env.CORS_ORIGIN || '*';
  if (configured === '*') return { origin: true };
  return { origin: configured.split(',').map((value) => value.trim()).filter(Boolean) };
}

function createApp({ pool = getPool() } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.locals.pool = pool;
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/v1/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch (error) {
      res.status(503).json({ status: 'error', db: 'unavailable', message: error.message });
    }
  });

  app.use('/api/v1', dataRouter);

  app.use((req, res) => {
    res.status(404).json({ message: `Not found: ${req.method} ${req.originalUrl}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = Number(error.status) || 500;
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error('[api]', error.stack || error.message);
    }
    res.status(status).json({ message: error.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
