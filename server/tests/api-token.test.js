/**
 * Bearer-token gate (API_TOKEN env), which sits in front of Clerk auth as
 * an extra perimeter for exposed deployments. Runs in its own process
 * (node --test isolates files), so setting the env before requiring the
 * app is safe.
 */
process.env.NODE_ENV = 'test';
process.env.API_TOKEN = 'test-secret-token';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const createApp = require('../src/app');
const seedDB = require('../src/db/seed');
const { fakeAuthMiddleware, as } = require('./helpers/auth');

const ORG = 'org_token_test';
const AGENT = as({ userId: 'user_agent', orgId: ORG });

let mongod;
let app;

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await seedDB(ORG);
    app = createApp({ authMiddleware: fakeAuthMiddleware });
});

after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

test('rejects API requests without a token, even with a valid session', async () => {
    const res = await request(app).get('/api/tickets').set(AGENT);
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
});

test('rejects a wrong token', async () => {
    const res = await request(app)
        .get('/api/tickets')
        .set(AGENT)
        .set('Authorization', 'Bearer wrong-token');
    assert.equal(res.status, 401);
});

test('the token alone is not enough — a session is still required', async () => {
    const res = await request(app)
        .get('/api/tickets')
        .set('Authorization', 'Bearer test-secret-token');
    assert.equal(res.status, 401);
});

test('accepts the correct token together with a valid session', async () => {
    const res = await request(app)
        .get('/api/tickets')
        .set(AGENT)
        .set('Authorization', 'Bearer test-secret-token');
    assert.equal(res.status, 200);
    assert.equal(res.body.tickets.length, 20);
});

test('the health check bypasses both gates', async () => {
    const res = await request(app).get('/healthz');
    assert.equal(res.status, 200);
});
