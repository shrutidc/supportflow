const Ticket = require('../../models/Ticket');

/**
 * All Mongoose access for tickets lives here.
 * No business rules, no HTTP concerns.
 */

const LIST_PROJECTION =
    'ticketId customer.name customer.company subject priority status assignedTo lastUpdated';

async function findMany(query, { sort, limit }) {
    return Ticket.find(query)
        .select(LIST_PROJECTION)
        .sort(sort)
        .limit(limit);
}

async function findByTicketId(ticketId) {
    return Ticket.findOne({ ticketId });
}

/**
 * Applies a $set update to a ticket. `extraFilter` lets the service
 * express conditional updates (e.g. atomic claim) in a single operation.
 */
async function updateByTicketId(ticketId, updates, extraFilter = {}) {
    return Ticket.findOneAndUpdate(
        { ticketId, ...extraFilter },
        { $set: updates },
        { new: true, runValidators: true }
    );
}

async function pushMessage(ticketId, message, setFields) {
    return Ticket.findOneAndUpdate(
        { ticketId },
        { $push: { messages: message }, $set: setFields },
        { new: true }
    );
}

module.exports = {
    findMany,
    findByTicketId,
    updateByTicketId,
    pushMessage
};
