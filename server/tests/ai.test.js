/**
 * AI endpoints.
 *
 * The AI service itself is stubbed: these tests are about what Express owns —
 * tenant scoping, caching, persistence, human feedback, and degrading safely
 * when the service is down. Whether the model classifies well is the AI
 * service's own suite, and later the evaluation harness.
 */
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://ai.test';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const createApp = require('../src/app');
const Ticket = require('../models/Ticket');
const AIDecision = require('../models/AIDecision');
const aiClient = require('../src/lib/ai-client');
const { fakeAuthMiddleware, as } = require('./helpers/auth');

const ORG = 'org_ai';
const OTHER_ORG = 'org_ai_other';
const AGENT = as({ userId: 'user_agent', orgId: ORG });

let mongod;
let app;
let calls;
let stubbedResponse;
let stubbedError;

const realAnalyze = aiClient.analyze;

function triageResponse(overrides = {}) {
    return {
        feature: 'triage',
        model: 'gemini-3.6-flash',
        prompt_version: 'triage/v1',
        latency_ms: 1234,
        usage: { input_tokens: 390, output_tokens: 186 },
        grounding: { evidence_total: 1, evidence_verified: 1, evidence_dropped: 0 },
        confidence: 0.91,
        output: {
            category: 'Incident',
            priority: 'High',
            urgency: 'High',
            recommended_queue: 'Technical Support',
            should_escalate: true,
            confidence: 0.91,
            reasoning_summary: 'Production impact.',
            evidence: [{ message_id: 'm1', quote: 'completely blocked', reason: 'impact' }],
            missing_information: []
        },
        ...overrides
    };
}

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = createApp({ authMiddleware: fakeAuthMiddleware });

    // Stub the network boundary, not the service under test.
    aiClient.analyze = async (feature, payload, requestId) => {
        calls.push({ feature, payload, requestId });
        if (stubbedError) throw stubbedError;
        return stubbedResponse;
    };

    await Ticket.create({
        organizationId: ORG,
        ticketId: 'AI-1',
        subject: 'Production API failing',
        category: 'Incident',
        priority: 'Medium',
        status: 'New',
        queue: 'Technical Support',
        customer: { name: 'Test Customer', company: 'Northwind' },
        slaDeadline: new Date(Date.now() + 3600_000),
        messages: [{ sender: 'customer', body: 'Everything is completely blocked.' }]
    });

    await Ticket.create({
        organizationId: OTHER_ORG,
        ticketId: 'OTHER-1',
        subject: 'Another tenant ticket',
        category: 'Request',
        priority: 'Low',
        status: 'New',
        customer: { name: 'Other Customer' },
        slaDeadline: new Date(Date.now() + 3600_000),
        messages: [{ sender: 'customer', body: 'Unrelated.' }]
    });
});

after(async () => {
    aiClient.analyze = realAnalyze;
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    calls = [];
    stubbedError = null;
    stubbedResponse = triageResponse();
    await AIDecision.deleteMany({});
});

test('requires authentication', async () => {
    const res = await request(app).post('/api/ai/tickets/AI-1/triage');
    assert.equal(res.status, 401);
});

test('returns a recommendation and persists it as a decision', async () => {
    const res = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    assert.equal(res.status, 200);
    assert.equal(res.body.feature, 'triage');
    assert.equal(res.body.output.priority, 'High');
    assert.equal(res.body.model, 'gemini-3.6-flash');
    assert.equal(res.body.promptVersion, 'triage/v1');

    const stored = await AIDecision.findOne({ ticketId: 'AI-1' });
    assert.equal(stored.organizationId, ORG);
    assert.equal(stored.tokenUsage.input, 390);
    assert.equal(stored.latencyMs, 1234);
    // Nobody has judged it yet, which is not the same as rejecting it.
    assert.equal(stored.userAction, null);
});

test('the recommendation is never applied to the ticket', async () => {
    await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    const ticket = await Ticket.findOne({ organizationId: ORG, ticketId: 'AI-1' });
    // Triage said High and Escalate; the ticket must be untouched until a
    // human acts through the ordinary authorized PATCH.
    assert.equal(ticket.priority, 'Medium');
    assert.equal(ticket.status, 'New');
});

