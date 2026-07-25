const Ticket = require('../../models/Ticket');

/**
 * Organization-scoped ticket repository.
 *
 * There is no way to reach these queries without first supplying an
 * organization id: `forOrg(organizationId)` is the only export, and every
 * filter it builds starts from that id. A new endpoint therefore cannot
 * forget to scope its reads — the type of mistake that silently leaks one
 * tenant's data to another.
 *
 * All Mongoose access for tickets lives here. No business rules, no HTTP.
 */

const LIST_PROJECTION =
    'ticketId customer.name customer.company subject priority status assignedTo assignedToUserId lastUpdated';

function forOrg(organizationId) {
    if (!organizationId) {
        // Defensive: a missing scope is a programming error, not a 404.
        // Failing loudly here beats silently querying across all tenants.
        throw new Error('ticketRepo.forOrg requires an organizationId');
    }

    /** Every filter in this repository is built through here. */
    const scoped = (filter = {}) => ({ ...filter, organizationId });

    return {
        async findMany(query, { sort, limit }) {
            return Ticket.find(scoped(query)).select(LIST_PROJECTION).sort(sort).limit(limit);
        },

        async findByTicketId(ticketId) {
            return Ticket.findOne(scoped({ ticketId }));
        },

        /**
         * Applies a $set update. `extraFilter` lets the service express
         * conditional updates (e.g. the atomic claim) in one operation.
         */
        async updateByTicketId(ticketId, updates, extraFilter = {}) {
            return Ticket.findOneAndUpdate(
                scoped({ ticketId, ...extraFilter }),
                { $set: updates },
                { new: true, runValidators: true }
            );
        },

        async pushMessage(ticketId, message, setFields) {
            return Ticket.findOneAndUpdate(
                scoped({ ticketId }),
                { $push: { messages: message }, $set: setFields },
                { new: true }
            );
        }
    };
}

module.exports = { forOrg };
