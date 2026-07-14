const ticketRepo = require('../repositories/ticket.repo');
const HttpError = require('../lib/http-error');

/**
 * Business rules for the ticket workflow. Behavior matches the
 * pre-refactor server.js exactly; HTTP concerns live in the controller,
 * persistence in the repository.
 */

const ESCALATION_SLA_HOURS = 4;

/** Escape user input before embedding it in a regex (search injection / ReDoS). */
function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildListQuery({ status, q, view }) {
    const query = {};

    if (status && status !== 'All') {
        query.status = status;
    }

    if (q) {
        query.subject = { $regex: escapeRegex(q), $options: 'i' };
    }

    if (view === 'assigned') {
        query.assignedTo = 'You';
    } else if (view === 'escalations') {
        query.status = 'Escalated';
    }

    return query;
}

async function listTickets({ status, q, view, sort, limit }) {
    const query = buildListQuery({ status, q, view });

    const sortObj = { lastUpdated: sort === 'lastUpdated_asc' ? 1 : -1 };

    return ticketRepo.findMany(query, { sort: sortObj, limit });
}

async function getTicket(ticketId) {
    const ticket = await ticketRepo.findByTicketId(ticketId);
    if (!ticket) {
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
        updates.assignedTo = 'Engineering Queue';
        updates.slaDeadline = new Date(Date.now() + ESCALATION_SLA_HOURS * 60 * 60 * 1000);
    } else if (updates.status === 'New') {
        updates.assignedTo = null;
    }
    return updates;
}

function isClaimAttempt(updates) {
    return updates.assignedTo === 'You' && updates.status === 'In Progress';
}

async function updateTicket(ticketId, requestedUpdates) {
    const updates = applyStatusSideEffects({ ...requestedUpdates });
    updates.lastUpdated = new Date();

    if (isClaimAttempt(updates)) {
        // Atomic claim: only succeeds if the ticket is still unassigned.
        // A single conditional update eliminates the read-then-write race
        // where two agents could both claim the same ticket.
        const claimed = await ticketRepo.updateByTicketId(ticketId, updates, {
            $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }]
        });
        if (claimed) {
            return claimed;
        }
        // Claim failed: distinguish "already assigned" from "not found".
        const existing = await ticketRepo.findByTicketId(ticketId);
        if (!existing) {
            throw new HttpError(404, 'Ticket not found');
        }
        throw new HttpError(409, 'Ticket is already assigned');
    }

    const updated = await ticketRepo.updateByTicketId(ticketId, updates);
    if (!updated) {
        throw new HttpError(404, 'Ticket not found');
    }
    return updated;
}

async function addMessage(ticketId, { sender, body }) {
    if (!sender || !body) {
        throw new HttpError(400, 'Missing sender or body');
    }

    const ticket = await ticketRepo.findByTicketId(ticketId);
    if (!ticket) {
        throw new HttpError(404, 'Ticket not found');
    }

    const message = { sender, body, timestamp: new Date() };
    const setFields = { lastUpdated: new Date() };

    // First agent reply on a New ticket implicitly claims it.
    if (ticket.status === 'New' && sender === 'agent') {
        setFields.status = 'In Progress';
        setFields.assignedTo = 'You';
    }

    return ticketRepo.pushMessage(ticketId, message, setFields);
}

module.exports = {
    listTickets,
    getTicket,
    updateTicket,
    addMessage
};