test('a ticket in another organization is reported as missing', async () => {
    const res = await request(app).post('/api/ai/tickets/OTHER-1/triage').set(AGENT);
    assert.equal(res.status, 404);
    // No model call for a ticket the caller cannot see.
    assert.equal(calls.length, 0);
});

test('the AI service receives content but never a ticket or organization id', async () => {
    await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    const [call] = calls;
    const serialised = JSON.stringify(call.payload);
    assert.ok(!serialised.includes('AI-1'), 'ticket id must not be sent');
    assert.equal(call.payload.ticket.subject, 'Production API failing');
    assert.ok(call.payload.taxonomy.priorities.includes('High'));
    // org_tag is an opaque trace label, not something to look a tenant up by.
    assert.equal(call.payload.org_tag, ORG);
});

test('an unchanged ticket reuses the stored decision instead of paying again', async () => {
    const first = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    assert.equal(first.headers['x-ai-cache'], 'miss');

    const second = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    assert.equal(second.headers['x-ai-cache'], 'hit');
    assert.equal(second.body.id, first.body.id);
    assert.equal(calls.length, 1, 'the model must be called only once');
});

test('force=true buys a fresh answer', async () => {
    await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    const res = await request(app).post('/api/ai/tickets/AI-1/triage?force=true').set(AGENT);

    assert.equal(res.headers['x-ai-cache'], 'miss');
    assert.equal(calls.length, 2);
});

test('editing the ticket invalidates the cached decision', async () => {
    await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    await request(app)
        .post('/api/tickets/AI-1/messages')
        .set(AGENT)
        .send({ sender: 'agent', body: 'Investigating now.' });

    const res = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    // The stored answer described a ticket that no longer exists.
    assert.equal(res.headers['x-ai-cache'], 'miss');
    assert.equal(calls.length, 2);
});

test('a change that adds no message still invalidates the cache', async () => {
    await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    // Deliberately not a new message: an earlier version of this test only
    // appended one, which also changes the message *count*, so it passed even
    // when the fingerprint ignored message content entirely. Changing priority
    // moves the input without moving the count.
    await request(app).patch('/api/tickets/AI-1').set(AGENT).send({ priority: 'Low' });

    const res = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    assert.equal(res.headers['x-ai-cache'], 'miss');
    assert.equal(calls.length, 2);

    // Restore, so ordering between tests cannot matter.
    await request(app).patch('/api/tickets/AI-1').set(AGENT).send({ priority: 'Medium' });
});

test('rewriting a message body invalidates the cache', async () => {
    await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    // Written directly rather than through the API, because no endpoint edits
    // an existing message today. That is exactly why this needs asserting: the
    // fingerprint must cover message *content*, not merely how many there are,
    // so the guarantee survives a future edit feature or a data migration.
    const ticket = await Ticket.findOne({ organizationId: ORG, ticketId: 'AI-1' });
    const original = ticket.messages[0].body;
    ticket.messages[0].body = 'Actually it resolved itself, please close.';
    await ticket.save();

    try {
        const res = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
        assert.equal(res.headers['x-ai-cache'], 'miss');
        assert.equal(calls.length, 2);
    } finally {
        const restore = await Ticket.findOne({ organizationId: ORG, ticketId: 'AI-1' });
        restore.messages[0].body = original;
        await restore.save();
    }
});

test('decisions do not leak between tenants sharing a ticket id', async () => {
    // Ticket ids are unique per organization, so two tenants can both hold an
    // AI-1. Without scoping on the decision query, one would see the other's
    // history — and the ticket lookup that guards the route would not catch
    // it, because both tickets legitimately exist.
    await Ticket.create({
        organizationId: OTHER_ORG,
        ticketId: 'AI-1',
        subject: 'Same id, different tenant',
        category: 'Request',
        priority: 'Low',
        status: 'New',
        customer: { name: 'Other Customer' },
        slaDeadline: new Date(Date.now() + 3600_000),
        messages: [{ sender: 'customer', body: 'Unrelated content.' }]
    });

    try {
        await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
        await request(app)
            .post('/api/ai/tickets/AI-1/triage')
            .set(as({ userId: 'user_other', orgId: OTHER_ORG }));

        const mine = await request(app).get('/api/ai/tickets/AI-1/decisions').set(AGENT);
        assert.equal(mine.body.decisions.length, 1);

        const stored = await AIDecision.findById(mine.body.decisions[0].id);
        assert.equal(stored.organizationId, ORG);
    } finally {
        await Ticket.deleteOne({ organizationId: OTHER_ORG, ticketId: 'AI-1' });
    }
});

