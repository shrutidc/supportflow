const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: String,
        enum: ['customer', 'agent'],
        required: true
    },
    body: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const ticketSchema = new mongoose.Schema({
    // Tenancy key: the Clerk organization id this ticket belongs to.
    // Always resolved from the authenticated session, never from the client.
    organizationId: {
        type: String,
        required: true,
        index: true
    },
    // Human-facing id (SF-1001). Unique *per organization* — see the
    // compound index below — so separate tenants can each have an SF-1001.
    ticketId: {
        type: String,
        required: true
    },
    subject: {
        type: String,
        required: true
    },
    // Two vocabularies coexist deliberately. The first four are the original
    // hand-authored demo taxonomy, still used by the built-in seed that the
    // test suite depends on. The last four are ITIL-style types carried in
    // from the labelled Kaggle dataset, which is the ground truth the AI
    // triage evaluation scores against — remapping them would destroy the
    // labels that make that evaluation meaningful.
    category: {
        type: String,
        enum: [
            'Billing',
            'Integration',
            'Bug',
            'Account Access',
            'Incident',
            'Request',
            'Problem',
            'Change'
        ],
        required: true
    },
    // Routing destination, e.g. "Technical Support". Present in the target
    // domain model and supplied by the dataset's `queue` label; null for the
    // original hand-authored tickets, which predate the concept.
    queue: {
        type: String,
        default: null
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        required: true
    },
    status: {
        type: String,
        enum: ['New', 'In Progress', 'Escalated', 'Closed'],
        required: true
    },
    // Display label for the assignee: a member's name, or a queue such as
    // "Engineering Queue". Kept as a string so the existing API contract and
    // both frontends continue to work unchanged.
    assignedTo: {
        type: String,
        default: null
    },
    // Set when the assignee is a real person (null for queues). This is what
    // "assigned to me" filters on — names are ambiguous, ids are not.
    assignedToUserId: {
        type: String,
        default: null,
        index: true
    },
    customer: {
        name: { type: String, required: true },
        company: { type: String },
        email: { type: String },
        phone: { type: String }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    slaDeadline: {
        type: Date,
        required: true
    },
    aiAssist: {
        sentiment: {
            type: String,
            enum: ['Frustrated', 'Neutral', 'Positive']
        },
        suggestedReply: { type: String },
        recommendedAction: { type: String }
    },
    /**
     * The human labels this ticket arrived with, for tickets imported from the
     * labelled dataset. Absent on hand-authored tickets.
     *
     * Kept separate from `category`/`queue`/`priority` because those are
     * working state: an agent reassigns a queue, an accepted AI triage bumps a
     * priority. Once that happens the field no longer says what a human
     * originally judged, and the ground truth an evaluation scores against
     * would be silently corrupted by ordinary use of the product.
     */
    datasetLabels: {
        type: { type: String },
        queue: { type: String },
        priority: { type: String }
    },
    messages: [messageSchema]
});

// Human-facing ticket ids are unique within an organization, not globally.
ticketSchema.index({ organizationId: 1, ticketId: 1 }, { unique: true });

// Queue listing: filter by org (+ status), sort by recency.
ticketSchema.index({ organizationId: 1, status: 1, lastUpdated: -1 });

// Text index for search
ticketSchema.index({ subject: 'text' });

module.exports = mongoose.model('Ticket', ticketSchema);
