/**
 * Bearer-token gate (API_TOKEN env). Runs in its own process (node --test
 * isolates files), so setting the env before requiring the app is safe.
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

let mongod;
let app;

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await seedDB();
    app = createApp();
});

after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

test('rejects API requests without a token', async () => {
    const res = await request(app).get('/api/tickets');
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
});

test('rejects a wrong token', async () => {
    const res = await request(app)
        .get('/api/tickets')
        .set('Authorization', 'Bearer wrong-token');
    assert.equal(res.status, 401);
});

test('accepts the correct bearer token', async () => {
    const res = await request(app)
        .get('/api/tickets')
        .set('Authorization', 'Bearer test-secret-token');
    assert.equal(res.status, 200);
    assert.equal(res.body.tickets.length, 20);
});

test('static frontend stays reachable without a token', async () => {
    const res = await request(app).get('/index.html');
    assert.equal(res.status, 200);
});
