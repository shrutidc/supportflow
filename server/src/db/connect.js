const mongoose = require('mongoose');
const env = require('../config/env');
const logger = require('../lib/logger');

/**
 * Cached connection, shared across warm serverless invocations.
 *
 * A serverless container is reused between requests, so connecting per
 * request would open a fresh pool every time and exhaust the Atlas
 * connection limit. Holding the *promise* (not just the connection) also
 * means concurrent cold requests wait on one attempt instead of racing.
 */
let connectionPromise = null;

/**
 * Connects to MongoDB. Prefers MONGODB_URI; in non-production
 * environments falls back to an in-memory server seeded with demo data
 * so the app runs with zero external dependencies.
 *
 * Idempotent: repeated calls reuse the first connection. Resolves only once
 * a connection is established, so the HTTP server can defer listening until
 * the database is ready.
 */
function connectDatabase() {
    if (!connectionPromise) {
        connectionPromise = openConnection().catch(err => {
            // Clear the cache so the next invocation retries rather than
            // replaying a transient failure for the life of the container.
            connectionPromise = null;
            throw err;
        });
    }
    return connectionPromise;
}

async function openConnection() {
    if (env.mongoUri) {
        try {
            await mongoose.connect(env.mongoUri, {
                serverSelectionTimeoutMS: 5000,
                // Each serverless container keeps its own pool, and Atlas M0
                // allows only 500 connections in total. The default of 100
                // per container would exhaust that after a handful of
                // containers; this workload needs a couple at most.
                maxPoolSize: 5
            });
            logger.info('MongoDB connected', { source: 'uri' });
            return { source: 'uri' };
        } catch (err) {
            if (env.isProduction) {
                throw err; // never silently degrade in production
            }
            logger.warn('Primary MongoDB connection failed, falling back to in-memory', {
                error: err.message
            });
        }
    } else {
        logger.warn('MONGODB_URI not set, defaulting to in-memory database');
    }

    // Lazy-require so production deployments never load the dev dependency path.
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const seedDB = require('./seed');

    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    logger.info('MongoDB connected', { source: 'in-memory' });

    await seedDB();
    return { source: 'in-memory', memoryServer };
}

async function disconnectDatabase(handle) {
    connectionPromise = null;
    await mongoose.disconnect();
    if (handle && handle.memoryServer) {
        await handle.memoryServer.stop();
    }
}

module.exports = { connectDatabase, disconnectDatabase };
