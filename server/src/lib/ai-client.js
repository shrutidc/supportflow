const env = require('../config/env');
const HttpError = require('./http-error');
const logger = require('./logger');

/**
 * HTTP client for the AI service.
 *
 * The only place in this codebase that knows the AI service exists. It sends
 * ticket content and gets structured JSON back — it never sends a ticket id or
 * an organization id, because the AI service has no database and nothing to
 * look them up in.
 */

/**
 * Beyond this the agent has given up anyway; failing fast beats a hung request.
 *
 * Must stay below `maxDuration` in vercel.json (60s). If the platform limit is
 * the lower of the two it kills the function first, and the caller gets a
 * generic platform error instead of the 503 this client raises deliberately —
 * which is exactly what a 30s function limit produced. AI calls run ~10-22s
 * including a cold start, so this leaves real margin on both sides.
 */
const TIMEOUT_MS = 45_000;

async function analyze(feature, payload, requestId) {
    if (!env.aiServiceUrl) {
        // A missing AI service is a configuration state, not a crash. The
        // ticket workspace keeps working; only the AI panel reports it.
        throw new HttpError(503, 'AI service is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const headers = { 'Content-Type': 'application/json' };
    // Propagated so a trace spans both services.
    if (requestId) headers['X-Request-Id'] = requestId;
    if (env.aiInternalToken) headers['X-Internal-Token'] = env.aiInternalToken;

    let response;
    try {
        response = await fetch(`${env.aiServiceUrl}/v1/${feature}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } catch (err) {
        const timedOut = err.name === 'AbortError';
        logger.error('ai service unreachable', { feature, error: err.message, timedOut });
        throw new HttpError(503, timedOut ? 'AI service timed out' : 'AI service is unavailable');
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        logger.error('ai service error', {
            feature,
            status: response.status,
            // Truncated: the body can echo ticket content back.
            detail: detail.slice(0, 200)
        });
        // Upstream faults stay 503 — the client should offer a retry, not
        // treat it as a bad request it could fix.
        throw new HttpError(503, 'AI service could not complete the request');
    }

    return response.json();
}

module.exports = { analyze };
