const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { clerkMiddleware } = require('@clerk/express');

const env = require('./config/env');
const requestId = require('./middleware/request-id');
const errorHandler = require('./middleware/error-handler');
const apiToken = require('./middleware/api-token');
const { requireAuth } = require('./middleware/auth');
const ticketsRouter = require('./routes/tickets.routes');
const analyticsRouter = require('./routes/analytics.routes');
const aiRouter = require('./routes/ai.routes');

/**
 * Builds the Express app without binding a port or touching the database,
 * so tests can exercise it with supertest.
 *
 * `authMiddleware` is an injection point for tests, which supply a stub
 * session instead of standing up real Clerk infrastructure. It is not a
 * production bypass: callers that pass nothing get real Clerk verification,
 * and nothing reads an environment variable to disable authentication.
 */
function createApp({ authMiddleware } = {}) {
    const app = express();

    // Behind a reverse proxy (Railway, etc.) trust X-Forwarded-For so rate
    // limiting sees real client IPs.
    if (env.trustProxy) {
        app.set('trust proxy', 1);
    }

    // Security headers, including CSP.
    app.use(helmet());

    // CORS: closed by default. The Next.js frontend calls this API through
    // its own server-side proxy, so it is same-origin from the browser's
    // point of view and needs no entry here.
    app.use(cors({ origin: env.corsOrigins.length > 0 ? env.corsOrigins : false }));

    app.use(express.json({ limit: '100kb' }));
    app.use(requestId);

    // Rate limit the API. Generous ceiling: this protects against abuse,
    // not normal agent usage.
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

    // Optional shared-secret gate (API_TOKEN env, sent as X-Api-Token).
    // Must stay ahead of Clerk and must not read Authorization — see
    // middleware/api-token.js.
    app.use('/api', apiToken);

    // Authentication. Clerk parses and verifies the session token; requireAuth
    // then insists on a signed-in user with an active organization and builds
    // req.auth. Everything below this line is tenant-scoped.
    if (authMiddleware) {
        app.use('/api', authMiddleware);
    } else {
        app.use('/api', clerkMiddleware(), requireAuth);
    }

    app.use('/api/tickets', ticketsRouter);
    app.use('/api/analytics', analyticsRouter);
    app.use('/api/ai', aiRouter);

    // JSON 404 for unknown API routes.
    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    // Health check, deliberately outside /api so it needs no credentials.
    app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

    app.use(errorHandler);

    return app;
}

module.exports = createApp;
