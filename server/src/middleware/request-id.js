const crypto = require('crypto');
const logger = require('../lib/logger');

/**
 * Attaches a request ID to every request (honoring an inbound
 * X-Request-Id header) and logs a structured line per request.
 */
module.exports = function requestId(req, res, next) {
    req.id = req.get('x-request-id') || crypto.randomUUID();
    res.set('X-Request-Id', req.id);

    const start = Date.now();
    res.on('finish', () => {
        logger.info('request', {
            reqId: req.id,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - start
        });
    });

    next();
};
