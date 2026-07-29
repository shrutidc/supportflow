const crypto = require('crypto');
const env = require('../config/env');

/**
 * Optional shared-secret gate for /api — a perimeter in front of Clerk, not
 * a replacement for it. When API_TOKEN is unset (local development) every
 * request passes through.
 *
 * The secret travels in `X-Api-Token`, NOT in `Authorization`. Since Phase 3
 * the Authorization header belongs to Clerk: the Next.js proxy mints a
 * session JWT and puts it there. Reading the secret from Authorization —
 * which this middleware used to do — meant that switching API_TOKEN on in
 * production compared a Clerk JWT against the shared secret and rejected
 * every single request with 401.
 */
function timingSafeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = function apiToken(req, res, next) {
    if (!env.apiToken) return next();

    const token = req.get('x-api-token') || '';

    if (!token || !timingSafeEqual(token, env.apiToken)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
};
