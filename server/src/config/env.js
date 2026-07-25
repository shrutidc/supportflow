require('dotenv').config();

/**
 * Centralized, validated environment configuration.
 * Fail fast on invalid values instead of degrading silently.
 */
function loadEnv() {
    const nodeEnv = process.env.NODE_ENV || 'development';

    const port = parseInt(process.env.PORT || '3000', 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid PORT: "${process.env.PORT}" — must be an integer between 1 and 65535`);
    }

    const mongoUri = process.env.MONGODB_URI || '';

    // In production a real database is mandatory; the in-memory fallback
    // would silently discard all data on every restart.
    if (nodeEnv === 'production' && !mongoUri) {
        throw new Error('MONGODB_URI is required when NODE_ENV=production');
    }

    // Comma-separated list of allowed CORS origins.
    // Empty (default) = same-origin only; the frontend is served by this server.
    const corsOrigins = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    // Optional bearer token in front of /api, layered on top of Clerk auth.
    // Empty = not required (local development).
    const apiToken = process.env.API_TOKEN || '';

    // Clerk. The SDK reads CLERK_SECRET_KEY from the environment itself;
    // validating here means a misconfigured deployment fails at boot with a
    // clear message instead of 500ing on the first authenticated request.
    const clerkSecretKey = process.env.CLERK_SECRET_KEY || '';
    if (nodeEnv !== 'test' && !clerkSecretKey) {
        throw new Error(
            'CLERK_SECRET_KEY is required — the API cannot verify sessions without it. ' +
                'Copy it from the Clerk dashboard into server/.env'
        );
    }

    // Set to true when running behind a reverse proxy (Railway, etc.) so
    // rate limiting sees real client IPs from X-Forwarded-For.
    const trustProxy = process.env.TRUST_PROXY === 'true';

    return {
        nodeEnv,
        isProduction: nodeEnv === 'production',
        isTest: nodeEnv === 'test',
        port,
        mongoUri,
        corsOrigins,
        apiToken,
        clerkSecretKey,
        trustProxy
    };
}

module.exports = loadEnv();
