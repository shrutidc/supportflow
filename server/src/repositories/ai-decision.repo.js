const AIDecision = require('../../models/AIDecision');

/**
 * Organization-scoped AI decision repository.
 *
 * Same shape as ticket.repo and analytics.repo, for the same reason:
 * `forOrg(organizationId)` is the only export, so there is no unscoped query
 * available to call by accident.
 *
 * All Mongoose access for AI decisions lives here. No business rules, no HTTP.
 */

function forOrg(organizationId) {
    if (!organizationId) {
        throw new Error('aiDecisionRepo.forOrg requires an organizationId');
    }

    const scoped = (filter = {}) => ({ ...filter, organizationId });

    return {
        /**
         * The most recent decision for this ticket and feature whose input
         * still matches. A mismatch means the ticket changed, so the stored
         * answer describes a ticket that no longer exists.
         */
        async findFresh(ticketId, feature, inputHash) {
            return AIDecision.findOne(scoped({ ticketId, feature, inputHash })).sort({
                createdAt: -1
            });
        },

        async create(decision) {
            return AIDecision.create({ ...decision, organizationId });
        },

        async listForTicket(ticketId, limit) {
            return AIDecision.find(scoped({ ticketId })).sort({ createdAt: -1 }).limit(limit);
        },

        async findById(decisionId) {
            return AIDecision.findOne(scoped({ _id: decisionId }));
        },

        /**
         * Records the human verdict. Scoped by organization, so a decision id
         * from another tenant simply does not resolve.
         */
        async recordAction(decisionId, { userAction, actedByUserId }) {
            return AIDecision.findOneAndUpdate(
                scoped({ _id: decisionId }),
                { $set: { userAction, actedByUserId, actedAt: new Date() } },
                { new: true, runValidators: true }
            );
        }
    };
}

module.exports = { forOrg };
