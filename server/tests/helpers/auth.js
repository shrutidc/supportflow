const { mapClerkRole } = require('../../src/lib/roles');

/**
 * Test-only stand-in for Clerk session verification.
 *
 * Reads a fake session from request headers so a test can act as any user,
 * organization, or role without network calls. Injected explicitly via
 * createApp({ authMiddleware }) — production always uses real Clerk.
 */
function fakeAuthMiddleware(req, res, next) {
    const userId = req.get('x-test-user');
    const orgId = req.get('x-test-org');
    const clerkRole = req.get('x-test-role') || 'org:member';

    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!orgId) {
        return res
            .status(403)
            .json({ error: 'No active organization. Select or create a workspace to continue.' });
    }

    req.auth = {
        userId,
        organizationId: orgId,
        role: mapClerkRole(clerkRole),
        actorName: req.get('x-test-name') || undefined
    };
    next();
}

/** Headers identifying a caller, for supertest `.set(...)`. */
function as({ userId = 'user_test', orgId = 'org_test', role = 'org:member', name } = {}) {
    const headers = {
        'x-test-user': userId,
        'x-test-org': orgId,
        'x-test-role': role
    };
    if (name) headers['x-test-name'] = name;
    return headers;
}

module.exports = { fakeAuthMiddleware, as };
