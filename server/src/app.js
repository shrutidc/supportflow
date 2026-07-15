const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const env = require('./config/env');
const requestId = require('./middleware/request-id');
const errorHandler = require('./middleware/error-handler');
const apiToken = require('./middleware/api-token');
const ticketsRouter = require('./routes/tickets.routes');

/**
 * Builds the Express app without binding a port or touching the
 * database, so tests can exercise it with supertest.
 */
function createApp() {
    const app = express();

    // Behind a reverse proxy (Railway, etc.) trust X-Forwarded-For so rate
    // limiting sees real client IPs.
    if (env.trustProxy) {
        app.set('trust proxy', 1);
    }

    // Security headers, including CSP. Helmet's default policy applies:
    // script-src 'self' (the legacy frontend's inline scripts/handlers were
    // extracted to external files), inline style attributes remain allowed.
    app.use(helmet());

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

    // Optional bearer-token gate (API_TOKEN env) — see middleware/api-token.js.
    app.use('/api', apiToken);

    app.use('/api/tickets', ticketsRouter);

    // JSON 404 for unknown API routes (static handler covers the rest).
    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.use(errorHandler);

    return app;
}

module.exports = createApp;