test('a cached decision is not served across tenants', async () => {
    await Ticket.create({
        organizationId: OTHER_ORG,
        ticketId: 'AI-1',
        subject: 'Production API failing',
        category: 'Incident',
        priority: 'Medium',
        status: 'New',
        queue: 'Technical Support',
        // Identical content, so the input fingerprint matches exactly. Only
        // the organization scope keeps the two apart.
        customer: { name: 'Test Customer', company: 'Northwind' },
        slaDeadline: new Date(Date.now() + 3600_000),
        messages: [{ sender: 'customer', body: 'Everything is completely blocked.' }]
    });

    try {
        await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
        const other = await request(app)
            .post('/api/ai/tickets/AI-1/triage')
            .set(as({ userId: 'user_other', orgId: OTHER_ORG }));

        assert.equal(other.headers['x-ai-cache'], 'miss');
        assert.equal(calls.length, 2);
    } finally {
        await Ticket.deleteOne({ organizationId: OTHER_ORG, ticketId: 'AI-1' });
    }
});

test('decision history is scoped to the organization', async () => {
    await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    const mine = await request(app).get('/api/ai/tickets/AI-1/decisions').set(AGENT);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.decisions.length, 1);

    const theirs = await request(app)
        .get('/api/ai/tickets/AI-1/decisions')
        .set(as({ userId: 'user_other', orgId: OTHER_ORG }));
    assert.equal(theirs.status, 404);
});

test('feedback records what the human did', async () => {
    const created = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    const res = await request(app)
        .post(`/api/ai/decisions/${created.body.id}/feedback`)
        .set(AGENT)
        .send({ userAction: 'accepted' });

    assert.equal(res.status, 200);
    assert.equal(res.body.userAction, 'accepted');

    const stored = await AIDecision.findById(created.body.id);
    assert.equal(stored.actedByUserId, 'user_agent');
    assert.ok(stored.actedAt instanceof Date);
});

test('feedback from another organization cannot reach the decision', async () => {
    const created = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);

    const res = await request(app)
        .post(`/api/ai/decisions/${created.body.id}/feedback`)
        .set(as({ userId: 'user_other', orgId: OTHER_ORG }))
        .send({ userAction: 'rejected' });

    assert.equal(res.status, 404);
});

test('an invalid feedback verdict is rejected', async () => {
    const created = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    const res = await request(app)
        .post(`/api/ai/decisions/${created.body.id}/feedback`)
        .set(AGENT)
        .send({ userAction: 'maybe' });

    assert.equal(res.status, 400);
});

test('an unknown feature is not routed', async () => {
    const res = await request(app).post('/api/ai/tickets/AI-1/hallucinate').set(AGENT);
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
});

test('an AI service outage is a 503, and the ticket workspace still works', async () => {
    const HttpError = require('../src/lib/http-error');
    stubbedError = new HttpError(503, 'AI service is unavailable');

    const res = await request(app).post('/api/ai/tickets/AI-1/triage').set(AGENT);
    assert.equal(res.status, 503);

    // The failure is contained to the AI panel.
    const ticket = await request(app).get('/api/tickets/AI-1').set(AGENT);
    assert.equal(ticket.status, 200);

    // Nothing half-written was persisted.
    assert.equal(await AIDecision.countDocuments({}), 0);
});

test('the repository refuses to query without an organization', () => {
    const repo = require('../src/repositories/ai-decision.repo');
    assert.throws(() => repo.forOrg(undefined), /requires an organizationId/);
    assert.throws(() => repo.forOrg(''), /requires an organizationId/);
});
