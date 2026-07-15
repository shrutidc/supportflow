const crypto = require('crypto');
const env = require('../config/env');

/**
 * Optional bearer-token gate for /api. A stopgap for exposed deployments
 * until real authentication (Clerk, Phase 3) replaces it: when API_TOKEN
 * is unset (local development) every request passes through.
 */
function timingSafeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = function apiToken(req, res, next) {
    if (!env.apiToken) return next();

    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token || !timingSafeEqual(token, env.apiToken)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
};
