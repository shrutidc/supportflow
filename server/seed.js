/**
 * Standalone seeding entrypoint: `npm run seed`.
 * Requires MONGODB_URI — seeds the real database with the demo dataset.
 */
const mongoose = require('mongoose');
const env = require('./src/config/env');
const logger = require('./src/lib/logger');
const seedDB = require('./src/db/seed');

async function runSeed() {
    if (!env.mongoUri) {
        logger.error('MONGODB_URI is not set — nothing to seed');
        process.exit(1);
    }

    try {
        await mongoose.connect(env.mongoUri);
        logger.info('MongoDB connected for seeding');
        await seedDB();
        logger.info('Seeding finished, exiting');
        process.exit(0);
    } catch (err) {
        logger.error('Seeding failed', { error: err.message });
        process.exit(1);
    }
}

runSeed();
