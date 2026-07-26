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
