const logger = require('../lib/logger');

/**
 * Central error handler. Keeps the existing wire contract:
 * every error response is { error: <message> }.
 */
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
    const status = err.status || 500;
    const message = status >= 500 ? 'Internal server error' : err.message;

    if (status >= 500) {
        logger.error('unhandled error', {
            reqId: req.id,
            method: req.method,
            path: req.path,
            error: err.message,
            stack: err.stack
        });
    }

    res.status(status).json({ error: message });
};
