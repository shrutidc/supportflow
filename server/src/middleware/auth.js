const { getAuth } = require('@clerk/express');
const HttpError = require('../lib/http-error');
const { mapClerkRole } = require('../lib/roles');

/**
 * Turns a verified Clerk session into `req.auth`:
 *
 *   { userId, organizationId, role }
 *
 * The organization id comes from the signed session token and nowhere else.
 * A client cannot influence which tenant it reads or writes by sending a
 * body field, query parameter, or header — that is the core guarantee of
 * this file.
 */
function requireAuth(req, res, next) {
    const session = getAuth(req);

    if (!session || !session.userId) {
        return next(new HttpError(401, 'Authentication required'));
    }

    // Clerk is configured with "membership required", so every session should
    // carry an active organization. If it does not (user signed in but has
    // not selected/created a workspace yet) there is no tenant to scope to.
    if (!session.orgId) {
        return next(
            new HttpError(403, 'No active organization. Select or create a workspace to continue.')
        );
    }

    req.auth = {
        userId: session.userId,
        organizationId: session.orgId,
        role: mapClerkRole(session.orgRole)
    };

    next();
}

/**
 * Guards a route on a minimum role, e.g. requireRole(ROLES.MANAGER).
 * Must run after requireAuth.
 */
function requireRole(minimumRole) {
    const { hasAtLeast } = require('../lib/roles');
    return (req, res, next) => {
        if (!req.auth) {
            return next(new HttpError(401, 'Authentication required'));
        }
        if (!hasAtLeast(req.auth.role, minimumRole)) {
            return next(new HttpError(403, 'Insufficient permissions'));
        }
        next();
    };
}

module.exports = { requireAuth, requireRole };
