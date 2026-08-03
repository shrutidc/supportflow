const crypto = require('crypto');
const ticketRepo = require('../repositories/ticket.repo');
const aiDecisionRepo = require('../repositories/ai-decision.repo');
const aiClient = require('../lib/ai-client');
const HttpError = require('../lib/http-error');

/**
 * AI recommendations for tickets.
 *
 * This layer owns everything the AI service deliberately does not: which
 * organization the ticket belongs to, what the application's vocabulary is,
 * whether an answer can be reused, and what happens to the recommendation
 * afterwards.
 *
 * Nothing here applies a recommendation. Triage returns a suggestion; changing
 * the ticket is a separate, authorized PATCH that a human initiates. That
 * separation is the point — an AI that can act on its own conclusions has no
 * meaningful review step.
 */

/** The application's vocabulary, sent with each request so the AI service
 *  stays generic and cannot invent values the product has never heard of. */
const TAXONOMY = {
    categories: ['Incident', 'Request', 'Problem', 'Change'],
    queues: [
        'Technical Support',
        'Product Support',
        'Customer Service',
        'IT Support',
        'Billing and Payments',
        'Returns and Exchanges',
        'Service Outages and Maintenance',
        'Sales and Pre-Sales',
        'Human Resources',
        'General Inquiry'
    ],
    priorities: ['Low', 'Medium', 'High']
};

const FEATURES = ['summarize', 'triage'];
const HISTORY_LIMIT = 20;

/**
 * Fingerprints the exact input a decision was derived from.
 *
 * Covers the message thread and the fields triage reasons about, so editing a
 * ticket invalidates its cached answer. It deliberately excludes `lastUpdated`
 * — that changes on every claim and assignment, which would discard a still
 * valid decision and pay for an identical one.
 */
function hashInput(ticket, feature) {
    const material = JSON.stringify({
        feature,
        subject: ticket.subject,
        status: ticket.status,
        category: ticket.category,
        priority: ticket.priority,
        queue: ticket.queue,
        messages: ticket.messages.map(m => `${m.sender}:${m.body}`)
    });
    return crypto.createHash('sha256').update(material).digest('hex');
}

function toAnalyzeRequest(ticket, auth) {
    return {
        ticket: {
            subject: ticket.subject,
            status: ticket.status,
            category: ticket.category ?? null,
            priority: ticket.priority ?? null,
            queue: ticket.queue ?? null,
            customer_company: ticket.customer?.company ?? null,
            messages: ticket.messages.map(message => ({
                // Mongoose subdocument ids: what the AI service cites, and
                // what the UI resolves an evidence quote back to.
                id: String(message._id),
                sender: message.sender,
                body: message.body
            }))
        },
        taxonomy: TAXONOMY,
        // Opaque tracing label. The AI service cannot look anything up with it.
        org_tag: auth.organizationId,
        redaction: 'standard'
    };
}

function serialize(decision) {
    return {
        id: String(decision._id),
        ticketId: decision.ticketId,
        feature: decision.feature,
        model: decision.model,
        promptVersion: decision.promptVersion,
        output: decision.output,
        confidence: decision.confidence,
        evidence: decision.evidence,
        latencyMs: decision.latencyMs,
        tokenUsage: decision.tokenUsage,
        groundingDropped: decision.groundingDropped,
        userAction: decision.userAction,
        createdAt: decision.createdAt
    };
}

async function analyzeTicket(ticketId, feature, auth, { requestId, force = false } = {}) {
    if (!FEATURES.includes(feature)) {
        throw new HttpError(400, `Unknown AI feature: ${feature}`);
    }

    const ticket = await ticketRepo.forOrg(auth.organizationId).findByTicketId(ticketId);
    if (!ticket) {
        // Consistent with the rest of the API: a ticket in another workspace
        // is reported as missing, never as forbidden.
        throw new HttpError(404, 'Ticket not found');
    }

    const decisions = aiDecisionRepo.forOrg(auth.organizationId);
    const inputHash = hashInput(ticket, feature);

    if (!force) {
        const cached = await decisions.findFresh(ticketId, feature, inputHash);
        if (cached) {
            return { decision: serialize(cached), cached: true };
        }
    }

    const result = await aiClient.analyze(feature, toAnalyzeRequest(ticket, auth), requestId);

    // Evidence is lifted to the top level for triage and nested in facts for
    // summaries; the stored copy is flattened so the audit view is uniform.
    const evidence = [
        ...(result.output?.evidence ?? []),
        ...(result.output?.extracted_facts ?? []).flatMap(fact => fact.evidence ?? [])
    ].map(item => ({
        messageId: item.message_id,
        quote: item.quote,
        reason: item.reason
    }));

    const created = await decisions.create({
        ticketId,
        feature,
        model: result.model,
        promptVersion: result.prompt_version,
        inputHash,
        output: result.output,
        confidence: result.confidence,
        evidence,
        latencyMs: result.latency_ms,
        tokenUsage: {
            input: result.usage?.input_tokens ?? 0,
            output: result.usage?.output_tokens ?? 0
        },
        groundingDropped: result.grounding?.evidence_dropped ?? 0
    });

    return { decision: serialize(created), cached: false };
}

async function listDecisions(ticketId, auth) {
    // Confirms the ticket is in this organization before returning anything
    // attached to it.
    const ticket = await ticketRepo.forOrg(auth.organizationId).findByTicketId(ticketId);
    if (!ticket) {
        throw new HttpError(404, 'Ticket not found');
    }

    const decisions = await aiDecisionRepo
        .forOrg(auth.organizationId)
        .listForTicket(ticketId, HISTORY_LIMIT);

    return decisions.map(serialize);
}

/**
 * Records what the agent did with a recommendation.
 *
 * Kept for reporting and evaluation only. It never feeds automatic retraining
 * — an accepted suggestion is evidence the feature helped, not licence to
 * change the model behind the user's back.
 */
async function recordFeedback(decisionId, { userAction }, auth) {
    const updated = await aiDecisionRepo
        .forOrg(auth.organizationId)
        .recordAction(decisionId, { userAction, actedByUserId: auth.userId });

    if (!updated) {
        throw new HttpError(404, 'Decision not found');
    }
    return serialize(updated);
}

module.exports = { analyzeTicket, listDecisions, recordFeedback, TAXONOMY };
