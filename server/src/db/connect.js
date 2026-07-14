const mongoose = require('mongoose');
const env = require('../config/env');
const logger = require('../lib/logger');

/**
 * Connects to MongoDB. Prefers MONGODB_URI; in non-production
 * environments falls back to an in-memory server seeded with demo data
 * so the app runs with zero external dependencies.
 *
 * Resolves only once a connection is established, so the HTTP server
 * can defer listening until the database is ready.
 */
async function connectDatabase() {
    if (env.mongoUri) {
        try {
            await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
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
    await mongoose.disconnect();
    if (handle && handle.memoryServer) {
        await handle.memoryServer.stop();
    }
}

module.exports = { connectDatabase, disconnectDatabase };
