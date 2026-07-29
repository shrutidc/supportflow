const logger = require('../lib/logger');

/**
 * Central error handler. Every error response is `{ error: <message> }`.
 *
 * Infrastructure faults are separated from application bugs. A database the
 * API cannot reach is not an "Internal server error" — it is a dependency
 * being down, which is a 503 and should say so plainly. Collapsing the two
 * into one opaque 500 turns an obvious operational problem into a debugging
 * session through stack traces.
 */

/** Mongoose/MongoDB errors that mean "the database is unreachable". */
const UNAVAILABLE_ERRORS = new Set([
    'MongoServerSelectionError',
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoTimeoutError'
]);

/**
 * Clerk rejects a malformed key on every request rather than at startup, so
 * a typo'd or placeholder key produces a green /healthz and a blanket 500.
 * env.js catches a *missing* key at boot; only an unparseable one reaches
 * here. Either way it is a deployment misconfiguration, not a code defect,
 * and saying so beats an opaque 500. Matched on message because the SDK
 * throws a plain Error.
 */
const CLERK_KEY_ERROR = /(publishable|secret) key (is missing|not valid)/i;

function classify(err) {
    if (err.status) {
        return { status: err.status, message: err.message };
    }
    if (UNAVAILABLE_ERRORS.has(err.name)) {
        return {
            status: 503,
            message: 'Database is unavailable. Check the connection string and network access.'
        };
    }
    if (typeof err.message === 'string' && CLERK_KEY_ERROR.test(err.message)) {
        // Deliberately does not echo err.message — it would not leak a key,
        // but the response is public and the detail belongs in the log.
        return {
            status: 503,
            message:
                'Authentication is misconfigured. Check CLERK_SECRET_KEY and ' +
                'CLERK_PUBLISHABLE_KEY on the server.'
        };
    }
    return { status: 500, message: 'Internal server error' };
}

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
    const { status, message } = classify(err);

    if (status >= 500) {
        logger.error(status === 503 ? 'dependency unavailable' : 'unhandled error', {
            reqId: req.id,
            method: req.method,
            path: req.path,
            errorName: err.name,
            error: err.message,
            // A stack for an unreachable database is noise — the name says it all.
            stack: status === 503 ? undefined : err.stack
        });
    }

    res.status(status).json({ error: message });
};
