/**
 * Environment validation.
 *
 * Regression guard for a failure mode that a green health check hides:
 * @clerk/express needs BOTH Clerk keys, and without the publishable key the
 * process boots happily, answers /healthz with 200, and then throws on every
 * single /api request. That was only caught by running the Docker image,
 * because a developer machine has the key sitting in server/.env where
 * nothing validated it. Config errors belong at startup, not per-request.
 *
 * Runs as 'development' — the check is deliberately skipped under 'test' so
 * the other suites need no Clerk credentials.
 */
process.env.NODE_ENV = 'development';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ENV_MODULE = require.resolve('../src/config/env');

/**
 * Loads config/env.js fresh with the given overrides.
 *
 * Overrides are set to '' rather than deleted on purpose: env.js runs
 * dotenv.config(), which back-fills any key *absent* from process.env from
 * the developer's real server/.env. An empty string is still present, so
 * dotenv leaves it alone and the validation sees a missing value.
 */
function loadEnvWith(overrides) {
    const saved = { ...process.env };
    delete require.cache[ENV_MODULE];
    Object.assign(process.env, overrides);

    try {
        return require(ENV_MODULE);
    } finally {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, saved);
        delete require.cache[ENV_MODULE];
    }
}

const BOTH_KEYS = {
    CLERK_SECRET_KEY: 'sk_test_fake',
    CLERK_PUBLISHABLE_KEY: 'pk_test_fake'
};

test('boots when both Clerk keys are present', () => {
    const env = loadEnvWith(BOTH_KEYS);
    assert.equal(env.clerkSecretKey, 'sk_test_fake');
    assert.equal(env.clerkPublishableKey, 'pk_test_fake');
});

test('refuses to boot without CLERK_PUBLISHABLE_KEY', () => {
    assert.throws(
        () => loadEnvWith({ ...BOTH_KEYS, CLERK_PUBLISHABLE_KEY: '' }),
        /CLERK_PUBLISHABLE_KEY is required/
    );
});

test('refuses to boot without CLERK_SECRET_KEY', () => {
    assert.throws(
        () => loadEnvWith({ ...BOTH_KEYS, CLERK_SECRET_KEY: '' }),
        /CLERK_SECRET_KEY is required/
    );
});

test('names both keys when both are missing', () => {
    assert.throws(
        () => loadEnvWith({ CLERK_SECRET_KEY: '', CLERK_PUBLISHABLE_KEY: '' }),
        /CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY are required/
    );
});

test('rejects an out-of-range PORT', () => {
    assert.throws(() => loadEnvWith({ ...BOTH_KEYS, PORT: '70000' }), /Invalid PORT/);
});
