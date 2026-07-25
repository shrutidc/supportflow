/**
 * Migration 001 — introduce multi-tenancy.
 *
 *   node scripts/migrations/001-add-organization-id.js --org-id=org_xxx [--dry-run]
 *
 * What it does, idempotently:
 *   1. Upserts an Organization record for the given Clerk org.
 *   2. Back-fills organizationId on every ticket that lacks one.
 *   3. Replaces the legacy GLOBAL unique index on ticketId with a compound
 *      unique index on (organizationId, ticketId). Without this step a second
 *      tenant could never have a ticket numbered SF-1001.
 *
 * Safe to re-run. Use --dry-run to preview counts without writing.
 */
const mongoose = require('mongoose');
const env = require('../../src/config/env');
const logger = require('../../src/lib/logger');
const Organization = require('../../models/Organization');
const Ticket = require('../../models/Ticket');

const LEGACY_TICKET_INDEX = 'ticketId_1';
const COMPOUND_INDEX = 'organizationId_1_ticketId_1';

function parseArgs(argv) {
    const args = { dryRun: false, orgId: null, orgName: 'Demo Workspace' };
    for (const arg of argv.slice(2)) {
        if (arg === '--dry-run') args.dryRun = true;
        else if (arg.startsWith('--org-id=')) args.orgId = arg.slice('--org-id='.length);
        else if (arg.startsWith('--org-name=')) args.orgName = arg.slice('--org-name='.length);
    }
    return args;
}

async function migrateIndexes(dryRun) {
    const collection = Ticket.collection;
    const indexes = await collection.indexes();
    const names = indexes.map(i => i.name);

    if (names.includes(LEGACY_TICKET_INDEX)) {
        logger.info('Dropping legacy global unique index on ticketId', {
            index: LEGACY_TICKET_INDEX,
            dryRun
        });
        if (!dryRun) await collection.dropIndex(LEGACY_TICKET_INDEX);
    } else {
        logger.info('Legacy ticketId index not present, nothing to drop');
    }

    if (!names.includes(COMPOUND_INDEX)) {
        logger.info('Creating compound unique index (organizationId, ticketId)', { dryRun });
        if (!dryRun) {
            await collection.createIndex({ organizationId: 1, ticketId: 1 }, { unique: true });
        }
    } else {
        logger.info('Compound unique index already present');
    }
}

async function run() {
    const { orgId, orgName, dryRun } = parseArgs(process.argv);

    if (!orgId) {
        logger.error(
            'Missing --org-id. Pass the Clerk organization id that should own ' +
                'the existing tickets, e.g. --org-id=org_2abc123'
        );
        process.exit(1);
    }
    if (!env.mongoUri) {
        logger.error('MONGODB_URI is not set');
        process.exit(1);
    }

    await mongoose.connect(env.mongoUri);
    logger.info('Connected for migration', { orgId, dryRun });

    try {
        // 1. Organization record
        const existingOrg = await Organization.findOne({ clerkOrgId: orgId });
        if (existingOrg) {
            logger.info('Organization already exists', { orgId, name: existingOrg.name });
        } else {
            logger.info('Creating organization', { orgId, name: orgName, dryRun });
            if (!dryRun) {
                await Organization.create({ clerkOrgId: orgId, name: orgName });
            }
        }

        // 2. Back-fill tickets
        const orphaned = await Ticket.countDocuments({
            $or: [{ organizationId: { $exists: false } }, { organizationId: null }]
        });
        logger.info('Tickets missing organizationId', { count: orphaned, dryRun });

        if (orphaned > 0 && !dryRun) {
            const result = await Ticket.collection.updateMany(
                { $or: [{ organizationId: { $exists: false } }, { organizationId: null }] },
                { $set: { organizationId: orgId } }
            );
            logger.info('Back-filled tickets', { modified: result.modifiedCount, orgId });
        }

        // 3. Indexes (after back-fill, so the unique index cannot fail on nulls)
        await migrateIndexes(dryRun);

        const total = await Ticket.countDocuments({ organizationId: orgId });
        logger.info('Migration complete', { orgId, ticketsInOrg: total, dryRun });
    } finally {
        await mongoose.disconnect();
    }
}

run().catch(err => {
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    process.exit(1);
});
