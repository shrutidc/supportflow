const mongoose = require('mongoose');

/**
 * A record of one AI recommendation, and what a human did about it.
 *
 * Stored rather than computed on demand for three reasons:
 *
 *  - **Auditability.** "Why is this ticket High priority?" has to be
 *    answerable months later, including which model and prompt version said
 *    so. A recommendation with no record is an unexplainable state change.
 *  - **Cost.** `inputHash` lets an unchanged ticket reuse an existing decision
 *    instead of paying for the same answer twice, which is what keeps the
 *    public demo free.
 *  - **Evaluation.** Whether an agent accepted, edited, or rejected each
 *    recommendation is the only honest signal of whether the feature helps.
 *    It feeds reporting, never automatic retraining.
 */

const evidenceSchema = new mongoose.Schema(
    {
        messageId: { type: String, required: true },
        quote: { type: String, required: true },
        reason: { type: String }
    },
    { _id: false }
);

const aiDecisionSchema = new mongoose.Schema({
    // Tenancy key, always resolved from the authenticated session.
    organizationId: {
        type: String,
        required: true,
        index: true
    },
    // The human-facing ticket id (SF-1001), matching how tickets are addressed
    // everywhere else in the API.
    ticketId: {
        type: String,
        required: true
    },
    feature: {
        type: String,
        enum: ['summarize', 'triage'],
        required: true
    },

    // What produced it. `model` is the version the provider actually served,
    // not the alias requested — aliases move, and a decision has to stay
    // attributable to a real model.
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },

    /**
     * Fingerprint of the exact input this decision was derived from. Changes
     * whenever the ticket's content changes, so a cached decision is never
     * served for a ticket that has moved on since.
     */
    inputHash: { type: String, required: true },

    // The validated structured output, stored whole. Shape varies by feature,
    // so it is deliberately unschema'd here — contracts live in the AI service.
    output: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },

    // Post-grounding confidence: already reduced by whatever share of the
    // model's cited evidence failed verification.
    confidence: { type: Number, min: 0, max: 1, required: true },
    evidence: [evidenceSchema],

    // What it cost. Recorded per decision so the evaluation phase can report
    // real cost and latency rather than estimates.
    latencyMs: { type: Number, default: 0 },
    tokenUsage: {
        input: { type: Number, default: 0 },
        output: { type: Number, default: 0 }
    },
    groundingDropped: { type: Number, default: 0 },

    /**
     * The human verdict. Null means nobody has acted yet — distinct from
     * rejected, which is an actual judgement. Collapsing the two would make
     * an unreviewed recommendation look like a refused one.
     */
    userAction: {
        type: String,
        enum: ['accepted', 'edited', 'rejected'],
        default: null
    },
    actedByUserId: { type: String, default: null },
    actedAt: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});

// Serves both the cache lookup (same ticket, same feature, same input) and the
// decision history for a ticket.
aiDecisionSchema.index({ organizationId: 1, ticketId: 1, feature: 1, createdAt: -1 });

module.exports = mongoose.model('AIDecision', aiDecisionSchema);
