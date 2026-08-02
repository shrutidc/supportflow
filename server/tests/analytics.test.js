/**
 * Analytics endpoint.
 *
 * The isolation test matters more here than anywhere else: a `$group` run
 * against the wrong scope does not throw or look wrong — it returns a
 * plausible number that silently includes another tenant's tickets.
 */
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const createApp = require('../src/app');
const Ticket = require('../models/Ticket');
const { fakeAuthMiddleware, as } = require('./helpers/auth');

const ORG = 'org_analytics';
const OTHER_ORG = 'org_other';
const AGENT = as({ userId: 'user_agent', orgId: ORG });

let mongod;
let app;

const HOUR = 3600 * 1000;

function ticket(overrides) {
    const createdAt = overrides.createdAt ?? new Date(Date.now() - 10 * HOUR);
    return {
        organizationId: ORG,
        ticketId: overrides.ticketId,
        subject: 'Test ticket',
        category: 'Incident',
        priority: 'Medium',
        status: 'New',
        queue: 'Technical Support',
        customer: { name: 'Test Customer' },
        createdAt,
        lastUpdated: createdAt,
        slaDeadline: new Date(createdAt.getTime() + 24 * HOUR),
        messages: [],
        ...overrides
    };
}

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = createApp({ authMiddleware: fakeAuthMiddleware });

    const now = Date.now();
    await Ticket.insertMany([
        // Closed inside SLA: opened 10h ago, resolved 2h later, 24h deadline.
        ticket({
            ticketId: 'AN-1',
            status: 'Closed',
            createdAt: new Date(now - 10 * HOUR),
            lastUpdated: new Date(now - 8 * HOUR)
        }),
        // Closed outside SLA: resolved 30h after opening.
        ticket({
            ticketId: 'AN-2',
            status: 'Closed',
            createdAt: new Date(now - 40 * HOUR),
            lastUpdated: new Date(now - 10 * HOUR),
            slaDeadline: new Date(now - 16 * HOUR)
        }),
        // Open and already past its deadline.
        ticket({
            ticketId: 'AN-3',
            status: 'In Progress',
            assignedTo: 'Support Team',
            priority: 'High',
            createdAt: new Date(now - 50 * HOUR),
            slaDeadline: new Date(now - 46 * HOUR)
        }),
        // Open, unassigned, still inside its deadline.
        ticket({
            ticketId: 'AN-4',
            status: 'New',
            queue: 'Billing and Payments',
            createdAt: new Date(now - 2 * HOUR),
            slaDeadline: new Date(now + 22 * HOUR)
        }),
        ticket({ ticketId: 'AN-5', status: 'Escalated', assignedTo: 'Engineering Queue' }),
        // Another tenant's data — must never reach the numbers above.
        ticket({
            ticketId: 'OTHER-1',
            organizationId: OTHER_ORG,
            status: 'Closed',
            priority: 'Low'
        })
    ]);
});

after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

test('requires authentication', async () => {
    const res = await request(app).get('/api/analytics/overview');
    assert.equal(res.status, 401);
});

test('totals count only this organization', async () => {
    const res = await request(app).get('/api/analytics/overview').set(AGENT);
    assert.equal(res.status, 200);
    // Five tickets in ORG; the sixth belongs to OTHER_ORG.
    assert.equal(res.body.totals.all, 5);
    assert.equal(res.body.totals.closed, 2);
    assert.equal(res.body.totals.open, 3);
    assert.equal(res.body.totals.escalated, 1);
    assert.equal(res.body.totals.unassigned, 1);
});

test('another tenant sees only its own ticket', async () => {
    const res = await request(app)
        .get('/api/analytics/overview')
        .set(as({ userId: 'user_other', orgId: OTHER_ORG }));
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.all, 1);
    assert.equal(res.body.totals.closed, 1);
});

test('SLA compliance counts on-time resolutions, not open breaches', async () => {
    const res = await request(app).get('/api/analytics/overview').set(AGENT);
    const { sla } = res.body;
    assert.equal(sla.closedTotal, 2);
    assert.equal(sla.closedOnTime, 1);
    assert.equal(sla.compliance, 0.5);
    assert.equal(sla.openTotal, 3);
    // AN-3 is the only open ticket past its deadline.
    assert.equal(sla.openBreached, 1);
});

test('resolution percentiles are computed from closed tickets only', async () => {
    const res = await request(app).get('/api/analytics/overview').set(AGENT);
    // AN-1 took 2h, AN-2 took 30h.
    assert.equal(res.body.resolution.count, 2);
    assert.equal(res.body.resolution.medianHours, 2);
    assert.equal(res.body.resolution.p90Hours, 30);
});

test('groupings are present and scoped', async () => {
    const res = await request(app).get('/api/analytics/overview').set(AGENT);
    const statuses = Object.fromEntries(res.body.byStatus.map(r => [r.status, r.count]));
    assert.equal(statuses.Closed, 2);
    assert.equal(statuses.Escalated, 1);

    const queues = Object.fromEntries(res.body.byQueue.map(r => [r.queue, r.count]));
    assert.equal(queues['Billing and Payments'], 1);
    // The other tenant's Low-priority ticket must not appear.
    assert.ok(!res.body.byPriority.some(r => r.priority === 'Low'));
});

test('the volume series covers every day in the window, including quiet ones', async () => {
    const res = await request(app).get('/api/analytics/overview?days=7').set(AGENT);
    assert.equal(res.body.periodDays, 7);
    assert.equal(res.body.volume.length, 7);
    assert.ok(res.body.volume.every(d => typeof d.created === 'number'));
    // Ascending, so a chart plots it left to right without sorting.
    const dates = res.body.volume.map(d => d.date);
    assert.deepEqual(dates, [...dates].sort());
});

test('backlog buckets count open tickets only', async () => {
    const res = await request(app).get('/api/analytics/overview').set(AGENT);
    const total = res.body.backlogAge.reduce((sum, b) => sum + b.count, 0);
    assert.equal(total, 3);
});

test('an out-of-range window is rejected rather than scanning everything', async () => {
    const res = await request(app).get('/api/analytics/overview?days=9999').set(AGENT);
    // The schema catches and falls back to the default rather than erroring.
    assert.equal(res.status, 200);
    assert.equal(res.body.periodDays, 14);
});

test('the repository refuses to aggregate without an organization', () => {
    const analyticsRepo = require('../src/repositories/analytics.repo');
    assert.throws(() => analyticsRepo.forOrg(undefined), /requires an organizationId/);
    assert.throws(() => analyticsRepo.forOrg(''), /requires an organizationId/);
});
