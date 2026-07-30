/**
 * Vercel serverless entry point for the Express API.
 *
 * This is a thin adapter, not a second application. An Express app is already
 * a `(req, res)` handler, and `createApp()` deliberately does not bind a port,
 * so the same app object serves local `node server.js`, Docker, tests, and
 * this function without modification.
 *
 * The app is built once at module scope so warm invocations skip assembly;
 * only the database connection is awaited per request, and that is itself
 * cached (see src/db/connect.js).
 *
 * Deployed with Vercel "Root Directory" set to `server/`, so dependencies come
 * from server/package.json rather than needing a duplicate manifest at the
 * repo root.
 */
const createApp = require('../src/app');
const { connectDatabase } = require('../src/db/connect');
const logger = require('../src/lib/logger');

const app = createApp();

module.exports = async function handler(req, res) {
    try {
        await connectDatabase();
    } catch (err) {
        // An unreachable database is an infrastructure fault, not a bug in the
        // request. Mirrors how the central error handler classifies it, since
        // this failure happens before Express is reached.
        logger.error('database connection failed', { error: err.message });
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        return res.end(
            JSON.stringify({
                error: 'Database is unavailable. Check the connection string and network access.'
            })
        );
    }

    return app(req, res);
};
