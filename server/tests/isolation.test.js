/**
 * Cross-tenant isolation.
 *
 * These are the tests that matter most in the whole suite: a defect here
 * leaks one customer's support tickets to another. Every read and write is
 * attempted across an organization boundary and must fail as though the
 * data simply does not exist.
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
const ticketRepo = require('../src/repositories/ticket.repo');
const { fakeAuthMiddleware, as } = require('./helpers/auth');

const ORG_A = 'org_acme';
const ORG_B = 'org_globex';

const ALICE = as({ userId: 'user_alice', orgId: ORG_A, role: 'org:member', name: 'Alice' });
const BOB = as({ userId: 'user_bob', orgId: ORG_B, role: 'org:member', name: 'Bob' });
const BOB_ADMIN = as({ userId: 'user_bob', orgId: ORG_B, role: 'org:admin', name: 'Bob' });

let mongod;
let app;

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = createApp({ authMiddleware: fakeAuthMiddleware });
});

after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    // Both tenants hold the same demo dataset, so every ticket id exists in
    // both. Any leak shows up as data, not as an empty result.
    await seedDB(ORG_A);
    await seedDB(ORG_B);
});

// --- reads ---

test('each organization sees only its own tickets', async () => {
    const a = await request(app).get('/api/tickets').set(ALICE);
    const b = await request(app).get('/api/tickets').set(BOB);

    assert.equal(a.body.tickets.length, 20);
    assert.equal(b.body.tickets.length, 20);
    assert.equal(await Ticket.countDocuments({}), 40, 'both tenants should be stored');
});

test('a ticket read returns the caller organization copy, not another tenant one', async () => {
    // Make org A's SF-1001 distinguishable.
    await request(app)
        .post('/api/tickets/SF-1001/messages')
        .set(ALICE)
        .send({ sender: 'agent', body: 'ACME-ONLY-MARKER' });

    const bobsCopy = await request(app).get('/api/tickets/SF-1001').set(BOB);
    assert.equal(bobsCopy.status, 200);

    const bodies = bobsCopy.body.messages.map(m => m.body).join(' ');
    assert.ok(
        !bodies.includes('ACME-ONLY-MARKER'),
        "org B must not receive org A's message content"
    );
});

test("a ticket that exists only in another organization reads as 404, not 403", async () => {
    await Ticket.create({
        organizationId: ORG_A,
        ticketId: 'SF-SECRET',
        subject: 'Acme confidential incident',
        category: 'Bug',
        priority: 'High',
        status: 'New',
        customer: { name: 'Acme' },
        slaDeadline: new Date()
    });

    const res = await request(app).get('/api/tickets/SF-SECRET').set(BOB);
    // 403 would confirm the id exists somewhere — an existence oracle.
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Ticket not found' });
});

test('search cannot reach across tenants', async () => {
    await Ticket.create({
        organizationId: ORG_A,
        ticketId: 'SF-9001',
        subject: 'Zzyzx unique acme subject',
        category: 'Bug',
        priority: 'Low',
        status: 'New',
        customer: { name: 'Acme' },
        slaDeadline: new Date()
    });

    const found = await request(app).get('/api/tickets?q=Zzyzx').set(ALICE);
    assert.equal(found.body.tickets.length, 1);

    const leaked = await request(app).get('/api/tickets?q=Zzyzx').set(BOB);
    assert.equal(leaked.body.tickets.length, 0);
});

// --- writes ---

test('cannot patch a ticket in another organization', async () => {
    const res = await request(app)
        .patch('/api/tickets/SF-1002')
        .set(BOB_ADMIN) // even an admin, because the tenant boundary outranks roles
        .send({ status: 'Closed' });

    assert.equal(res.status, 200, "org B's own SF-1002 is updated");

    const acme = await Ticket.findOne({ organizationId: ORG_A, ticketId: 'SF-1002' });
    assert.notEqual(acme.status, 'Closed', "org A's SF-1002 must be untouched");
});

test('cannot claim a ticket in another organization', async () => {
    await request(app).post('/api/tickets/SF-1003/claim').set(ALICE);

    // Bob claims his own org's SF-1003 — should succeed independently.
    const bobClaim = await request(app).post('/api/tickets/SF-1003/claim').set(BOB);
    assert.equal(bobClaim.status, 200);

    const acme = await Ticket.findOne({ organizationId: ORG_A, ticketId: 'SF-1003' });
    const globex = await Ticket.findOne({ organizationId: ORG_B, ticketId: 'SF-1003' });
    assert.equal(acme.assignedToUserId, 'user_alice');
    assert.equal(globex.assignedToUserId, 'user_bob');
});

test('cannot post a message onto another organization ticket', async () => {
    await request(app)
        .post('/api/tickets/SF-1004/messages')
        .set(BOB)
        .send({ sender: 'agent', body: 'GLOBEX-MARKER' });

    const acme = await Ticket.findOne({ organizationId: ORG_A, ticketId: 'SF-1004' });
    assert.ok(
        !acme.messages.some(m => m.body === 'GLOBEX-MARKER'),
        "org A's ticket must not receive org B's message"
    );
});

test('a forged organizationId in the request body is ignored', async () => {
    // SF-1001 is "New" in the seed data, so "Closed" is a real change and the
    // assertion below cannot pass vacuously.
    const before = await Ticket.findOne({ organizationId: ORG_A, ticketId: 'SF-1001' });
    assert.equal(before.status, 'New');

    // The tenant comes from the verified session; body fields cannot override it.
    const res = await request(app)
        .patch('/api/tickets/SF-1001')
        .set(BOB)
        .send({ status: 'Closed', organizationId: ORG_A });

    assert.equal(res.status, 200);
    assert.equal(res.body.organizationId, ORG_B, 'the session tenant wins over the body');

    const acme = await Ticket.findOne({ organizationId: ORG_A, ticketId: 'SF-1001' });
    assert.equal(acme.status, 'New', "org A's ticket must be untouched");
});

// --- the structural guarantee ---

test('the repository refuses to build a query without an organization', () => {
    assert.throws(() => ticketRepo.forOrg(undefined), /requires an organizationId/);
    assert.throws(() => ticketRepo.forOrg(null), /requires an organizationId/);
    assert.throws(() => ticketRepo.forOrg(''), /requires an organizationId/);
});

test('seeding one organization leaves other tenants untouched', async () => {
    await request(app).patch('/api/tickets/SF-1006').set(BOB).send({ status: 'Closed' });

    // Re-seed org A only.
    await seedDB(ORG_A);

    const globex = await Ticket.findOne({ organizationId: ORG_B, ticketId: 'SF-1006' });
    assert.equal(globex.status, 'Closed', "org B's data must survive a re-seed of org A");
    assert.equal(await Ticket.countDocuments({ organizationId: ORG_B }), 20);
});
