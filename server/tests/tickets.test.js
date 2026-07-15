/**
 * Characterization + security tests for the ticket API.
 * Runs against an in-memory MongoDB; no external services required.
 */
process.env.NODE_ENV = 'test';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const createApp = require('../src/app');
const seedDB = require('../src/db/seed');
const Ticket = require('../models/Ticket');

let mongod;
let app;

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = createApp();
});

after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    await seedDB();
});

// --- GET /api/tickets ---

test('lists all 20 seeded tickets with the list projection', async () => {
    const res = await request(app).get('/api/tickets');
    assert.equal(res.status, 200);
    assert.equal(res.body.tickets.length, 20);

    const t = res.body.tickets[0];
    assert.ok(t.ticketId);
    assert.ok(t.customer.name);
    assert.ok(t.subject);
    assert.ok(t.status);
    // full documents are not leaked in list view
    assert.equal(t.messages, undefined);
});

test('filters by status', async () => {
    const res = await request(app).get('/api/tickets?status=Escalated');
    assert.equal(res.status, 200);
    assert.ok(res.body.tickets.length > 0);
    assert.ok(res.body.tickets.every(t => t.status === 'Escalated'));
});

test('searches subject with q, case-insensitively', async () => {
    const res = await request(app).get('/api/tickets?q=api');
    assert.equal(res.status, 200);
    assert.ok(res.body.tickets.length > 0);
    assert.ok(res.body.tickets.every(t => /api/i.test(t.subject)));
});

test('regex metacharacters in q are treated literally', async () => {
    const res = await request(app).get('/api/tickets?q=' + encodeURIComponent('(((['));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.tickets, []);
});

test('view=escalations returns only escalated tickets', async () => {
    const res = await request(app).get('/api/tickets?view=escalations');
    assert.ok(res.body.tickets.length > 0);
    assert.ok(res.body.tickets.every(t => t.status === 'Escalated'));
});

test('view=assigned returns only tickets assigned to You', async () => {
    await request(app)
        .patch('/api/tickets/SF-1001')
        .send({ assignedTo: 'You', status: 'In Progress' });

    const res = await request(app).get('/api/tickets?view=assigned');
    assert.ok(res.body.tickets.length > 0);
    assert.ok(res.body.tickets.every(t => t.assignedTo === 'You'));
});

test('sorts by lastUpdated descending by default, ascending on request', async () => {
    const desc = (await request(app).get('/api/tickets')).body.tickets;
    for (let i = 1; i < desc.length; i++) {
        assert.ok(new Date(desc[i - 1].lastUpdated) >= new Date(desc[i].lastUpdated));
    }

    const asc = (await request(app).get('/api/tickets?sort=lastUpdated_asc')).body.tickets;
    for (let i = 1; i < asc.length; i++) {
        assert.ok(new Date(asc[i - 1].lastUpdated) <= new Date(asc[i].lastUpdated));
    }
});

test('respects limit and falls back to default on garbage', async () => {
    const limited = await request(app).get('/api/tickets?limit=5');
    assert.equal(limited.body.tickets.length, 5);

    const garbage = await request(app).get('/api/tickets?limit=banana');
    assert.equal(garbage.status, 200);
    assert.equal(garbage.body.tickets.length, 20); // default 50 > seed size
});

// --- GET /api/tickets/:ticketId ---

test('returns a full ticket by id, 404 when missing', async () => {
    const found = await request(app).get('/api/tickets/SF-1001');
    assert.equal(found.status, 200);
    assert.equal(found.body.ticketId, 'SF-1001');
    assert.ok(Array.isArray(found.body.messages));

    const missing = await request(app).get('/api/tickets/SF-9999');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Ticket not found' });
});

// --- PATCH /api/tickets/:ticketId ---

