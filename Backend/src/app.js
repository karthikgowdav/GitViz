const express = require('express');
const cors = require('cors');
const pool = require('./config/database');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check API
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'GitViz Backend is running'
    });
});
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

module.exports = app;