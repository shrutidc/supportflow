const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const env = require('./config/env');
const requestId = require('./middleware/request-id');
const errorHandler = require('./middleware/error-handler');
const ticketsRouter = require('./routes/tickets.routes');

/**
 * Builds the Express app without binding a port or touching the
 * database, so tests can exercise it with supertest.
 */
function createApp() {
    const app = express();

    // Security headers. CSP stays off until the legacy frontend's inline
    // event handlers are removed in the Next.js migration (Phase 2).
    app.use(helmet({ contentSecurityPolicy: false }));

    // CORS: the frontend is served same-origin by this server, so no
    // cross-origin access is allowed unless CORS_ORIGINS is configured.
    app.use(cors({ origin: env.corsOrigins.length > 0 ? env.corsOrigins : false }));

    app.use(express.json({ limit: '100kb' }));
    app.use(requestId);

    // Serve the static frontend from the repository root.
    app.use(express.static(path.join(__dirname, '..', '..')));

    // Rate limit the API (not static assets). Generous ceiling: this
    // protects against abuse, not normal agent usage.
    if (!env.isTest) {
        app.use(
            '/api',
            rateLimit({
                windowMs: 60 * 1000,
                limit: 300,
                standardHeaders: 'draft-8',
                legacyHeaders: false,
                message: { error: 'Too many requests, please slow down' }
            })
        );
    }

    app.use('/api/tickets', ticketsRouter);

    // JSON 404 for unknown API routes (static handler covers the rest).
    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.use(errorHandler);

    return app;
}

module.exports = createApp;
