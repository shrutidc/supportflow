/**
 * Role model.
 *
 * Clerk owns role assignment; these constants map its organization role
 * keys onto SupportFlow's domain roles. Authorization is checked against
 * the role on the verified session — never against anything client-supplied.
 */

const ROLES = {
    ADMIN: 'admin',
    MANAGER: 'manager',
    AGENT: 'agent'
};

/** Clerk org role key -> SupportFlow role. */
const CLERK_ROLE_MAP = {
    'org:admin': ROLES.ADMIN,
    'org:manager': ROLES.MANAGER,
    'org:member': ROLES.AGENT
};

/**
 * Unknown Clerk roles deliberately fall back to the LEAST privileged role
 * rather than throwing: a new role added in the Clerk dashboard should
 * degrade to "agent", never accidentally grant elevated access.
 */
function mapClerkRole(clerkRole) {
    return CLERK_ROLE_MAP[clerkRole] || ROLES.AGENT;
}

/** Privilege ordering for "at least this role" checks. */
const RANK = {
    [ROLES.AGENT]: 1,
    [ROLES.MANAGER]: 2,
    [ROLES.ADMIN]: 3
};

function hasAtLeast(role, minimumRole) {
    return (RANK[role] || 0) >= (RANK[minimumRole] || 0);
}

module.exports = { ROLES, CLERK_ROLE_MAP, mapClerkRole, hasAtLeast };