test('updates status and bumps lastUpdated', async () => {
    const beforeDoc = await Ticket.findOne({ ticketId: 'SF-1001' });
    const res = await request(app)
        .patch('/api/tickets/SF-1001')
        .send({ status: 'Closed' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'Closed');
    assert.ok(new Date(res.body.lastUpdated) > new Date(beforeDoc.lastUpdated));
});

test('escalation applies domain side effects', async () => {
    const res = await request(app)
        .patch('/api/tickets/SF-1001')
        .send({ status: 'Escalated' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'Escalated');
    assert.equal(res.body.priority, 'High');
    assert.equal(res.body.assignedTo, 'Engineering Queue');
    assert.ok(new Date(res.body.slaDeadline) > new Date());
});

test('resetting to New clears the assignee', async () => {
    await request(app).patch('/api/tickets/SF-1001').send({ assignedTo: 'You', status: 'In Progress' });
    const res = await request(app).patch('/api/tickets/SF-1001').send({ status: 'New' });

    assert.equal(res.status, 200);
    assert.equal(res.body.assignedTo, null);
});

test('claim succeeds once, then conflicts with 409', async () => {
    const first = await request(app)
        .patch('/api/tickets/SF-1001')
        .send({ assignedTo: 'You', status: 'In Progress' });
    assert.equal(first.status, 200);
    assert.equal(first.body.assignedTo, 'You');

    const second = await request(app)
        .patch('/api/tickets/SF-1001')
        .send({ assignedTo: 'You', status: 'In Progress' });
    assert.equal(second.status, 409);
    assert.deepEqual(second.body, { error: 'Ticket is already assigned' });
});

test('concurrent claims: exactly one wins (atomicity)', async () => {
    const claim = () =>
        request(app)
            .patch('/api/tickets/SF-1001')
            .send({ assignedTo: 'You', status: 'In Progress' });

    const results = await Promise.all([claim(), claim(), claim()]);
    const statuses = results.map(r => r.status).sort();
    assert.deepEqual(statuses, [200, 409, 409]);
});

test('claiming a missing ticket returns 404', async () => {
    const res = await request(app)
        .patch('/api/tickets/SF-9999')
        .send({ assignedTo: 'You', status: 'In Progress' });
    assert.equal(res.status, 404);
});

test('mass-assignment fields are stripped from PATCH', async () => {
    const res = await request(app)
        .patch('/api/tickets/SF-1002')
        .send({
            status: 'In Progress',
            ticketId: 'SF-HACKED',
            createdAt: '1999-01-01T00:00:00Z',
            aiAssist: { sentiment: 'Positive' },
            customer: { name: 'Mallory' }
        });

    assert.equal(res.status, 200);
    assert.equal(res.body.ticketId, 'SF-1002');
    assert.notEqual(new Date(res.body.createdAt).getFullYear(), 1999);
    assert.notEqual(res.body.customer.name, 'Mallory');
});

test('invalid enum values and empty patches are rejected with 400', async () => {
    const badStatus = await request(app).patch('/api/tickets/SF-1001').send({ status: 'Bogus' });
    assert.equal(badStatus.status, 400);

    const badPriority = await request(app).patch('/api/tickets/SF-1001').send({ priority: 'Extreme' });
    assert.equal(badPriority.status, 400);

    const noFields = await request(app).patch('/api/tickets/SF-1001').send({ nonsense: true });
    assert.equal(noFields.status, 400);
});

// --- POST /api/tickets/:ticketId/messages ---

test('appends a message and bumps lastUpdated', async () => {
    const res = await request(app)
        .post('/api/tickets/SF-1002/messages')
        .send({ sender: 'agent', body: 'Engineering has a fix rolling out.' });

    assert.equal(res.status, 200);
    const last = res.body.messages[res.body.messages.length - 1];
    assert.equal(last.sender, 'agent');
    assert.equal(last.body, 'Engineering has a fix rolling out.');
});

test('first agent reply on a New ticket auto-claims it', async () => {
    const res = await request(app)
        .post('/api/tickets/SF-1001/messages')
        .send({ sender: 'agent', body: 'Looking into this now.' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'In Progress');
    assert.equal(res.body.assignedTo, 'You');
});

test('client-supplied customer sender is rejected (fabrication guard)', async () => {
    const res = await request(app)
        .post('/api/tickets/SF-1001/messages')
        .send({ sender: 'customer', body: 'I demand a refund.' });

    assert.equal(res.status, 400);
});

test('rejects invalid sender, blank body, and missing fields with 400', async () => {
    const badSender = await request(app)
        .post('/api/tickets/SF-1001/messages')
        .send({ sender: 'attacker', body: 'hi' });
    assert.equal(badSender.status, 400);

    const blankBody = await request(app)
        .post('/api/tickets/SF-1001/messages')
        .send({ sender: 'agent', body: '   ' });
    assert.equal(blankBody.status, 400);

    const missing = await request(app).post('/api/tickets/SF-1001/messages').send({ sender: 'agent' });
    assert.equal(missing.status, 400);
});

test('messages on a missing ticket return 404', async () => {
    const res = await request(app)
        .post('/api/tickets/SF-9999/messages')
        .send({ sender: 'agent', body: 'hello?' });
    assert.equal(res.status, 404);
});

// --- misc ---

test('unknown API routes return JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
});

test('responses carry security and tracing headers', async () => {
    const res = await request(app).get('/api/tickets');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-request-id']);
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
});
