const ticketRepo = require('../repositories/ticket.repo');
const HttpError = require('../lib/http-error');
const { ROLES, hasAtLeast } = require('../lib/roles');

/**
 * Business rules for the ticket workflow.
 *
 * Every function takes an `auth` context ({ userId, organizationId, role })
 * resolved from the verified session by the auth middleware, and reaches the
 * database only through a repository already scoped to that organization.
 * HTTP concerns live in the controller, persistence in the repository.
 */

const ESCALATION_SLA_HOURS = 4;
const ENGINEERING_QUEUE = 'Engineering Queue';

/** Escape user input before embedding it in a regex (search injection / ReDoS). */
function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildListQuery({ status, q, view }, auth) {
    const query = {};

    if (status && status !== 'All') {
        query.status = status;
    }

    if (q) {
        query.subject = { $regex: escapeRegex(q), $options: 'i' };
    }

    if (view === 'assigned') {
        // "Assigned to me" now means the signed-in user, matched by id.
        // Names are ambiguous across a workspace; ids are not.
        query.assignedToUserId = auth.userId;
    } else if (view === 'escalations') {
        query.status = 'Escalated';
    }

    return query;
}

async function listTickets({ status, q, view, sort, limit }, auth) {
    const query = buildListQuery({ status, q, view }, auth);
    const sortObj = { lastUpdated: sort === 'lastUpdated_asc' ? 1 : -1 };

    return ticketRepo.forOrg(auth.organizationId).findMany(query, { sort: sortObj, limit });
}

async function getTicket(ticketId, auth) {
    const ticket = await ticketRepo.forOrg(auth.organizationId).findByTicketId(ticketId);
    if (!ticket) {
        // A ticket belonging to another organization is reported as missing,
        // not forbidden: a 403 would confirm the id exists elsewhere.
        throw new HttpError(404, 'Ticket not found');
    }
    return ticket;
}

/**
 * Domain side effects of a status change:
 *  - Escalated  -> High priority, Engineering Queue, tightened SLA
 *  - New        -> unassigned
 */
function applyStatusSideEffects(updates) {
    if (updates.status === 'Escalated') {
        updates.priority = 'High';
        updates.assignedTo = ENGINEERING_QUEUE;
        // A queue is not a person, so no user owns the ticket any more.
        updates.assignedToUserId = null;
        updates.slaDeadline = new Date(Date.now() + ESCALATION_SLA_HOURS * 60 * 60 * 1000);
    } else if (updates.status === 'New') {
        updates.assignedTo = null;
        updates.assignedToUserId = null;
    }
    return updates;
}

/**
 * The caller takes ownership of an unassigned ticket.
 *
 * Atomic: the conditional filter means the update succeeds only while the
 * ticket is still unowned, removing the read-then-write race in which two
 * agents could both believe they claimed it.
 */
async function claimTicket(ticketId, auth) {
    const repo = ticketRepo.forOrg(auth.organizationId);

    const claimed = await repo.updateByTicketId(
        ticketId,
        {
            assignedTo: auth.actorName || 'You',
            assignedToUserId: auth.userId,
            status: 'In Progress',
            lastUpdated: new Date()
        },
        { $or: [{ assignedToUserId: null }, { assignedToUserId: { $exists: false } }] }
    );

    if (claimed) {
        return claimed;
    }

    // Distinguish "already claimed" from "does not exist in this organization".
    const existing = await repo.findByTicketId(ticketId);
    if (!existing) {
        throw new HttpError(404, 'Ticket not found');
    }
    throw new HttpError(409, 'Ticket is already assigned');
}

async function updateTicket(ticketId, requestedUpdates, auth) {
    // Reassigning someone else's work is a supervisory action.
    if (requestedUpdates.assignedTo !== undefined && !hasAtLeast(auth.role, ROLES.MANAGER)) {
        throw new HttpError(403, 'Only managers and administrators can reassign tickets');
    }

    const updates = applyStatusSideEffects({ ...requestedUpdates });
    updates.lastUpdated = new Date();

    // A manual reassignment sets a display label, not a specific person,
    // so ownership by user id is cleared unless a status rule already set it.
    if (requestedUpdates.assignedTo !== undefined && updates.assignedToUserId === undefined) {
        updates.assignedToUserId = null;
    }

    const updated = await ticketRepo
        .forOrg(auth.organizationId)
        .updateByTicketId(ticketId, updates);

    if (!updated) {
        throw new HttpError(404, 'Ticket not found');
    }
    return updated;
}

async function addMessage(ticketId, { sender, body }, auth) {
    if (!sender || !body) {
        throw new HttpError(400, 'Missing sender or body');
    }

    const repo = ticketRepo.forOrg(auth.organizationId);

    const ticket = await repo.findByTicketId(ticketId);
    if (!ticket) {
        throw new HttpError(404, 'Ticket not found');
    }

    const message = { sender, body, timestamp: new Date() };
    const setFields = { lastUpdated: new Date() };

    // The first agent reply on a New ticket implicitly claims it.
    if (ticket.status === 'New' && sender === 'agent') {
        setFields.status = 'In Progress';
        setFields.assignedTo = auth.actorName || 'You';
        setFields.assignedToUserId = auth.userId;
    }

    return repo.pushMessage(ticketId, message, setFields);
}

module.exports = {
    listTickets,
    getTicket,
    claimTicket,
    updateTicket,
    addMessage
};
